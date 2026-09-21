/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  Auth.gs
 * ----------------------------------------------------------------------------
 *  Login, logout, restauración de sesión y gestión de usuarios (solo ADMIN).
 *  Depende de Security.gs (hash + tokens + RBAC) y Logger.gs (auditoría).
 * ============================================================================
 */

/**
 * Punto de entrada de la Web App.
 * Sirve una única página (SPA) y evalúa las plantillas HTML incluidas.
 */
function doGet() {
  var t = HtmlService.createTemplateFromFile('Index');
  return t.evaluate()
    .setTitle('Nechimotos · CRM de Inventarios y Ventas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Permite incluir StyleCss.html / AppJs.html / ReportesJs.html dentro de Index. */
function include(nombreArchivo) {
  return HtmlService.createHtmlOutputFromFile(nombreArchivo).getContent();
}

/* ===========================================================================
 *  LOGIN / LOGOUT
 * =========================================================================== */

/**
 * Verifica credenciales y abre sesión.
 *
 * @param {string} usuario  Nombre de usuario.
 * @param {string} password Contraseña en texto plano (viaja por HTTPS de Google).
 * @return {Object} { ok, data: { token, perfil } } | { ok:false, error }
 */
function login(usuario, password) {
  return ejecutarSeguro_(function () {
    var user = limpiarTexto_(usuario, 60);
    var pass = String(password || '');
    if (!user || !pass) throw new Error('DATO_INVALIDO: usuario y contraseña son obligatorios.');

    // Protección contra fuerza bruta.
    if (intentosFallidos_(user) >= LOGIN_MAX_INTENTOS) {
      registrarAuditoriaAnonima_(user, 'LOGIN_BLOQUEADO',
        'Cuenta bloqueada temporalmente por exceso de intentos fallidos.');
      throw new Error('REGLA_NEGOCIO: cuenta bloqueada temporalmente. Intente en 10 minutos.');
    }

    var registro = buscarUsuario_(user);
    if (!registro) {
      sumarIntentoFallido_(user);
      registrarAuditoriaAnonima_(user, 'LOGIN_FALLIDO', 'Usuario inexistente.');
      throw new Error('REGLA_NEGOCIO: usuario o contraseña incorrectos.');
    }

    var d = registro.datos;
    if (norm_(d.Estado_Cuenta) !== 'ACTIVO') {
      registrarAuditoriaAnonima_(user, 'LOGIN_FALLIDO', 'Cuenta inactiva.');
      throw new Error('REGLA_NEGOCIO: la cuenta se encuentra inactiva. Contacte a la jefatura.');
    }

    var hash = hashPassword(user, pass);
    if (!compararHash_(hash, String(d.Password_Hash || '').trim().toLowerCase())) {
      var n = sumarIntentoFallido_(user);
      registrarAuditoriaAnonima_(user, 'LOGIN_FALLIDO', 'Contraseña incorrecta. Intento ' + n + '.');
      throw new Error('REGLA_NEGOCIO: usuario o contraseña incorrectos.');
    }

    limpiarIntentos_(user);
    var token = crearSesion_(d);
    var ses = validarSesion_(token);
    registrarAuditoria_(ses, 'LOGIN_EXITOSO', '', 'Inicio de sesión correcto.');

    return { token: token, perfil: perfilPublico_(ses) };
  });
}

/** Cierra la sesión activa. */
function logout(token) {
  return ejecutarSeguro_(function () {
    try {
      var ses = validarSesion_(token);
      registrarAuditoria_(ses, 'LOGOUT', '', 'Cierre de sesión.');
    } catch (e) { /* token ya expirado: nada que registrar */ }
    destruirSesion_(token);
    return true;
  });
}

/**
 * Restaura la sesión al recargar la página (el token se guarda en
 * sessionStorage del navegador; el servidor sigue siendo la única autoridad).
 */
function restaurarSesion(token) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    return { token: token, perfil: perfilPublico_(ses) };
  });
}

/**
 * Datos de contexto que el frontend necesita para pintar la UI.
 * Nunca incluye hashes ni información de otros usuarios.
 */
function perfilPublico_(ses) {
  var global = esGlobal_(ses);
  return {
    usuario: ses.usuario,
    rol: ses.rol,
    pdv: global ? 'RED NACIONAL' : ses.pdv,
    pdvAsignado: ses.pdv,
    marca: global ? MARCAS.TODAS : ses.marca,
    esGlobal: global,
    pdvs: global ? CATALOGO_PDV.map(function (p) { return p.nombre; }) : [ses.pdv],
    catalogoPdv: CATALOGO_PDV,
    catalogoLineas: CATALOGO_LINEAS,
    marcas: [MARCAS.TVS, MARCAS.MOBILITY],
    estadosInventario: ESTADOS_INVENTARIO,
    tiposVenta: TIPOS_VENTA
  };
}

/** Busca un usuario por nombre de login (case-insensitive). */
function buscarUsuario_(usuario) {
  var tabla = leerTabla_(SHEETS.USUARIOS);
  var objetivo = norm_(usuario);
  for (var i = 0; i < tabla.filas.length; i++) {
    if (norm_(tabla.filas[i].datos.Usuario) === objetivo) return tabla.filas[i];
  }
  return null;
}

/* ===========================================================================
 *  GESTIÓN DE USUARIOS (ADMIN)
 * =========================================================================== */

/** Lista los usuarios sin exponer los hashes de contraseña. */
function listarUsuarios(token) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirRol_(ses, [ROLES.ADMIN]);
    return leerTabla_(SHEETS.USUARIOS).filas.map(function (f) {
      var d = f.datos;
      return {
        ID_Usuario: d.ID_Usuario,
        Usuario: d.Usuario,
        Rol: d.Rol,
        PDV_Asignado: d.PDV_Asignado,
        Marca_Permitida: d.Marca_Permitida,
        Estado_Cuenta: d.Estado_Cuenta
      };
    });
  });
}

/**
 * Crea un usuario nuevo. Solo ADMIN.
 * @param {Object} datos { usuario, password, rol, pdv, marca }
 */
function crearUsuario(token, datos) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirRol_(ses, [ROLES.ADMIN]);
    datos = datos || {};

    var usuario = limpiarTexto_(datos.usuario, 60);
    var password = String(datos.password || '');
    if (usuario.length < 3) throw new Error('DATO_INVALIDO: el usuario debe tener al menos 3 caracteres.');
    if (password.length < 8) throw new Error('DATO_INVALIDO: la contraseña debe tener al menos 8 caracteres.');
    if (buscarUsuario_(usuario)) throw new Error('REGLA_NEGOCIO: el usuario ya existe.');

    var rol = exigirEnLista_(datos.rol, [ROLES.ADMIN, ROLES.AUXILIAR, ROLES.ASESOR_PDV], 'Rol');
    var marca = exigirEnLista_(datos.marca, ['TVS', 'MOBILITY', 'TODAS'], 'Marca_Permitida');
    var pdv = limpiarTexto_(datos.pdv, 80);

    if (rol === ROLES.ASESOR_PDV) {
      pdv = exigirEnLista_(pdv, pdvsPorMarca_(null), 'PDV_Asignado');
    } else {
      pdv = pdv || 'RED NACIONAL';
      marca = 'TODAS';
    }

    var id = 'U-' + Utilities.formatDate(new Date(), TZ, 'yyMMddHHmmss');
    anexarFila_(SHEETS.USUARIOS, {
      ID_Usuario: id,
      Usuario: usuario,
      Password_Hash: hashPassword(usuario, password),
      Rol: rol,
      PDV_Asignado: pdv,
      Marca_Permitida: marca,
      Estado_Cuenta: 'Activo'
    });

    registrarAuditoria_(ses, 'USUARIO_CREADO', '',
      'Usuario=' + usuario + ' Rol=' + rol + ' PDV=' + pdv + ' Marca=' + marca);
    return { ID_Usuario: id, Usuario: usuario };
  });
}

/**
 * Cambia el estado de una cuenta (Activo / Inactivo). Solo ADMIN.
 */
function cambiarEstadoUsuario(token, usuario, nuevoEstado) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirRol_(ses, [ROLES.ADMIN]);
    var estado = exigirEnLista_(nuevoEstado, ESTADOS_CUENTA, 'Estado_Cuenta');
    var reg = buscarUsuario_(usuario);
    if (!reg) throw new Error('REGLA_NEGOCIO: usuario no encontrado.');
    if (norm_(reg.datos.Usuario) === norm_(ses.usuario) && estado === 'Inactivo') {
      throw new Error('REGLA_NEGOCIO: no puede desactivar su propia cuenta.');
    }
    var col = COLUMNS.Usuarios.indexOf('Estado_Cuenta') + 1;
    getSheet_(SHEETS.USUARIOS).getRange(reg.fila, col).setValue(estado);
    registrarAuditoria_(ses, 'USUARIO_ESTADO', '', 'Usuario=' + reg.datos.Usuario + ' -> ' + estado);
    return true;
  });
}

/**
 * Restablece la contraseña de un usuario. Solo ADMIN.
 */
function restablecerPassword(token, usuario, nuevaPassword) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirRol_(ses, [ROLES.ADMIN]);
    var pass = String(nuevaPassword || '');
    if (pass.length < 8) throw new Error('DATO_INVALIDO: la contraseña debe tener al menos 8 caracteres.');
    var reg = buscarUsuario_(usuario);
    if (!reg) throw new Error('REGLA_NEGOCIO: usuario no encontrado.');
    var col = COLUMNS.Usuarios.indexOf('Password_Hash') + 1;
    getSheet_(SHEETS.USUARIOS).getRange(reg.fila, col)
      .setValue(hashPassword(reg.datos.Usuario, pass));
    limpiarIntentos_(reg.datos.Usuario);
    registrarAuditoria_(ses, 'PASSWORD_RESET', '', 'Usuario=' + reg.datos.Usuario);
    return true;
  });
}

/**
 * Cambio de contraseña por el propio usuario (requiere la contraseña actual).
 */
function cambiarMiPassword(token, actual, nueva) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var pass = String(nueva || '');
    if (pass.length < 8) throw new Error('DATO_INVALIDO: la nueva contraseña debe tener al menos 8 caracteres.');
    var reg = buscarUsuario_(ses.usuario);
    if (!reg) throw new Error('REGLA_NEGOCIO: usuario no encontrado.');
    if (!compararHash_(hashPassword(ses.usuario, String(actual || '')),
                       String(reg.datos.Password_Hash || '').trim().toLowerCase())) {
      registrarAuditoria_(ses, 'PASSWORD_CAMBIO_FALLIDO', '', 'Contraseña actual incorrecta.');
      throw new Error('REGLA_NEGOCIO: la contraseña actual no es correcta.');
    }
    var col = COLUMNS.Usuarios.indexOf('Password_Hash') + 1;
    getSheet_(SHEETS.USUARIOS).getRange(reg.fila, col).setValue(hashPassword(ses.usuario, pass));
    registrarAuditoria_(ses, 'PASSWORD_CAMBIO', '', 'Cambio de contraseña por el propio usuario.');
    return true;
  });
}

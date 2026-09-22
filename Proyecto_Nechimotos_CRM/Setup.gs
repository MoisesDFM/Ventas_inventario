/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  Setup.gs
 * ----------------------------------------------------------------------------
 *  Utilidades de instalación (ejecutar UNA sola vez desde el editor de Apps
 *  Script, nunca desde la Web App):
 *
 *   1. instalarNechimotos()  -> crea `BaseDatos_Nechimotos_Master` con las 5
 *                               pestañas, encabezados, formatos y validaciones,
 *                               y guarda su ID en las Propiedades del Script.
 *   2. crearAdminInicial()   -> crea la primera cuenta ADMIN.
 *   3. cargarDatosDemo()     -> (opcional) inventario de ejemplo para pruebas.
 *
 *  Estas funciones NO están expuestas al frontend.
 * ============================================================================
 */

/**
 * Crea el archivo maestro con sus 5 pestañas y lo deja listo para operar.
 * Si ya existe un ID configurado, solo verifica/repara la estructura.
 */
function instalarNechimotos() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_SPREADSHEET_ID);
  var ss;

  if (id) {
    ss = SpreadsheetApp.openById(id);
  } else {
    ss = SpreadsheetApp.create('BaseDatos_Nechimotos_Master');
    props.setProperty(PROP_SPREADSHEET_ID, ss.getId());
  }
  _ssCache = ss;
  ss.setSpreadsheetTimeZone(TZ);

  Object.keys(COLUMNS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    var esquema = COLUMNS[nombre];
    sh.getRange(1, 1, 1, esquema.length).setValues([esquema])
      .setFontWeight('bold')
      .setBackground('#111827')
      .setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, esquema.length);
  });

  // Elimina la hoja por defecto "Hoja 1"/"Sheet1" si quedó vacía.
  ['Hoja 1', 'Hoja1', 'Sheet1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  aplicarValidaciones_(ss);
  aplicarFormatosFecha_(ss);
  getPepper_(); // genera el pepper si aún no existe

  Logger.log('Archivo maestro listo: ' + ss.getUrl());
  return ss.getUrl();
}

/** Listas desplegables en la hoja (protección adicional si alguien edita a mano). */
function aplicarValidaciones_(ss) {
  var inv = ss.getSheetByName(SHEETS.INVENTARIO);
  var filas = 2000;

  var reglaEstado = SpreadsheetApp.newDataValidation()
    .requireValueInList(ESTADOS_INVENTARIO, true).setAllowInvalid(false).build();
  inv.getRange(2, COLUMNS.Inventario.indexOf('Estado') + 1, filas).setDataValidation(reglaEstado);

  var reglaMarca = SpreadsheetApp.newDataValidation()
    .requireValueInList([MARCAS.TVS, MARCAS.MOBILITY], true).setAllowInvalid(false).build();
  inv.getRange(2, COLUMNS.Inventario.indexOf('Marca') + 1, filas).setDataValidation(reglaMarca);

  var reglaPdv = SpreadsheetApp.newDataValidation()
    .requireValueInList(CATALOGO_PDV.map(function (p) { return p.nombre; }), true)
    .setAllowInvalid(false).build();
  inv.getRange(2, COLUMNS.Inventario.indexOf('PDV_Actual') + 1, filas).setDataValidation(reglaPdv);

  var usr = ss.getSheetByName(SHEETS.USUARIOS);
  var reglaRol = SpreadsheetApp.newDataValidation()
    .requireValueInList([ROLES.ADMIN, ROLES.AUXILIAR, ROLES.ASESOR_PDV], true)
    .setAllowInvalid(false).build();
  usr.getRange(2, COLUMNS.Usuarios.indexOf('Rol') + 1, 500).setDataValidation(reglaRol);
}

/** Formatos de fecha coherentes con la zona horaria de Colombia. */
function aplicarFormatosFecha_(ss) {
  ss.getSheetByName(SHEETS.INVENTARIO)
    .getRange(2, COLUMNS.Inventario.indexOf('Fecha_Ingreso') + 1, 2000)
    .setNumberFormat('yyyy-mm-dd');
  ss.getSheetByName(SHEETS.VENTAS)
    .getRange(2, COLUMNS.Ventas.indexOf('Fecha_Venta') + 1, 5000)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName(SHEETS.TRASLADOS)
    .getRange(2, COLUMNS.Traslados.indexOf('Fecha_Despacho') + 1, 5000, 2)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ss.getSheetByName(SHEETS.AUDITORIA)
    .getRange(2, 1, 20000)
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

/**
 * Crea la cuenta ADMIN inicial.
 * EDITE las constantes antes de ejecutar y cambie la contraseña tras el
 * primer ingreso (Auth.cambiarMiPassword).
 */
function crearAdminInicial() {
  var USUARIO = 'admin.nechimotos';
  var PASSWORD = 'CambiarEstaClave2026*';

  if (buscarUsuario_(USUARIO)) {
    Logger.log('El usuario ADMIN ya existe. No se hizo nada.');
    return;
  }
  anexarFila_(SHEETS.USUARIOS, {
    ID_Usuario: 'U-ADMIN-001',
    Usuario: USUARIO,
    Password_Hash: hashPassword(USUARIO, PASSWORD),
    Rol: ROLES.ADMIN,
    PDV_Asignado: 'RED NACIONAL',
    Marca_Permitida: 'TODAS',
    Estado_Cuenta: 'Activo'
  });
  Logger.log('ADMIN creado: ' + USUARIO + ' — cambie la contraseña al ingresar.');
}

/**
 * Carga inventario de ejemplo para validar la aplicación en pruebas.
 * NO ejecutar en producción.
 */
function cargarDatosDemo() {
  var demo = [
    ['MD625GF12N1234567', 'GF1AN1234567', 'TVS', 'Raider 125 FI', 2026, 'Rojo', 'MAJAGUAL'],
    ['MD625GF12N1234568', 'GF1AN1234568', 'TVS', 'NTORQ 125 XConnect', 2026, 'Negro', 'MAJAGUAL'],
    ['MD625GF12N1234569', 'GF1AN1234569', 'TVS', 'Apache RTR 160 4V', 2025, 'Azul', 'MONTELIBANO TVS'],
    ['9C2KC2200NR000001', 'KC22NR000001', 'AUTECO MOBILITY', 'MRX 150', 2026, 'Blanco', 'BANCO MOBILITY'],
    ['9C2KC2200NR000002', 'KC22NR000002', 'AUTECO MOBILITY', 'Agility Fusion', 2026, 'Gris', 'BANCO MOBILITY']
  ];
  var hoy = new Date();
  demo.forEach(function (d, i) {
    if (buscarUnidadPorVin_(d[0])) return;
    var ingreso = new Date(hoy.getTime() - (i + 1) * 12 * 86400000);
    anexarFila_(SHEETS.INVENTARIO, {
      Chasis_VIN: d[0], Motor: d[1], Marca: d[2], Linea_Modelo: d[3],
      Modelo_Ano: d[4], Color: d[5], Fecha_Ingreso: ingreso, PDV_Actual: d[6],
      Estado: 'Disponible', Asesor_Asignado: 'Sin asignar', Observacion: 'Carga demo'
    });
  });
  Logger.log('Datos demo cargados.');
}

/**
 * ============================================================================
 *  HERRAMIENTAS DE DESPLIEGUE
 * ============================================================================
 */

/**
 * Verifica que la instalación esté completa y correcta.
 * Ejecútela desde el editor después de instalar y antes de publicar la Web App:
 * el resultado aparece en el registro de ejecución (Ver → Registros).
 *
 * @return {string} Informe legible del estado de la instalación.
 */
function verificarInstalacion() {
  var lineas = [], errores = 0;
  var revisar = function (etiqueta, condicion, detalle) {
    lineas.push((condicion ? '  OK    ' : '  FALLA ') + etiqueta + (detalle ? ' — ' + detalle : ''));
    if (!condicion) errores++;
  };

  // 1. Archivo maestro
  var url = '';
  try {
    url = getSpreadsheet_().getUrl();
    revisar('Archivo maestro accesible', true, url);
  } catch (e) {
    revisar('Archivo maestro accesible', false, e.message);
    Logger.log(lineas.join('\n'));
    return lineas.join('\n');
  }

  // 2. Pestañas y encabezados exactos
  Object.keys(COLUMNS).forEach(function (nombre) {
    var sh = getSpreadsheet_().getSheetByName(nombre);
    if (!sh) return revisar('Pestaña ' + nombre, false, 'no existe');
    var esperados = COLUMNS[nombre];
    var reales = sh.getRange(1, 1, 1, esperados.length).getValues()[0]
      .map(function (h) { return String(h).trim(); });
    var iguales = esperados.every(function (c, i) { return c === reales[i]; });
    revisar('Pestaña ' + nombre, iguales,
      iguales ? esperados.length + ' columnas' : 'encabezados distintos: ' + reales.join(', '));
  });

  // 3. Seguridad
  revisar('Pepper criptográfico generado',
    !!PropertiesService.getScriptProperties().getProperty(PROP_PEPPER));

  // 4. Cuentas
  var usuarios = leerTabla_(SHEETS.USUARIOS).filas.map(function (f) { return f.datos; });
  var admins = usuarios.filter(function (u) {
    return norm_(u.Rol) === ROLES.ADMIN && norm_(u.Estado_Cuenta) === 'ACTIVO';
  });
  revisar('Al menos un ADMIN activo', admins.length > 0,
    admins.map(function (u) { return u.Usuario; }).join(', ') || 'ejecute crearAdminInicial()');
  revisar('Contraseñas almacenadas como hash',
    usuarios.every(function (u) { return /^[0-9a-f]{64}$/.test(String(u.Password_Hash).trim()); }),
    usuarios.length + ' cuentas');

  // 5. Catálogo de puntos
  var nombres = CATALOGO_PDV.map(function (p) { return p.nombre; });
  revisar('Catálogo de PDV sin duplicados',
    new Set(nombres.map(norm_)).size === nombres.length, nombres.length + ' puntos');

  // 6. Coherencia inventario ↔ catálogo (detecta PDV mal escritos)
  var huerfanos = {};
  leerTabla_(SHEETS.INVENTARIO).filas.forEach(function (f) {
    var p = String(f.datos.PDV_Actual).trim();
    if (p && nombres.map(norm_).indexOf(norm_(p)) === -1) huerfanos[p] = true;
  });
  revisar('Inventario con PDV reconocidos', Object.keys(huerfanos).length === 0,
    Object.keys(huerfanos).join(', ') || 'sin inconsistencias');

  var informe = 'VERIFICACIÓN DE INSTALACIÓN · NECHIMOTOS CRM\n' +
    lineas.join('\n') + '\n\n' +
    (errores === 0
      ? 'Todo correcto. Ya puede publicar la aplicación web.'
      : errores + ' punto(s) por corregir antes de publicar.');
  Logger.log(informe);
  return informe;
}

/**
 * Crea de una sola vez una cuenta `ASESOR_PDV` por cada punto del catálogo,
 * con contraseña temporal aleatoria y la marca permitida que corresponde a ese
 * punto. Omite los usuarios que ya existan, así que puede re-ejecutarse tras
 * agregar un PDV nuevo.
 *
 * Las contraseñas se imprimen UNA sola vez en el registro de ejecución: cópielas
 * y entréguelas por un canal privado. No quedan guardadas en ninguna parte (en
 * la hoja solo vive el hash). Cada asesor debe cambiarla al primer ingreso.
 *
 * @return {string} Tabla con usuario, PDV, marca y contraseña temporal.
 */
function crearUsuariosIniciales() {
  var creados = [], omitidos = [];

  CATALOGO_PDV.forEach(function (p, i) {
    var usuario = 'asesor.' + nombreUsuarioDesdePdv_(p.nombre);
    if (buscarUsuario_(usuario)) { omitidos.push(usuario); return; }

    var marca = p.marcas.length > 1 ? 'TODAS' : (p.marcas[0] === MARCAS.TVS ? 'TVS' : 'MOBILITY');
    var clave = generarPasswordTemporal_();

    anexarFila_(SHEETS.USUARIOS, {
      ID_Usuario: 'U-PDV-' + ('00' + (i + 1)).slice(-3),
      Usuario: usuario,
      Password_Hash: hashPassword(usuario, clave),
      Rol: ROLES.ASESOR_PDV,
      PDV_Asignado: p.nombre,
      Marca_Permitida: marca,
      Estado_Cuenta: 'Activo'
    });
    creados.push([usuario, p.nombre, marca, clave]);
  });

  var informe = 'CUENTAS CREADAS (' + creados.length + ')\n' +
    'ENTREGUE ESTAS CLAVES POR CANAL PRIVADO. NO VOLVERÁN A MOSTRARSE.\n\n' +
    'usuario;PDV;marca;clave_temporal\n' +
    creados.map(function (c) { return c.join(';'); }).join('\n') +
    (omitidos.length ? '\n\nOmitidos por existir ya: ' + omitidos.join(', ') : '');
  Logger.log(informe);
  return informe;
}

/** Convierte 'MONTELIBANO TVS' en 'montelibano.tvs' (sin tildes ni espacios). */
function nombreUsuarioDesdePdv_(nombrePdv) {
  return String(nombrePdv).toLowerCase()
    .replace(/[áàä]/g, 'a').replace(/[éèë]/g, 'e').replace(/[íìï]/g, 'i')
    .replace(/[óòö]/g, 'o').replace(/[úùü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');
}

/** Contraseña temporal legible de 12 caracteres (cumple el mínimo de 8). */
function generarPasswordTemporal_() {
  var abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var s = '';
  for (var i = 0; i < 8; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return 'Nechi' + s; // 13 caracteres, sin caracteres ambiguos (0/O, 1/l/I)
}

/**
 * Diagnóstico de la pestaña `Ventas`.
 * Ejecútela desde el editor cuando la vista de Ventas falle en la Web App:
 * imprime el tamaño real de la hoja, la primera fila leída y el valor exacto
 * que `obtenerVentas` devuelve al navegador.
 *
 * Si aquí funciona pero en la aplicación no, el problema es que la versión
 * publicada quedó desactualizada (Implementar → Gestionar implementaciones).
 */
function diagnosticoVentas() {
  var sh = getSheet_(SHEETS.VENTAS);
  var lineas = [
    'HOJA VENTAS',
    '  getLastRow=' + sh.getLastRow() + '  getLastColumn=' + sh.getLastColumn(),
    '  getMaxRows=' + sh.getMaxRows() + '  getMaxColumns=' + sh.getMaxColumns(),
    '  columnas esperadas por el esquema=' + COLUMNS.Ventas.length
  ];

  try {
    var t = leerTabla_(SHEETS.VENTAS);
    lineas.push('LECTURA OK · filas con datos=' + t.filas.length);
    if (t.filas.length) lineas.push('  primera fila: ' + JSON.stringify(t.filas[0].datos));
  } catch (e) {
    lineas.push('LECTURA FALLA · ' + e.message);
  }

  // Llama a la función tal como lo hace el navegador, con una sesión temporal.
  try {
    var token = crearSesion_({
      ID_Usuario: 'DIAG', Usuario: 'diagnostico', Rol: ROLES.ADMIN,
      PDV_Asignado: 'RED NACIONAL', Marca_Permitida: 'TODAS'
    });
    var r = obtenerVentas(token, {});
    destruirSesion_(token);
    lineas.push('obtenerVentas devuelve: ' + JSON.stringify(r));
  } catch (e) {
    lineas.push('obtenerVentas LANZA: ' + e.message + ' | ' + (e.stack || ''));
  }

  var informe = lineas.join('\n');
  Logger.log(informe);
  return informe;
}

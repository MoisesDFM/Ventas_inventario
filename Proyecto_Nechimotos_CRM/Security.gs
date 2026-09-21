/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  Security.gs
 * ----------------------------------------------------------------------------
 *  Capa transversal de seguridad:
 *   - Hash SHA-256 de contraseñas (Utilities.computeDigest) con salt por
 *     usuario + pepper almacenado en Propiedades del Script.
 *   - Emisión, validación y revocación de tokens de sesión (CacheService).
 *   - Control RBAC y de segregación de marcas, SIEMPRE del lado servidor.
 *   - Saneamiento de entradas provenientes del navegador.
 *
 *  Regla de oro: ninguna función pública de servicio confía en el rol, PDV o
 *  marca enviados por el cliente. Esos datos se derivan del token de sesión.
 * ============================================================================
 */

/** Prefijo de las claves de sesión en CacheService. */
var CACHE_PREFIX_SESION = 'SES_';
var CACHE_PREFIX_INTENTOS = 'TRY_';

/** Obtiene (o crea) el pepper criptográfico global. */
function getPepper_() {
  var props = PropertiesService.getScriptProperties();
  var pepper = props.getProperty(PROP_PEPPER);
  if (!pepper) {
    pepper = Utilities.base64Encode(
      Utilities.getUuid() + '|' + new Date().getTime() + '|NECHIMOTOS'
    );
    props.setProperty(PROP_PEPPER, pepper);
  }
  return pepper;
}

/**
 * Calcula el hash SHA-256 de una contraseña.
 * Composición: SHA256( usuarioNormalizado + ':' + password + ':' + pepper )
 * El usuario actúa como salt determinístico (dos usuarios con la misma clave
 * producen hashes distintos) y el pepper vive fuera de la hoja de cálculo.
 *
 * @param {string} usuario  Nombre de usuario (login).
 * @param {string} password Contraseña en texto plano.
 * @return {string} Hash hexadecimal en minúsculas (64 caracteres).
 */
function hashPassword(usuario, password) {
  var material = norm_(usuario) + ':' + String(password) + ':' + getPepper_();
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, material, Utilities.Charset.UTF_8
  );
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

/**
 * Comparación de hashes en tiempo constante (evita ataques de temporización).
 */
function compararHash_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

/* ===========================================================================
 *  SESIONES
 * =========================================================================== */

/**
 * Crea una sesión en CacheService y devuelve el token opaco.
 * El token es un UUID: no contiene información del usuario, por lo que no es
 * manipulable desde el navegador.
 */
function crearSesion_(usuarioObj) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  var payload = {
    idUsuario: usuarioObj.ID_Usuario,
    usuario:   usuarioObj.Usuario,
    rol:       norm_(usuarioObj.Rol),
    pdv:       String(usuarioObj.PDV_Asignado || '').trim(),
    marca:     String(usuarioObj.Marca_Permitida || '').trim(),
    inicio:    new Date().getTime()
  };
  CacheService.getScriptCache()
    .put(CACHE_PREFIX_SESION + token, JSON.stringify(payload), SESSION_TTL_SEGUNDOS);
  return token;
}

/**
 * Valida un token y devuelve el contexto de sesión.
 * Renueva el TTL en cada llamada (sesión deslizante).
 *
 * @throws {Error} si el token no existe o expiró.
 */
function validarSesion_(token) {
  if (!token || typeof token !== 'string' || token.length < 30) {
    throw new Error('SESION_INVALIDA');
  }
  var cache = CacheService.getScriptCache();
  var raw = cache.get(CACHE_PREFIX_SESION + token);
  if (!raw) throw new Error('SESION_INVALIDA');
  var ses = JSON.parse(raw);
  cache.put(CACHE_PREFIX_SESION + token, raw, SESSION_TTL_SEGUNDOS); // renovar
  ses.token = token;
  return ses;
}

/** Elimina la sesión del cache (logout). */
function destruirSesion_(token) {
  if (token) CacheService.getScriptCache().remove(CACHE_PREFIX_SESION + token);
}

/* ===========================================================================
 *  RBAC
 * =========================================================================== */

/** true si el rol de la sesión tiene visibilidad global. */
function esGlobal_(ses) {
  return ROLES_GLOBALES.indexOf(ses.rol) !== -1;
}

/**
 * Exige que la sesión tenga uno de los roles indicados.
 * @param {Object} ses Contexto de sesión.
 * @param {Array<string>} rolesPermitidos
 */
function exigirRol_(ses, rolesPermitidos) {
  if (rolesPermitidos.indexOf(ses.rol) === -1) {
    registrarAuditoria_(ses, 'ACCESO_DENEGADO', '',
      'Rol ' + ses.rol + ' intentó una acción reservada a: ' + rolesPermitidos.join('/'));
    throw new Error('PERMISO_DENEGADO: su rol no autoriza esta operación.');
  }
}

/** Exige rol ADMIN o AUXILIAR (jefatura / coordinación). */
function exigirGlobal_(ses) {
  exigirRol_(ses, ROLES_GLOBALES);
}

/**
 * ¿Puede la sesión ver/operar una unidad concreta?
 * ADMIN y AUXILIAR: todo. ASESOR_PDV: solo su PDV y su marca permitida.
 *
 * @param {Object} ses   Contexto de sesión.
 * @param {string} pdv   PDV de la unidad.
 * @param {string} marca Marca de la unidad.
 */
function puedeVer_(ses, pdv, marca) {
  if (esGlobal_(ses)) return true;
  if (norm_(pdv) !== norm_(ses.pdv)) return false;
  return marcaPermitida_(ses, marca);
}

/** ¿La marca de la unidad está dentro de la marca permitida del usuario? */
function marcaPermitida_(ses, marca) {
  if (esGlobal_(ses)) return true;
  var permitida = norm_(ses.marca);
  if (!permitida || permitida === norm_(MARCAS.TODAS)) return true;
  var m = norm_(marca);
  // 'MOBILITY' en la ficha del usuario habilita 'AUTECO MOBILITY' en inventario.
  if (permitida === 'MOBILITY') return m.indexOf('MOBILITY') !== -1;
  if (permitida === 'TVS') return m === 'TVS';
  return m === permitida;
}

/**
 * Igual que puedeVer_ pero lanzando excepción y dejando rastro en auditoría.
 */
function exigirAcceso_(ses, pdv, marca, accion, chasis) {
  if (!puedeVer_(ses, pdv, marca)) {
    registrarAuditoria_(ses, 'ACCESO_DENEGADO', chasis || '',
      'Intento sobre PDV=' + pdv + ' Marca=' + marca + ' en accion=' + accion);
    throw new Error('PERMISO_DENEGADO: la unidad no pertenece a su punto de venta o marca.');
  }
}

/* ===========================================================================
 *  SANEAMIENTO DE ENTRADAS
 * =========================================================================== */

/** Convierte a texto plano recortado y limita longitud (anti-inyección/ruido). */
function limpiarTexto_(valor, maxLen) {
  var s = String(valor === null || valor === undefined ? '' : valor);
  s = s.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  return s.substring(0, maxLen || 200);
}

/** Valida y normaliza un número de chasis (VIN). */
function limpiarVin_(valor) {
  var s = limpiarTexto_(valor, 40).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 5) throw new Error('DATO_INVALIDO: número de chasis (VIN) inválido.');
  return s;
}

/** Exige que un valor pertenezca a una lista cerrada. */
function exigirEnLista_(valor, lista, etiqueta) {
  var v = limpiarTexto_(valor, 60);
  for (var i = 0; i < lista.length; i++) {
    if (norm_(lista[i]) === norm_(v)) return lista[i];
  }
  throw new Error('DATO_INVALIDO: ' + etiqueta + ' no válido (' + v + ').');
}

/* ===========================================================================
 *  CONTROL DE FUERZA BRUTA EN LOGIN
 * =========================================================================== */

function intentosFallidos_(usuario) {
  var v = CacheService.getScriptCache().get(CACHE_PREFIX_INTENTOS + norm_(usuario));
  return v ? parseInt(v, 10) : 0;
}

function sumarIntentoFallido_(usuario) {
  var n = intentosFallidos_(usuario) + 1;
  CacheService.getScriptCache()
    .put(CACHE_PREFIX_INTENTOS + norm_(usuario), String(n), LOGIN_BLOQUEO_SEGUNDOS);
  return n;
}

function limpiarIntentos_(usuario) {
  CacheService.getScriptCache().remove(CACHE_PREFIX_INTENTOS + norm_(usuario));
}

/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  Logger.gs
 * ----------------------------------------------------------------------------
 *  Bitácora inmutable de trazabilidad (pestaña `Auditoria`).
 *  Toda acción sensible (login, logout, venta, despacho, recepción, cambios de
 *  estado, accesos denegados y errores) genera una fila con:
 *  Timestamp | Usuario | Rol | PDV | Accion_Realizada | Chasis_Afectado | Detalle
 *
 *  El registro nunca debe interrumpir la operación: si la escritura falla, el
 *  error se envía a Stackdriver (console.error) pero no se propaga.
 * ============================================================================
 */

/**
 * Registra una acción en la pestaña `Auditoria`.
 *
 * @param {Object|null} ses    Contexto de sesión (puede ser null en pre-login).
 * @param {string} accion      Verbo de la acción (ej. 'VENTA_REGISTRADA').
 * @param {string} chasis      VIN afectado, o cadena vacía.
 * @param {string} detalle     Detalle técnico legible.
 */
function registrarAuditoria_(ses, accion, chasis, detalle) {
  try {
    anexarFila_(SHEETS.AUDITORIA, {
      Timestamp:        new Date(),
      Usuario:          ses && ses.usuario ? ses.usuario : 'ANONIMO',
      Rol:              ses && ses.rol ? ses.rol : 'N/A',
      PDV:              ses && ses.pdv ? ses.pdv : 'N/A',
      Accion_Realizada: limpiarTexto_(accion, 60),
      Chasis_Afectado:  limpiarTexto_(chasis, 40),
      Detalle:          limpiarTexto_(detalle, 900)
    });
  } catch (e) {
    console.error('Auditoria falló: ' + e.message + ' | accion=' + accion);
  }
}

/**
 * Variante para eventos previos a la sesión (intentos de login).
 * @param {string} usuario Usuario declarado en el formulario.
 */
function registrarAuditoriaAnonima_(usuario, accion, detalle) {
  registrarAuditoria_(
    { usuario: limpiarTexto_(usuario, 60) || 'ANONIMO', rol: 'N/A', pdv: 'N/A' },
    accion, '', detalle
  );
}

/**
 * Consulta paginada de auditoría para el panel de ADMIN.
 * Devuelve los registros más recientes primero.
 *
 * @param {string} token  Token de sesión.
 * @param {Object} filtro { usuario, accion, desde, hasta, limite }
 */
function consultarAuditoria(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirGlobal_(ses); // solo jefatura y coordinación
    filtro = filtro || {};
    var limite = Math.min(parseInt(filtro.limite, 10) || 200, 1000);

    var tabla = leerTabla_(SHEETS.AUDITORIA);
    var desde = filtro.desde ? new Date(filtro.desde) : null;
    var hasta = filtro.hasta ? new Date(filtro.hasta + 'T23:59:59') : null;
    var fUsuario = norm_(filtro.usuario || '');
    var fAccion  = norm_(filtro.accion || '');

    var out = [];
    for (var i = tabla.filas.length - 1; i >= 0 && out.length < limite; i--) {
      var d = tabla.filas[i].datos;
      var ts = d.Timestamp instanceof Date ? d.Timestamp : new Date(d.Timestamp);
      if (desde && ts < desde) continue;
      if (hasta && ts > hasta) continue;
      if (fUsuario && norm_(d.Usuario).indexOf(fUsuario) === -1) continue;
      if (fAccion && norm_(d.Accion_Realizada).indexOf(fAccion) === -1) continue;
      out.push({
        Timestamp: formatearFechaHora_(ts),
        Usuario: d.Usuario,
        Rol: d.Rol,
        PDV: d.PDV,
        Accion_Realizada: d.Accion_Realizada,
        Chasis_Afectado: d.Chasis_Afectado,
        Detalle: d.Detalle
      });
    }
    return out;
  });
}

/* ===========================================================================
 *  UTILIDADES COMPARTIDAS DE FECHA / RESPUESTA
 * =========================================================================== */

/** Zona horaria operativa de Nechimotos. */
var TZ = 'America/Bogota';

/** Formatea una fecha como yyyy-MM-dd. */
function formatearFecha_(fecha) {
  if (!fecha) return '';
  var d = (fecha instanceof Date) ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Formatea una fecha como yyyy-MM-dd HH:mm:ss. */
function formatearFechaHora_(fecha) {
  if (!fecha) return '';
  var d = (fecha instanceof Date) ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** Diferencia en días completos entre dos fechas (>= 0). */
function diasEntre_(desde, hasta) {
  if (!desde) return '';
  var a = (desde instanceof Date) ? desde : new Date(desde);
  var b = (hasta instanceof Date) ? hasta : new Date(hasta);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return '';
  var ms = new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
           new Date(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.max(0, Math.round(ms / 86400000));
}

/**
 * Envoltura estándar de todas las funciones expuestas a `google.script.run`.
 * Normaliza la respuesta a { ok: boolean, data|error } para que el frontend
 * nunca reciba trazas internas del servidor.
 *
 * @param {Function} fn Función a ejecutar.
 */
function ejecutarSeguro_(fn) {
  try {
    return { ok: true, data: fn() };
  } catch (e) {
    var msg = e && e.message ? e.message : String(e);
    console.error(msg + (e && e.stack ? ' | ' + e.stack : ''));
    // Mensajes controlados se devuelven tal cual; el resto se generaliza.
    var controlado = /^(SESION_INVALIDA|PERMISO_DENEGADO|DATO_INVALIDO|REGLA_NEGOCIO)/.test(msg);
    return { ok: false, error: controlado ? msg : 'Error interno del servidor. Intente de nuevo.' };
  }
}

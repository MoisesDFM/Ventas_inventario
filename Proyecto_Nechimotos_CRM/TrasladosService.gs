/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  TrasladosService.gs
 * ----------------------------------------------------------------------------
 *  Protocolo de traslados en 2 pasos (cero desfases de inventario):
 *
 *   PASO 1 — DESPACHO (PDV Origen)
 *     · La unidad pasa a estado `En Traslado` (sigue contabilizada en origen).
 *     · Se crea una fila en `Traslados` con Estado_Traslado = 'En Transito'.
 *
 *   PASO 2 — RECEPCIÓN (PDV Destino)
 *     · El destino ve la unidad en su bandeja de entrantes.
 *     · Al confirmar: PDV_Actual = destino, Estado = 'Disponible' y la
 *       bitácora se cierra con Fecha_Recepcion y Estado = 'Confirmado'.
 *
 *  Restricción de marca: PDV_Destino solo puede ser un punto homologado para
 *  la marca de la motocicleta (CATALOGO_PDV en Config.gs).
 * ============================================================================
 */

/** Genera el consecutivo de traslado. */
function generarIdTraslado_() {
  var sufijo = ('000' + Math.floor(Math.random() * 1000)).slice(-3);
  return 'T-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '-' + sufijo;
}

/**
 * Devuelve los PDV de destino válidos para un chasis concreto.
 * Filtra por marca y excluye el punto de origen.
 */
function obtenerDestinosValidos(token, vin) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var v = limpiarVin_(vin);
    var reg = buscarUnidadPorVin_(v);
    if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
    exigirAcceso_(ses, reg.datos.PDV_Actual, reg.datos.Marca, 'CONSULTA_DESTINOS', v);

    var origen = norm_(reg.datos.PDV_Actual);
    return {
      marca: reg.datos.Marca,
      origen: reg.datos.PDV_Actual,
      destinos: pdvsPorMarca_(reg.datos.Marca).filter(function (p) {
        return norm_(p) !== origen;
      })
    };
  });
}

/**
 * PASO 1 · Despacho desde el PDV de origen.
 *
 * @param {Object} datos { vin, pdvDestino, observacion }
 */
function despacharTraslado(token, datos) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    datos = datos || {};
    var vin = limpiarVin_(datos.vin);
    var observacion = limpiarTexto_(datos.observacion, 300);
    var resultado;

    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      var reg = buscarUnidadPorVin_(vin);
      if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
      var u = reg.datos;

      // Seguridad: la unidad debe pertenecer al alcance del usuario.
      exigirAcceso_(ses, u.PDV_Actual, u.Marca, 'DESPACHAR_TRASLADO', vin);

      if (norm_(u.Estado) === 'EN TRASLADO') {
        throw new Error('REGLA_NEGOCIO: la unidad ya tiene un traslado en tránsito.');
      }

      // Validación de destino contra el catálogo homologado por marca.
      var destinosValidos = pdvsPorMarca_(u.Marca).filter(function (p) {
        return norm_(p) !== norm_(u.PDV_Actual);
      });
      var destino = exigirEnLista_(datos.pdvDestino, destinosValidos, 'PDV_Destino');

      var ahora = new Date();
      var idTraslado = generarIdTraslado_();

      anexarFila_(SHEETS.TRASLADOS, {
        ID_Traslado: idTraslado,
        Fecha_Despacho: ahora,
        Fecha_Recepcion: '',
        Chasis_VIN: u.Chasis_VIN,
        PDV_Origen: u.PDV_Actual,
        PDV_Destino: destino,
        Usuario_Despacha: ses.usuario,
        Usuario_Recibe: '',
        Estado_Traslado: ESTADOS_TRASLADO.TRANSITO,
        Observacion: observacion
      });

      getSheet_(SHEETS.INVENTARIO)
        .getRange(reg.fila, COLUMNS.Inventario.indexOf('Estado') + 1)
        .setValue('En Traslado');
      SpreadsheetApp.flush();

      resultado = {
        ID_Traslado: idTraslado,
        Chasis_VIN: u.Chasis_VIN,
        PDV_Origen: u.PDV_Actual,
        PDV_Destino: destino,
        Fecha_Despacho: formatearFechaHora_(ahora),
        Estado_Traslado: ESTADOS_TRASLADO.TRANSITO
      };
    } finally {
      lock.releaseLock();
    }

    registrarAuditoria_(ses, 'TRASLADO_DESPACHADO', vin,
      'ID=' + resultado.ID_Traslado + ' ' + resultado.PDV_Origen + ' -> ' + resultado.PDV_Destino);
    return resultado;
  });
}

/**
 * PASO 2 · Confirmación de recepción en el PDV destino.
 * Solo puede confirmar quien pertenece al punto destino (o un rol global).
 *
 * @param {string} idTraslado ID generado en el despacho.
 */
function confirmarRecepcion(token, idTraslado, observacion) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var id = limpiarTexto_(idTraslado, 40);
    if (!id) throw new Error('DATO_INVALIDO: identificador de traslado requerido.');
    var obs = limpiarTexto_(observacion, 300);
    var resultado;

    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      var tabla = leerTabla_(SHEETS.TRASLADOS);
      var reg = null;
      for (var i = 0; i < tabla.filas.length; i++) {
        if (norm_(tabla.filas[i].datos.ID_Traslado) === norm_(id)) { reg = tabla.filas[i]; break; }
      }
      if (!reg) throw new Error('REGLA_NEGOCIO: traslado no encontrado.');
      var t = reg.datos;

      if (norm_(t.Estado_Traslado) !== norm_(ESTADOS_TRASLADO.TRANSITO)) {
        throw new Error('REGLA_NEGOCIO: el traslado ya fue confirmado.');
      }

      // Seguridad: solo el destino (o jefatura) confirma la recepción.
      if (!esGlobal_(ses) && norm_(ses.pdv) !== norm_(t.PDV_Destino)) {
        registrarAuditoria_(ses, 'ACCESO_DENEGADO', t.Chasis_VIN,
          'Intento de confirmar recepción de un traslado dirigido a ' + t.PDV_Destino);
        throw new Error('PERMISO_DENEGADO: solo el punto destino puede confirmar la recepción.');
      }

      var unidad = buscarUnidadPorVin_(t.Chasis_VIN);
      if (!unidad) throw new Error('REGLA_NEGOCIO: la unidad ya no está en el inventario activo.');

      var ahora = new Date();
      var shT = getSheet_(SHEETS.TRASLADOS);
      shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Fecha_Recepcion') + 1).setValue(ahora);
      shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Usuario_Recibe') + 1).setValue(ses.usuario);
      shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Estado_Traslado') + 1)
         .setValue(ESTADOS_TRASLADO.CONFIRMADO);
      if (obs) {
        var previa = limpiarTexto_(t.Observacion, 300);
        shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Observacion') + 1)
           .setValue((previa ? previa + ' | ' : '') + 'RECEPCION: ' + obs);
      }

      var shI = getSheet_(SHEETS.INVENTARIO);
      shI.getRange(unidad.fila, COLUMNS.Inventario.indexOf('PDV_Actual') + 1).setValue(t.PDV_Destino);
      shI.getRange(unidad.fila, COLUMNS.Inventario.indexOf('Estado') + 1).setValue('Disponible');
      SpreadsheetApp.flush();

      resultado = {
        ID_Traslado: t.ID_Traslado,
        Chasis_VIN: t.Chasis_VIN,
        PDV_Origen: t.PDV_Origen,
        PDV_Destino: t.PDV_Destino,
        Fecha_Recepcion: formatearFechaHora_(ahora),
        Estado_Traslado: ESTADOS_TRASLADO.CONFIRMADO
      };
    } finally {
      lock.releaseLock();
    }

    registrarAuditoria_(ses, 'TRASLADO_CONFIRMADO', resultado.Chasis_VIN,
      'ID=' + resultado.ID_Traslado + ' recibido en ' + resultado.PDV_Destino);
    return resultado;
  });
}

/**
 * Anula un traslado en tránsito (solo ADMIN / AUXILIAR o el punto de origen).
 * Devuelve la unidad a estado `Disponible` en su PDV de origen.
 */
function anularTraslado(token, idTraslado, motivo) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var id = limpiarTexto_(idTraslado, 40);
    var razon = limpiarTexto_(motivo, 300);
    if (!razon) throw new Error('DATO_INVALIDO: indique el motivo de la anulación.');

    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      var tabla = leerTabla_(SHEETS.TRASLADOS);
      var reg = null;
      for (var i = 0; i < tabla.filas.length; i++) {
        if (norm_(tabla.filas[i].datos.ID_Traslado) === norm_(id)) { reg = tabla.filas[i]; break; }
      }
      if (!reg) throw new Error('REGLA_NEGOCIO: traslado no encontrado.');
      var t = reg.datos;
      if (norm_(t.Estado_Traslado) !== norm_(ESTADOS_TRASLADO.TRANSITO)) {
        throw new Error('REGLA_NEGOCIO: solo se pueden anular traslados en tránsito.');
      }
      if (!esGlobal_(ses) && norm_(ses.pdv) !== norm_(t.PDV_Origen)) {
        throw new Error('PERMISO_DENEGADO: solo el punto de origen o la jefatura pueden anular.');
      }

      var shT = getSheet_(SHEETS.TRASLADOS);
      shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Estado_Traslado') + 1).setValue('Anulado');
      shT.getRange(reg.fila, COLUMNS.Traslados.indexOf('Observacion') + 1)
         .setValue(limpiarTexto_(t.Observacion, 300) + ' | ANULADO: ' + razon);

      var unidad = buscarUnidadPorVin_(t.Chasis_VIN);
      if (unidad) {
        getSheet_(SHEETS.INVENTARIO)
          .getRange(unidad.fila, COLUMNS.Inventario.indexOf('Estado') + 1)
          .setValue('Disponible');
      }
      SpreadsheetApp.flush();
      registrarAuditoria_(ses, 'TRASLADO_ANULADO', t.Chasis_VIN, 'ID=' + id + ' Motivo=' + razon);
    } finally {
      lock.releaseLock();
    }
    return true;
  });
}

/**
 * Bandejas de traslados para el panel del usuario:
 *  - entrantes: en tránsito hacia MI punto (pendientes de confirmar).
 *  - salientes: en tránsito despachados DESDE mi punto.
 *  - historico: últimos movimientos confirmados dentro de mi alcance.
 *
 * Los roles globales ven la red completa.
 */
function obtenerTraslados(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    filtro = filtro || {};
    var limiteHistorico = Math.min(parseInt(filtro.limite, 10) || 200, 1000);

    var entrantes = [], salientes = [], historico = [];
    var tabla = leerTabla_(SHEETS.TRASLADOS);

    for (var i = tabla.filas.length - 1; i >= 0; i--) {
      var d = tabla.filas[i].datos;
      var esOrigen  = norm_(d.PDV_Origen) === norm_(ses.pdv);
      var esDestino = norm_(d.PDV_Destino) === norm_(ses.pdv);
      if (!esGlobal_(ses) && !esOrigen && !esDestino) continue;

      var item = {
        ID_Traslado: d.ID_Traslado,
        Fecha_Despacho: formatearFechaHora_(d.Fecha_Despacho),
        Fecha_Recepcion: formatearFechaHora_(d.Fecha_Recepcion),
        Chasis_VIN: d.Chasis_VIN,
        PDV_Origen: d.PDV_Origen,
        PDV_Destino: d.PDV_Destino,
        Usuario_Despacha: d.Usuario_Despacha,
        Usuario_Recibe: d.Usuario_Recibe,
        Estado_Traslado: d.Estado_Traslado,
        Observacion: d.Observacion,
        diasEnTransito: diasEntre_(d.Fecha_Despacho, new Date())
      };

      if (norm_(d.Estado_Traslado) === norm_(ESTADOS_TRASLADO.TRANSITO)) {
        // Los roles globales ven toda la red en la bandeja de pendientes;
        // el asesor separa lo que debe confirmar (entrantes) de lo despachado.
        if (esGlobal_(ses) || esDestino) entrantes.push(item);
        else salientes.push(item);
      } else if (historico.length < limiteHistorico) {
        historico.push(item);
      }
    }

    return { entrantes: entrantes, salientes: salientes, historico: historico };
  });
}

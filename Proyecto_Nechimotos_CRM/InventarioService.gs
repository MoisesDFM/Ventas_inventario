/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  InventarioService.gs
 * ----------------------------------------------------------------------------
 *  Lectura y gestión del stock activo:
 *   - Filtrado server-side por PDV y marca según el rol de la sesión.
 *   - Alta de unidades (ingreso de mercancía).
 *   - Cambios de estado operativos (Test Drive / Consignación / Disponible).
 *   - Cálculo de `Dias_en_Sala` (HOY - Fecha_Ingreso).
 *
 *  IMPORTANTE: el filtrado NO se hace en el navegador. Un ASESOR_PDV nunca
 *  recibe filas de otros puntos de venta ni de marcas ajenas.
 * ============================================================================
 */

/**
 * Devuelve el inventario visible para la sesión, con filtros opcionales.
 *
 * @param {string} token  Token de sesión.
 * @param {Object} filtro { pdv, marca, estado, linea, texto }
 * @return {Object} { ok, data: { filas:[], resumen:{} } }
 */
function obtenerInventario(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    filtro = filtro || {};
    var hoy = new Date();

    var fPdv    = norm_(filtro.pdv || '');
    var fMarca  = norm_(filtro.marca || '');
    var fEstado = norm_(filtro.estado || '');
    var fLinea  = norm_(filtro.linea || '');
    var fTexto  = norm_(filtro.texto || '');

    var filas = [];
    var resumen = { total: 0, disponible: 0, enTraslado: 0, consignacion: 0, testDrive: 0, mas60: 0 };

    leerTabla_(SHEETS.INVENTARIO).filas.forEach(function (f) {
      var d = f.datos;
      // 1) Control de acceso obligatorio (PDV + marca).
      if (!puedeVer_(ses, d.PDV_Actual, d.Marca)) return;
      // 2) Filtros de interfaz (solo restringen más, nunca amplían).
      if (fPdv && norm_(d.PDV_Actual) !== fPdv) return;
      if (fMarca && norm_(d.Marca) !== fMarca) return;
      if (fEstado && norm_(d.Estado) !== fEstado) return;
      if (fLinea && norm_(d.Linea_Modelo) !== fLinea) return;
      if (fTexto) {
        var blob = norm_([d.Chasis_VIN, d.Motor, d.Linea_Modelo, d.Color, d.Asesor_Asignado].join(' '));
        if (blob.indexOf(fTexto) === -1) return;
      }

      var dias = diasEntre_(d.Fecha_Ingreso, hoy);
      filas.push({
        Chasis_VIN: d.Chasis_VIN,
        Motor: d.Motor,
        Marca: d.Marca,
        Linea_Modelo: d.Linea_Modelo,
        Modelo_Ano: d.Modelo_Ano,
        Color: d.Color,
        Fecha_Ingreso: formatearFecha_(d.Fecha_Ingreso),
        Dias_en_Sala: dias,
        PDV_Actual: d.PDV_Actual,
        Estado: d.Estado,
        Asesor_Asignado: d.Asesor_Asignado,
        Observacion: d.Observacion
      });

      resumen.total++;
      switch (norm_(d.Estado)) {
        case 'DISPONIBLE':   resumen.disponible++; break;
        case 'EN TRASLADO':  resumen.enTraslado++; break;
        case 'CONSIGNACION': resumen.consignacion++; break;
        case 'TEST DRIVE':   resumen.testDrive++; break;
      }
      if (typeof dias === 'number' && dias > 60) resumen.mas60++;
    });

    // Orden: más antiguo en sala primero (prioridad comercial de rotación).
    filas.sort(function (a, b) { return (b.Dias_en_Sala || 0) - (a.Dias_en_Sala || 0); });
    return { filas: filas, resumen: resumen };
  });
}

/**
 * Busca una unidad concreta por VIN validando permisos.
 * Uso interno de VentasService y TrasladosService.
 *
 * @return {{fila:number, datos:Object}}
 */
function buscarUnidadPorVin_(vin) {
  var objetivo = norm_(vin);
  var tabla = leerTabla_(SHEETS.INVENTARIO);
  for (var i = 0; i < tabla.filas.length; i++) {
    if (norm_(tabla.filas[i].datos.Chasis_VIN) === objetivo) return tabla.filas[i];
  }
  return null;
}

/** Versión pública: ficha de una unidad (respetando RBAC). */
function obtenerUnidad(token, vin) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var v = limpiarVin_(vin);
    var reg = buscarUnidadPorVin_(v);
    if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
    exigirAcceso_(ses, reg.datos.PDV_Actual, reg.datos.Marca, 'CONSULTA_UNIDAD', v);
    var d = reg.datos;
    return {
      Chasis_VIN: d.Chasis_VIN, Motor: d.Motor, Marca: d.Marca,
      Linea_Modelo: d.Linea_Modelo, Modelo_Ano: d.Modelo_Ano, Color: d.Color,
      Fecha_Ingreso: formatearFecha_(d.Fecha_Ingreso),
      Dias_en_Sala: diasEntre_(d.Fecha_Ingreso, new Date()),
      PDV_Actual: d.PDV_Actual, Estado: d.Estado,
      Asesor_Asignado: d.Asesor_Asignado, Observacion: d.Observacion
    };
  });
}

/**
 * Ingresa una unidad nueva al inventario.
 * ADMIN/AUXILIAR pueden ingresar en cualquier PDV; el ASESOR_PDV solo en el suyo.
 *
 * @param {Object} datos { vin, motor, marca, linea, modeloAno, color, pdv,
 *                         fechaIngreso, asesor, observacion }
 */
function ingresarUnidad(token, datos) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    datos = datos || {};

    var vin   = limpiarVin_(datos.vin);
    var marca = exigirEnLista_(datos.marca, [MARCAS.TVS, MARCAS.MOBILITY], 'Marca');
    var linea = exigirEnLista_(datos.linea, CATALOGO_LINEAS[marca], 'Linea_Modelo');
    var pdv   = esGlobal_(ses)
      ? exigirEnLista_(datos.pdv, pdvsPorMarca_(marca), 'PDV_Actual')
      : ses.pdv;

    // Un asesor solo puede ingresar unidades de su marca y en su punto.
    exigirAcceso_(ses, pdv, marca, 'INGRESO_UNIDAD', vin);

    // El PDV debe estar homologado para la marca.
    if (pdvsPorMarca_(marca).indexOf(pdv) === -1) {
      throw new Error('REGLA_NEGOCIO: el punto ' + pdv + ' no está autorizado para la marca ' + marca + '.');
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      if (buscarUnidadPorVin_(vin)) {
        throw new Error('REGLA_NEGOCIO: el chasis ' + vin + ' ya existe en el inventario.');
      }
      var anio = parseInt(datos.modeloAno, 10);
      if (!anio || anio < 2000 || anio > new Date().getFullYear() + 2) {
        throw new Error('DATO_INVALIDO: modelo/año fuera de rango.');
      }
      var fechaIngreso = datos.fechaIngreso ? new Date(datos.fechaIngreso) : new Date();
      if (isNaN(fechaIngreso.getTime())) fechaIngreso = new Date();

      anexarFila_(SHEETS.INVENTARIO, {
        Chasis_VIN: vin,
        Motor: limpiarTexto_(datos.motor, 40).toUpperCase(),
        Marca: marca,
        Linea_Modelo: linea,
        Modelo_Ano: anio,
        Color: limpiarTexto_(datos.color, 40),
        Fecha_Ingreso: fechaIngreso,
        PDV_Actual: pdv,
        Estado: 'Disponible',
        Asesor_Asignado: limpiarTexto_(datos.asesor, 60) || ses.usuario,
        Observacion: limpiarTexto_(datos.observacion, 300)
      });
    } finally {
      lock.releaseLock();
    }

    registrarAuditoria_(ses, 'INGRESO_UNIDAD', vin,
      'Marca=' + marca + ' Linea=' + linea + ' PDV=' + pdv);
    return { Chasis_VIN: vin };
  });
}

/**
 * Cambia el estado operativo de una unidad.
 * No permite fijar 'En Traslado' manualmente: ese estado solo lo produce el
 * protocolo de traslados en 2 pasos (TrasladosService.gs).
 */
function cambiarEstadoUnidad(token, vin, nuevoEstado, observacion) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var v = limpiarVin_(vin);
    var estado = exigirEnLista_(nuevoEstado, ['Disponible', 'Consignacion', 'Test Drive'], 'Estado');

    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      var reg = buscarUnidadPorVin_(v);
      if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
      exigirAcceso_(ses, reg.datos.PDV_Actual, reg.datos.Marca, 'CAMBIO_ESTADO', v);
      if (norm_(reg.datos.Estado) === 'EN TRASLADO') {
        throw new Error('REGLA_NEGOCIO: la unidad está en tránsito; confirme la recepción primero.');
      }
      var sh = getSheet_(SHEETS.INVENTARIO);
      sh.getRange(reg.fila, COLUMNS.Inventario.indexOf('Estado') + 1).setValue(estado);
      var obs = limpiarTexto_(observacion, 300);
      if (obs) {
        sh.getRange(reg.fila, COLUMNS.Inventario.indexOf('Observacion') + 1).setValue(obs);
      }
      registrarAuditoria_(ses, 'CAMBIO_ESTADO', v,
        'Estado ' + reg.datos.Estado + ' -> ' + estado + (obs ? ' | ' + obs : ''));
    } finally {
      lock.releaseLock();
    }
    return true;
  });
}

/**
 * Reasigna el asesor responsable de una unidad dentro del mismo PDV.
 */
function asignarAsesor(token, vin, asesor) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var v = limpiarVin_(vin);
    var nombre = limpiarTexto_(asesor, 60);
    if (!nombre) throw new Error('DATO_INVALIDO: indique el nombre del asesor.');
    var reg = buscarUnidadPorVin_(v);
    if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
    exigirAcceso_(ses, reg.datos.PDV_Actual, reg.datos.Marca, 'ASIGNAR_ASESOR', v);
    getSheet_(SHEETS.INVENTARIO)
      .getRange(reg.fila, COLUMNS.Inventario.indexOf('Asesor_Asignado') + 1)
      .setValue(nombre);
    registrarAuditoria_(ses, 'ASIGNAR_ASESOR', v, 'Asesor=' + nombre);
    return true;
  });
}

/**
 * Catálogo de líneas para los formularios (depende de la marca permitida).
 */
function obtenerCatalogos(token) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var marcas = esGlobal_(ses)
      ? [MARCAS.TVS, MARCAS.MOBILITY]
      : [MARCAS.TVS, MARCAS.MOBILITY].filter(function (m) { return marcaPermitida_(ses, m); });
    var lineas = {};
    marcas.forEach(function (m) { lineas[m] = CATALOGO_LINEAS[m]; });
    return {
      marcas: marcas,
      lineas: lineas,
      pdvs: esGlobal_(ses) ? CATALOGO_PDV : CATALOGO_PDV.filter(function (p) {
        return norm_(p.nombre) === norm_(ses.pdv);
      }),
      estados: ESTADOS_INVENTARIO,
      tiposVenta: TIPOS_VENTA
    };
  });
}

/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  VentasService.gs
 * ----------------------------------------------------------------------------
 *  Registro de ventas con cálculo automático de periodos comerciales.
 *
 *  Regla de negocio (sección 6.A del alcance):
 *   1. La unidad debe estar `Disponible` y en el PDV del usuario.
 *   2. El servidor toma la fecha/hora real (new Date()) — nunca la del cliente.
 *   3. Calcula Ano, Mes_Venta (YYYY-MM), Semana_Mes (1..5) y Dias_Totales_Sala.
 *   4. La fila se ELIMINA de `Inventario` y se INSERTA en `Ventas`.
 *
 *  Toda la operación se ejecuta bajo LockService para que dos asesores no
 *  puedan vender el mismo chasis simultáneamente.
 * ============================================================================
 */

/**
 * Calcula la semana comercial del mes a partir del día calendario.
 *  1-7 => Semana 1 | 8-14 => Semana 2 | 15-21 => Semana 3
 *  22-28 => Semana 4 | 29+ => Semana 5
 *
 * @param {Date} fecha
 * @return {string} 'Semana N'
 */
function calcularSemanaMes_(fecha) {
  var dia = fecha.getDate();
  if (dia <= 7) return 'Semana 1';
  if (dia <= 14) return 'Semana 2';
  if (dia <= 21) return 'Semana 3';
  if (dia <= 28) return 'Semana 4';
  return 'Semana 5';
}

/** Cadena YYYY-MM del periodo de venta. */
function calcularMesVenta_(fecha) {
  return Utilities.formatDate(fecha, TZ, 'yyyy-MM');
}

/** Genera un consecutivo único de venta: V-AAAAMMDD-HHMMSS-XXX. */
function generarIdVenta_() {
  var ahora = new Date();
  var sufijo = ('000' + Math.floor(Math.random() * 1000)).slice(-3);
  return 'V-' + Utilities.formatDate(ahora, TZ, 'yyyyMMdd-HHmmss') + '-' + sufijo;
}

/**
 * Registra la venta de una unidad del inventario activo.
 *
 * @param {string} token Token de sesión.
 * @param {Object} datos { vin, tipoVenta, asesor, observacion }
 * @return {Object} { ok, data: { ID_Venta, ... } }
 */
function registrarVenta(token, datos) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    datos = datos || {};

    var vin = limpiarVin_(datos.vin);
    var tipoVenta = exigirEnLista_(datos.tipoVenta, TIPOS_VENTA, 'Tipo_Venta');
    var observacion = limpiarTexto_(datos.observacion, 300);

    var resultado;
    var lock = LockService.getScriptLock();
    lock.waitLock(LOCK_TIMEOUT_MS);
    try {
      var reg = buscarUnidadPorVin_(vin);
      if (!reg) throw new Error('REGLA_NEGOCIO: el chasis no existe en el inventario activo.');
      var u = reg.datos;

      // --- Validaciones de seguridad y de negocio -------------------------
      exigirAcceso_(ses, u.PDV_Actual, u.Marca, 'REGISTRAR_VENTA', vin);
      if (norm_(u.Estado) === 'EN TRASLADO') {
        throw new Error('REGLA_NEGOCIO: la unidad está en tránsito y no puede venderse.');
      }
      if (['DISPONIBLE', 'CONSIGNACION', 'TEST DRIVE'].indexOf(norm_(u.Estado)) === -1) {
        throw new Error('REGLA_NEGOCIO: estado no vendible (' + u.Estado + ').');
      }

      // --- Cálculos automáticos del servidor ------------------------------
      var ahora = new Date();
      var idVenta = generarIdVenta_();
      var dias = diasEntre_(u.Fecha_Ingreso, ahora);
      var asesor = limpiarTexto_(datos.asesor, 60) ||
                   limpiarTexto_(u.Asesor_Asignado, 60) || ses.usuario;

      var venta = {
        ID_Venta: idVenta,
        Fecha_Venta: ahora,
        Mes_Venta: calcularMesVenta_(ahora),
        Semana_Mes: calcularSemanaMes_(ahora),
        Ano: ahora.getFullYear(),
        Chasis_VIN: u.Chasis_VIN,
        Motor: u.Motor,
        Marca: u.Marca,
        Linea_Modelo: u.Linea_Modelo,
        Modelo_Ano: u.Modelo_Ano,
        Color: u.Color,
        Fecha_Ingreso: u.Fecha_Ingreso,
        Dias_Totales_Sala: dias,
        PDV_Venta: u.PDV_Actual,
        Asesor_Vendedor: asesor,
        Tipo_Venta: tipoVenta,
        Observacion: observacion
      };

      // --- Escritura atómica: primero histórico, luego baja de inventario --
      anexarFila_(SHEETS.VENTAS, venta);
      getSheet_(SHEETS.INVENTARIO).deleteRow(reg.fila);
      SpreadsheetApp.flush();

      resultado = {
        ID_Venta: idVenta,
        Chasis_VIN: u.Chasis_VIN,
        Marca: u.Marca,
        Linea_Modelo: u.Linea_Modelo,
        PDV_Venta: u.PDV_Actual,
        Fecha_Venta: formatearFechaHora_(ahora),
        Mes_Venta: venta.Mes_Venta,
        Semana_Mes: venta.Semana_Mes,
        Dias_Totales_Sala: dias,
        Asesor_Vendedor: asesor,
        Tipo_Venta: tipoVenta
      };
    } finally {
      lock.releaseLock();
    }

    registrarAuditoria_(ses, 'VENTA_REGISTRADA', vin,
      'ID=' + resultado.ID_Venta + ' PDV=' + resultado.PDV_Venta +
      ' Tipo=' + tipoVenta + ' DiasSala=' + resultado.Dias_Totales_Sala);

    return resultado;
  });
}

/**
 * Histórico de ventas visible para la sesión.
 * El ASESOR_PDV solo ve las ventas de su punto y su marca.
 *
 * @param {Object} filtro { mes, semana, ano, pdv, marca, texto, limite }
 */
function obtenerVentas(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    filtro = filtro || {};
    var limite = Math.min(parseInt(filtro.limite, 10) || 500, 3000);

    var fMes    = limpiarTexto_(filtro.mes, 7);
    var fSemana = limpiarTexto_(filtro.semana, 20);
    var fAno    = filtro.ano ? String(parseInt(filtro.ano, 10)) : '';
    var fPdv    = norm_(filtro.pdv || '');
    var fMarca  = norm_(filtro.marca || '');
    var fTexto  = norm_(filtro.texto || '');

    var tabla = leerTabla_(SHEETS.VENTAS);
    var out = [];
    for (var i = tabla.filas.length - 1; i >= 0 && out.length < limite; i--) {
      var d = tabla.filas[i].datos;
      if (!puedeVer_(ses, d.PDV_Venta, d.Marca)) continue;
      if (fMes && String(d.Mes_Venta).trim() !== fMes) continue;
      if (fSemana && norm_(d.Semana_Mes) !== norm_(fSemana)) continue;
      if (fAno && String(d.Ano).trim() !== fAno) continue;
      if (fPdv && norm_(d.PDV_Venta) !== fPdv) continue;
      if (fMarca && norm_(d.Marca) !== fMarca) continue;
      if (fTexto) {
        var blob = norm_([d.Chasis_VIN, d.Motor, d.Linea_Modelo, d.Asesor_Vendedor, d.ID_Venta].join(' '));
        if (blob.indexOf(fTexto) === -1) continue;
      }
      out.push({
        ID_Venta: d.ID_Venta,
        Fecha_Venta: formatearFechaHora_(d.Fecha_Venta),
        Mes_Venta: d.Mes_Venta,
        Semana_Mes: d.Semana_Mes,
        Ano: d.Ano,
        Chasis_VIN: d.Chasis_VIN,
        Motor: d.Motor,
        Marca: d.Marca,
        Linea_Modelo: d.Linea_Modelo,
        Modelo_Ano: d.Modelo_Ano,
        Color: d.Color,
        Fecha_Ingreso: formatearFecha_(d.Fecha_Ingreso),
        Dias_Totales_Sala: d.Dias_Totales_Sala,
        PDV_Venta: d.PDV_Venta,
        Asesor_Vendedor: d.Asesor_Vendedor,
        Tipo_Venta: d.Tipo_Venta,
        Observacion: d.Observacion
      });
    }
    return out;
  });
}

/**
 * Indicadores rápidos de venta para la tarjeta superior del dashboard
 * (mes en curso, dentro del alcance visible de la sesión).
 */
function resumenVentasMesActual(token) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var mesActual = calcularMesVenta_(new Date());
    var total = 0, tvs = 0, mobility = 0, diasAcum = 0;

    leerTabla_(SHEETS.VENTAS).filas.forEach(function (f) {
      var d = f.datos;
      if (String(d.Mes_Venta).trim() !== mesActual) return;
      if (!puedeVer_(ses, d.PDV_Venta, d.Marca)) return;
      total++;
      if (norm_(d.Marca) === 'TVS') tvs++; else mobility++;
      var dd = parseInt(d.Dias_Totales_Sala, 10);
      if (!isNaN(dd)) diasAcum += dd;
    });

    return {
      mes: mesActual,
      total: total,
      tvs: tvs,
      mobility: mobility,
      promedioDiasSala: total ? Math.round(diasAcum / total) : 0
    };
  });
}

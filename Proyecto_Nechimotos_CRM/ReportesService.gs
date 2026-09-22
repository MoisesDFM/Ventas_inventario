/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  ReportesService.gs
 * ----------------------------------------------------------------------------
 *  Agregaciones y métricas ejecutivas para ADMIN / AUXILIAR:
 *   - Ventas por mes, semana del mes, PDV, marca, línea y asesor.
 *   - Comparativo de inventario vs. ventas (rotación y días en sala).
 *   - Ranking de puntos de venta y de asesores.
 *   - Alertas operativas (traslados vencidos, sobre-stock, baja rotación).
 *
 *  Todas las funciones exigen rol global salvo `miDesempeno`, pensada para que
 *  el asesor consulte únicamente sus propios números.
 * ============================================================================
 */

/** Suma 1 a una clave de un mapa acumulador. */
function acumular_(mapa, clave, incremento) {
  if (!clave && clave !== 0) clave = 'SIN DATO';
  mapa[clave] = (mapa[clave] || 0) + (incremento === undefined ? 1 : incremento);
}

/** Convierte un mapa {clave: valor} en arreglo ordenado descendente. */
function mapaAArreglo_(mapa, nombreClave) {
  return Object.keys(mapa).map(function (k) {
    var o = { total: mapa[k] };
    o[nombreClave || 'clave'] = k;
    return o;
  }).sort(function (a, b) { return b.total - a.total; });
}

/**
 * Reporte ejecutivo consolidado.
 *
 * @param {string} token Token de sesión (rol global obligatorio).
 * @param {Object} filtro { ano, mes ('YYYY-MM'), semana, pdv, marca }
 * @return {Object} estructura lista para renderizar tablas y gráficos.
 */
function obtenerReporteEjecutivo(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirGlobal_(ses);
    filtro = filtro || {};

    var fAno    = filtro.ano ? String(parseInt(filtro.ano, 10)) : '';
    var fMes    = limpiarTexto_(filtro.mes, 7);
    var fSemana = limpiarTexto_(filtro.semana, 20);
    var fPdv    = norm_(filtro.pdv || '');
    var fMarca  = norm_(filtro.marca || '');

    var porMes = {}, porSemana = {}, porPdv = {}, porMarca = {},
        porLinea = {}, porAsesor = {}, porTipoVenta = {};
    var total = 0, diasAcum = 0, aniosDisponibles = {};

    leerTabla_(SHEETS.VENTAS).filas.forEach(function (f) {
      var d = f.datos;
      if (d.Ano) aniosDisponibles[String(d.Ano).trim()] = true;

      if (fAno && String(d.Ano).trim() !== fAno) return;
      if (fMes && mesVenta_(d.Mes_Venta) !== fMes) return;
      if (fSemana && norm_(d.Semana_Mes) !== norm_(fSemana)) return;
      if (fPdv && norm_(d.PDV_Venta) !== fPdv) return;
      if (fMarca && norm_(d.Marca) !== fMarca) return;

      total++;
      acumular_(porMes, mesVenta_(d.Mes_Venta));
      acumular_(porSemana, String(d.Semana_Mes).trim());
      acumular_(porPdv, String(d.PDV_Venta).trim());
      acumular_(porMarca, String(d.Marca).trim());
      acumular_(porLinea, String(d.Linea_Modelo).trim());
      acumular_(porAsesor, String(d.Asesor_Vendedor).trim());
      acumular_(porTipoVenta, String(d.Tipo_Venta).trim());

      var dd = parseInt(d.Dias_Totales_Sala, 10);
      if (!isNaN(dd)) diasAcum += dd;
    });

    // Fotografía del inventario activo (no depende del filtro temporal).
    var stock = { total: 0, porPdv: {}, porMarca: {}, porEstado: {}, envejecido: 0 };
    var hoy = new Date();
    leerTabla_(SHEETS.INVENTARIO).filas.forEach(function (f) {
      var d = f.datos;
      if (fPdv && norm_(d.PDV_Actual) !== fPdv) return;
      if (fMarca && norm_(d.Marca) !== fMarca) return;
      stock.total++;
      acumular_(stock.porPdv, String(d.PDV_Actual).trim());
      acumular_(stock.porMarca, String(d.Marca).trim());
      acumular_(stock.porEstado, String(d.Estado).trim());
      if (diasEntre_(d.Fecha_Ingreso, hoy) > 60) stock.envejecido++;
    });

    // Semanas del mes siempre en orden natural, aunque no tengan ventas.
    var semanasOrdenadas = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5']
      .map(function (s) { return { clave: s, total: porSemana[s] || 0 }; });

    return {
      filtroAplicado: { ano: fAno, mes: fMes, semana: fSemana, pdv: filtro.pdv || '', marca: filtro.marca || '' },
      aniosDisponibles: Object.keys(aniosDisponibles).sort().reverse(),
      kpis: {
        totalVentas: total,
        promedioDiasSala: total ? Math.round(diasAcum / total) : 0,
        stockActivo: stock.total,
        stockEnvejecido: stock.envejecido,
        rotacion: stock.total ? Math.round((total / stock.total) * 100) : 0
      },
      series: {
        porMes: Object.keys(porMes).sort().map(function (k) { return { clave: k, total: porMes[k] }; }),
        porSemana: semanasOrdenadas,
        porPdv: mapaAArreglo_(porPdv),
        porMarca: mapaAArreglo_(porMarca),
        porLinea: mapaAArreglo_(porLinea).slice(0, 15),
        porAsesor: mapaAArreglo_(porAsesor).slice(0, 15),
        porTipoVenta: mapaAArreglo_(porTipoVenta)
      },
      inventario: {
        porPdv: mapaAArreglo_(stock.porPdv),
        porMarca: mapaAArreglo_(stock.porMarca),
        porEstado: mapaAArreglo_(stock.porEstado)
      }
    };
  });
}

/**
 * Matriz PDV x Semana del mes seleccionado (tabla cruzada de seguimiento).
 *
 * @param {string} mes 'YYYY-MM'. Si se omite se usa el mes en curso.
 */
function obtenerMatrizPdvSemana(token, mes) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirGlobal_(ses);
    var periodo = limpiarTexto_(mes, 7) || calcularMesVenta_(new Date());
    var semanas = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4', 'Semana 5'];
    var mapa = {};

    leerTabla_(SHEETS.VENTAS).filas.forEach(function (f) {
      var d = f.datos;
      if (mesVenta_(d.Mes_Venta) !== periodo) return;
      var pdv = String(d.PDV_Venta).trim() || 'SIN DATO';
      if (!mapa[pdv]) { mapa[pdv] = { pdv: pdv, total: 0 }; semanas.forEach(function (s) { mapa[pdv][s] = 0; }); }
      var sem = String(d.Semana_Mes).trim();
      if (semanas.indexOf(sem) === -1) sem = 'Semana 5';
      mapa[pdv][sem]++;
      mapa[pdv].total++;
    });

    var filas = Object.keys(mapa).map(function (k) { return mapa[k]; })
      .sort(function (a, b) { return b.total - a.total; });

    var totales = { pdv: 'TOTAL RED', total: 0 };
    semanas.forEach(function (s) { totales[s] = 0; });
    filas.forEach(function (r) {
      semanas.forEach(function (s) { totales[s] += r[s]; });
      totales.total += r.total;
    });

    return { mes: periodo, semanas: semanas, filas: filas, totales: totales };
  });
}

/**
 * Alertas operativas para la coordinación comercial.
 *  - Traslados en tránsito con más de 3 días sin confirmar.
 *  - Unidades con más de 90 días en sala.
 *  - Puntos sin ventas en el mes en curso.
 */
function obtenerAlertas(token) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirGlobal_(ses);
    var hoy = new Date();
    var mesActual = calcularMesVenta_(new Date());

    var trasladosVencidos = [];
    leerTabla_(SHEETS.TRASLADOS).filas.forEach(function (f) {
      var d = f.datos;
      if (norm_(d.Estado_Traslado) !== norm_(ESTADOS_TRASLADO.TRANSITO)) return;
      var dias = diasEntre_(d.Fecha_Despacho, hoy);
      if (dias >= 3) {
        trasladosVencidos.push({
          ID_Traslado: d.ID_Traslado, Chasis_VIN: d.Chasis_VIN,
          PDV_Origen: d.PDV_Origen, PDV_Destino: d.PDV_Destino,
          dias: dias, Usuario_Despacha: d.Usuario_Despacha
        });
      }
    });

    var unidadesEnvejecidas = [];
    leerTabla_(SHEETS.INVENTARIO).filas.forEach(function (f) {
      var d = f.datos;
      var dias = diasEntre_(d.Fecha_Ingreso, hoy);
      if (dias >= 90) {
        unidadesEnvejecidas.push({
          Chasis_VIN: d.Chasis_VIN, Marca: d.Marca, Linea_Modelo: d.Linea_Modelo,
          PDV_Actual: d.PDV_Actual, dias: dias
        });
      }
    });
    unidadesEnvejecidas.sort(function (a, b) { return b.dias - a.dias; });

    var pdvConVenta = {};
    leerTabla_(SHEETS.VENTAS).filas.forEach(function (f) {
      if (mesVenta_(f.datos.Mes_Venta) === mesActual) {
        pdvConVenta[norm_(f.datos.PDV_Venta)] = true;
      }
    });
    var pdvSinVentas = CATALOGO_PDV
      .map(function (p) { return p.nombre; })
      .filter(function (n) { return !pdvConVenta[norm_(n)]; });

    return {
      mes: mesActual,
      trasladosVencidos: trasladosVencidos,
      unidadesEnvejecidas: unidadesEnvejecidas.slice(0, 50),
      pdvSinVentas: pdvSinVentas
    };
  });
}

/**
 * Desempeño individual del asesor autenticado (o del PDV si es asesor).
 * No requiere rol global: cada quien solo ve lo suyo.
 */
function miDesempeno(token, mes) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    var periodo = limpiarTexto_(mes, 7) || calcularMesVenta_(new Date());
    var mias = 0, delPdv = 0, diasAcum = 0, porLinea = {};

    leerTabla_(SHEETS.VENTAS).filas.forEach(function (f) {
      var d = f.datos;
      if (mesVenta_(d.Mes_Venta) !== periodo) return;
      if (!puedeVer_(ses, d.PDV_Venta, d.Marca)) return;
      delPdv++;
      if (norm_(d.Asesor_Vendedor) === norm_(ses.usuario)) {
        mias++;
        acumular_(porLinea, String(d.Linea_Modelo).trim());
        var dd = parseInt(d.Dias_Totales_Sala, 10);
        if (!isNaN(dd)) diasAcum += dd;
      }
    });

    return {
      mes: periodo,
      ventasPropias: mias,
      ventasPdv: delPdv,
      promedioDiasSala: mias ? Math.round(diasAcum / mias) : 0,
      porLinea: mapaAArreglo_(porLinea)
    };
  });
}

/**
 * Exporta las ventas filtradas como CSV (texto) para descarga desde el cliente.
 * Evita crear archivos en Drive: cumple con el requisito de costo $0.
 */
function exportarVentasCsv(token, filtro) {
  return ejecutarSeguro_(function () {
    var ses = validarSesion_(token);
    exigirGlobal_(ses);
    var res = obtenerVentas(token, Object.assign({ limite: 3000 }, filtro || {}));
    if (!res.ok) throw new Error(res.error);
    var filas = res.data;
    var cols = COLUMNS.Ventas;
    var lineas = [cols.join(';')];
    filas.forEach(function (r) {
      lineas.push(cols.map(function (c) {
        return String(r[c] === undefined ? '' : r[c]).replace(/[;\r\n]/g, ' ');
      }).join(';'));
    });
    registrarAuditoria_(ses, 'EXPORTAR_CSV', '', 'Filas exportadas: ' + filas.length);
    return lineas.join('\n');
  });
}

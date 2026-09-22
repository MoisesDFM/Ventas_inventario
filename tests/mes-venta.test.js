/**
 * Reproduce el defecto encontrado en el primer despliegue: Google Sheets
 * convierte el texto '2026-09' de la columna Mes_Venta en un objeto Date.
 * Eso rompía los filtros por mes y dejaba un Date crudo en la respuesta, que
 * `google.script.run` no entrega al navegador (el cliente veía una respuesta
 * vacía sin ningún error).
 */
require('./appsscript-mock.js');
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'Proyecto_Nechimotos_CRM');
vm.runInThisContext(['Config.gs','Security.gs','Logger.gs','Auth.gs','InventarioService.gs',
  'VentasService.gs','TrasladosService.gs','ReportesService.gs','Setup.gs']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n'));

let fallos = 0;
const check = (n, c, e) => { console.log((c ? '  PASA  ' : '  FALLA ') + n + (e ? ' :: ' + e : '')); if (!c) fallos++; };
const ok = r => { if (!r.ok) throw new Error(r.error); return r.data; };

instalarNechimotos();
crearAdminInicial();
const adm = ok(login('admin.nechimotos', 'CambiarEstaClave2026*'));

// Venta registrada normalmente (Mes_Venta como texto).
ok(ingresarUnidad(adm.token, { vin: 'TEXTO000000001', marca: 'TVS', linea: 'Raider 125 FI',
  modeloAno: 2026, color: 'Rojo', pdv: 'MAJAGUAL' }));
const v1 = ok(registrarVenta(adm.token, { vin: 'TEXTO000000001', tipoVenta: 'Contado' }));
const mesActual = v1.Mes_Venta;

// Segunda venta, y luego se simula la conversión de Sheets sobre esa celda:
// el texto '2026-09' pasa a ser el Date del 1 de septiembre de 2026.
ok(ingresarUnidad(adm.token, { vin: 'FECHA000000002', marca: 'TVS', linea: 'Sport 100 ELS',
  modeloAno: 2026, color: 'Negro', pdv: 'MAJAGUAL' }));
ok(registrarVenta(adm.token, { vin: 'FECHA000000002', tipoVenta: 'Credito' }));

const shVentas = getSheet_(SHEETS.VENTAS);
const colMes = COLUMNS.Ventas.indexOf('Mes_Venta') + 1;
const partes = mesActual.split('-');
shVentas.getRange(shVentas.getLastRow(), colMes)
  .setValue(new Date(Number(partes[0]), Number(partes[1]) - 1, 1));
check('Escenario reproducido: la celda quedó como Date',
  shVentas.getRange(shVentas.getLastRow(), colMes).getValues()[0][0] instanceof Date);

// --- Lo que fallaba ---
const ventas = ok(obtenerVentas(adm.token, {}));
check('Las dos ventas se leen pese a la celda convertida', ventas.length === 2);
check('Mes_Venta sale siempre como texto YYYY-MM',
  ventas.every(v => typeof v.Mes_Venta === 'string' && /^\d{4}-\d{2}$/.test(v.Mes_Venta)),
  JSON.stringify(ventas.map(v => v.Mes_Venta)));
check('Ninguna respuesta lleva un Date crudo al navegador',
  JSON.stringify(ventas).indexOf('T00:00:00') === -1 &&
  !ventas.some(v => Object.keys(v).some(k => v[k] instanceof Date)));

check('El filtro por mes encuentra ambas',
  ok(obtenerVentas(adm.token, { mes: mesActual })).length === 2);
check('El resumen del dashboard cuenta ambas',
  ok(resumenVentasMesActual(adm.token)).total === 2);

const rep = ok(obtenerReporteEjecutivo(adm.token, {}));
check('El reporte agrupa ambas bajo un solo mes',
  rep.series.porMes.length === 1 && rep.series.porMes[0].total === 2,
  JSON.stringify(rep.series.porMes));
check('El reporte filtrado por mes cuenta ambas',
  ok(obtenerReporteEjecutivo(adm.token, { mes: mesActual })).kpis.totalVentas === 2);
check('La matriz PDV x Semana cuenta ambas',
  ok(obtenerMatrizPdvSemana(adm.token, mesActual)).totales.total === 2);
check('Las alertas no marcan MAJAGUAL como punto sin ventas',
  ok(obtenerAlertas(adm.token)).pdvSinVentas.indexOf('MAJAGUAL') === -1);
check('El desempeño individual cuenta ambas', ok(miDesempeno(adm.token, mesActual)).ventasPdv === 2);

// --- La reparación deja la hoja correcta ---
const informe = repararMesVenta();
check('repararMesVenta corrige la fila afectada', /1 de 2 filas corregidas/.test(informe), informe);
check('Tras reparar, la celda ya es texto',
  shVentas.getRange(shVentas.getLastRow(), colMes).getValues()[0][0] === mesActual);
check('Re-ejecutar la reparación no cambia nada', /0 de 2 filas corregidas/.test(repararMesVenta()));

// --- La red de seguridad general ---
check('normalizarSalida_ convierte Date anidados',
  normalizarSalida_({ a: [{ f: new Date(2026, 8, 22, 10, 30, 0) }] }).a[0].f === '2026-09-22 10:30:00');

console.log('\n' + (fallos ? fallos + ' FALLIDA(S)' : 'TODAS PASARON'));
process.exit(fallos ? 1 : 0);

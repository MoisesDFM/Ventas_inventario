require('./appsscript-mock.js');
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(__dirname, '..', 'Proyecto_Nechimotos_CRM');
const files = ['Config.gs','Security.gs','Logger.gs','Auth.gs','InventarioService.gs',
               'VentasService.gs','TrasladosService.gs','ReportesService.gs','Setup.gs'];
const code = files.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
vm.runInThisContext(code);

let fallos = 0;
function check(nombre, cond, extra) {
  console.log((cond ? '  PASA  ' : '  FALLA ') + nombre + (extra ? ' :: ' + extra : ''));
  if (!cond) fallos++;
}
function ok(res) { if (!res.ok) throw new Error(res.error); return res.data; }

// 1. Instalación
instalarNechimotos();
crearAdminInicial();
check('Instalación crea las 5 pestañas', Object.keys(COLUMNS).every(n => !!getSheet_(n)));

// 2. Login ADMIN
const adm = ok(login('admin.nechimotos', 'CambiarEstaClave2026*'));
check('Login ADMIN emite token', !!adm.token && adm.perfil.rol === 'ADMIN');
check('Login con clave errada falla', login('admin.nechimotos', 'mala').ok === false);

// 3. Alta de asesores
ok(crearUsuario(adm.token, { usuario: 'asesor.tvs', password: 'Clave12345', rol: 'ASESOR_PDV',
  pdv: 'PDV 02 - Norte', marca: 'TVS' }));
ok(crearUsuario(adm.token, { usuario: 'asesor.sur', password: 'Clave12345', rol: 'ASESOR_PDV',
  pdv: 'PDV 03 - Sur', marca: 'MOBILITY' }));
const a1 = ok(login('asesor.tvs', 'Clave12345'));
const a2 = ok(login('asesor.sur', 'Clave12345'));
check('Asesor autenticado con su PDV', a1.perfil.pdv === 'PDV 02 - Norte' && a1.perfil.esGlobal === false);

// 4. Ingreso de unidades
ok(ingresarUnidad(a1.token, { vin: 'MD625GF12N1111111', motor: 'M1', marca: 'TVS',
  linea: 'Apache RTR 160 4V', modeloAno: 2026, color: 'Rojo' }));
ok(ingresarUnidad(adm.token, { vin: '9C2KC2200NR222222', motor: 'M2', marca: 'AUTECO MOBILITY',
  linea: 'MRX 150', modeloAno: 2026, color: 'Blanco', pdv: 'PDV 03 - Sur' }));
check('VIN duplicado rechazado',
  ingresarUnidad(a1.token, { vin: 'MD625GF12N1111111', marca: 'TVS', linea: 'MRX 150', modeloAno: 2026 }).ok === false);
check('Línea de otra marca rechazada',
  ingresarUnidad(a1.token, { vin: 'MD625GF12N3333333', marca: 'TVS', linea: 'MRX 150', modeloAno: 2026 }).ok === false);

// 5. Segregación por PDV / marca
const invA1 = ok(obtenerInventario(a1.token, {}));
const invA2 = ok(obtenerInventario(a2.token, {}));
const invAdm = ok(obtenerInventario(adm.token, {}));
check('Asesor TVS solo ve su unidad', invA1.filas.length === 1 && invA1.filas[0].Chasis_VIN === 'MD625GF12N1111111');
check('Asesor Sur solo ve la suya', invA2.filas.length === 1 && invA2.filas[0].Marca === 'AUTECO MOBILITY');
check('ADMIN ve toda la red', invAdm.filas.length === 2);
check('Asesor no puede vender unidad ajena',
  registrarVenta(a1.token, { vin: '9C2KC2200NR222222', tipoVenta: 'Contado' }).ok === false);

// 6. Traslado en 2 pasos
const destinos = ok(obtenerDestinosValidos(a1.token, 'MD625GF12N1111111'));
check('Destinos filtrados por marca TVS',
  destinos.destinos.length > 0 && destinos.destinos.indexOf('PDV 03 - Sur') === -1,
  destinos.destinos.slice(0, 3).join(', '));
check('Destino no homologado rechazado',
  despacharTraslado(a1.token, { vin: 'MD625GF12N1111111', pdvDestino: 'PDV 03 - Sur' }).ok === false);

const desp = ok(despacharTraslado(a1.token, { vin: 'MD625GF12N1111111', pdvDestino: 'PDV 01 - Principal' }));
check('Despacho deja la unidad En Traslado',
  ok(obtenerInventario(a1.token, {})).filas[0].Estado === 'En Traslado');
check('Unidad en tránsito no se puede vender',
  registrarVenta(a1.token, { vin: 'MD625GF12N1111111', tipoVenta: 'Contado' }).ok === false);
check('Un PDV ajeno no confirma la recepción',
  confirmarRecepcion(a2.token, desp.ID_Traslado, '').ok === false);

ok(crearUsuario(adm.token, { usuario: 'asesor.principal', password: 'Clave12345', rol: 'ASESOR_PDV',
  pdv: 'PDV 01 - Principal', marca: 'TODAS' }));
const a3 = ok(login('asesor.principal', 'Clave12345'));
const rec = ok(confirmarRecepcion(a3.token, desp.ID_Traslado, 'Sin novedad'));
check('Recepción confirmada mueve el PDV', rec.PDV_Destino === 'PDV 01 - Principal');
const invA3 = ok(obtenerInventario(a3.token, {}));
check('Unidad Disponible en destino',
  invA3.filas.length === 1 && invA3.filas[0].Estado === 'Disponible' && invA3.filas[0].PDV_Actual === 'PDV 01 - Principal');
check('Origen ya no ve la unidad', ok(obtenerInventario(a1.token, {})).filas.length === 0);
check('Traslado no se confirma dos veces',
  confirmarRecepcion(a3.token, desp.ID_Traslado, '').ok === false);

// 7. Venta con cálculos automáticos
const venta = ok(registrarVenta(a3.token, { vin: 'MD625GF12N1111111', tipoVenta: 'Credito', observacion: 'Cliente X' }));
const hoy = new Date();
const semanaEsperada = 'Semana ' + (hoy.getDate() <= 7 ? 1 : hoy.getDate() <= 14 ? 2 : hoy.getDate() <= 21 ? 3 : hoy.getDate() <= 28 ? 4 : 5);
check('Mes_Venta YYYY-MM', /^\d{4}-\d{2}$/.test(venta.Mes_Venta), venta.Mes_Venta);
check('Semana_Mes correcta', venta.Semana_Mes === semanaEsperada, venta.Semana_Mes);
check('Días en sala calculados', typeof venta.Dias_Totales_Sala === 'number');
check('Unidad eliminada del inventario', ok(obtenerInventario(a3.token, {})).filas.length === 0);
check('Venta persistida en histórico', ok(obtenerVentas(adm.token, {})).length === 1);
check('Asesor ajeno no ve la venta de otro PDV', ok(obtenerVentas(a2.token, {})).length === 0);

// 8. Semanas del mes (unidad)
check('Semana 1 (día 3)', calcularSemanaMes_(new Date(2026, 8, 3)) === 'Semana 1');
check('Semana 3 (día 21)', calcularSemanaMes_(new Date(2026, 8, 21)) === 'Semana 3');
check('Semana 4 (día 28)', calcularSemanaMes_(new Date(2026, 8, 28)) === 'Semana 4');
check('Semana 5 (día 30)', calcularSemanaMes_(new Date(2026, 8, 30)) === 'Semana 5');

// 9. RBAC en reportes y auditoría
check('Asesor no accede a reportes ejecutivos', obtenerReporteEjecutivo(a1.token, {}).ok === false);
check('Asesor no accede a auditoría', consultarAuditoria(a1.token, {}).ok === false);
const rep = ok(obtenerReporteEjecutivo(adm.token, {}));
check('Reporte cuenta la venta', rep.kpis.totalVentas === 1);
const matriz = ok(obtenerMatrizPdvSemana(adm.token, venta.Mes_Venta));
check('Matriz PDV x Semana con totales', matriz.totales.total === 1);
const aud = ok(consultarAuditoria(adm.token, { limite: 500 }));
check('Auditoría registra login, venta y traslados',
  aud.some(r => r.Accion_Realizada === 'VENTA_REGISTRADA') &&
  aud.some(r => r.Accion_Realizada === 'TRASLADO_CONFIRMADO') &&
  aud.some(r => r.Accion_Realizada === 'LOGIN_EXITOSO') &&
  aud.some(r => r.Accion_Realizada === 'ACCESO_DENEGADO'));

// 10. Sesión y contraseñas
check('Token inválido rechazado', obtenerInventario('token-falso-xxxxxxxxxxxxxxxxxxxxxxxxxx', {}).ok === false);
ok(logout(a2.token));
check('Token revocado tras logout', obtenerInventario(a2.token, {}).ok === false);
check('Hash SHA-256 de 64 hex', /^[0-9a-f]{64}$/.test(hashPassword('x', 'y')));
check('Hash depende del usuario (salt)', hashPassword('u1', 'clave') !== hashPassword('u2', 'clave'));
check('Contraseña corta rechazada',
  crearUsuario(adm.token, { usuario: 'corto', password: '123', rol: 'ADMIN' }).ok === false);
check('Asesor no crea usuarios', crearUsuario(a1.token, { usuario: 'x', password: 'Clave12345', rol: 'ADMIN' }).ok === false);

// 11. CSV
const csv = ok(exportarVentasCsv(adm.token, {}));
check('CSV con encabezado y una fila', csv.split('\n').length === 2 && csv.indexOf('ID_Venta') === 0);

console.log('\n' + (fallos === 0 ? 'TODAS LAS PRUEBAS PASARON' : fallos + ' PRUEBA(S) FALLIDA(S)'));
process.exit(fallos ? 1 : 0);

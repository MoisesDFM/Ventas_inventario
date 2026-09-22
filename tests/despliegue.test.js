require('./appsscript-mock.js');
const fs=require('fs'),vm=require('vm'),path=require('path');
const dir=path.join(__dirname,'..','Proyecto_Nechimotos_CRM');
const files=['Config.gs','Security.gs','Logger.gs','Auth.gs','InventarioService.gs',
             'VentasService.gs','TrasladosService.gs','ReportesService.gs','Setup.gs'];
vm.runInThisContext(files.map(f=>fs.readFileSync(path.join(dir,f),'utf8')).join('\n'));
let fallos=0;
const check=(n,c,e)=>{console.log((c?'  PASA  ':'  FALLA ')+n+(e?' :: '+e:''));if(!c)fallos++;};

instalarNechimotos();
// Verificación antes de crear el ADMIN: debe detectar que falta.
let inf = verificarInstalacion();
check('verificarInstalacion detecta que falta el ADMIN', /FALLA Al menos un ADMIN/.test(inf));
crearAdminInicial();
inf = verificarInstalacion();
check('verificarInstalacion aprueba tras crear el ADMIN', /Todo correcto/.test(inf), inf.split('\n').filter(l=>/FALLA/.test(l)).join(' | '));

const informe = crearUsuariosIniciales();
const filas = informe.split('\n').filter(l => /^asesor\./.test(l)).map(l => l.split(';'));
check('Crea una cuenta por cada PDV', filas.length === CATALOGO_PDV.length, filas.length + ' cuentas');
check('Nombres de usuario legibles y únicos',
  new Set(filas.map(f=>f[0])).size === filas.length && filas.some(f=>f[0]==='asesor.montelibano.tvs'),
  filas.slice(0,3).map(f=>f[0]).join(', '));
check('Marca permitida derivada del punto',
  filas.find(f=>f[1]==='MONTELIBANO TVS')[2]==='TVS' &&
  filas.find(f=>f[1]==='BANCO MOBILITY')[2]==='MOBILITY' &&
  filas.find(f=>f[1]==='MAJAGUAL')[2]==='TODAS');
check('Las claves temporales cumplen el mínimo', filas.every(f=>f[3].length>=8));

// Las cuentas generadas realmente sirven para entrar y quedan restringidas.
const f = filas.find(x=>x[1]==='MONTELIBANO TVS');
const r = login(f[0], f[3]);
check('La cuenta generada inicia sesión', r.ok===true, r.error||'');
check('Y queda restringida a su punto y marca',
  r.ok && r.data.perfil.pdv==='MONTELIBANO TVS' && r.data.perfil.marca==='TVS' && !r.data.perfil.esGlobal);
check('Las claves NO se guardan en la hoja (solo hash)',
  leerTabla_(SHEETS.USUARIOS).filas.every(x=>/^[0-9a-f]{64}$/.test(String(x.datos.Password_Hash))));
check('Re-ejecutar no duplica cuentas', /Omitidos por existir ya/.test(crearUsuariosIniciales()) &&
  leerTabla_(SHEETS.USUARIOS).filas.length === CATALOGO_PDV.length + 1);

// Detección de PDV mal escrito en inventario.
anexarFila_(SHEETS.INVENTARIO,{Chasis_VIN:'TEST123456',Marca:'TVS',PDV_Actual:'MAJAGAL',Estado:'Disponible'});
check('Detecta un PDV mal escrito en Inventario', /FALLA Inventario con PDV reconocidos/.test(verificarInstalacion()));

console.log('\n'+(fallos?fallos+' FALLIDA(S)':'TODAS PASARON'));
process.exit(fallos?1:0);

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
    ['MD625GF12N1234567', 'GF1AN1234567', 'TVS', 'Raider 125 FI', 2026, 'Rojo', 'PDV 01 - Principal'],
    ['MD625GF12N1234568', 'GF1AN1234568', 'TVS', 'NTORQ 125 XConnect', 2026, 'Negro', 'PDV 01 - Principal'],
    ['MD625GF12N1234569', 'GF1AN1234569', 'TVS', 'Apache RTR 160 4V', 2025, 'Azul', 'PDV 02 - Norte'],
    ['9C2KC2200NR000001', 'KC22NR000001', 'AUTECO MOBILITY', 'MRX 150', 2026, 'Blanco', 'PDV 03 - Sur'],
    ['9C2KC2200NR000002', 'KC22NR000002', 'AUTECO MOBILITY', 'Agility Fusion', 2026, 'Gris', 'PDV 03 - Sur']
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

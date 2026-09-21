/**
 * ============================================================================
 *  NECHIMOTOS CRM  ·  Config.gs
 * ----------------------------------------------------------------------------
 *  Variables globales del proyecto: ID del Spreadsheet maestro, nombres de
 *  pestañas, esquemas de columnas, catálogos homologados (marcas, líneas y
 *  puntos de venta) y parámetros de sesión.
 *
 *  Este archivo NO contiene lógica de negocio: solo constantes y helpers de
 *  acceso a la hoja de cálculo que el resto de módulos reutiliza.
 * ============================================================================
 */

/** Propiedad de script donde se guarda el ID del archivo maestro. */
var PROP_SPREADSHEET_ID = 'SPREADSHEET_ID';

/** Propiedad de script con el "pepper" criptográfico del hash de contraseñas. */
var PROP_PEPPER = 'AUTH_PEPPER';

/**
 * ID del archivo `BaseDatos_Nechimotos_Master`.
 * Se recomienda NO dejarlo escrito en el código: ejecute `instalarNechimotos()`
 * (Setup.gs) que lo guarda en las Propiedades del Script. Si por alguna razón
 * prefiere fijarlo aquí, reemplace la cadena vacía.
 */
var SPREADSHEET_ID_FALLBACK = '';

/** Nombres de las 5 pestañas del archivo maestro. */
var SHEETS = {
  INVENTARIO: 'Inventario',
  VENTAS:     'Ventas',
  TRASLADOS:  'Traslados',
  USUARIOS:   'Usuarios',
  AUDITORIA:  'Auditoria'
};

/**
 * Esquema de columnas (orden exacto de los encabezados de cada pestaña).
 * Todo el código lee/escribe por nombre de columna usando estos arreglos, de
 * modo que reordenar una columna en la hoja no rompe la aplicación siempre que
 * el encabezado se mantenga igual.
 */
var COLUMNS = {
  Inventario: [
    'Chasis_VIN', 'Motor', 'Marca', 'Linea_Modelo', 'Modelo_Ano', 'Color',
    'Fecha_Ingreso', 'PDV_Actual', 'Estado', 'Asesor_Asignado', 'Observacion'
  ],
  Ventas: [
    'ID_Venta', 'Fecha_Venta', 'Mes_Venta', 'Semana_Mes', 'Ano', 'Chasis_VIN',
    'Motor', 'Marca', 'Linea_Modelo', 'Modelo_Ano', 'Color', 'Fecha_Ingreso',
    'Dias_Totales_Sala', 'PDV_Venta', 'Asesor_Vendedor', 'Tipo_Venta',
    'Observacion'
  ],
  Traslados: [
    'ID_Traslado', 'Fecha_Despacho', 'Fecha_Recepcion', 'Chasis_VIN',
    'PDV_Origen', 'PDV_Destino', 'Usuario_Despacha', 'Usuario_Recibe',
    'Estado_Traslado', 'Observacion'
  ],
  Usuarios: [
    'ID_Usuario', 'Usuario', 'Password_Hash', 'Rol', 'PDV_Asignado',
    'Marca_Permitida', 'Estado_Cuenta'
  ],
  Auditoria: [
    'Timestamp', 'Usuario', 'Rol', 'PDV', 'Accion_Realizada',
    'Chasis_Afectado', 'Detalle'
  ]
};

/** Roles soportados por el control RBAC. */
var ROLES = {
  ADMIN:      'ADMIN',
  AUXILIAR:   'AUXILIAR',
  ASESOR_PDV: 'ASESOR_PDV'
};

/** Roles con visibilidad global (27 PDV + todas las marcas). */
var ROLES_GLOBALES = [ROLES.ADMIN, ROLES.AUXILIAR];

/** Marcas oficiales. `TODAS` es un comodín de permiso, no una marca real. */
var MARCAS = {
  TVS:      'TVS',
  MOBILITY: 'AUTECO MOBILITY',
  TODAS:    'TODAS'
};

/** Estados válidos de una unidad en inventario. */
var ESTADOS_INVENTARIO = ['Disponible', 'En Traslado', 'Consignacion', 'Test Drive'];

/** Estados válidos de la bitácora de traslados. */
var ESTADOS_TRASLADO = { TRANSITO: 'En Transito', CONFIRMADO: 'Confirmado' };

/** Tipos de venta permitidos. */
var TIPOS_VENTA = ['Contado', 'Credito', 'Consignacion'];

/** Estados de cuenta de usuario. */
var ESTADOS_CUENTA = ['Activo', 'Inactivo'];

/** Duración de la sesión (segundos). 4 horas de jornada comercial. */
var SESSION_TTL_SEGUNDOS = 4 * 60 * 60;

/** Intentos fallidos de login permitidos antes de bloqueo temporal. */
var LOGIN_MAX_INTENTOS = 5;
var LOGIN_BLOQUEO_SEGUNDOS = 10 * 60;

/** Tiempo máximo de espera del LockService en operaciones críticas (ms). */
var LOCK_TIMEOUT_MS = 20000;

/* ===========================================================================
 *  CATÁLOGO DE PUNTOS DE VENTA (27 PDV)
 * ---------------------------------------------------------------------------
 *  `marcas` define qué marcas puede almacenar cada punto. Esta lista alimenta:
 *   - el selector de PDV_Destino en traslados (solo se muestran puntos
 *     autorizados para la marca de la moto),
 *   - los filtros de reportes de la jefatura comercial.
 *  Ajuste los nombres/ciudades a la operación real de Nechimotos; el código no
 *  depende de los nombres concretos, solo de que coincidan con `PDV_Actual`.
 * =========================================================================== */
var CATALOGO_PDV = [
  { nombre: 'PDV 01 - Principal',      ciudad: 'Cali',        marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 02 - Norte',          ciudad: 'Cali',        marcas: ['TVS'] },
  { nombre: 'PDV 03 - Sur',            ciudad: 'Cali',        marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 04 - Centro',         ciudad: 'Cali',        marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 05 - Alameda',        ciudad: 'Cali',        marcas: ['TVS'] },
  { nombre: 'PDV 06 - Pasoancho',      ciudad: 'Cali',        marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 07 - Valle del Lili', ciudad: 'Cali',        marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 08 - Yumbo',          ciudad: 'Yumbo',       marcas: ['TVS'] },
  { nombre: 'PDV 09 - Jamundi',        ciudad: 'Jamundi',     marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 10 - Palmira',        ciudad: 'Palmira',     marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 11 - Buga',           ciudad: 'Buga',        marcas: ['TVS'] },
  { nombre: 'PDV 12 - Tulua',          ciudad: 'Tulua',       marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 13 - Cartago',        ciudad: 'Cartago',     marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 14 - Buenaventura',   ciudad: 'Buenaventura',marcas: ['TVS'] },
  { nombre: 'PDV 15 - Popayan',        ciudad: 'Popayan',     marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 16 - Santander',      ciudad: 'Santander Q.',marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 17 - Pereira',        ciudad: 'Pereira',     marcas: ['TVS'] },
  { nombre: 'PDV 18 - Dosquebradas',   ciudad: 'Dosquebradas',marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 19 - Armenia',        ciudad: 'Armenia',     marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 20 - Manizales',      ciudad: 'Manizales',   marcas: ['TVS'] },
  { nombre: 'PDV 21 - Ipiales',        ciudad: 'Ipiales',     marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 22 - Pasto',          ciudad: 'Pasto',       marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 23 - Tumaco',         ciudad: 'Tumaco',      marcas: ['TVS'] },
  { nombre: 'PDV 24 - Florencia',      ciudad: 'Florencia',   marcas: ['AUTECO MOBILITY'] },
  { nombre: 'PDV 25 - Neiva',          ciudad: 'Neiva',       marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 26 - Bodega CEDI',    ciudad: 'Cali',        marcas: ['TVS', 'AUTECO MOBILITY'] },
  { nombre: 'PDV 27 - Taller Central', ciudad: 'Cali',        marcas: ['TVS', 'AUTECO MOBILITY'] }
];

/* ===========================================================================
 *  CATÁLOGO DE LÍNEAS HOMOLOGADAS
 * =========================================================================== */
var CATALOGO_LINEAS = {
  'TVS': [
    'Sport 100 ELS', 'Sport 100 KLS', 'Sport 100 SP',
    'Raider 125 Standard', 'Raider 125 FI', 'Raider 125 Racing', 'Raider 125 ACC',
    'Stryker 125 NG', 'Stryker 125 Indo',
    'Neo NX 110', 'Dazz 110',
    'NTORQ 125 XC', 'NTORQ 125 XConnect',
    'Apache RTR 160 4V', 'Apache RTR 180', 'Apache RTR 200 4V', 'Apache RTR 310',
    'Motocarro King Pasajeros', 'Motocarro King GS+'
  ],
  'AUTECO MOBILITY': [
    'MRX 125', 'MRX 150', 'MRX 200', 'MRX Arizona',
    'Agility Fusion', 'Twist 125',
    'One MP Facelift', 'One Mach 110',
    'New Life 125', 'Advance R 125',
    'Nitro 125', 'Nitro 151',
    'Combat 100', 'Combat 125',
    'Switch 125', 'Switch 150',
    'Bomber 125', 'Bomber 150',
    'Venom 14', 'Venom 18',
    'Hunter 150', 'Tricargo 200', 'Ceronte 200',
    'Benelli', 'KLX 150', 'Starker Electrica'
  ]
};

/* ===========================================================================
 *  HELPERS DE ACCESO AL SPREADSHEET
 * =========================================================================== */

/** Devuelve el ID del archivo maestro (Propiedades del Script o fallback). */
function getSpreadsheetId_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_SPREADSHEET_ID);
  if (!id) id = SPREADSHEET_ID_FALLBACK;
  if (!id) {
    throw new Error('No hay Spreadsheet configurado. Ejecute instalarNechimotos() una vez.');
  }
  return id;
}

/** Abre (y cachea por ejecución) el archivo maestro. */
var _ssCache = null;
function getSpreadsheet_() {
  if (!_ssCache) _ssCache = SpreadsheetApp.openById(getSpreadsheetId_());
  return _ssCache;
}

/** Obtiene una pestaña por nombre; lanza error si no existe. */
function getSheet_(nombre) {
  var sh = getSpreadsheet_().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la pestaña "' + nombre + '" en el archivo maestro.');
  return sh;
}

/**
 * Lee una pestaña completa y la devuelve como arreglo de objetos
 * { fila: <número de fila real>, datos: { Columna: valor, ... } }.
 * Trabajar con objetos evita índices mágicos en los servicios.
 */
function leerTabla_(nombreHoja) {
  var sh = getSheet_(nombreHoja);
  var ultima = sh.getLastRow();
  var esquema = COLUMNS[nombreHoja];
  if (ultima < 2) return { headers: esquema, filas: [] };

  var valores = sh.getRange(1, 1, ultima, esquema.length).getValues();
  var headers = valores[0].map(function (h) { return String(h).trim(); });
  var filas = [];
  for (var i = 1; i < valores.length; i++) {
    var fila = valores[i];
    // Ignora filas totalmente vacías (residuos de edición manual).
    var vacia = fila.every(function (c) { return c === '' || c === null; });
    if (vacia) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = fila[c];
    filas.push({ fila: i + 1, datos: obj });
  }
  return { headers: headers, filas: filas };
}

/** Convierte un objeto {columna: valor} en un arreglo ordenado según el esquema. */
function objetoAFila_(nombreHoja, obj) {
  return COLUMNS[nombreHoja].map(function (col) {
    return obj[col] === undefined || obj[col] === null ? '' : obj[col];
  });
}

/** Anexa una fila respetando el esquema de la pestaña. */
function anexarFila_(nombreHoja, obj) {
  getSheet_(nombreHoja).appendRow(objetoAFila_(nombreHoja, obj));
}

/** Devuelve el catálogo de PDV autorizados para una marca concreta. */
function pdvsPorMarca_(marca) {
  if (!marca || marca === MARCAS.TODAS) {
    return CATALOGO_PDV.map(function (p) { return p.nombre; });
  }
  return CATALOGO_PDV.filter(function (p) {
    return p.marcas.indexOf(marca) !== -1;
  }).map(function (p) { return p.nombre; });
}

/** Normaliza texto para comparaciones robustas (sin espacios/mayúsculas). */
function norm_(v) {
  return String(v === null || v === undefined ? '' : v).trim().toUpperCase();
}

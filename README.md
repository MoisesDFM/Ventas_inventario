# Nechimotos · CRM de Inventarios y Ventas

Aplicación web centralizada para administrar **ventas, inventario y traslados de
motocicletas en 27 puntos de venta (PDV)**, construida íntegramente sobre la capa
gratuita de Google Workspace: **costo de infraestructura $0 COP**.

| Componente | Tecnología |
|---|---|
| Backend | Google Apps Script (`HtmlService`, `SpreadsheetApp`, `Utilities`, `LockService`, `CacheService`) |
| Base de datos | Un único Google Sheets: `BaseDatos_Nechimotos_Master` (5 pestañas) |
| Frontend | HTML5 semántico + CSS3 nativo (Custom Properties, Grid, Flexbox) + JavaScript ES6 |
| Dependencias externas | Ninguna (sin Bootstrap, sin CDN, sin hosting de pago) |

Los usuarios **nunca acceden a la hoja de cálculo**: toda lectura y escritura ocurre
del lado servidor, tras validar sesión, rol, PDV y marca.

## Estructura del proyecto

```
Proyecto_Nechimotos_CRM/
├── Config.gs             Constantes, esquema de columnas, catálogo de 27 PDV y líneas
├── Security.gs           Hash SHA-256, tokens de sesión, RBAC, saneamiento de entradas
├── Auth.gs               doGet, login/logout y gestión de usuarios (ADMIN)
├── InventarioService.gs  Stock activo, filtrado por PDV/marca, ingreso y estados
├── VentasService.gs      Venta con cálculo automático de Mes/Semana/Días en sala
├── TrasladosService.gs   Despacho y recepción en 2 pasos, validación por marca
├── ReportesService.gs    Agregaciones ejecutivas, matriz PDV×Semana, alertas, CSV
├── Logger.gs             Bitácora inmutable en `Auditoria` + utilidades de fecha
├── Setup.gs              Instalador: crea el archivo maestro y el ADMIN inicial
├── Index.html            Login, dashboard del asesor y panel de jefatura
├── StyleCss.html         Diseño dashboard premium, dark/light, responsive-first
├── AppJs.html            Controladores cliente (google.script.run)
├── ReportesJs.html       Gráficos CSS, matriz, alertas y auditoría
└── appsscript.json       Manifiesto (zona horaria, scopes, despliegue web)
```

## Ver la aplicación sin desplegarla

`demo/index.html` es un archivo autocontenido que ejecuta la aplicación completa
en el navegador: el backend `.gs` real corriendo sobre dobles de prueba de los
servicios de Google (`demo/mock-appsscript.js`), con inventario, ventas y un
traslado en tránsito de ejemplo. Ábralo con doble clic; no necesita servidor,
cuenta de Google ni conexión. Los datos viven en memoria y se reinician al recargar.

Usuarios de la demostración:

| Usuario | Contraseña | Rol / alcance |
|---|---|---|
| `admin.nechimotos` | `CambiarEstaClave2026*` | ADMIN · red completa |
| `coordinador` | `Demo12345` | AUXILIAR · red completa |
| `asesor.majagual` | `Demo12345` | ASESOR_PDV · MAJAGUAL (ambas marcas) |
| `asesor.montelibano` | `Demo12345` | ASESOR_PDV · MONTELIBANO TVS |
| `asesor.banco` | `Demo12345` | ASESOR_PDV · BANCO MOBILITY |

Para regenerarlo después de tocar el código: `node demo/generar-demo.js`.

## Despliegue

El procedimiento completo está en **[DESPLIEGUE.md](DESPLIEGUE.md)**: crear el proyecto
(con `clasp` o copiando archivos), instalar la base de datos, crear las cuentas, publicar
la aplicación web, verificar en caliente y actualizar después sin cambiar la URL.

Resumen de las funciones de instalación, que se ejecutan desde el editor de Apps Script
y no están expuestas a la aplicación:

| Función | Qué hace |
|---|---|
| `instalarNechimotos()` | Crea `BaseDatos_Nechimotos_Master` con las 5 pestañas, encabezados, formatos y validaciones, y guarda su ID en las Propiedades del Script |
| `crearAdminInicial()` | Crea la primera cuenta ADMIN (edite usuario y clave antes de ejecutar) |
| `crearUsuariosIniciales()` | Crea de una vez un `ASESOR_PDV` por cada uno de los 27 puntos, con su marca permitida y una clave temporal que se imprime **una sola vez** en el registro |
| `verificarInstalacion()` | Comprueba pestañas, encabezados, hashes, ADMIN activo, duplicados del catálogo y PDV mal escritos en el inventario |
| `cargarDatosDemo()` | Inventario de ejemplo para pruebas (no ejecutar en producción) |

Al publicar: *Ejecutar como* **Yo** (propietario del archivo maestro) y *Quién tiene
acceso* **Cualquier usuario**. Esto último solo permite que cargue la pantalla de login:
el control de acceso lo hace la aplicación con su tabla `Usuarios`, de modo que los
asesores no necesitan cuenta de Workspace ni permisos sobre Drive.

## Roles y permisos (validados en el servidor)

| Rol | Alcance | Acciones |
|---|---|---|
| `ASESOR_PDV` | Solo su `PDV_Asignado` y su `Marca_Permitida` (`TVS`, `MOBILITY` o `TODAS`) | Consultar stock, ingresar unidades, registrar ventas, despachar y confirmar traslados |
| `AUXILIAR` | Los 27 PDV y ambas marcas | Todo lo anterior + reportes ejecutivos y auditoría |
| `ADMIN` | Global | Todo lo anterior + gestión de usuarios y restablecimiento de contraseñas |

Cada llamada del navegador viaja con un **token de sesión opaco**; el servidor
deriva rol, PDV y marca de ese token y descarta cualquier dato de permisos enviado
por el cliente. Los intentos denegados quedan registrados en `Auditoria`.

## Reglas de negocio implementadas

**Venta (`VentasService.gs`)** — al confirmar, el servidor toma `new Date()` y genera
`Ano`, `Mes_Venta` (`YYYY-MM`), `Semana_Mes` (1–7→S1, 8–14→S2, 15–21→S3, 22–28→S4,
29+→S5) y `Dias_Totales_Sala` = `Fecha_Venta − Fecha_Ingreso`. La unidad se elimina de
`Inventario` y queda registrada de forma permanente en `Ventas`.

**Traslado en 2 pasos (`TrasladosService.gs`)** — el origen despacha (estado
`En Traslado`, bitácora `En Transito`); el destino confirma la recepción y solo
entonces cambia `PDV_Actual`, el estado vuelve a `Disponible` y el traslado se cierra
como `Confirmado`. El selector de `PDV_Destino` solo ofrece puntos homologados para la
marca de la moto. Un traslado en tránsito puede anularse (con motivo) por el origen o
la jefatura.

**Excepción de marca autorizada** — para el caso puntual en que una moto deba ir a un
punto que no maneja su marca, `ADMIN` y `AUXILIAR` ven esos destinos en un grupo
aparte del selector (`⚠ No manejan <marca> — requiere autorización`) y solo pueden
usarlos escribiendo el motivo. El traslado queda marcado en su observación
(`TRASLADO EXCEPCIONAL autorizado por <usuario>: <motivo>`) y en `Auditoria` con la
acción `TRASLADO_DESPACHADO_EXCEPCION`, distinta de un despacho normal para poder
filtrarla. El `ASESOR_PDV` sigue restringido: ni ve esos destinos ni puede forzarlos
desde el navegador.

**Concurrencia** — venta, ingreso, despacho y recepción se ejecutan bajo
`LockService` para que dos asesores no puedan operar el mismo chasis a la vez.

## Seguridad

- Contraseñas almacenadas solo como **SHA-256** de `usuario:contraseña:pepper`
  (`Utilities.computeDigest`); el *pepper* vive en las Propiedades del Script, no en
  la hoja. Comparación en tiempo constante.
- Sesiones en `CacheService` con expiración deslizante de 4 horas y revocación en logout.
- Bloqueo temporal tras 5 intentos fallidos de login.
- Saneamiento y listas cerradas para todo valor recibido del cliente (VIN, marca,
  línea, PDV, estado, tipo de venta).
- Auditoría inmutable de login, logout, ventas, traslados, cambios de estado,
  gestión de usuarios y accesos denegados.
- El frontend escapa todo dato antes de insertarlo en el DOM.

## Pruebas

```bash
node tests/reglas-negocio.test.js   # reglas de negocio y control de acceso
node tests/despliegue.test.js        # instaladores y verificación de instalación
```

Ejecuta el backend en Node con dobles de prueba de los servicios de Google; valida
RBAC, segregación por PDV/marca, el protocolo de traslados, los cálculos de la venta,
los reportes y la auditoría. No toca Drive ni requiere credenciales.

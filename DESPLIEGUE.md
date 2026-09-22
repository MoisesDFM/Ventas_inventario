# Despliegue de Nechimotos CRM

Guía paso a paso para poner la aplicación en producción. Tiempo estimado: 30–40
minutos la primera vez. Requiere una cuenta de Google (la de la empresa) y nada más:
no hay servidores, dominios ni pagos involucrados.

> **Quién debe hacerlo:** la cuenta que ejecute estos pasos será la **propietaria**
> del archivo maestro y bajo cuyos permisos correrá la aplicación. Use una cuenta
> corporativa estable (por ejemplo `sistemas@nechimotos...`), no la personal de
> alguien que pueda salir de la empresa.

---

## Paso 0 · Antes de empezar

Dos cosas que conviene decidir ahora, no después:

1. **Cambie la contraseña del ADMIN inicial.** Abra `Proyecto_Nechimotos_CRM/Setup.gs`,
   busque `crearAdminInicial()` y reemplace `CambiarEstaClave2026*` por una clave real.
   Está en el código fuente, así que cámbiela otra vez desde la aplicación al primer
   ingreso (menú *Cambiar contraseña*) y deje en el archivo una que ya no sirva.
2. **Revise `CATALOGO_PDV`** en `Config.gs`. Los nombres allí escritos son la llave del
   sistema: deben coincidir exactamente con lo que se guardará en `PDV_Actual`. Cambiarlos
   después de cargar inventario obliga a reescribir filas.

---

## Paso 1 · Crear el proyecto y subir el código

Elija **una** de las dos rutas.

### Ruta A — `clasp` (recomendada si va a actualizar la app con el tiempo)

Requiere Node.js instalado en su computador.

```bash
npm install -g @google/clasp
clasp login                      # abre el navegador para autorizar

git clone https://github.com/MoisesDFM/Ventas_inventario.git
cd Ventas_inventario
git checkout claude/nechimotos-crm-inventory-kdthjv

clasp create --title "Nechimotos CRM" --type webapp --rootDir Proyecto_Nechimotos_CRM
clasp push
```

Si `clasp create` falla pidiendo habilitar la API, abra
<https://script.google.com/home/usersettings> y active **API de Google Apps Script**.

Para futuras actualizaciones basta `git pull && clasp push`. El archivo
`.clasp.json.ejemplo` de este repo muestra la forma que debe tener `.clasp.json`
(no lo versione con su `scriptId` real).

### Ruta B — Copiar y pegar (sin instalar nada)

1. Entre a <https://script.google.com> → **Nuevo proyecto**. Nómbrelo `Nechimotos CRM`.
2. Borre el archivo `Código.gs` que viene por defecto.
3. Cree los **14 archivos** con el nombre y tipo exactos de la tabla, y pegue el
   contenido de cada uno desde el repositorio. El nombre debe ser idéntico:
   `include('StyleCss')` falla si el archivo se llama `StyleCSS`.

   | Archivo en el editor | Tipo | Origen |
   |---|---|---|
   | `Config` | Script | `Config.gs` |
   | `Security` | Script | `Security.gs` |
   | `Logger` | Script | `Logger.gs` |
   | `Auth` | Script | `Auth.gs` |
   | `InventarioService` | Script | `InventarioService.gs` |
   | `VentasService` | Script | `VentasService.gs` |
   | `TrasladosService` | Script | `TrasladosService.gs` |
   | `ReportesService` | Script | `ReportesService.gs` |
   | `Setup` | Script | `Setup.gs` |
   | `Index` | HTML | `Index.html` |
   | `StyleCss` | HTML | `StyleCss.html` |
   | `AppJs` | HTML | `AppJs.html` |
   | `ReportesJs` | HTML | `ReportesJs.html` |

4. El manifiesto: ⚙ **Configuración del proyecto** → marque *Mostrar el archivo de
   manifiesto `appsscript.json`* → ábralo y reemplace su contenido por el del repo.

---

## Paso 2 · Instalar la base de datos

En el editor, seleccione la función **`instalarNechimotos`** y pulse **Ejecutar**.

La primera ejecución pide autorización. Google mostrará una advertencia porque la
aplicación no está verificada —es normal, es código suyo, no publicado en el
Marketplace—: **Configuración avanzada → Ir a Nechimotos CRM (no seguro)** → *Permitir*.

Esto crea `BaseDatos_Nechimotos_Master` en su Drive con las 5 pestañas, encabezados,
formatos y validaciones, y guarda su ID en las Propiedades del Script. El enlace al
archivo queda en el registro de ejecución.

> El ID nunca se escribe en el código. Si más adelante necesita apuntar a otro archivo,
> cambie la propiedad `SPREADSHEET_ID` en ⚙ Configuración del proyecto → *Propiedades
> del script*.

---

## Paso 3 · Crear las cuentas

1. Ejecute **`crearAdminInicial`** — crea su cuenta de administrador.
2. Ejecute **`crearUsuariosIniciales`** — crea de una vez una cuenta `ASESOR_PDV` por
   cada uno de los 27 puntos, con la marca permitida que corresponde a cada uno
   (`MONTELIBANO TVS` → solo TVS, `BANCO MOBILITY` → solo Mobility, el resto `TODAS`).

   **Las contraseñas temporales se imprimen una sola vez** en el registro de ejecución
   (*Ver → Registros*). Cópielas antes de cerrar: en la hoja solo queda el hash, no hay
   forma de recuperarlas. Si pierde una, restablézcala desde el panel de *Usuarios*.

   Entréguelas por canal privado e indique a cada asesor que la cambie al primer
   ingreso. Los usuarios quedan con el formato `asesor.majagual`, `asesor.montelibano.tvs`,
   `asesor.magangue.1`, etc.

3. Ejecute **`verificarInstalacion`** y confirme que el registro dice
   *"Todo correcto. Ya puede publicar la aplicación web."*

> Si prefiere crear las cuentas a mano, o necesita auxiliares de coordinación, use el
> panel *Usuarios* de la aplicación una vez desplegada (solo rol ADMIN).

---

## Paso 4 · Publicar la aplicación web

**Implementar → Nueva implementación → ⚙ → Aplicación web**

| Campo | Valor | Por qué |
|---|---|---|
| Descripción | `v1 - producción` | Para identificar versiones |
| **Ejecutar como** | **Yo** (`su-cuenta@…`) | La app accede al archivo maestro con *sus* permisos; así los asesores nunca necesitan acceso a Drive ni pueden abrir la hoja |
| **Quién tiene acceso** | **Cualquier usuario** | El control de acceso lo hace la propia aplicación con su tabla `Usuarios` + hash SHA-256; esto solo permite que la página cargue |

Copie la **URL de la aplicación web** (`https://script.google.com/macros/s/.../exec`).
Esa es la dirección que reparte a los 27 puntos.

> **"Cualquier usuario" no significa acceso abierto a los datos.** Quien abra la URL solo
> ve la pantalla de login. Sin credenciales válidas ninguna función del servidor devuelve
> un solo dato: toda llamada exige un token de sesión emitido tras validar usuario,
> contraseña y estado de la cuenta.

---

## Paso 5 · Verificación en caliente

Con la URL ya publicada, compruebe en el navegador:

- [ ] Entra con la cuenta ADMIN y ve el dashboard con la red completa.
- [ ] *Cambiar contraseña* funciona (hágalo ahora con el ADMIN).
- [ ] Entra con un asesor de prueba y **solo** ve su punto.
- [ ] Ingresa una unidad, la traslada a otro punto, y el destino confirma la recepción.
- [ ] Registra una venta: desaparece del inventario y aparece en *Ventas* con mes,
      semana y días en sala calculados.
- [ ] En *Auditoría* aparecen todas esas acciones con usuario, hora y detalle.
- [ ] Ábrala en un teléfono: la interfaz es la que usarán los asesores en sala.

Si algo falla, la tabla de problemas frecuentes está más abajo.

---

## Paso 6 · Carga inicial del inventario

Tiene dos caminos:

- **Desde la aplicación** (recomendado para volúmenes pequeños): cada punto ingresa sus
  unidades con *＋ Ingresar unidad*. Queda auditado y valida marca, línea y PDV.
- **Pegando en la hoja** (para la carga masiva inicial): abra `BaseDatos_Nechimotos_Master`,
  pestaña `Inventario`, y pegue las filas respetando el orden de las columnas. Cuidado con
  tres cosas: `PDV_Actual` debe coincidir **exactamente** con el catálogo, `Marca` debe ser
  `TVS` o `AUTECO MOBILITY`, y `Fecha_Ingreso` debe ser fecha real (no texto) o los días en
  sala saldrán vacíos. Después ejecute `verificarInstalacion` para detectar PDV mal escritos.

---

## Actualizar la aplicación más adelante

Tras subir código nuevo (`clasp push` o pegando los archivos):

**Implementar → Gestionar implementaciones → ✏ (editar) → Versión: Nueva versión → Implementar**

Esto **mantiene la misma URL**. Si en cambio crea una *Nueva implementación*, obtendrá una
URL distinta y los 27 puntos seguirían usando la vieja. Es el error más común.

---

## Problemas frecuentes

| Síntoma | Causa y solución |
|---|---|
| `No hay Spreadsheet configurado` | No se ejecutó `instalarNechimotos()`, o se borró la propiedad `SPREADSHEET_ID`. |
| La página carga en blanco | Falta un archivo HTML o su nombre no coincide (`StyleCss`, `AppJs`, `ReportesJs`). |
| `Se requiere autorización` al usar la app | La implementación quedó como *Ejecutar como: usuario que accede*. Edítela y póngala en *Yo*. |
| Un asesor no ve sus motos | Su `PDV_Asignado` no coincide con el `PDV_Actual` de las unidades. Compare escritura exacta. |
| `Sesión finalizada` al rato | Normal: la sesión dura 4 h de inactividad. Ajustable en `SESSION_TTL_SEGUNDOS` (`Config.gs`). |
| Cuenta bloqueada | 5 intentos fallidos bloquean 10 minutos. Espere, o restablezca la clave desde *Usuarios*. |
| Un punto nuevo no aparece | Agréguelo a `CATALOGO_PDV`, suba el código, publique nueva versión y ejecute `crearUsuariosIniciales()` (solo crea los que falten). |

---

## Respaldo

El archivo maestro vive en su Drive con historial de versiones de Google (*Archivo →
Historial de versiones*), que ya es un respaldo razonable. Para algo más formal:
`Archivo → Descargar → Excel` una vez al mes, o una copia programada del archivo.

Las pestañas `Ventas`, `Traslados` y `Auditoria` son históricos: la aplicación nunca
borra filas en ellas. `Inventario` sí cambia (las unidades vendidas se eliminan), por eso
el histórico de ventas es la fuente de verdad de lo facturado.

/**
 * Genera `demo/index.html`: un archivo autocontenido que ejecuta la aplicación
 * completa en el navegador, con el backend `.gs` corriendo sobre los dobles de
 * prueba de `mock-appsscript.js`. No requiere servidor, Google ni conexión.
 *
 *   node demo/generar-demo.js
 */
const fs = require('fs'), path = require('path');
const raiz = path.join(__dirname, '..', 'Proyecto_Nechimotos_CRM');
const leer = f => fs.readFileSync(path.join(raiz, f), 'utf8');

const GS = ['Config.gs','Security.gs','Logger.gs','Auth.gs','InventarioService.gs',
            'VentasService.gs','TrasladosService.gs','ReportesService.gs','Setup.gs'];

const backend = GS.map(f => '/* ===== ' + f + ' ===== */\n' + leer(f)).join('\n\n');
const mock = fs.readFileSync(path.join(__dirname, 'mock-appsscript.js'), 'utf8');

const aviso = `
<div style="position:fixed;left:0;right:0;bottom:0;z-index:200;background:#111827;color:#fff;
            font:500 12.5px/1.45 system-ui,sans-serif;padding:9px 14px;text-align:center">
  <strong>MODO DEMOSTRACIÓN</strong> — datos ficticios en memoria, se reinician al recargar.
  Usuarios: <code>admin.nechimotos</code> / <code>CambiarEstaClave2026*</code> ·
  <code>asesor.montelibano</code>, <code>asesor.banco</code>, <code>asesor.majagual</code>,
  <code>coordinador</code> / <code>Demo12345</code>
</div>
<style>body{padding-bottom:46px}.toasts{bottom:58px!important}</style>`;

// Index.html usa plantillas de Apps Script: aquí se resuelven en tiempo de build.
// El reemplazo se pasa como función: el código fuente contiene `$$` y `$&`, que
// String.replace interpretaría como secuencias de escape y corrompería el archivo.
const poner = (txt, marca, contenido) => txt.replace(marca, () => contenido);

let html = leer('Index.html');
html = poner(html, "<?!= include('StyleCss'); ?>", leer('StyleCss.html'));
html = poner(html, "<?!= include('AppJs'); ?>",
  '<script>\n' + mock + '\n' + backend + '\nsembrarDemo();\n<\/script>\n' + leer('AppJs.html'));
html = poner(html, "<?!= include('ReportesJs'); ?>", leer('ReportesJs.html') + aviso);
html = poner(html, '<title>', '<title>DEMO · ');

fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('demo/index.html generado (' + Math.round(html.length / 1024) + ' KB)');

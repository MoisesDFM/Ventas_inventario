/**
 * ============================================================================
 *  DEMO · mock-appsscript.js
 * ----------------------------------------------------------------------------
 *  Dobles de prueba de los servicios de Google para ejecutar el backend `.gs`
 *  dentro del navegador, SIN Google Sheets y SIN conexión.
 *
 *  Sirve únicamente para mostrar la aplicación: los datos viven en memoria y
 *  se pierden al recargar. En producción estos objetos los provee Apps Script.
 * ============================================================================
 */
(function (global) {

  /* ---------- SHA-256 síncrono (Utilities.computeDigest) ---------------- */
  var K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];

  function sha256Bytes(texto) {
    var msg = new TextEncoder().encode(texto);
    var len = msg.length, bitLen = len * 8;
    var withPad = new Uint8Array((((len + 9) >> 6) + 1) << 6);
    withPad.set(msg); withPad[len] = 0x80;
    new DataView(withPad.buffer).setUint32(withPad.length - 4, bitLen >>> 0);
    var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    var w = new Uint32Array(64), dv = new DataView(withPad.buffer);
    var rr = (x, n) => (x >>> n) | (x << (32 - n));
    for (var off = 0; off < withPad.length; off += 64) {
      for (var i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3);
        var s1 = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10);
        w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
      }
      var a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rr(e,6) ^ rr(e,11) ^ rr(e,25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rr(a,2) ^ rr(a,13) ^ rr(a,22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
      }
      H[0]=(H[0]+a)>>>0; H[1]=(H[1]+b)>>>0; H[2]=(H[2]+c)>>>0; H[3]=(H[3]+d)>>>0;
      H[4]=(H[4]+e)>>>0; H[5]=(H[5]+f)>>>0; H[6]=(H[6]+g)>>>0; H[7]=(H[7]+h)>>>0;
    }
    var out = [];
    H.forEach(function (x) {
      [24,16,8,0].forEach(function (s) {
        var b = (x >>> s) & 0xff;
        out.push(b > 127 ? b - 256 : b); // Apps Script devuelve bytes con signo
      });
    });
    return out;
  }

  /* ---------- Hoja de cálculo en memoria -------------------------------- */
  function FakeRange(sheet, r, c, nr, nc) {
    this.getValues = function () {
      var out = [];
      for (var i = 0; i < nr; i++) {
        var row = sheet._rows[r - 1 + i] || [];
        var linea = [];
        for (var j = 0; j < nc; j++) linea.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
        out.push(linea);
      }
      return out;
    };
    this.setValues = function (v) {
      v.forEach(function (row, i) { row.forEach(function (val, j) { sheet._set(r + i, c + j, val); }); });
      return this;
    };
    this.setValue = function (v) { sheet._set(r, c, v); return this; };
    ['setFontWeight','setBackground','setFontColor','setNumberFormat','setDataValidation']
      .forEach(m => { this[m] = () => this; });
  }
  function FakeSheet(name) {
    this._rows = [];
    this.getName = () => name;
    this._set = (r, c, v) => { while (this._rows.length < r) this._rows.push([]); this._rows[r-1][c-1] = v; };
    this.getLastRow = () => this._rows.length;
    this.getRange = (r, c, nr, nc) => new FakeRange(this, r, c, nr || 1, nc || 1);
    this.appendRow = vals => { this._rows.push(vals.slice()); };
    this.deleteRow = r => { this._rows.splice(r - 1, 1); };
    this.setFrozenRows = () => {}; this.autoResizeColumns = () => {};
  }
  var hojas = {};
  var SS = {
    getSheetByName: n => hojas[n] || null,
    insertSheet: n => (hojas[n] = new FakeSheet(n)),
    getSheets: () => Object.keys(hojas).map(k => hojas[k]),
    deleteSheet: sh => { delete hojas[sh.getName()]; },
    setSpreadsheetTimeZone: () => {}, getId: () => 'DEMO', getUrl: () => '#'
  };

  global.SpreadsheetApp = {
    openById: () => SS, create: () => SS, flush: () => {},
    newDataValidation: () => ({ requireValueInList() { return this; },
      setAllowInvalid() { return this; }, build() { return {}; } })
  };

  var props = {}, cache = {};
  global.PropertiesService = { getScriptProperties: () => ({
    getProperty: k => (props[k] === undefined ? null : props[k]),
    setProperty: (k, v) => { props[k] = v; } }) };
  global.CacheService = { getScriptCache: () => ({
    get: k => (cache[k] === undefined ? null : cache[k]),
    put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) };
  global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };

  function uuid() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, ch => {
      var r = Math.random() * 16 | 0;
      return (ch === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  global.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, texto) => sha256Bytes(texto),
    getUuid: uuid,
    base64Encode: s => btoa(unescape(encodeURIComponent(s))),
    formatDate: function (d, tz, fmt) {
      var p = n => String(n).padStart(2, '0');
      return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1))
        .replace('dd', p(d.getDate())).replace('HH', p(d.getHours()))
        .replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()))
        .replace('yy', String(d.getFullYear()).slice(2));
    }
  };
  global.Logger = { log: function () { console.log.apply(console, arguments); } };
  global.HtmlService = { createTemplateFromFile: () => ({ evaluate: () => ({}) }) };

  /* ---------- Shim de google.script.run --------------------------------- */
  function Runner() { this._ok = null; this._err = null; }
  Runner.prototype.withSuccessHandler = function (f) { this._ok = f; return this; };
  Runner.prototype.withFailureHandler = function (f) { this._err = f; return this; };
  global.google = { script: { run: new Proxy(new Runner(), {
    get: function (target, prop) {
      if (prop in target) return target[prop];
      if (typeof global[prop] !== 'function') return undefined;
      return function () {
        var args = Array.prototype.slice.call(arguments), self = target;
        var ok = self._ok, err = self._err;
        self._ok = null; self._err = null;
        // Latencia simulada para que se vean los estados de carga reales.
        setTimeout(function () {
          try { if (ok) ok(global[prop].apply(null, args)); }
          catch (e) { if (err) err(e); else console.error(e); }
        }, 180);
      };
    }
  }) } };

  /* ---------- Datos de demostración ------------------------------------- */
  global.sembrarDemo = function () {
    instalarNechimotos();
    crearAdminInicial();

    var cuentas = [
      ['asesor.majagual', 'MAJAGUAL', 'TODAS'],
      ['asesor.montelibano', 'MONTELIBANO TVS', 'TVS'],
      ['asesor.banco', 'BANCO MOBILITY', 'MOBILITY'],
      ['coordinador', null, null]
    ];
    var admToken = login('admin.nechimotos', 'CambiarEstaClave2026*').data.token;
    cuentas.forEach(function (c) {
      crearUsuario(admToken, {
        usuario: c[0], password: 'Demo12345',
        rol: c[1] ? 'ASESOR_PDV' : 'AUXILIAR',
        pdv: c[1] || 'RED NACIONAL', marca: c[2] || 'TODAS'
      });
    });

    // Inventario repartido por la red, con antigüedades distintas.
    var unidades = [
      ['MD625TVS0000001','TVS','Apache RTR 160 4V','Rojo','MAJAGUAL',12],
      ['MD625TVS0000002','TVS','NTORQ 125 XConnect','Negro','MAJAGUAL',48],
      ['MD625TVS0000003','TVS','Raider 125 FI','Azul','MONTELIBANO TVS',95],
      ['MD625TVS0000004','TVS','Sport 100 ELS','Negro','MONTELIBANO TVS',7],
      ['MD625TVS0000005','TVS','Stryker 125 NG','Gris','MAGANGUE 1',63],
      ['MD625TVS0000006','TVS','Neo NX 110','Rojo','SAN MARCOS',21],
      ['9C2MOB00000001','AUTECO MOBILITY','MRX 150','Blanco','BANCO MOBILITY',30],
      ['9C2MOB00000002','AUTECO MOBILITY','Agility Fusion','Azul','BANCO MOBILITY',110],
      ['9C2MOB00000003','AUTECO MOBILITY','Bomber 150','Negro','MAJAGUAL',5],
      ['9C2MOB00000004','AUTECO MOBILITY','Nitro 125','Rojo','CODAZZI',40],
      ['9C2MOB00000005','AUTECO MOBILITY','Combat 125','Gris','CURUMANI',75],
      ['9C2MOB00000006','AUTECO MOBILITY','Starker Electrica','Blanco','PELAYA',18]
    ];
    var hoy = new Date();
    unidades.forEach(function (u) {
      var ingreso = new Date(hoy.getTime() - u[5] * 86400000);
      anexarFila_(SHEETS.INVENTARIO, {
        Chasis_VIN: u[0], Motor: u[0].replace(/^..../, 'MOT'), Marca: u[1],
        Linea_Modelo: u[2], Modelo_Ano: 2026, Color: u[3], Fecha_Ingreso: ingreso,
        PDV_Actual: u[4], Estado: 'Disponible', Asesor_Asignado: 'Sin asignar',
        Observacion: ''
      });
    });

    // Ventas históricas de los últimos 3 meses (para que el reporte tenga series).
    var lineasTvs = ['Apache RTR 160 4V','Raider 125 FI','NTORQ 125 XConnect','Sport 100 ELS'];
    var lineasMob = ['MRX 150','Agility Fusion','Bomber 150','Nitro 125'];
    var puntos = ['MAJAGUAL','MONTELIBANO TVS','BANCO MOBILITY','MAGANGUE 1','SAN MARCOS','CODAZZI','CURUMANI'];
    var asesores = ['asesor.majagual','asesor.montelibano','asesor.banco','Luis Romero','Ana Pertuz'];
    var tipos = ['Contado','Credito','Consignacion'];
    for (var i = 0; i < 70; i++) {
      var f = new Date(hoy.getTime() - Math.floor(Math.random() * 85) * 86400000);
      var esTvs = Math.random() > 0.45;
      var pdv = puntos[i % puntos.length];
      if (esTvs && pdv === 'BANCO MOBILITY') pdv = 'MONTELIBANO TVS';
      if (!esTvs && pdv === 'MONTELIBANO TVS') pdv = 'BANCO MOBILITY';
      var dias = 5 + Math.floor(Math.random() * 80);
      anexarFila_(SHEETS.VENTAS, {
        ID_Venta: 'V-DEMO-' + (1000 + i),
        Fecha_Venta: f,
        Mes_Venta: Utilities.formatDate(f, TZ, 'yyyy-MM'),
        Semana_Mes: calcularSemanaMes_(f),
        Ano: f.getFullYear(),
        Chasis_VIN: (esTvs ? 'MD625TVS' : '9C2MOB00') + (900000 + i),
        Motor: 'MOT' + (900000 + i),
        Marca: esTvs ? 'TVS' : 'AUTECO MOBILITY',
        Linea_Modelo: esTvs ? lineasTvs[i % 4] : lineasMob[i % 4],
        Modelo_Ano: 2025 + (i % 2),
        Color: ['Rojo','Negro','Azul','Blanco'][i % 4],
        Fecha_Ingreso: new Date(f.getTime() - dias * 86400000),
        Dias_Totales_Sala: dias,
        PDV_Venta: pdv,
        Asesor_Vendedor: asesores[i % asesores.length],
        Tipo_Venta: tipos[i % 3],
        Observacion: 'Venta de demostración'
      });
    }

    // Un traslado en tránsito, para poder probar el Paso 2 (recepción).
    var tokMonte = login('asesor.montelibano', 'Demo12345').data.token;
    despacharTraslado(tokMonte, {
      vin: 'MD625TVS0000004', pdvDestino: 'MAJAGUAL',
      observacion: 'Transportadora Coordinadora, guía 998877'
    });
    logout(tokMonte);
  };

})(window);

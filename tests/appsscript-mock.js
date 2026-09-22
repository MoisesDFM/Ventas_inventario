/* Stubs mínimos de Apps Script para probar la lógica de negocio en Node. */
const crypto = require('crypto');

class FakeRange {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet._rows[this.r - 1 + i] || [];
      out.push(Array.from({ length: this.nc }, (_, j) => row[this.c - 1 + j] === undefined ? '' : row[this.c - 1 + j]));
    }
    return out;
  }
  setValues(v) { v.forEach((row, i) => row.forEach((val, j) => this.sheet._set(this.r + i, this.c + j, val))); return this; }
  setValue(v) { this.sheet._set(this.r, this.c, v); return this; }
  setFontWeight() { return this; } setBackground() { return this; } setFontColor() { return this; }
  setNumberFormat() { return this; } setDataValidation() { return this; }
}
class FakeSheet {
  constructor(name) { this.name = name; this._rows = []; }
  _set(r, c, v) { while (this._rows.length < r) this._rows.push([]); this._rows[r - 1][c - 1] = v; }
  getName() { return this.name; }
  getLastRow() { return this._rows.length; }
  getLastColumn() { return this._rows.reduce((m, r) => Math.max(m, r.length), 0); }
  getMaxRows() { return Math.max(1000, this._rows.length); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(r, c, nr = 1, nc = 1) { return new FakeRange(this, r, c, nr, nc); }
  appendRow(vals) { this._rows.push(vals.slice()); }
  deleteRow(r) { this._rows.splice(r - 1, 1); }
  setFrozenRows() {} autoResizeColumns() {}
}
class FakeSS {
  constructor() { this._sheets = {}; }
  getSheetByName(n) { return this._sheets[n] || null; }
  insertSheet(n) { return (this._sheets[n] = new FakeSheet(n)); }
  getSheets() { return Object.values(this._sheets); }
  deleteSheet(sh) { delete this._sheets[sh.getName()]; }
  setSpreadsheetTimeZone() {} getId() { return 'FAKE_ID'; } getUrl() { return 'https://fake'; }
}
const SS = new FakeSS();
global.SpreadsheetApp = {
  openById: () => SS, create: () => SS, flush: () => {},
  newDataValidation: () => ({ requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } })
};
const propsStore = {};
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: k => propsStore[k] || null, setProperty: (k, v) => { propsStore[k] = v; } }) };
const cacheStore = {};
global.CacheService = { getScriptCache: () => ({
  get: k => (cacheStore[k] === undefined ? null : cacheStore[k]),
  put: (k, v) => { cacheStore[k] = v; }, remove: k => { delete cacheStore[k]; } }) };
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
global.Utilities = {
  DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
  computeDigest: (alg, txt) => Array.from(crypto.createHash('sha256').update(txt, 'utf8').digest())
    .map(b => (b > 127 ? b - 256 : b)),
  getUuid: () => crypto.randomUUID(),
  base64Encode: s => Buffer.from(s).toString('base64'),
  formatDate: (d, tz, fmt) => {
    const p = n => String(n).padStart(2, '0');
    return fmt.replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1))
      .replace('dd', p(d.getDate())).replace('HH', p(d.getHours()))
      .replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()))
      .replace('yy', String(d.getFullYear()).slice(2));
  }
};
global.Logger = { log: (...a) => console.log('[log]', ...a) };
global.HtmlService = { createTemplateFromFile: () => ({ evaluate: () => ({}) }) };
global.console = console;

'use strict';
/* Motore PDF: stampa.json generato da logica.js sulla fixture → motore/report.py → PDF con almeno una pagina.
   Installa motore/requirements.txt in test/.venv (ignorato da git). Lancio: npm run test:motore */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const L = require('../logica.js');
const { ID, zona } = require('./fixture/zona.js');

const RADICE = path.resolve(__dirname, '..');
const VENV = path.join(__dirname, '.venv');
const PY = path.join(VENV, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function esegui(cmd, args, opz = {}) { return spawnSync(cmd, args, { encoding: 'utf8', ...opz }); }

test.before(() => {
  if (!fs.existsSync(PY)) {
    const v = esegui('python3', ['-m', 'venv', VENV]); assert.equal(v.status, 0, 'venv: ' + v.stderr);
  }
  const ok = esegui(PY, ['-c', 'import reportlab']).status === 0;
  if (!ok) {
    const i = esegui(PY, ['-m', 'pip', 'install', '-q', '-r', path.join(RADICE, 'motore', 'requirements.txt')]);
    assert.equal(i.status, 0, 'pip install: ' + i.stderr);
  }
});

function preparaCartella(jobExtra = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-motore-'));
  const dir = path.join(tmp, 'zone', ID); fs.mkdirSync(dir, { recursive: true });
  const z = zona('2026-10-23');
  fs.writeFileSync(path.join(dir, 'zona.json'), JSON.stringify(z));
  const ps = [z.prospect.p1, z.prospect.p2, z.prospect.p4];
  const job = { ...L.jobStampa(z, ps, { data: '2026-10-23', richiesta: 'richiesta-prova', firma: { nome: 'Prova Test', ruolo: 'Consulente', telefono: '+39 000 000 0000', email: 'prova@example.com' } }), ...jobExtra };
  fs.writeFileSync(path.join(dir, 'stampa.json'), JSON.stringify(job));
  return { tmp, dir, job };
}

test('report.py genera il PDF del giro: esiste, è un PDF, ha almeno una pagina', () => {
  const { tmp, dir, job } = preparaCartella();
  try {
    const r = esegui(PY, ['-I', path.join(RADICE, 'motore', 'report.py'), path.join(dir, 'stampa.json')], { cwd: tmp });
    assert.equal(r.status, 0, `report.py exit ${r.status}\n${r.stderr}\n${r.stdout}`);
    const pdf = path.join(dir, 'stampa', job.file + '.pdf');
    assert.ok(fs.existsSync(pdf), 'PDF non creato: ' + pdf);
    const buf = fs.readFileSync(pdf);
    assert.ok(buf.length > 1000, 'PDF troppo piccolo: ' + buf.length);
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    const pagine = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    assert.ok(pagine >= 1, 'nessuna pagina nel PDF');
    const esito = JSON.parse(fs.readFileSync(path.join(dir, 'stampa', 'esito.json'), 'utf8'));
    assert.equal(esito.richiesta, 'richiesta-prova');
    assert.equal(esito.analisi, 3);
    assert.equal(esito.fogli, 2);
    assert.equal(esito.file, 'stampa/' + job.file + '.pdf');
    assert.equal(pagine, esito.fogli, `pagine ${pagine} ≠ fogli ${esito.fogli}`);
    assert.deepEqual(esito.avvisi, [], 'avvisi inattesi: ' + esito.avvisi);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('report.py senza griglia: esce con errore chiaro e non produce PDF', () => {
  const { tmp, dir, job } = preparaCartella({ punti: [] });
  try {
    const r = esegui(PY, ['-I', path.join(RADICE, 'motore', 'report.py'), path.join(dir, 'stampa.json')], { cwd: tmp });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /griglia non utilizzabile/);
    assert.ok(!fs.existsSync(path.join(dir, 'stampa', job.file + '.pdf')));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

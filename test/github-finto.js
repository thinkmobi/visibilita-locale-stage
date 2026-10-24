'use strict';
/* GitHub finto in memoria: emula GET/PUT /repos/:owner/:repo/contents/* per il repo dati.
   Nessuna rete reale: ogni altra richiesta a api.github.com viene bloccata. */
const crypto = require('node:crypto');

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

function creaGithub({ owner = 'prova', repo = 'visibilita-dati-stage' } = {}) {
  const file = new Map();   // percorso → { buf, sha }
  const gh = {
    owner, repo, richieste: [], put: [], rifiuti: 0, offline: false, forza409: 0, ritardoMs: 0,
    metti(p, dati) { const buf = Buffer.isBuffer(dati) ? dati : Buffer.from(typeof dati === 'string' ? dati : JSON.stringify(dati)); const sha = sha1(Buffer.concat([Buffer.from('blob ' + buf.length + '\0'), buf])); file.set(p, { buf, sha }); return sha; },
    json(p) { const f = file.get(p); return f ? JSON.parse(f.buf.toString('utf8')) : null; },
    ha(p) { return file.has(p); },
    sha(p) { const f = file.get(p); return f ? f.sha : null; },
    putSu(p) { return gh.put.filter((x) => x.path === p); },
    reset() { gh.richieste.length = 0; gh.put.length = 0; },
    /* installa le rotte su un contesto Playwright */
    async installa(ctx) {
      await ctx.route('https://api.github.com/**', async (route) => {
        const req = route.request(); const u = new URL(req.url()); const m = req.method();
        if (m === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        gh.richieste.push({ metodo: m, path: u.pathname, auth: req.headers().authorization });
        if (gh.offline) return route.abort('internetdisconnected');
        if (gh.ritardoMs) await new Promise((r) => setTimeout(r, gh.ritardoMs));
        const base = `/repos/${owner}/${repo}/contents/`;
        const risp = (status, body, extra = {}) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
        if (u.pathname === `/repos/${owner}/${repo}`) return risp(200, { full_name: `${owner}/${repo}`, private: true });
        if (!u.pathname.startsWith(base)) return risp(404, { message: 'Not Found' });
        const p = decodeURIComponent(u.pathname.slice(base.length)).replace(/\/$/, '');
        if (!/^Bearer \S+$/.test(req.headers().authorization || '')) return risp(401, { message: 'Bad credentials' });
        if (m === 'GET') {
          const f = file.get(p);
          if (f) {
            const raw = /raw/.test(req.headers().accept || '');
            if (raw) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: f.buf });
            return risp(200, { type: 'file', name: p.split('/').pop(), path: p, sha: f.sha, size: f.buf.length, content: f.buf.toString('base64') });
          }
          const pref = p ? p + '/' : '';
          const figli = new Map();
          for (const [k, v] of file) if (k.startsWith(pref)) { const resto = k.slice(pref.length); const nome = resto.split('/')[0]; if (resto.includes('/')) figli.set(nome, { type: 'dir', name: nome, path: pref + nome, sha: sha1(Buffer.from(pref + nome)) }); else figli.set(nome, { type: 'file', name: nome, path: k, sha: v.sha, size: v.buf.length }); }
          return figli.size ? risp(200, [...figli.values()]) : risp(404, { message: 'Not Found' });
        }
        if (m === 'PUT') {
          const corpo = JSON.parse(req.postData() || '{}');
          gh.put.push({ path: p, shaInviato: corpo.sha || null, messaggio: corpo.message });
          if (gh.forza409 > 0) { gh.forza409--; gh.rifiuti++; return risp(409, { message: `${p} does not match` }); }
          const f = file.get(p);
          if (f && corpo.sha !== f.sha) { gh.rifiuti++; return risp(409, { message: `${p} does not match ${f.sha}` }); }
          if (!f && corpo.sha) { gh.rifiuti++; return risp(422, { message: 'sha non valido' }); }
          const sha = gh.metti(p, Buffer.from(corpo.content, 'base64'));
          return risp(f ? 200 : 201, { content: { path: p, sha }, commit: { sha: sha1(Buffer.from(String(Date.now()))) } });
        }
        return risp(405, { message: 'Method Not Allowed' });
      });
    },
  };
  return gh;
}

module.exports = { creaGithub };

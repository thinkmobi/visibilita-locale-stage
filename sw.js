// Cache dell'app per l'uso offline. I dati (api.github.com) non passano mai da qui.
const CACHE = 'vl-0.23.0';
const FILE = ['./', 'index.html', 'stile.css', 'app.js', 'logica.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'motore/fonts/PlexSans-Regular.ttf', 'motore/fonts/PlexSans-Medium.ttf', 'motore/fonts/PlexSans-SemiBold.ttf', 'motore/fonts/PlexCond-Bold.ttf', 'motore/fonts/PlexMono-Medium.ttf'];
// produzione e stage stanno sullo stesso sito: ogni ambiente cancella solo le proprie cache vecchie (e quelle senza ambiente, delle versioni precedenti)
const AMB = '@' + (/-stage\//.test(self.location.pathname) ? 'stage' : 'prod');
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE + AMB).then((c) => c.addAll(FILE))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== CACHE + AMB && (x.endsWith(AMB) || !x.includes('@'))).map((x) => caches.delete(x))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== 'GET') return;
  // rete prima (aggiornamenti immediati), cache se offline
  // no-cache: chiede sempre al server se il file è cambiato, così app.js e logica.js arrivano della stessa versione;
  // in cache vanno solo le risposte valide (un 404 durante un aggiornamento di Pages non sostituisce la copia buona)
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => {
    if (r.ok) { const c = r.clone(); caches.open(CACHE + AMB).then((x) => x.put(e.request, c)); return r; }
    return caches.match(e.request, { ignoreSearch: true }).then((m) => m || r);
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

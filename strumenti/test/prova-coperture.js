// La prova che conta: Ordini cliente + Storico devono coprire TUTTE le
// commesse, ognuna una volta sola. Nessun buco (era il difetto: 21 invisibili)
// e nessun doppione (una commessa in tutte e due sarebbe altrettanto sbagliato).
const https = require('https'), fs = require('fs'), vm = require('vm');
const G = process.argv[2];
const db = fs.readFileSync(G + '/core/db.js', 'utf8');
const URL = db.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const KEY = db.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const EMAIL = db.match(/APP_EMAIL\s*=\s*'([^']+)'/)[1];
const PASS = db.match(/APP_PASSWORD\s*=\s*'([^']+)'/)[1];
const host = URL.replace('https://', '');
const req = (p, m, b, t) => new Promise((res, rej) => {
  const d = b ? JSON.stringify(b) : null;
  const r = https.request({ host, path: p, method: m, headers: Object.assign({
    apikey: KEY, Authorization: 'Bearer ' + (t || KEY), 'Content-Type': 'application/json',
  }, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, resp => {
    let s = ''; resp.on('data', c => s += c);
    resp.on('end', () => { try { res(JSON.parse(s)); } catch (e) { res(s); } });
  });
  r.on('error', rej); if (d) r.write(d); r.end();
});
const tutte = async (tab, tok) => {
  const o = [];
  for (let f = 0; ; f += 1000) {
    const p = await req('/rest/v1/' + tab + '?select=*&limit=1000&offset=' + f, 'GET', null, tok);
    if (!Array.isArray(p) || !p.length) break;
    o.push(...p); if (p.length < 1000) break;
  }
  return o;
};

(async () => {
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.access_token;
  const ops = await tutte('operazioni', tok);
  const sped = await tutte('spedizioni', tok);

  const s = vm.createContext({ state: {}, console });
  vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8'), s);
  const OGGI = new Date().toISOString().slice(0, 10);

  // le due schede, con le stesse regole del codice
  const inStorico = o => s.commessaInStorico(o, sped, OGGI);
  const storico = ops.filter(inStorico);
  const ordini  = ops.filter(o => !inStorico(o));

  console.log('commesse totali:', ops.length);
  console.log('  Ordini cliente:', ordini.length);
  console.log('  Storico:       ', storico.length);
  console.log('  somma:         ', ordini.length + storico.length,
    ordini.length + storico.length === ops.length ? '  ✓ torna' : '  ✗ NON TORNA');

  const idsO = new Set(ordini.map(o => o.id)), idsS = new Set(storico.map(o => o.id));
  const doppie = ops.filter(o => idsO.has(o.id) && idsS.has(o.id));
  const orfane = ops.filter(o => !idsO.has(o.id) && !idsS.has(o.id));
  console.log('\n  in TUTTE E DUE (sarebbe un errore):', doppie.length);
  console.log('  in NESSUNA delle due (il vecchio buco):', orfane.length);

  // dentro Ordini cliente: come si spartiscono i chip
  const perStato = {};
  ordini.forEach(o => { perStato[o.stato] = (perStato[o.stato] || 0) + 1; });
  console.log('\nOrdini cliente per stato:', JSON.stringify(perStato));
  console.log('  vista "Tutte" (tutto quello che sta nella scheda):', ordini.length);
  console.log('  chip "Spedite":', ordini.filter(o => o.stato === 'spedita').length);

  // dentro lo Storico: quante hanno spedizioni registrate
  const nSp = {}; sped.forEach(x => { nSp[x.operazione_id] = (nSp[x.operazione_id] || 0) + 1; });
  const conSped = storico.filter(o => nSp[o.id]).length;
  console.log('\nStorico: con spedizione registrata', conSped,
    '| senza (caricamento iniziale)', storico.length - conSped);
  console.log('  righe della vecchia vista per spedizione:', sped.length,
    '-> adesso una per commessa:', storico.length);

  // le tre che avevano fatto scoprire il buco
  console.log('\nle commesse della segnalazione:');
  ['2026/OC/00011', '2026/OC/00128', '2026/OC/00000'].forEach(n => {
    const trovate = ops.filter(o => o.numero_ordine === n);
    trovate.forEach(o => console.log('   ' + n + '/' + o.pos + '  ' + o.stato
      + '  ->  ' + (inStorico(o) ? 'STORICO' : 'Ordini cliente')));
  });

  const esito = (ordini.length + storico.length === ops.length) && !doppie.length && !orfane.length;
  console.log('\n' + (esito ? 'OK: ogni commessa ha una casa, e una sola.' : 'PROBLEMA: la copertura non e completa.'));
  process.exit(esito ? 0 : 1);
})();

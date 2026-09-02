// Quante commesse sembrano SERVITE e non lo sono.
//
// Il fabbisogno di Alnus attribuisce ogni codice mancante a UNA sola commessa:
// quella che lo consuma per prima (colonna "OdL Prossimo Impegno"). Due
// commesse dello stesso articolo vogliono gli stessi materiali, ma il mancante
// finisce tutto sulla piu vicina a scadere, e l'altra risulta pulita.
// Questa prova elenca le commesse in quel caso: senza righe proprie, ma con
// una sorella dello stesso articolo che ne ha.
//
//   node strumenti/test/prova-mancanti-riflessi.js .
const https = require('https'), fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
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
  const mancanti = await tutte('mancanti', tok);
  const articoli = await tutte('articoli', tok);
  const artById = {}; articoli.forEach(a => artById[a.id] = a);

  const s = vm.createContext({ state: { operazioni: ops, mancanti }, console });
  vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8'), s);

  const vive = ops.filter(o => o.stato === 'aperta' || o.stato === 'sospesa');
  const conRighe = vive.filter(o => s.mancantiCommessa(o).nCodici > 0);
  const riflesse = vive
    .map(o => ({ o, rifl: s.mancantiRiflessi(o) }))
    .filter(x => x.rifl.length);

  console.log('commesse vive (aperte + sospese): ' + vive.length);
  console.log('  con righe di fabbisogno PROPRIE: ' + conRighe.length);
  console.log('  senza righe proprie ma coperte da una sorella: ' + riflesse.length);
  console.log('  davvero senza segnalazioni: '
    + (vive.length - conRighe.length - riflesse.length));
  console.log('\nrighe di fabbisogno in archivio: ' + mancanti.length
    + ' · estrazione del ' + ((mancanti[0] || {}).import_data || '?'));

  if (riflesse.length) {
    console.log('\nQuelle che PRIMA sembravano a posto:');
    riflesse.forEach(({ o, rifl }) => {
      const cod = (artById[o.articolo_id] || {}).codice || '?';
      const b = rifl.reduce((n, r) => n + r.mc.nBloccanti, 0);
      const c = rifl.reduce((n, r) => n + r.mc.nCodici, 0);
      console.log('  ' + (o.numero_ordine || '?') + '/' + (o.pos || '?')
        + '  ' + (o.numero_op || '—')
        + '  art ' + cod
        + '  scad ' + (o.scadenza || '—')
        + '   -> conteggiata su ' + rifl.map(r => r.op.numero_op).join(', ')
        + '  (' + b + ' da ordinare su ' + c + ')');
    });
  }

  // Non c'e' un esito giusto o sbagliato: e' una fotografia. Fallisce solo se
  // la regola si contraddice, cioe' se una commessa risulta insieme con righe
  // proprie e con un riflesso.
  const incoerenti = riflesse.filter(x => s.mancantiCommessa(x.o).nCodici > 0);
  console.log('\n' + (incoerenti.length
    ? 'PROBLEMA: ' + incoerenti.length + ' commesse con righe proprie E riflesso.'
    : 'OK: nessuna commessa ha insieme righe proprie e riflesso.'));
  process.exit(incoerenti.length ? 1 : 0);
})();

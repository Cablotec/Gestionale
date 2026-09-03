// Crea la lista materiali sulle commesse che non ce l'hanno, una tantum.
//
// La lista di norma nasce con l'ordine (tutte e tre le porte la creano). Serve
// questo per le commesse gia' a sistema il giorno che la colonna e' stata
// aggiunta: senza, resterebbero vuote finche' qualcuno non apre la scheda e
// preme il bottone, una per una.
//
// DI DEFAULT NON SCRIVE: legge, dice cosa farebbe e salva il contenuto su
// file. Si scrive con --scrivi. Regola di casa: dichiarare quante righe si
// toccano, salvarle su file, aspettare l'ok.
//
// ⚠ Di default tocca solo le commesse VIVE (aperta/sospesa). Su una gia'
// spedita la lista sarebbe scritta con la distinta di OGGI, che non e' quella
// con cui il pezzo e' stato fatto: sarebbe inventare storia. Con --tutte si
// forza, sapendo cosa si sta facendo.
//
//   node strumenti/genera-materiali-commesse.js .
//   node strumenti/genera-materiali-commesse.js . --scrivi
//   node strumenti/genera-materiali-commesse.js . --scrivi --tutte
const fs = require('fs');
const https = require('https');
const path = require('path');
const G = process.argv[2] || '.';
const SCRIVI = process.argv.includes('--scrivi');
const TUTTE = process.argv.includes('--tutte');
const M = require(path.resolve(G, 'domain/materiali.js'));

const db = fs.readFileSync(G + '/core/db.js', 'utf8');
const URLB = db.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const KEY = db.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const EMAIL = db.match(/APP_EMAIL\s*=\s*'([^']+)'/)[1];
const PASS = db.match(/APP_PASSWORD\s*=\s*'([^']+)'/)[1];
const host = URLB.replace('https://', '');
const req = (p, m, b, tok, extra) => new Promise((res, rej) => {
  const d = b ? JSON.stringify(b) : null;
  const r = https.request({ host, path: p, method: m, headers: Object.assign({
    apikey: KEY, Authorization: 'Bearer ' + (tok || KEY), 'Content-Type': 'application/json',
  }, extra || {}, d ? { 'Content-Length': Buffer.byteLength(d) } : {}) }, resp => {
    let s = ''; resp.on('data', c => s += c);
    resp.on('end', () => { let j = null; try { j = JSON.parse(s); } catch (e) { j = s; }
      res({ stato: resp.statusCode, corpo: j }); });
  });
  r.on('error', rej); if (d) r.write(d); r.end();
});
const tutteRighe = async (tab, tok, sel) => {
  const o = [];
  for (let f = 0; ; f += 1000) {
    const p = await req('/rest/v1/' + tab + '?select=' + (sel || '*') + '&limit=1000&offset=' + f, 'GET', null, tok);
    if (!Array.isArray(p.corpo) || !p.corpo.length) break;
    o.push(...p.corpo); if (p.corpo.length < 1000) break;
  }
  return o;
};

(async () => {
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.corpo.access_token;

  // La colonna c'e?
  const prova = await req('/rest/v1/operazioni?select=materiali&limit=1', 'GET', null, tok);
  if (prova.stato !== 200) {
    console.error('La colonna `operazioni.materiali` non c\'è: esegui prima '
      + 'strumenti/migrazione-materiali-commessa.sql dal pannello Supabase.');
    process.exit(2);
  }

  const [ops, art, dist] = await Promise.all([
    tutteRighe('operazioni', tok, 'id,numero_ordine,pos,numero_op,articolo_id,quantita,stato,materiali'),
    tutteRighe('articoli', tok, 'id,codice,distinta'),
    tutteRighe('distinta', tok, 'padre,figlio,qta,um,figlio_descrizione')]);

  const artById = {}; art.forEach(a => artById[a.id] = a);
  const figliDi = M.indiceDistinta(dist);
  // Le distinte scritte a mano nella scheda articolo vincono, come nell'app.
  M.applicaDistinteLocali(figliDi, art);
  const descr = {}, ums = {};
  dist.forEach(r => {
    if (r.figlio_descrizione && !descr[r.figlio]) descr[r.figlio] = r.figlio_descrizione;
    if (r.um && !ums[r.figlio]) ums[r.figlio] = r.um;
  });

  const viva = (o) => o.stato === 'aperta' || o.stato === 'sospesa';
  const candidate = ops.filter(o => (TUTTE || viva(o)) && !o.materiali);
  const gia = ops.filter(o => o.materiali).length;

  const daFare = [], senzaDistinta = [], senzaArticolo = [], senzaQta = [], aVuoto = [];
  candidate.forEach(o => {
    const a = artById[o.articolo_id];
    if (!a || !a.codice) { senzaArticolo.push(o); return; }
    const pezzi = Number(o.quantita) || 0;
    if (!(pezzi > 0)) { senzaQta.push(o); return; }
    if (!figliDi.has(a.codice)) { senzaDistinta.push({ o, cod: a.codice }); return; }
    const e = M.esplodiDistinta(a.codice, pezzi, figliDi);
    const righe = [...e.materiali.entries()]
      .map(([codice, qta]) => ({
        codice, descrizione: descr[codice] || null, um: ums[codice] || null,
        qta_pz: +(qta / pezzi).toFixed(6), qta: +qta.toFixed(4),
      }))
      .sort((x, y) => x.codice.localeCompare(y.codice, 'it', { numeric: true, sensitivity: 'base' }));
    if (righe.length) daFare.push({ o, art: a, righe });
    else aVuoto.push({ o, cod: a.codice });
  });

  console.log('=== COMMESSE ===');
  console.log('  totali a database:            ' + ops.length);
  console.log('  in esame (' + (TUTTE ? 'TUTTE' : 'solo vive') + ', senza lista):  ' + candidate.length);
  console.log('  che hanno gia la lista:       ' + gia);
  console.log('\n=== COSA SI PUO FARE ===');
  console.log('  con distinta -> lista da creare: ' + daFare.length
    + '   (' + daFare.reduce((a, x) => a + x.righe.length, 0) + ' righe in tutto)');
  console.log('  senza distinta, restano vuote:   ' + senzaDistinta.length);
  console.log('  senza articolo collegato:        ' + senzaArticolo.length);
  console.log('  con quantita a zero:             ' + senzaQta.length);
  console.log('  distinta fatta solo di segnaposto: ' + aVuoto.length
    + '   (COMP GENERICO / VARIE: esclusi dal calcolo)');
  const somma = daFare.length + senzaDistinta.length + senzaArticolo.length + senzaQta.length + aVuoto.length;
  console.log('  ── somma: ' + somma + ' su ' + candidate.length
    + (somma === candidate.length ? '  ✓ tornano' : '  ✗ NON TORNANO'));

  if (aVuoto.length) {
    console.log('\n  articoli la cui distinta e solo segnaposto (i primi 6):');
    [...new Set(aVuoto.map(x => x.cod))].slice(0, 6).forEach(c => console.log('     ' + c));
  }
  if (senzaDistinta.length) {
    console.log('\n  gli articoli senza distinta (i primi 10):');
    [...new Set(senzaDistinta.map(x => x.cod))].slice(0, 10)
      .forEach(c => console.log('     ' + c));
  }
  if (daFare.length) {
    console.log('\n  esempi di cosa verrebbe scritto:');
    daFare.slice(0, 3).forEach(x => console.log('     '
      + ((x.o.numero_ordine || '?') + '/' + (x.o.pos || '?')).padEnd(20)
      + (x.o.numero_op || '').padEnd(16) + x.art.codice.padEnd(24)
      + x.o.quantita + ' pz -> ' + x.righe.length + ' materiali'));
  }

  // Copia su disco PRIMA di scrivere, e FUORI dal repo: e' pubblico.
  if (daFare.length) {
    const fuori = path.join(require('os').tmpdir(), 'materiali-commesse-' + Date.now() + '.json');
    fs.writeFileSync(fuori, JSON.stringify(daFare.map(x => ({
      id: x.o.id, commessa: (x.o.numero_ordine || '') + '/' + (x.o.pos || ''),
      numero_op: x.o.numero_op, articolo: x.art.codice, materiali: x.righe,
    })), null, 1));
    console.log('\n  copia salvata in ' + fuori);
  }

  // ── La strada che funziona davvero: SQL dal pannello ──
  // Le UPDATE in blocco su `operazioni` passano di li, come le posizioni e
  // le scadenze: e' la regola gia' scritta in CLAUDE.md.
  if (process.argv.includes('--sql')) {
    const esc = (t) => String(t).replace(/'/g, "''");
    const out = [ '-- Lista materiali delle commesse, generata da',
      '-- strumenti/genera-materiali-commesse.js il ' + new Date().toISOString().slice(0, 10) + '.',
      '-- Da eseguire nel PANNELLO Supabase: le UPDATE su operazioni non passano',
      "-- dall'account tecnico (l'RLS le rifiuta in silenzio, HTTP 200 e zero righe).",
      '-- Righe toccate: ' + daFare.length + '.', 'BEGIN;' ];
    daFare.forEach(x => out.push("UPDATE operazioni SET materiali = '"
      + esc(JSON.stringify(x.righe)) + "'::jsonb WHERE id = '" + x.o.id + "';"));
    out.push('COMMIT;', '',
      '-- Verifica: SELECT count(*) FROM operazioni WHERE materiali IS NOT NULL;');
    // ⚠ FUORI DAL REPO: dentro ci sono le distinte complete dei prodotti,
    // e il repo e pubblico. Stessa scelta della copia JSON qui sopra.
    const f = path.join(require('os').tmpdir(), 'materiali-commesse.sql');
    fs.writeFileSync(f, out.join('\n'));
    console.log('\n  scritto ' + f);
    console.log('  Eseguilo nel pannello Supabase: ' + daFare.length + ' UPDATE.');
    return;
  }

  if (!SCRIVI) {
    console.log('\n  PROVA A VUOTO: non ho scritto niente.');
    console.log('  --sql     -> genera il file per il pannello (la strada che funziona)');
    console.log("  --scrivi  -> prova via REST (l'RLS la rifiuta)");
    return;
  }

  let fatte = 0, errori = 0, rifiutate = 0;
  for (const x of daFare) {
    // Prefer return=representation: si fa restituire la riga scritta.
    // ⚠⚠ Senza, l'RLS che rifiuta risponde HTTP 200 con ZERO righe e il
    // conto direbbe "fatto". La prima versione di questo strumento ha
    // dichiarato "67/67 scritte" senza aver scritto niente.
    const r = await req('/rest/v1/operazioni?id=eq.' + x.o.id, 'PATCH',
      { materiali: x.righe }, tok, { Prefer: 'return=representation' });
    if (r.stato >= 300) { errori++; if (errori <= 3) console.error('  errore su '
      + x.o.numero_op + ': ' + r.stato + ' ' + JSON.stringify(r.corpo).slice(0, 160)); continue; }
    const tornata = Array.isArray(r.corpo) ? r.corpo.length : (r.corpo ? 1 : 0);
    if (!tornata) {
      rifiutate++;
      console.error('\n  ⚠ SCRITTURA RIFIUTATA IN SILENZIO (HTTP ' + r.stato + ', zero righe).');
      console.error("    E' l'RLS: questo account non puo scrivere su `operazioni`.");
      console.error('    Rilancia con --sql ed esegui il file dal pannello Supabase.');
      break;
    }
    fatte++;
    if (fatte % 25 === 0) process.stdout.write('\r  scritte: ' + fatte + '/' + daFare.length);
  }
  if (rifiutate) { console.error('  fermato: nessuna riga scritta.'); process.exit(1); }
  console.log('\r  scritte: ' + fatte + '/' + daFare.length + (errori ? '   errori: ' + errori : ''));
})();

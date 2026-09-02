// Carica l'estrazione distinte di Alnus in `materiali` e `distinta`.
//
// DI DEFAULT NON SCRIVE NIENTE: legge il file, dice cosa farebbe e salva il
// contenuto su disco. Si scrive solo con --scrivi, ed e la regola di casa —
// dichiarare quante righe si toccano, salvarle su file, aspettare l'ok. Il
// 7 ago un file salvato il giorno prima ha permesso di recuperare 144
// timbrature.
//
//   node strumenti/carica-distinte.js . <file.xls>            (prova a vuoto)
//   node strumenti/carica-distinte.js . <file.xls> --scrivi   (scrive)
//
// ⚠ `distinta` e una FOTOGRAFIA: ogni caricamento SOSTITUISCE il precedente,
// come i mancanti. Tenere le righe vecchie accanto alle nuove darebbe due
// verita sullo stesso prodotto.
// ⚠ `materiali` invece NON si sostituisce: e un'anagrafica, e i campi che si
// riempiono a mano (fornitore, scorta minima, lead time) non si buttano via a
// ogni import. I codici gia presenti si aggiornano, i nuovi si aggiungono, i
// vecchi restano con `visto_il` fermo all'ultima volta che sono comparsi.
const fs = require('fs');
const https = require('https');
const path = require('path');
const G = process.argv[2] || '.';
const FILE = process.argv[3];
const SCRIVI = process.argv.includes('--scrivi');
if (!FILE) {
  console.error('uso: node strumenti/carica-distinte.js . <file.xls> [--scrivi]');
  process.exit(2);
}
const XLSX = require(path.resolve(G, 'strumenti/test/xlsx.full.min.js'));

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

const t = v => String(v == null ? '' : v).trim();
const numDi = v => {
  const s = t(v).replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

// ── Il report a blocchi: [padre][intestazioni][componenti...] e da capo ──
function leggi(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const righe = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const out = []; let cur = null;
  for (const r of righe) {
    const c = r.map(t);
    if (c[0] === 'Codice Padre') {
      cur = { padre: c[1], descr: c[2], tipoParte: c[6], comp: [] };
      out.push(cur); continue;
    }
    if (!cur || c[0] === 'Nr.  Riga' || c[0] === 'Fase' || !c[1]) continue;
    cur.comp.push({ riga: c[0], codice: c[1], descr: c[3], tipoParte: c[4], um: c[5], qta: c[6] });
  }
  return out.filter(d => d.padre);
}

(async () => {
  const oggi = new Date().toISOString().slice(0, 10);
  const distinte = leggi(FILE);

  // ── Righe di distinta ──
  const righeDist = [];
  distinte.forEach(d => d.comp.forEach(c => righeDist.push({
    padre: d.padre, figlio: c.codice,
    qta: numDi(c.qta), um: t(c.um) || null,
    tipo_parte: t(c.tipoParte).toUpperCase() || null,
    riga: t(c.riga) || null,
    padre_descrizione: t(d.descr) || null,
    figlio_descrizione: t(c.descr) || null,
    import_data: oggi,
  })));

  // ── Anagrafica: ogni codice che compare, da padre o da figlio ──
  // Un padre e un materiale come gli altri: `TS-342015G00` e figlio di uno e
  // padre di undici. Distinguerli qui vorrebbe dire inventare una gerarchia
  // che nel file non c'e'.
  const mat = new Map();
  const metti = (codice, descr, um, tp) => {
    const k = t(codice); if (!k) return;
    const gia = mat.get(k) || { codice: k, descrizione: null, um: null, tipo_parte: null };
    // Il primo valore non vuoto vince: le righe si ripetono e la descrizione
    // e sempre la stessa, ma l'UM su un padre spesso non c'e'.
    if (!gia.descrizione && t(descr)) gia.descrizione = t(descr);
    if (!gia.um && t(um)) gia.um = t(um);
    if (!gia.tipo_parte && t(tp)) gia.tipo_parte = t(tp).toUpperCase();
    mat.set(k, gia);
  };
  distinte.forEach(d => {
    metti(d.padre, d.descr, null, d.tipoParte);
    d.comp.forEach(c => metti(c.codice, c.descr, c.um, c.tipoParte));
  });
  const materiali = [...mat.values()].map(m => Object.assign(m, { visto_il: oggi }));

  console.log('=== LETTO DAL FILE ===');
  console.log('  distinte (padri):        ' + distinte.length);
  console.log('  righe padre->figlio:     ' + righeDist.length);
  console.log('  materiali distinti:      ' + materiali.length);
  const senzaUm = materiali.filter(m => !m.um).length;
  const senzaTp = materiali.filter(m => !m.tipo_parte).length;
  console.log('  ...senza UM: ' + senzaUm + '  ·  senza tipo parte: ' + senzaTp);
  const senzaQta = righeDist.filter(r => r.qta == null).length;
  if (senzaQta) console.log('  ⚠ righe senza quantita leggibile: ' + senzaQta);

  // Copia su disco PRIMA di toccare qualsiasi cosa — la regola di casa.
  // ⚠ Accanto al FILE DI PARTENZA, non dentro il repo: sono ~12 MB di dati
  // di produzione e il repo e PUBBLICO. Stessa scelta di backup.js.
  const dir = path.dirname(path.resolve(FILE));
  const fMat = path.join(dir, 'carico-materiali.json');
  const fDist = path.join(dir, 'carico-distinta.json');
  fs.writeFileSync(fMat, JSON.stringify(materiali, null, 1));
  fs.writeFileSync(fDist, JSON.stringify(righeDist, null, 1));
  console.log('\n  salvati accanto al file di partenza:');
  console.log('    ' + fMat);
  console.log('    ' + fDist);

  // ── Le tabelle ci sono? ──
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.corpo.access_token;
  const prova = async (tab) => {
    const r = await req('/rest/v1/' + tab + '?select=id&limit=1', 'GET', null, tok);
    return r.stato === 200;
  };
  const okMat = await prova('materiali'), okDist = await prova('distinta');
  console.log('\n=== TABELLE ===');
  console.log('  materiali: ' + (okMat ? 'c e' : 'NON C E'));
  console.log('  distinta:  ' + (okDist ? 'c e' : 'NON C E'));
  if (!okMat || !okDist) {
    console.log('\n  Esegui prima strumenti/migrazione-distinte.sql dal pannello Supabase.');
    return;
  }

  if (!SCRIVI) {
    console.log('\n  PROVA A VUOTO: non ho scritto niente.');
    console.log('  Per scrivere davvero: aggiungi --scrivi');
    console.log('  (distinta viene SOSTITUITA per intero; materiali aggiornata e arricchita)');
    return;
  }

  // ── Scrittura ──
  const blocchi = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

  // materiali: upsert sul codice, cosi i campi riempiti a mano sopravvivono.
  let nMat = 0;
  for (const b of blocchi(materiali, 500)) {
    const r = await req('/rest/v1/materiali?on_conflict=codice', 'POST', b, tok,
      { Prefer: 'resolution=merge-duplicates,return=minimal' });
    if (r.stato >= 300) { console.error('errore materiali: ' + r.stato + ' ' + JSON.stringify(r.corpo).slice(0, 300)); return; }
    nMat += b.length; process.stdout.write('\r  materiali: ' + nMat + '/' + materiali.length);
  }
  console.log('');

  // distinta: fotografia, quindi prima si svuota.
  const del = await req('/rest/v1/distinta?id=not.is.null', 'DELETE', null, tok, { Prefer: 'return=minimal' });
  if (del.stato >= 300) { console.error('errore svuotamento: ' + del.stato + ' ' + JSON.stringify(del.corpo).slice(0, 300)); return; }
  let nD = 0;
  for (const b of blocchi(righeDist, 500)) {
    const r = await req('/rest/v1/distinta', 'POST', b, tok, { Prefer: 'return=minimal' });
    if (r.stato >= 300) { console.error('\nerrore distinta: ' + r.stato + ' ' + JSON.stringify(r.corpo).slice(0, 300)); return; }
    nD += b.length; process.stdout.write('\r  distinta: ' + nD + '/' + righeDist.length);
  }
  console.log('\n\n  fatto: ' + nMat + ' materiali · ' + nD + ' righe di distinta (' + oggi + ')');
})();

// Porta le distinte DENTRO i prodotti, una volta sola.
//
// Fino a oggi `articoli.distinta` era vuota quasi ovunque e la distinta vera
// si leggeva dalla tabella `distinta`, la fotografia di Alnus. Due origini per
// la stessa cosa. Decisione di Nico (4 set): "non voglio piu' cache Alnus, le
// distinte sono importate e basta". Questo strumento fa il travaso: dopo,
// ogni prodotto porta la sua, e la tabella `distinta` resta come archivio che
// nessuno legge.
//
// ⚠⚠ SI SCRIVONO LE FOGLIE, NON I FIGLI DIRETTI. Su 229 prodotti con distinta,
// 225 sono a un livello solo e le due cose coincidono. I 4 multilivello no:
// `TS-342010003` ha 82 figli diretti di cui 37 sono sottoassiemi, e i materiali
// veri sono 56. Scrivere gli 82 vorrebbe dire mettere in distinta delle scatole
// al posto dei pezzi, e il fabbisogno conterebbe cose che a magazzino non si
// prelevano. E' anche la forma che ha gia' `operazioni.materiali`.
//
// ⚠ NON tocca i prodotti che hanno gia' una distinta scritta qui: quella e'
// una dichiarazione di qualcuno e non si sovrascrive con un travaso massivo.
//
// DI DEFAULT NON SCRIVE: legge, dice cosa farebbe e salva il contenuto su
// file. Regola di casa: dichiarare quante righe si toccano, salvarle su file,
// aspettare l'ok.
//
//   node strumenti/materializza-distinte.js .
//   node strumenti/materializza-distinte.js . --sql migrazione-distinte-materializzate.sql
//   node strumenti/materializza-distinte.js . --scrivi            (account kiosk)
//   node strumenti/materializza-distinte.js . --scrivi --come-ai  (account AI)
//
// ⚠ --scrivi da solo NON basta: l'account kiosk non puo scrivere su
// `articoli` (ed e giusto cosi, e condiviso da tutte le postazioni di
// reparto). Serve --come-ai, che entra con l'utente dedicato leggendo la
// password dal file locale fuori dal repo, piu la policy di
// `strumenti/accesso-claude-articoli.sql` eseguita dal pannello.
const fs = require('fs');
const https = require('https');
const path = require('path');
const G = process.argv[2] || '.';
const SCRIVI = process.argv.includes('--scrivi');
const iSql = process.argv.indexOf('--sql');
const FILE_SQL = iSql >= 0 ? (process.argv[iSql + 1] || 'migrazione-distinte-materializzate.sql') : null;
const M = require(path.resolve(G, 'domain/materiali.js'));
const COME_AI = process.argv.includes('--come-ai');
const CRED = require(path.resolve(G, 'strumenti/credenziali.js'));

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
const tutte = async (tab, tok, sel) => {
  const o = [];
  for (let f = 0; ; f += 1000) {
    const r = await req('/rest/v1/' + tab + '?select=' + (sel || '*') + '&limit=1000&offset=' + f, 'GET', null, tok);
    const p = r.corpo;
    if (!Array.isArray(p) || !p.length) break;
    o.push(...p); if (p.length < 1000) break;
  }
  return o;
};
const T = v => String(v == null ? '' : v).trim();
const q = v => "'" + String(v).replace(/'/g, "''") + "'";

(async () => {
  // Con --come-ai si entra con l'utente dedicato: e l'unico che le policy
  // lasciano scrivere. Senza, si entra col kiosk e si legge soltanto.
  let email = EMAIL, pw = PASS;
  if (COME_AI) {
    const c = CRED.leggiCredenziali('ai@cablotec.local', { radice: G });
    email = c.email; pw = c.password;
    console.log('entro come ' + email + ' (password dal file locale)');
  }
  const a = await req('/auth/v1/token?grant_type=password', 'POST', { email, password: pw });
  const tok = a.corpo && a.corpo.access_token;
  if (!tok) { console.error('login fallito'); process.exit(1); }

  const art = await tutte('articoli', tok, 'id,codice,distinta,attivo');
  const dist = await tutte('distinta', tok, 'padre,figlio,qta,um,figlio_descrizione');
  const figliDi = M.indiceDistinta(dist);
  const descrDi = new Map();
  const umDi = new Map();
  dist.forEach(r => {
    if (r.figlio_descrizione && !descrDi.has(r.figlio)) descrDi.set(r.figlio, r.figlio_descrizione);
    if (r.um && !umDi.has(r.figlio)) umDi.set(r.figlio, r.um);
  });

  console.log('articoli: ' + art.length + ' · righe distinta: ' + dist.length);

  const gia = art.filter(x => Array.isArray(x.distinta));
  const senza = [];
  const daFare = [];
  const multi = [];

  art.forEach(x => {
    if (Array.isArray(x.distinta)) return;          // gia' dichiarata qui: non si tocca
    const figli = figliDi.get(x.codice);
    if (!figli || !figli.length) { senza.push(x.codice); return; }
    const e = M.esplodiDistinta(x.codice, 1, figliDi);
    const righe = [...e.materiali.entries()]
      .map(([codice, qta]) => ({ codice, qta: +Number(qta).toFixed(6), um: umDi.get(codice) || null }))
      .sort((r1, r2) => r1.codice.localeCompare(r2.codice, 'it', { numeric: true, sensitivity: 'base' }));
    if (!righe.length) { senza.push(x.codice); return; }
    const sottoassiemi = figli.filter(f => figliDi.has(f.figlio)).length;
    if (sottoassiemi) multi.push({ codice: x.codice, diretti: figli.length, sottoassiemi, foglie: righe.length });
    if (e.cicli && e.cicli.size) console.error('  ⚠ CICLO in ' + x.codice + ': ' + [...e.cicli].join(', '));
    if (e.segnaposto && e.segnaposto.size) {
      // COMP GENERICO / VARIE non sono materiali: il motore li tiene da parte.
      // Si dichiara che sono stati esclusi, non si nasconde.
    }
    daFare.push({ art: x, righe, segnaposto: e.segnaposto ? e.segnaposto.size : 0 });
  });

  console.log('\n── COSA FAREBBE ──');
  console.log('  prodotti da riempire        : ' + daFare.length);
  console.log('  righe di materiale scritte  : ' + daFare.reduce((s, x) => s + x.righe.length, 0));
  console.log('  gia\' dichiarate qui (saltate): ' + gia.length + (gia.length ? '  -> ' + gia.map(x => x.codice).join(', ') : ''));
  console.log('  senza distinta da nessuna parte: ' + senza.length);
  const conSegn = daFare.filter(x => x.segnaposto);
  console.log('  con segnaposto esclusi (COMP GENERICO / VARIE): ' + conSegn.length);

  console.log('\n── I MULTILIVELLO, prima e dopo ──');
  if (!multi.length) console.log('  nessuno');
  multi.forEach(m => console.log('  ' + m.codice.padEnd(16) + ' ' + String(m.diretti).padStart(3)
    + ' figli diretti (' + m.sottoassiemi + ' sottoassiemi)  ->  ' + m.foglie + ' materiali veri'));

  const primi = daFare.slice(0, 3);
  console.log('\n── ESEMPI (primi 3) ──');
  primi.forEach(x => {
    console.log('  ' + x.art.codice + '  (' + x.righe.length + ' righe)');
    x.righe.slice(0, 4).forEach(r => console.log('     ' + r.codice.padEnd(16) + ' ' + String(r.qta).padStart(9)
      + ' ' + (r.um || '-') + '   ' + (descrDi.get(r.codice) || '').slice(0, 40)));
    if (x.righe.length > 4) console.log('     … e altre ' + (x.righe.length - 4));
  });

  const fuori = path.resolve(G, 'strumenti/materializza-distinte.json');
  fs.writeFileSync(fuori, JSON.stringify(daFare.map(x => ({ codice: x.art.codice, righe: x.righe })), null, 1));
  console.log('\ncontenuto salvato in ' + fuori);

  if (FILE_SQL) {
    const out = [
      '-- Materializza le distinte dentro i prodotti (generato ' + new Date().toISOString().slice(0, 10) + ').',
      '-- Scrive le FOGLIE, non i figli diretti. Non tocca chi ha gia una distinta propria.',
      'begin;',
    ];
    daFare.forEach(x => out.push('update articoli set distinta = '
      + q(JSON.stringify(x.righe)) + '::jsonb where id = ' + q(x.art.id) + ';'));
    out.push('commit;');
    const p = path.resolve(G, 'strumenti/' + FILE_SQL);
    fs.writeFileSync(p, out.join('\n') + '\n');
    console.log('SQL scritto in ' + p + '  (' + daFare.length + ' update)');
  }

  if (!SCRIVI) {
    console.log('\n  PROVA A VUOTO: non ho scritto niente.');
    console.log('  --sql <file>  -> genera il file per il pannello Supabase');
    console.log('  --scrivi      -> prova via REST (se l\'RLS lo permette)');
    return;
  }

  let fatte = 0, errori = 0, rifiutate = 0;
  for (const x of daFare) {
    // ⚠⚠ Prefer return=representation: senza, l'RLS che rifiuta risponde
    // HTTP 200 con ZERO righe e il conto direbbe "fatto". E' gia' successo
    // con genera-materiali-commesse.js: "67/67 scritte" senza aver scritto.
    const r = await req('/rest/v1/articoli?id=eq.' + x.art.id, 'PATCH',
      { distinta: x.righe }, tok, { Prefer: 'return=representation' });
    if (r.stato >= 300) { errori++; if (errori <= 3) console.error('  errore su '
      + x.art.codice + ': ' + r.stato + ' ' + JSON.stringify(r.corpo).slice(0, 160)); continue; }
    const tornata = Array.isArray(r.corpo) ? r.corpo.length : (r.corpo ? 1 : 0);
    if (!tornata) {
      rifiutate++;
      console.error('\n  ⚠ SCRITTURA RIFIUTATA IN SILENZIO (HTTP ' + r.stato + ', zero righe).');
      console.error("    E' l'RLS: questo account non puo scrivere su `articoli`.");
      console.error('    Rilancia con --sql ed esegui il file dal pannello Supabase.');
      break;
    }
    fatte++;
    if (fatte % 25 === 0) process.stdout.write('\r  scritte: ' + fatte + '/' + daFare.length);
  }
  if (rifiutate) { console.error('  fermato: nessuna riga scritta.'); process.exit(1); }
  console.log('\r  scritte: ' + fatte + '/' + daFare.length + (errori ? '   errori: ' + errori : ''));
})();

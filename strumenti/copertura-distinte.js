// Quali commesse VIVE non hanno una distinta, e PERCHE'.
//
// L'estrazione distinte di Alnus (CAPRTESP0101.xls) e' un REPORT a blocchi,
// non una tabella: [riga padre][riga intestazioni][componenti...] e poi da
// capo. Qui la si ricostruisce e si confronta con le commesse a database.
//
// Il valore non e' il numero di scoperte: e' la CLASSIFICAZIONE. Un articolo
// senza distinta perche' e' un acquistato non e' un problema; uno che c'e' ma
// scritto diverso e' un aggancio perso, e si recupera. Tenerli nello stesso
// mucchio vuol dire non guardare ne' l'uno ne' l'altro.
//
//   node strumenti/copertura-distinte.js . <file-distinte.xls> [out.xlsx]
const fs = require('fs');
const https = require('https');
const G = process.argv[2] || '.';
const FILE = process.argv[3];
const OUT = process.argv[4] || null;
if (!FILE) {
  console.error('uso: node strumenti/copertura-distinte.js . <file-distinte.xls> [out.xlsx]');
  process.exit(2);
}
const XLSX = require(require('path').resolve(G, 'strumenti/test/xlsx.full.min.js'));

// ── credenziali dal repo, come gli altri strumenti ──
const db = fs.readFileSync(G + '/core/db.js', 'utf8');
const URLB = db.match(/SUPABASE_URL\s*=\s*"([^"]+)"/)[1];
const KEY = db.match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)[1];
const EMAIL = db.match(/APP_EMAIL\s*=\s*'([^']+)'/)[1];
const PASS = db.match(/APP_PASSWORD\s*=\s*'([^']+)'/)[1];
const host = URLB.replace('https://', '');
const req = (p, m, b, tok) => new Promise((res, rej) => {
  const d = b ? JSON.stringify(b) : null;
  const r = https.request({ host, path: p, method: m, headers: Object.assign({
    apikey: KEY, Authorization: 'Bearer ' + (tok || KEY), 'Content-Type': 'application/json',
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

// ── lettura del report a blocchi ──
const t = (v) => String(v == null ? '' : v).trim();
function leggiDistinte(file) {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: true });
  const righe = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
  const out = [];
  let cur = null;
  for (const r of righe) {
    const c = r.map(t);
    if (c[0] === 'Codice Padre') {
      cur = { padre: c[1], descrizione: c[2], versione: c[4], tipoParte: c[6], nota: c[8], comp: [] };
      out.push(cur); continue;
    }
    if (!cur || c[0] === 'Nr.  Riga' || c[0] === 'Fase' || !c[1]) continue;
    cur.comp.push({ codice: c[1], descrizione: c[3], tipoParte: c[4], um: c[5], qta: c[6] });
  }
  return out;
}

// ── scala di normalizzazione: dall'uguale identico al "quasi" ──
// Serve a distinguere "non c'e'" da "c'e' ma scritto diverso": la lezione del
// 25 ago sull'import ordini, dove le pos "0040" e "40" avevano generato 51
// commesse doppie. Le chiavi si provano contro i dati veri, non contro il file.
const esatto = s => String(s || '').trim();
const lasco  = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const nudo   = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

(async () => {
  const distinte = leggiDistinte(FILE);
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.access_token;
  const [art, ops, az, man] = await Promise.all([
    tutte('articoli', tok), tutte('operazioni', tok), tutte('aziende', tok), tutte('mancanti', tok)]);
  // Righe di fabbisogno per OP: servono a dire se una commessa senza distinta
  // e anche fuori dal controllo materiale, che e la cosa che fa danno.
  const manPerOp = {};
  man.forEach(m => { (manPerOp[m.numero_op] = manPerOp[m.numero_op] || []).push(m); });

  const artById = {}; art.forEach(a => artById[a.id] = a);
  const azById = {}; az.forEach(a => azById[a.id] = a);

  // indici dei padri e dei componenti, ai tre livelli di severita'
  const idx = { esatto: new Map(), lasco: new Map(), nudo: new Map() };
  distinte.forEach(d => {
    if (!d.padre) return;
    if (!idx.esatto.has(esatto(d.padre))) idx.esatto.set(esatto(d.padre), d);
    if (!idx.lasco.has(lasco(d.padre))) idx.lasco.set(lasco(d.padre), d);
    if (!idx.nudo.has(nudo(d.padre))) idx.nudo.set(nudo(d.padre), d);
  });
  const componenti = new Set();
  distinte.forEach(d => d.comp.forEach(c => componenti.add(nudo(c.codice))));

  const SCARTO = /NON USARE|ANNULLAT|DA CANCELLARE|OBSOLET/i;

  function diagnosi(codice) {
    if (!codice) return { esito: 'senza articolo', dettaglio: 'la commessa non ha un articolo collegato' };
    const d = idx.esatto.get(esatto(codice)) || idx.lasco.get(lasco(codice)) || idx.nudo.get(nudo(codice));
    if (d) {
      const come = idx.esatto.has(esatto(codice)) ? 'esatto'
        : (idx.lasco.has(lasco(codice)) ? 'a meno di spazi/maiuscole' : 'a meno di punteggiatura');
      if (SCARTO.test(d.descrizione + ' ' + d.nota))
        return { esito: 'distinta DA SCARTARE', dettaglio: 'trovata (' + come + ') ma marcata: ' + (d.descrizione || d.nota), padre: d.padre };
      if (come !== 'esatto')
        return { esito: 'AGGANCIO PERSO', dettaglio: 'la distinta c e, ma il codice combacia solo ' + come + ' -> padre nel file: ' + d.padre, padre: d.padre };
      return { esito: 'coperta', dettaglio: '', padre: d.padre };
    }
    if (/^BOX[_-]|[_-]BOX$/i.test(codice))
      return { esito: 'kit BOX', dettaglio: 'codice creato dall import per fondere le righe Senzani: in Alnus non esiste come articolo' };
    if (componenti.has(nudo(codice)))
      return { esito: 'e un COMPONENTE', dettaglio: 'compare nelle distinte ma come componente, non come padre: probabilmente si acquista, non si produce' };
    return { esito: 'assente dal file', dettaglio: 'il codice non compare ne come padre ne come componente' };
  }

  const vive = ops.filter(o => o.stato === 'aperta' || o.stato === 'sospesa');
  const esiti = vive.map(o => {
    const a = artById[o.articolo_id];
    const d = diagnosi(a && a.codice);
    return {
      commessa: (o.numero_ordine || '?') + '/' + (o.pos || '?'),
      op: o.numero_op || '',
      cliente: (azById[o.cliente_id] || {}).nome || '',
      articolo: (a && a.codice) || '',
      descrizione: (a && a.descrizione) || '',
      qta: o.quantita, scadenza: o.scadenza || '', stato: o.stato,
      esito: d.esito, dettaglio: d.dettaglio,
      righeFabbisogno: (manPerOp[o.numero_op] || []).length,
    };
  });

  const per = {};
  esiti.forEach(e => { (per[e.esito] = per[e.esito] || []).push(e); });
  const ordine = ['coperta', 'AGGANCIO PERSO', 'e un COMPONENTE', 'kit BOX',
    'distinta DA SCARTARE', 'assente dal file', 'senza articolo'];

  console.log('distinte lette: ' + distinte.length
    + '  ·  righe componente: ' + distinte.reduce((a, d) => a + d.comp.length, 0));
  console.log('commesse vive (aperte + sospese): ' + vive.length + '\n');
  ordine.forEach(k => {
    if (!per[k]) return;
    console.log('  ' + k.padEnd(24) + String(per[k].length).padStart(4)
      + '   (' + Math.round(per[k].length / vive.length * 100) + '%)');
  });

  ordine.filter(k => k !== 'coperta' && per[k]).forEach(k => {
    console.log('\n══ ' + k.toUpperCase() + ' ══');
    per[k].forEach(e => {
      console.log('  ' + e.commessa.padEnd(20) + (e.articolo || '—').padEnd(26)
        + ' scad ' + (e.scadenza || '—') + '   ' + String(e.cliente).slice(0, 22));
      if (e.dettaglio) console.log('      ' + e.dettaglio);
    });
  });

  // ── Chi sono, per cliente: e li che si vede il disegno ──
  const perCli = {};
  esiti.forEach(e => {
    const c = e.cliente || '?';
    perCli[c] = perCli[c] || { tot: 0, sco: 0 };
    perCli[c].tot++;
    if (e.esito !== 'coperta') perCli[c].sco++;
  });
  const conScoperte = Object.entries(perCli).filter(([, v]) => v.sco).sort((a, b) => b[1].sco - a[1].sco);
  if (conScoperte.length) {
    console.log('\n══ PER CLIENTE ══');
    conScoperte.forEach(([n, v]) => console.log('  ' + n.slice(0, 32).padEnd(34)
      + 'vive ' + String(v.tot).padStart(3) + '  ·  senza distinta ' + String(v.sco).padStart(3)
      + '  (' + Math.round(v.sco / v.tot * 100) + '%)'));
    console.log('  Un cliente al 100% non e un caso: e una domanda da fare a chi tiene Alnus.');
  }

  // ── Il punto cieco: senza distinta Alnus non calcola nemmeno il fabbisogno ──
  // Non sono due mancanze, e la stessa: il fabbisogno si calcola DALLA distinta.
  // Quelle commesse non mostrano nessun avviso materiale — e non perche' il
  // materiale ci sia, ma perche' non e mai stato calcolato niente per loro.
  // Il badge dei riflessi non le salva: righe non ne ha nemmeno una sorella.
  const scoperte = esiti.filter(e => e.esito !== 'coperta');
  const cieche = scoperte.filter(e => e.righeFabbisogno === 0);
  if (scoperte.length) {
    console.log('\n══ PUNTO CIECO ══');
    console.log('  senza distinta: ' + scoperte.length
      + '  ·  di queste, ZERO righe di fabbisogno: ' + cieche.length);
    console.log('  Sono FUORI dal controllo materiale: nessun avviso, ma non perche il');
    console.log('  materiale ci sia — perche per loro non e mai stato calcolato niente.');
  }

  const recuperabili = (per['AGGANCIO PERSO'] || []).length;
  console.log('\n' + (recuperabili
    ? 'DA SISTEMARE SUBITO: ' + recuperabili + ' commesse hanno la distinta ma non si agganciano.'
    : 'Nessun aggancio perso: i codici che combaciano, combaciano esatti.'));

  if (OUT) {
    const ws = XLSX.utils.json_to_sheet(esiti.filter(e => e.esito !== 'coperta'));
    ws['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 26 }, { wch: 34 },
      { wch: 7 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 70 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Senza distinta');
    // writeFile di SheetJS fallisce su certi percorsi lunghi: si scrive il
    // buffer a mano, che e la stessa cosa senza quella sorpresa.
    fs.writeFileSync(OUT, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    console.log('scritto ' + OUT);
  }
})();

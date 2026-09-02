// Il fabbisogno calcolato IN CASA, messo accanto a quello di Alnus.
//
// Non sostituisce niente: mostra i due numeri e dice dove non vanno
// d'accordo. E lo stesso metodo con cui e stato collaudato l'import ordini
// — due passate e pretendere zero differenze — perche un calcolo nuovo si
// crede solo dopo che ha detto le stesse cose di quello vecchio per un po'.
//
//   node strumenti/prova-fabbisogno.js .
//   node strumenti/prova-fabbisogno.js . out.xlsx
const fs = require('fs');
const https = require('https');
const path = require('path');
const G = process.argv[2] || '.';
const OUT = process.argv[3] || null;
const XLSX = require(path.resolve(G, 'strumenti/test/xlsx.full.min.js'));
const M = require(path.resolve(G, 'domain/materiali.js'));

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
const tutte = async (tab, tok, sel) => {
  const o = [];
  for (let f = 0; ; f += 1000) {
    const p = await req('/rest/v1/' + tab + '?select=' + (sel || '*') + '&limit=1000&offset=' + f, 'GET', null, tok);
    if (!Array.isArray(p) || !p.length) break;
    o.push(...p); if (p.length < 1000) break;
  }
  return o;
};
const nf = n => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });

(async () => {
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.access_token;
  const [ops, art, az, man, dist, cons] = await Promise.all([
    tutte('operazioni', tok, 'id,numero_ordine,pos,numero_op,articolo_id,cliente_id,quantita,scadenza,stato'),
    tutte('articoli', tok, 'id,codice'),
    tutte('aziende', tok, 'id,nome'),
    tutte('mancanti', tok),
    tutte('distinta', tok, 'padre,figlio,qta,um,tipo_parte'),
    tutte('consegne_commessa', tok, 'operazione_id,quantita')]);
  // Il materiale serve per quello che RESTA da produrre, non per l'ordine
  // intero: sui pezzi gia fatti e stato prelevato. Misurato contro Alnus,
  // il residuo porta i codici che combaciano da 212 a 231 su 358.
  const prodotto = {};
  cons.forEach(c => { prodotto[c.operazione_id] = (prodotto[c.operazione_id] || 0) + (Number(c.quantita) || 0); });

  const codDi = {}; art.forEach(a => codDi[a.id] = a.codice);
  const nomeDi = {}; az.forEach(a => nomeDi[a.id] = a.nome);
  const figliDi = M.indiceDistinta(dist);

  const vive = ops.filter(o => o.stato === 'aperta' || o.stato === 'sospesa')
    .map(o => ({
      id: o.id, numero_op: o.numero_op,
      etichetta: (o.numero_ordine || '?') + '/' + (o.pos || '?'),
      cliente: nomeDi[o.cliente_id] || '',
      codiceArticolo: codDi[o.articolo_id] || '',
      quantita: Math.max(0, (Number(o.quantita) || 0) - (prodotto[o.id] || 0)),
      ordinati: Number(o.quantita) || 0, prodotti: prodotto[o.id] || 0,
      scadenza: o.scadenza || '',
    }));

  console.log('=== BASE DI CALCOLO ===');
  console.log('  commesse vive: ' + vive.length
    + '  ·  con distinta: ' + vive.filter(c => figliDi.has(c.codiceArticolo)).length);
  console.log('  righe di distinta caricate: ' + dist.length
    + '  ·  padri distinti: ' + figliDi.size);

  const perCodice = M.fabbisognoPerCodice(vive, figliDi);
  const totale = [...perCodice.entries()]
    .map(([cod, righe]) => ({ cod, qta: righe.reduce((a, r) => a + r.qta, 0), righe }))
    .sort((a, b) => b.qta - a.qta);
  console.log('\n=== FABBISOGNO CALCOLATO IN CASA ===');
  console.log('  materiali richiesti da almeno una commessa: ' + totale.length);
  console.log('  primi per quantita:');
  totale.slice(0, 6).forEach(x => console.log('     ' + x.cod.padEnd(24)
    + nf(x.qta).padStart(10) + '   da ' + x.righe.length + ' commesse'));

  // ── Il confronto con Alnus ──
  // `impegno` di Alnus e il totale impegnato su TUTTI gli ordini; il nostro
  // e la somma sulle commesse vive del gestionale. Non devono coincidere al
  // grammo: le due basi non sono le stesse. Serve a vedere se sono dello
  // stesso ORDINE DI GRANDEZZA, cioe se il calcolo regge.
  const manPerCod = {};
  man.forEach(m => { const k = String(m.codice || '').trim(); if (k) manPerCod[k] = m; });
  const confronto = [];
  Object.keys(manPerCod).forEach(cod => {
    const mio = perCodice.get(cod);
    const suo = manPerCod[cod];
    const qMio = mio ? mio.reduce((a, r) => a + r.qta, 0) : 0;
    const qSuo = Number(suo.impegno) || 0;
    confronto.push({
      codice: cod, descrizione: suo.descrizione || '', tipo_parte: suo.tipo_parte || '',
      impegnoAlnus: qSuo, fabbisognoNostro: +qMio.toFixed(2),
      commesseNostre: mio ? mio.length : 0,
      giacenza: Number(suo.giacenza) || 0,
      scarto: +(qMio - qSuo).toFixed(2),
      scartoPerc: qSuo > 0 ? Math.round((qMio - qSuo) / qSuo * 100) : null,
    });
  });
  const noti = confronto.filter(c => c.fabbisognoNostro > 0);
  const ignoti = confronto.filter(c => c.fabbisognoNostro === 0);
  const dentro = (c, p) => c.scartoPerc !== null && Math.abs(c.scartoPerc) <= p;
  console.log('\n=== CONFRONTO CON ALNUS (sui ' + confronto.length + ' codici che segnala) ===');
  console.log('  quanto si va d accordo:');
  console.log('     entro il 2%:   ' + noti.filter(c => dentro(c, 2)).length);
  console.log('     entro il 20%:  ' + noti.filter(c => dentro(c, 20)).length);
  console.log('     oltre il 20%:  ' + noti.filter(c => c.scartoPerc !== null && Math.abs(c.scartoPerc) > 20).length);
  console.log('     codici che lui segnala e noi non vediamo: ' + ignoti.length);
  console.log('  ⚠ Guardare PRIMA questa riga, non gli scarti: sono i peggiori per');
  console.log('    costruzione, e da soli fanno sembrare sbagliato tutto il resto.');
  console.log('\n  i 10 scarti piu grossi (da capire, uno per uno):');
  noti.slice().sort((a, b) => Math.abs(b.scarto) - Math.abs(a.scarto)).slice(0, 10)
    .forEach(c => console.log('     ' + c.codice.padEnd(24)
      + 'noi ' + nf(c.fabbisognoNostro).padStart(9)
      + '   Alnus ' + nf(c.impegnoAlnus).padStart(9)
      + '   (' + (c.scartoPerc === null ? '—' : (c.scartoPerc > 0 ? '+' : '') + c.scartoPerc + '%') + ')'));

  // ── La cosa che Alnus non fa: ripartire ──
  console.log('\n=== RIPARTIZIONE DELLA GIACENZA (chi scade prima, serve prima) ===');
  const scoperte = [];
  noti.forEach(c => {
    const righe = perCodice.get(c.codice) || [];
    const { esito } = M.ripartisciGiacenza(righe, c.giacenza);
    esito.filter(e => e.scoperto > 0).forEach(e => scoperte.push({
      commessa: e.commessa.etichetta, op: e.commessa.numero_op || '',
      cliente: e.commessa.cliente, scadenza: e.commessa.scadenza,
      codice: c.codice, descrizione: c.descrizione, tipo_parte: c.tipo_parte,
      serve: e.qta, coperto: e.coperto, scoperto: e.scoperto,
    }));
  });
  const commScoperte = new Set(scoperte.map(s => s.commessa));
  console.log('  righe scoperte: ' + scoperte.length
    + '  su ' + commScoperte.size + ' commesse distinte');
  console.log('\n  ⚠ Confronto col badge di oggi, che viene da Alnus:');
  const opConMancanti = new Set(man.map(m => m.numero_op));
  const nostreConScoperto = new Set(scoperte.map(s => s.op).filter(Boolean));
  const soloNostre = [...nostreConScoperto].filter(op => !opConMancanti.has(op));
  console.log('     commesse che Alnus segnala:            ' + [...opConMancanti].filter(Boolean).length);
  console.log('     commesse che segnaliamo noi:           ' + nostreConScoperto.size);
  console.log('     ...che oggi NON hanno nessun avviso:   ' + soloNostre.length);
  if (soloNostre.length) {
    console.log('     (sono quelle che il "prossimo impegno" copriva con una sorella)');
    soloNostre.slice(0, 12).forEach(op => {
      const r = scoperte.find(s => s.op === op);
      console.log('       ' + String(op).padEnd(16) + r.commessa.padEnd(20)
        + 'scad ' + (r.scadenza || '—') + '   ' + String(r.cliente).slice(0, 22));
    });
    if (soloNostre.length > 12) console.log('       … e altre ' + (soloNostre.length - 12));
  }

  if (OUT) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(confronto), 'Confronto Alnus');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(scoperte), 'Scoperte per commessa');
    fs.writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    console.log('\n  scritto ' + OUT);
  }
})();

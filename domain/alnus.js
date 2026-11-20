// ── LO SPECCHIO DI ALNUS (20 nov 2026) ── motore PURO: niente DOM, niente Supabase.
// Legge le tre stampe di Alnus (giacenze, movimenti, OF aperti) e calcola:
//   giacenza = fotografia d'apertura + movimenti successivi, per codice e magazzino
//   in arrivo = residua degli OF aperti − carichi EA1 arrivati dopo la fotografia
//   da ordinare NOSTRO = fabbisogno delle liste − giacenza − in arrivo
// da mettere accanto al «da ordinare» di Alnus. Vedi strumenti/migrazione-alnus-specchio.sql.
// Date: stringhe locali 'YYYY-MM-DDTHH:MM:SS' o ISO dal database; si confrontano con Date.parse.

// Numeri all'italiana di Alnus: "1.234,500", "3,000-" (meno in fondo), "-1,000".
function numAlnus(s) {
  if (typeof s === 'number') return s;
  let t = String(s == null ? '' : s).trim().replace(/\s/g, '');
  if (!t) return null;
  let neg = false;
  if (t.endsWith('-')) { neg = true; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (!/^[\d.,]+$/.test(t)) return NaN;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
// "20/11/2026" + "10:33:11" -> "2026-11-20T10:33:11"
function dataAlnus(d, ora) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(d || '').trim());
  if (!m) return null;
  const o = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(ora || '').trim());
  const p2 = (x) => String(x).padStart(2, '0');
  return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]) + 'T' + (o ? p2(o[1]) + ':' + o[2] + ':' + (o[3] || '00') : '00:00:00');
}
const alnusChiaveCol = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9]/g, '').toLowerCase();
function alnusColonne(intestazione, voluti) {
  const k = intestazione.map(alnusChiaveCol);
  const out = {};
  Object.entries(voluti).forEach(([nome, cand]) => {
    out[nome] = -1;
    for (const c of cand) {
      const i = typeof c === 'function' ? k.findIndex(c) : k.indexOf(alnusChiaveCol(c));
      if (i >= 0) { out[nome] = i; break; }
    }
  });
  return out;
}
const alnusRighe = (testo) => String(testo || '').split(/\r?\n/);

// «Stampa Giacenze di Magazzino»: una riga per codice e magazzino, poi
// «Totale Articolo». Il primo rigo porta ora e data della stampa.
function leggiGiacenzeAlnus(testo) {
  const L = alnusRighe(testo);
  const iTesta = L.findIndex(l => /Stampa Giacenze/i.test(l));
  const iInt = L.findIndex(l => /Codice Articolo/i.test(l) && /Giacenza/i.test(l));
  if (iInt < 0) return { errore: 'Non è una «Stampa Giacenze di Magazzino» di Alnus: manca l’intestazione con «Codice Articolo» e «Giacenza».' };
  const testa = iTesta >= 0 ? L[iTesta].split('\t').map(x => x.trim()) : [];
  const preso_il = dataAlnus(testa.find(x => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(x)), testa.find(x => /^\d{1,2}:\d{2}(:\d{2})?$/.test(x)));
  const C = alnusColonne(L[iInt].split('\t'), { codice: ['Codice Articolo'], descrizione: ['Descrizione Articolo'],
    deposito: ['Cod Dep'], magazzino: ['Cod Mag'], um: ['UM'], qta: ['Giacenza'] });
  if (C.codice < 0 || C.magazzino < 0 || C.qta < 0) return { errore: 'Mancano le colonne Codice Articolo, Cod Mag o Giacenza.' };
  const righe = [], scartate = [];
  L.slice(iInt + 1).forEach(l => {
    if (!l.trim()) return;
    const c = l.split('\t');
    const cod = String(c[C.codice] || '').trim();
    if (!cod || /Totale Articolo/i.test(l)) return;
    const q = numAlnus(c[C.qta]);
    const mag = String(c[C.magazzino] || '').trim();
    // Una descrizione con un tab dentro sposta le colonne: si vede dal deposito.
    if (q == null || isNaN(q) || !mag || (C.deposito >= 0 && String(c[C.deposito] || '').trim() !== 'STD')) {
      scartate.push(cod); return;
    }
    righe.push({ codice: cod, descrizione: String(c[C.descrizione] || '').trim(), um: String(c[C.um] || '').trim(), magazzino: mag, qta: q });
  });
  return { preso_il, righe, scartate };
}

// «Stampa movimenti di magazzino». Chiave = anno + numero movimento + causale.
function leggiMovimentiAlnus(testo) {
  const L = alnusRighe(testo);
  const iTesta = L.findIndex(l => /Stampa movimenti/i.test(l));
  const iInt = L.findIndex(l => /Numero Movim/i.test(l) && /Cau Mov/i.test(l));
  if (iInt < 0) return { errore: 'Non è una «Stampa movimenti di magazzino» di Alnus: manca l’intestazione con «Numero Movim.» e «Cau Mov».' };
  const testa = iTesta >= 0 ? L[iTesta].split('\t').map(x => x.trim()) : [];
  const stampato_il = dataAlnus(testa.find(x => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(x)), testa.find(x => /^\d{1,2}:\d{2}(:\d{2})?$/.test(x)));
  const C = alnusColonne(L[iInt].split('\t'), { eser: ['Eser'], numero: ['Numero Movim.'], codice: ['Codice Articolo'],
    descrizione: ['Descrizione Articolo'], magazzino: ['Cod Mag'], causale: ['Cau Mov'], qta: [k => /^quantit/.test(k)],
    um: ['UM'], data: ['Data Movimento'], soggetto: ['Ragione Sociale'], tipo_doc: ['Tipo Doc.'], anno_doc: ['Es. Doc.'],
    numero_doc: ['Numero Doc.'], operatore: ['Cod Op.'], bolla: ['Numero Bolla'], ora: ['Time'], prezzo: ['Prezzo Unitario'] });
  for (const k of ['eser', 'numero', 'codice', 'magazzino', 'causale', 'qta', 'data'])
    if (C[k] < 0) return { errore: 'Manca la colonna «' + k + '» nella stampa movimenti.' };
  const righe = [], scartate = [];
  L.slice(iInt + 1).forEach(l => {
    if (!l.trim()) return;
    const c = l.split('\t').map(x => x.trim());
    if (!/^\d{4}$/.test(c[C.eser] || '')) return;
    const q = numAlnus(c[C.qta]);
    const data = dataAlnus(c[C.data], C.ora >= 0 ? c[C.ora] : '');
    const v = (k) => (C[k] >= 0 && c[C[k]]) ? c[C[k]] : null;
    if (!c[C.codice] || !c[C.numero] || q == null || isNaN(q) || !data) { scartate.push(c[C.numero] || '?'); return; }
    const pr = numAlnus(v('prezzo'));
    righe.push({ eser: Number(c[C.eser]), numero: Number(c[C.numero]), causale: c[C.causale], codice: c[C.codice],
      descrizione: v('descrizione'), magazzino: c[C.magazzino], qta: q, um: v('um'), data,
      tipo_doc: v('tipo_doc'), anno_doc: v('anno_doc') ? Number(v('anno_doc')) : null, numero_doc: v('numero_doc'),
      soggetto: v('soggetto'), bolla: v('bolla'), prezzo: pr == null || isNaN(pr) ? null : pr, operatore: v('operatore') });
  });
  return { stampato_il, righe, scartate };
}

// Estrazione degli OF aperti (xlsx letto come matrice di righe). Le date
// possono arrivare come Date, come numero di Excel o come testo.
function dataCella(v) {
  if (v == null || v === '') return null;
  const p2 = (x) => String(x).padStart(2, '0');
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
  if (typeof v === 'number') { const d = new Date(Math.round((v - 25569) * 86400000)); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()); }
  const t = dataAlnus(String(v).trim().slice(0, 10));
  if (t) return t.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null;
}
function leggiOfAlnus(matrice) {
  const M = Array.isArray(matrice) ? matrice : [];
  const iInt = M.findIndex(r => Array.isArray(r) && r.some(x => /Nr\.?\s*Ord\.?\s*Acquis/i.test(String(x || ''))));
  if (iInt < 0) return { errore: 'Non è l’estrazione degli OF aperti: manca la colonna «Nr.Ord. Acquis.».' };
  const C = alnusColonne(M[iInt], { anno: ['Eser'], sezionale: ['Sz Ac'], numero: ['Nr.Ord. Acquis.'], riga: ['Nr. Riga'],
    codice: ['Codice Articolo'], descrizione: ['Descrizione Articolo'], fornitore: ['Nomignolo'],
    consegna: ['Data Cons. Confermata', 'Data Rich. Consegna'], ordinata: ['Quantita in UM ordine'],
    residua: [k => /^quantit.*residua$/.test(k)], interna: ['Quantita in UM interna'], um: ['UM In', 'UM Or'],
    prezzo: ['Prezzo Netto Riga'], codice_fornitore: ['Articolo Cli/For'], anno_odl: ['Anno ODL'], odl: ['Nr. ODL'] });
  for (const k of ['anno', 'numero', 'codice', 'residua']) if (C[k] < 0) return { errore: 'Manca la colonna «' + k + '» negli OF aperti.' };
  const righe = [], scartate = [];
  M.slice(iInt + 1).forEach(r => {
    if (!Array.isArray(r)) return;
    const v = (k) => C[k] >= 0 ? r[C[k]] : null;
    const cod = String(v('codice') == null ? '' : v('codice')).trim();
    const anno = Number(v('anno')), num = Number(v('numero'));
    if (!cod && !num) return;
    const ord = numAlnus(v('ordinata')), res = numAlnus(v('residua')), int = numAlnus(v('interna'));
    if (!cod || !(anno > 0) || !(num > 0) || res == null || isNaN(res)) { scartate.push(cod || String(num)); return; }
    // La residua e' nell'UM dell'ordine: si porta in UM interna con lo stesso rapporto dell'ordinata.
    const f = (ord > 0 && int > 0) ? int / ord : 1;
    const pr = numAlnus(v('prezzo'));
    righe.push({ anno, sezionale: String(v('sezionale') || '').trim() || null, numero: num, riga: Number(v('riga')) || null,
      codice: cod, descrizione: String(v('descrizione') || '').trim() || null, fornitore: String(v('fornitore') || '').trim() || null,
      codice_fornitore: v('codice_fornitore') == null ? null : String(v('codice_fornitore')).trim() || null,
      um: String(v('um') || '').trim() || null, qta_ordinata: ord == null || isNaN(ord) ? null : +(ord * f).toFixed(6),
      qta_residua: +(res * f).toFixed(6), consegna: dataCella(v('consegna')), prezzo: pr == null || isNaN(pr) ? null : pr,
      odl: v('odl') ? String(v('anno_odl') || '') + '/' + String(v('odl')) : null });
  });
  return { righe, scartate };
}

const alnusMs = (d) => { const t = Date.parse(d); return isNaN(t) ? null : t; };

// I MAGAZZINI DI ALNUS (20 nov, Nico):
//   01  principale                          -> conta
//   WIP reparto (materiale gia' prelevato)  -> conta
//   SPK magazzino di Sacmi per il loro C/L  -> a parte: non e' disponibile per tutti
//   02  magazzino di JMA per il loro C/L    -> «inglobalo nello 01 ed eliminalo»: diventa 01
//   05  da eliminare                        -> non si conta da nessuna parte
// Alnus stesso, nel Fabbisogno, conta 01 + WIP (238 codici su 239 il 20 nov).
// Un magazzino nuovo che non e' qui resta col suo nome e si vede: si decide allora.
const MAGAZZINI_ALIAS = { '02': '01' };
const MAGAZZINI_ELIMINATI = new Set(['05']);
const MAGAZZINI_CONTATI_DI_SERIE = ['01', 'WIP'];
function magazzinoAlnus(m) {
  const k = String(m == null ? '' : m).trim().toUpperCase();
  if (!k || MAGAZZINI_ELIMINATI.has(k)) return null;
  return MAGAZZINI_ALIAS[k] || k;
}
// Giacenza per codice e magazzino: apertura + movimenti dopo `da` e fino a `a` (compreso).
function giacenzaAlnus(apertura, movimenti, da, a) {
  const tDa = alnusMs(da), tA = a == null ? null : alnusMs(a);
  const per = new Map();   // codice -> { perMag: {mag: qta}, totale }
  const somma = (cod, mag, q) => {
    if (!per.has(cod)) per.set(cod, { perMag: {}, totale: 0 });
    const g = per.get(cod);
    g.perMag[mag] = +((g.perMag[mag] || 0) + q).toFixed(6);
    g.totale = +(g.totale + q).toFixed(6);
  };
  (apertura || []).forEach(r => { const mag = magazzinoAlnus(r.magazzino); if (mag) somma(String(r.codice).trim(), mag, Number(r.qta) || 0); });
  (movimenti || []).forEach(m => {
    const t = alnusMs(m.data);
    if (t == null || (tDa != null && t <= tDa) || (tA != null && t > tA)) return;
    const mag = magazzinoAlnus(m.magazzino);
    if (mag) somma(String(m.codice).trim(), mag, Number(m.qta) || 0);
  });
  return per;
}
// Quanto conta per il da ordinare: i magazzini scelti, mai sotto zero.
function giacenzaContata(g, magazzini) {
  if (!g) return 0;
  const t = Object.entries(g.perMag).reduce((s, [mag, q]) => s + ((!magazzini || magazzini.has(mag)) ? q : 0), 0);
  return Math.max(0, +t.toFixed(6));
}

// OF di Alnus ancora da arrivare: residua della fotografia meno i carichi
// (tipo documento OF, stesso anno, numero e codice) arrivati DOPO la
// fotografia, che consumano le righe in ordine di consegna.
// `oggi` 'YYYY-MM-DD': una riga con consegna prima di oggi e' «scaduta».
function ofAlnusAperti(righeOf, movimenti, presoIl, oggi) {
  const tDa = alnusMs(presoIl);
  const arrivi = new Map();
  (movimenti || []).forEach(m => {
    if (String(m.tipo_doc || '').trim().toUpperCase() !== 'OF' || !(Number(m.qta) > 0)) return;
    const t = alnusMs(m.data);
    if (t == null || (tDa != null && t <= tDa)) return;
    const k = Number(m.anno_doc) + '/' + Number(m.numero_doc) + '|' + String(m.codice).trim();
    arrivi.set(k, (arrivi.get(k) || 0) + Number(m.qta));
  });
  const perOrdine = new Map();
  (righeOf || []).forEach(r => {
    const k = Number(r.anno) + '/' + Number(r.numero) + '|' + String(r.codice).trim();
    if (!perOrdine.has(k)) perOrdine.set(k, []);
    perOrdine.get(k).push(r);
  });
  const per = new Map();   // codice -> { aperto, scaduto, righe:[{...riga, aperto, scaduta}] }
  perOrdine.forEach((righe, k) => {
    let arr = arrivi.get(k) || 0;
    righe.slice().sort((a, b) => String(a.consegna || '9999').localeCompare(String(b.consegna || '9999')) || (a.riga || 0) - (b.riga || 0))
      .forEach(r => {
        const res = Number(r.qta_residua) || 0;
        const tolto = Math.min(res, arr); arr -= tolto;
        const ap = +(res - tolto).toFixed(6);
        const cod = String(r.codice).trim();
        if (!per.has(cod)) per.set(cod, { aperto: 0, scaduto: 0, righe: [] });
        const v = per.get(cod);
        const scaduta = !!(oggi && r.consegna && String(r.consegna).slice(0, 10) < oggi);
        v.aperto = +(v.aperto + ap).toFixed(6);
        if (scaduta) v.scaduto = +(v.scaduto + ap).toFixed(6);
        v.righe.push(Object.assign({}, r, { aperto: ap, scaduta }));
      });
  });
  return per;
}

// Il confronto codice per codice. Entrano i codici che chiede una lista
// (non C/L ne' MAC: non si comprano) o che Alnus dice di ordinare.
// `fabbisogno` Map codice -> qta; `tipi` Map codice -> 'ACQ'|'C/L'|'MAC'|null;
// `giacenza` da giacenzaAlnus; `ofAlnus` da ofAlnusAperti; `ofNostri` Map codice -> aperto
// (da ordinatoApertoOf); `daOrdinareAlnus` Map codice -> qta; `magazzini` Set o null (tutti);
// `contaScaduti`: gli OF scaduti contano come in arrivo.
function confrontoDaOrdinare(o) {
  const tipoDi = (c) => String((o.tipi && o.tipi.get(c)) || '').trim().toUpperCase();
  const codici = new Set();
  (o.fabbisogno || new Map()).forEach((q, c) => { if (q > 0) codici.add(c); });
  (o.daOrdinareAlnus || new Map()).forEach((q, c) => { if (q > 0) codici.add(c); });
  const righe = [];
  codici.forEach(c => {
    const tipo = tipoDi(c);
    if (tipo === 'C/L' || tipo === 'MAC') return;
    const fab = Number((o.fabbisogno && o.fabbisogno.get(c)) || 0);
    const g = o.giacenza ? o.giacenza.get(c) : null;
    const giac = giacenzaContata(g, o.magazzini);
    const oa = o.ofAlnus ? o.ofAlnus.get(c) : null;
    const arrA = oa ? (o.contaScaduti === false ? +(oa.aperto - oa.scaduto).toFixed(6) : oa.aperto) : 0;
    const arrN = Number((o.ofNostri && o.ofNostri.get(c)) || 0);
    const nostro = Math.max(0, +(fab - giac - arrA - arrN).toFixed(6));
    const alnus = Number((o.daOrdinareAlnus && o.daOrdinareAlnus.get(c)) || 0);
    righe.push({ codice: c, tipo: tipo || null, fabbisogno: fab, giacenza: giac, perMag: g ? g.perMag : {},
      inArrivoAlnus: arrA, scaduto: oa ? oa.scaduto : 0, inArrivoNostri: arrN, nostro, alnus,
      differenza: +(nostro - alnus).toFixed(6) });
  });
  return righe.sort((a, b) => Math.abs(b.differenza) - Math.abs(a.differenza) || a.codice.localeCompare(b.codice, 'it', { numeric: true }));
}

// Controllo: la giacenza calcolata (apertura + movimenti fino alla stampa di
// controllo) contro quella stampata. Ritorna solo i codici che non tornano.
function controlloGiacenze(calcolata, stampata, tolleranza) {
  const tol = tolleranza == null ? 0.0005 : tolleranza;
  const st = new Map();
  (stampata || []).forEach(r => { if (!magazzinoAlnus(r.magazzino)) return; const c = String(r.codice).trim(); st.set(c, +((st.get(c) || 0) + (Number(r.qta) || 0)).toFixed(6)); });
  const codici = new Set([...st.keys(), ...(calcolata ? calcolata.keys() : [])]);
  const diversi = [];
  codici.forEach(c => {
    const a = calcolata && calcolata.get(c) ? calcolata.get(c).totale : 0;
    const b = st.get(c) || 0;
    if (Math.abs(a - b) > tol) diversi.push({ codice: c, calcolata: a, stampata: b, differenza: +(a - b).toFixed(6) });
  });
  return diversi.sort((x, y) => Math.abs(y.differenza) - Math.abs(x.differenza));
}

// ── IL FABBISOGNO FATTO DAL GESTIONALE (20 nov, Nico: "se vogliamo far girare
// il gestionale senza Alnus...") ── Le stesse righe che arrivano dall'import
// del Fabbisogno Massivo (`mancanti`), con la STESSA FORMA, ma fatte coi
// nostri dati: cosi' Materiali, triangolini, stato dei materiali, ripartizione
// e «Genera OF» girano senza sapere da dove vengono. Una riga per codice.
//   impegno        = quanto chiedono le liste delle commesse vive (a residuo)
//   giacenza       = specchio (magazzini scelti, mai sotto zero)
//   qta_richiesta  = impegno − giacenza
//   qta_da_ordinare= richiesta − in arrivo (OF di Alnus + OF nostri)
//   consegne       = le righe d'OF ancora aperte, con data, qta, ordine, fornitore
//   numero_op      = l'OP della commessa servita per prima (come «OdL Prossimo Impegno»)
// `o`: { fabbisogno: Map codice -> [{ commessa, qta }] gia' in ordine di servizio
//   (fabbisognoDaListe), tipi, descr, um: Map, giacenza (giacenzaAlnus), magazzini,
//   ofAlnus (ofAlnusAperti), ofNostri: [{ codice, aperto, consegna, ordine, fornitore }],
//   contaScaduti }.
function righeFabbisognoSpecchio(o) {
  const codici = new Set();
  (o.fabbisogno || new Map()).forEach((r, c) => codici.add(c));
  (o.ofAlnus || new Map()).forEach((v, c) => { if (v.aperto > 0) codici.add(c); });
  (o.ofNostri || []).forEach(x => { if (x.aperto > 0) codici.add(String(x.codice).trim()); });
  const nostriPer = new Map();
  (o.ofNostri || []).forEach(x => { const c = String(x.codice).trim(); if (!nostriPer.has(c)) nostriPer.set(c, []); nostriPer.get(c).push(x); });
  const righe = [];
  codici.forEach(c => {
    const dom = (o.fabbisogno && o.fabbisogno.get(c)) || [];
    const impegno = +dom.reduce((s, x) => s + (Number(x.qta) || 0), 0).toFixed(4);
    const g = o.giacenza ? o.giacenza.get(c) : null;
    const giacenza = +giacenzaContata(g, o.magazzini).toFixed(4);
    const consegne = [];
    const oa = o.ofAlnus ? o.ofAlnus.get(c) : null;
    (oa ? oa.righe : []).forEach(r => {
      if (!(r.aperto > 0) || (o.contaScaduti === false && r.scaduta)) return;
      consegne.push({ data: r.consegna || null, qta: r.aperto, ordine: (r.sezionale || 'OF') + ' ' + r.numero + '/' + r.anno, fornitore: r.fornitore || null });
    });
    (nostriPer.get(c) || []).forEach(x => { if (x.aperto > 0) consegne.push({ data: x.consegna || null, qta: x.aperto, ordine: x.ordine, fornitore: x.fornitore || null }); });
    const inArrivo = consegne.reduce((s, x) => s + (Number(x.qta) || 0), 0);
    const richiesta = Math.max(0, +(impegno - giacenza).toFixed(4));
    const daOrdinare = Math.max(0, +(richiesta - inArrivo).toFixed(4));
    // Le consegne senza data non entrano nell'elenco datato (come nell'import), ma contano come ordinato.
    const datate = consegne.filter(x => x.data).sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const primo = dom.find(x => x.commessa && x.commessa.numero_op);
    righe.push({ codice: c, descrizione: (o.descr && o.descr.get(c)) || null, um: (o.um && o.um.get(c)) || null,
      tipo_parte: (o.tipi && o.tipi.get(c)) ? String(o.tipi.get(c)).trim().toUpperCase() : null,
      numero_op: primo ? primo.commessa.numero_op : null,
      giacenza, impegno, qta_richiesta: richiesta, qta_da_ordinare: daOrdinare,
      consegne: datate, prima_consegna: datate.length ? datate[0].data : null,
      data_arrivo: datate.length ? datate[0].data : null, fornitore: datate.length ? datate[0].fornitore : null,
      in_arrivo: +inArrivo.toFixed(4), fonte: 'specchio' });
  });
  return righe.sort((a, b) => a.codice.localeCompare(b.codice, 'it', { numeric: true }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { numAlnus, dataAlnus, leggiGiacenzeAlnus, leggiMovimentiAlnus, leggiOfAlnus, dataCella,
    magazzinoAlnus, MAGAZZINI_CONTATI_DI_SERIE, giacenzaAlnus, giacenzaContata, ofAlnusAperti, confrontoDaOrdinare, controlloGiacenze, righeFabbisognoSpecchio };
}

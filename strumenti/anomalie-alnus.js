// Excel delle anomalie ancora aperte fra Alnus e il gestionale.
//
// Il gestionale si legge DAL VIVO; l'estrazione Alnus e' l'ultima che Nico ha
// mandato. Quindi: cio' che e' stato sistemato QUI si vede, cio' che e' stato
// sistemato IN ALNUS no, finche' non arriva un'estrazione nuova. E' scritto
// nel Riepilogo, perche' un elenco di anomalie senza la data delle due fonti
// fa inseguire fantasmi.
//
// I numeri escono da `analizzaImportOrdini`, la stessa funzione che gira
// quando si trascina il file nell'app: uno strumento parallelo scritto per
// l'occasione risponderebbe a una domanda leggermente diversa.
const https = require('https'), fs = require('fs'), vm = require('vm');
const G = process.argv[2], SP = process.argv[3], ALNUS = process.argv[4], OUT = process.argv[5];
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
const itDate = i => i ? String(i).slice(8, 10) + '/' + String(i).slice(5, 7) + '/' + String(i).slice(0, 4) : '';
const itFile = p => {
  const d = fs.statSync(p).mtime;
  return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0')
    + '/' + d.getFullYear() + ' ' + String(d.getHours()).padStart(2, '0')
    + ':' + String(d.getMinutes()).padStart(2, '0');
};
// La data si CALCOLA, non si scrive. Scritta a mano era giusta il giorno in
// cui e' nato lo strumento e sbagliata ogni giorno dopo: al terzo riutilizzo
// il foglio "In ritardo" contava i giorni da una data ferma. In locale, non
// in UTC: il ritardo si misura sul calendario di chi legge.
const OGGI = (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
  + '-' + String(d.getDate()).padStart(2, '0'))(new Date());

(async () => {
  const auth = await req('/auth/v1/token?grant_type=password', 'POST', { email: EMAIL, password: PASS });
  const tok = auth.access_token;
  const ctx = {
    operazioni: await tutte('operazioni', tok), aziende: await tutte('aziende', tok),
    articoli: await tutte('articoli', tok), spedizioni: await tutte('spedizioni', tok),
  };
  const s = vm.createContext({ state: { sessioni: [] }, console });
  vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8'), s);
  const XLSX = require(SP + '/xlsx.full.min.js');
  const wbA = XLSX.read(fs.readFileSync(ALNUS), { type: 'buffer', cellDates: true });
  const righe = XLSX.utils.sheet_to_json(wbA.Sheets[wbA.SheetNames[0]], { defval: '', raw: true });
  const p = s.analizzaImportOrdini(righe, ctx);

  // quanto e' spedito davvero, per commessa: serve a dire se una riga
  // "finita per Alnus" ha almeno una spedizione registrata qui
  const spedPerOp = {};
  ctx.spedizioni.forEach(x => spedPerOp[x.operazione_id] = (spedPerOp[x.operazione_id] || 0) + (x.quantita || 0));
  const opKey = {};
  ctx.operazioni.forEach(o => opKey[o.numero_ordine + '|' + Number(o.pos)] = o);
  const spedDi = r => {
    const o = opKey[r.numeroOrdine + '|' + Number(r.pos)];
    return o ? (spedPerOp[o.id] || 0) + ' / ' + o.quantita : '?';
  };

  const sd = p.statiDiscordanti;
  const stati = []
    .concat(sd.viveQui.map(r => ({
      'Ordine': r.numeroOrdine, 'Pos': r.pos, 'Cliente': r.cliente, 'Codice articolo': r.codice,
      'Stato qui': r.stato, 'Spedite qui': spedDi(r), 'Scadenza': itDate(r.scadenza),
      'Situazione': r.kit
        ? ('KIT ' + r.kit + ': in Alnus non resta nessuna delle sue righe')
        : (r.ordineNelFile
          ? 'per Alnus FINITA (l’ordine c’e ancora, e’ sparita la riga)'
          : 'per Alnus FINITA (sparito tutto l’ordine)'),
      'Cosa fare': 'Se e’ partita: registrare la spedizione QUI (lo stato va a spedita da solo). '
        + 'Se non e’ partita: riaprirla in ALNUS.', 'Fatto?': '',
    })))
    .concat(sd.chiuseQui.map(r => ({
      'Ordine': r.numeroOrdine, 'Pos': r.pos, 'Cliente': r.cliente, 'Codice articolo': r.codice,
      'Stato qui': r.stato, 'Spedite qui': spedDi(r), 'Scadenza': itDate(r.scadenza),
      'Situazione': 'SPEDITA qui, per Alnus ancora da fare',
      'Cosa fare': 'ALNUS: la merce e’ partita, l’ordine va chiuso.', 'Fatto?': '',
    })));

  const sped = p.residuiDiscordanti.map(r => ({
    'Ordine': r.numeroOrdine, 'Pos': r.pos, 'Stato qui': r.stato,
    'Ordinate qui': r.ordinato, 'Spedite qui': r.spedito, 'Restano qui': r.residuoQui,
    'Residua in Alnus': r.residuaFile,
    'Ordinate in Alnus': r.basiDiverse ? r.ordinatoFile : '',
    'Cosa fare': r.basiDiverse
      ? 'DA GUARDARE: e’ diverso anche l’ORDINATO, le due residue non partono dalla stessa base.'
      : (r.chiIndietro === 'alnus'
        ? 'ALNUS non sa di una spedizione gia’ fatta.'
        : 'GESTIONALE: manca una spedizione da registrare.'), 'Fatto?': '',
  }));

  const senzaCod = p.senzaCodice.map(r => ({
    'Ordine': r.numeroOrdine, 'Pos': r.pos, 'Cliente': r.cliente,
    'Descrizione nel file': r.descrizione, 'Qta': r.quantita, 'Prezzo': r.prezzo,
    'Perche resta fuori': 'Riga descrittiva: senza codice articolo non c’e’ un pezzo da produrre.',
    'Cosa fare': 'Niente, se e’ davvero descrittiva (manodopera, minuteria). '
      + 'Mettere il codice in ALNUS solo se e’ un pezzo vero.', 'Fatto?': '',
  }));

  // ⚠ I nomi dei campi si prendono dalla forma VERA prodotta dal domain, non
  // da come verrebbe comodo chiamarli: `nuove` e' un elenco di VOCI del file
  // (`clienteNome`, `qta`, `codArt`), mentre `aggiornamenti` sono
  // `{ voce, op, campi }` con `campi = [{campo, da, a}]`. Indovinandoli il
  // foglio stampava `undefined` senza che niente segnalasse l'errore — e non
  // si era visto prima solo perche' finora quel foglio era sempre vuoto.
  const mostra = v => (v === null || v === undefined || v === '') ? '—'
    : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? itDate(v) : String(v));
  const daVoce = v => ({
    'Ordine': v.numeroOrdine, 'Pos': v.pos, 'Cliente': v.clienteNome,
    'Codice articolo': v.codArt, 'Qta': v.qta, 'Scadenza': itDate(v.scadenza),
  });
  const daScrivere = []
    .concat(p.nuove.map(v => Object.assign({ 'Cosa': 'NUOVA commessa' }, daVoce(v),
      { 'Dettaglio': v.origine === 'box' ? ('kit ' + v.riferimento + ', '
        + v.nRigheFuse + ' righe fuse in una') : '' })))
    .concat(p.aggiornamenti.map(a => Object.assign({ 'Cosa': 'AGGIORNAMENTO' }, daVoce(a.voce),
      { 'Dettaglio': a.campi.map(c => c.campo + ': ' + mostra(c.da) + ' → ' + mostra(c.a)).join(' · ') })));

  const viva = o => o.stato !== 'completata' && o.stato !== 'spedita';
  const ritardo = ctx.operazioni.filter(o => viva(o) && o.scadenza && o.scadenza < OGGI)
    .sort((a, b) => String(a.scadenza).localeCompare(String(b.scadenza)))
    .map(o => {
      const az = ctx.aziende.find(x => x.id === o.cliente_id);
      const ar = ctx.articoli.find(x => x.id === o.articolo_id);
      const g = Math.round((new Date(OGGI) - new Date(o.scadenza)) / 86400000);
      return {
        'Ordine': o.numero_ordine, 'Pos': o.pos, 'Cliente': az ? az.nome : '?',
        'Codice articolo': ar ? ar.codice : '?', 'Qta': o.quantita, 'Stato': o.stato,
        'Scadenza': itDate(o.scadenza), 'Giorni di ritardo': g,
        'Spedite': (spedPerOp[o.id] || 0) + ' / ' + o.quantita,
      };
    });

  const fogli = [
    ['1 Stati', stati, 'I due sistemi non concordano su cosa sia finito. E’ il gruppo da sistemare per primo.'],
    ['2 Spedizioni', sped, 'La quantita’ che resta da evadere non torna fra i due archivi.'],
    ['3 Senza codice', senzaCod, 'Righe del file che non diventano commesse. Quasi sempre e’ giusto cosi’.'],
    ['4 Da importare', daScrivere, 'Cosa scriverebbe l’import adesso, se si trascinasse il file.'],
    ['5 In ritardo', ritardo, 'Commesse vive con la scadenza gia’ passata. Non e’ un disaccordo fra i due sistemi.'],
  ];

  const riepilogo = [
    { 'Voce': 'Gestionale letto il', 'Valore': itDate(OGGI) + ' (dal vivo, adesso)',
      'Nota': 'Quello che hai gia’ sistemato NELL’APP e’ gia’ conteggiato qui.' },
    { 'Voce': 'Estrazione Alnus del', 'Valore': itFile(ALNUS),
      'Nota': 'Quello che hai sistemato IN ALNUS dopo quest’ora NON si vede: serve una nuova estrazione.' },
    { 'Voce': 'Righe nel file', 'Valore': righe.length, 'Nota': 'Solo sezionale OC; gli OD restano fuori.' },
    { 'Voce': '', 'Valore': '', 'Nota': '' },
  ].concat(fogli.map(([n, r, c]) => ({ 'Voce': n, 'Valore': r.length, 'Nota': c })));
  riepilogo.push({ 'Voce': '', 'Valore': '', 'Nota': '' });
  riepilogo.push({ 'Voce': 'Commesse a sistema', 'Valore': ctx.operazioni.length,
    'Nota': 'di cui vive: ' + ctx.operazioni.filter(viva).length });

  const wb = XLSX.utils.book_new();
  const wsR = XLSX.utils.json_to_sheet(riepilogo);
  wsR['!cols'] = [{ wch: 24 }, { wch: 24 }, { wch: 86 }];
  XLSX.utils.book_append_sheet(wb, wsR, 'Riepilogo');
  fogli.forEach(([n, r]) => {
    const ws = XLSX.utils.json_to_sheet(r.length ? r : [{ '(vuoto)': 'niente da segnalare' }]);
    ws['!cols'] = Object.keys(r[0] || { a: 1 }).map(k => ({
      wch: Math.min(58, Math.max(11, k.length + 2,
        ...r.slice(0, 300).map(x => String(x[k] == null ? '' : x[k]).length + 2))),
    }));
    if (r.length) ws['!autofilter'] = { ref: ws['!ref'] };
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
  });
  fs.writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

  console.log('PIANO IMPORT: nuove ' + p.nuove.length + ' · aggiornamenti ' + p.aggiornamenti.length
    + ' · gia uguali ' + p.invariate + ' · chiuse non toccate ' + p.bloccate.length);
  console.log('scartate: ' + JSON.stringify(p.scartatePerMotivo));
  if (p.clientiDaRinominare && p.clientiDaRinominare.length) {
    console.log('rinomine cliente proposte: ' + p.clientiDaRinominare.length);
  }
  console.log('');
  fogli.forEach(([n, r]) => console.log('   ' + String(r.length).padStart(4) + '  ' + n));
  console.log('\nscritto: ' + OUT);
})();

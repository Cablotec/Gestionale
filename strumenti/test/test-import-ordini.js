// Test di analizzaImportOrdini (domain/scheduling.js) — funzione pura.
// Ogni test e' una decisione presa con Nico il 25 ago: se un test cade,
// e' una decisione che si sta perdendo, non un dettaglio di codice.
const fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
const sandbox = { state: { sessioni: [] }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8'), sandbox);
const analizza = sandbox.analizzaImportOrdini;
const impData = sandbox.importOrdiniData;

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

// Riga tipo dell'estrazione ERP. Le intestazioni hanno lo spazio in coda
// come nel file vero, ed e' apposta: e' il dettaglio che aveva rotto tutto.
const R = (o) => Object.assign({
  'Eser ': '2026', 'Sz Cl ': 'OC', 'Ord/Off Cliente ': '400', 'Riga ': '10',
  'Codice Articolo ': 'ART-1', 'Descrizione Articolo ': 'Descrizione',
  'Data Rich. Evasione ': 46000, 'Quantita UMI Ordine/Offerta ': 3,
  'Ragione Sociale ': 'Cliente Uno', 'Riferimento Cliente ': '',
  'Riferimento Cliente _1': '', 'Prezzo Netto Riga ': 10, 'Impon. Totale Riga ': 30,
}, o);
const CTX = {
  articoli: [{ id:'a1', codice:'ART-1', minuti_unitari: 42 },
             { id:'abox', codice:'BOX_EL000999', minuti_unitari: 775 }],
  aziende:  [{ id:'c1', nome:'Cliente Uno' },
             { id:'csz', nome:'Senzani Brevetti S.p.a.' },
             { id:'cel', nome:'Elcotec S.r.l.', tariffa_cliente: 27.3 }],
  operazioni: [],
};

sez('DATE');
t('seriale 46000 -> 2025-12-09', impData(46000) === '2025-12-09');
t('sentinella 2958465 (9999-12-31) -> nessuna data', impData(2958465) === null);
t('oltre la sentinella -> nessuna data', impData(3000000) === null);
t('testo italiano gg/mm/aaaa', impData('05/03/2026') === '2026-03-05');
t('gia ISO resta ISO', impData('2026-03-05') === '2026-03-05');
t('vuoto -> null', impData('') === null);
t('sentinella come Date (e la strada vera: cellDates)', impData(new Date(9999,11,31)) === null);
t('sentinella come testo ISO', impData('9999-12-31') === null);
t('sentinella come testo italiano', impData('31/12/9999') === null);
t('Date di SheetJS letta in locale', impData(new Date(2026, 2, 5)) === '2026-03-05');

sez('NUMERO ORDINE E POS');
{
  const p = analizza([R({})], CTX);
  const v = p.nuove[0];
  t('numero ordine con gli zeri: 2026/OC/00400', v.numeroOrdine === '2026/OC/00400');
  t('pos a 4 cifre: 0010', v.pos === '0010');
  t('quantita dall ordinato', v.qta === 3);
  t('scadenza da Data Rich. Evasione', v.scadenza === '2025-12-09');
  t('prezzo importato', v.prezzo === 10);
  t('minuti dal default articolo', v.minutiUnitari === 42);
}

sez('SOLO OC: le righe OD si scartano dichiarandole');
{
  const p = analizza([R({}), R({ 'Sz Cl ':'OD', 'Riga ':'20' })], CTX);
  t('una sola voce importabile', p.nuove.length === 1);
  t('la riga OD e scartata', p.scartate.length === 1);
  t('e il motivo lo nomina', /OD/.test(p.scartate[0].motivo));
}

sez('FUSIONE SENZANI EL -> una commessa BOX');
{
  const senz = (riga, rif, prezzo, imp) => R({
    'Ragione Sociale ':'SENZANI BREVETTI S.p.a.', 'Ord/Off Cliente ':'500',
    'Riga ': riga, 'Codice Articolo ':'SZ-PEZZO'+riga, 'Riferimento Cliente _1': rif,
    'Prezzo Netto Riga ': prezzo, 'Impon. Totale Riga ': imp, 'Quantita UMI Ordine/Offerta ': 1 });
  const p = analizza([senz('10','EL000999',100,100), senz('20','EL000999',50,50),
                      senz('30','EL000999',25.5,25.5)], CTX);
  t('tre righe -> una sola voce', p.nuove.length === 1);
  t('e la voce e un box', p.box.length === 1);
  const b = p.box[0];
  t('codice BOX_ + riferimento', b.codArt === 'BOX_EL000999');
  t('descrizione SBNE', b.descrArt === 'SBNE');
  t('pos 0010', b.pos === '0010');
  t('quantita 1 (un kit)', b.qta === 1);
  t('prezzo = somma degli imponibili', b.prezzo === 175.5);
  t('dichiara quante righe ha fuso', b.nRigheFuse === 3);
  t('minuti dall articolo BOX gia in anagrafica', b.minutiUnitari === 775);
  t('riferimento tenuto', b.riferimento === 'EL000999');
  t('i codici delle righe fuse non diventano articoli',
    !p.articoliDaCreare.some(a => /^SZ-PEZZO/.test(a.codice)));
}

sez('La fusione NON scatta fuori dai suoi confini');
{
  const p = analizza([R({ 'Riferimento Cliente _1':'EL000999' })], CTX);
  t('altro cliente con rif EL: nessuna fusione', p.box.length === 0);
  const p2 = analizza([R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.',
    'Riferimento Cliente _1':'OL000042' })], CTX);
  t('Senzani con rif OL: nessuna fusione', p2.box.length === 0);
}

sez('INTESTAZIONI DOPPIE: vince quella che ha i dati');
{
  // "Riferimento Cliente " compare due volte nel file vero: la prima vuota.
  const p = analizza([R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.',
    'Riferimento Cliente ': '', 'Riferimento Cliente _1':'EL000999' })], CTX);
  t('legge la colonna piena, non la prima omonima', p.box.length === 1);
}

sez('FOTOGRAFIA: cosa succede a una commessa che c e gia');
{
  const ctx = Object.assign({}, CTX, { operazioni: [{
    id:'o1', numero_ordine:'2026/OC/00400', pos:'0010', quantita: 1,
    scadenza:'2026-01-01', prezzo_unitario: null, stato:'aperta',
    minuti_unitari: 999, note:'una nota', gruppo_id:'g1' }] });
  const p = analizza([R({})], ctx);
  t('non la duplica', p.nuove.length === 0);
  t('la mette fra gli aggiornamenti', p.aggiornamenti.length === 1);
  const campi = p.aggiornamenti[0].campi.map(c => c.campo).sort();
  t('tocca solo quantita, scadenza e prezzo',
    JSON.stringify(campi) === JSON.stringify(['prezzo','quantita','scadenza']));
  t('dichiara il valore di prima', p.aggiornamenti[0].campi.find(c=>c.campo==='quantita').da === 1);
}
{
  const ctx = Object.assign({}, CTX, { operazioni: [{
    id:'o1', numero_ordine:'2026/OC/00400', pos:'0010', quantita: 3,
    scadenza:'2025-12-09', prezzo_unitario: 10, stato:'aperta' }] });
  const p = analizza([R({})], ctx);
  t('identica: nessun aggiornamento inutile', p.aggiornamenti.length === 0 && p.invariate === 1);
}

sez('POSIZIONE SENZA GLI ZERI: e la stessa commessa, non una nuova');
// Il 25 ago l'import ha creato 51 commesse doppie: quelle vecchie hanno
// pos "40", lui cercava "0040" e non le trovava. 191 commesse su 468
// hanno la pos corta, quindi il problema era ovunque.
{
  const conPosCorta = (pos) => Object.assign({}, CTX, { operazioni: [{
    id:'o1', numero_ordine:'2026/OC/00400', pos, quantita: 1,
    scadenza:'2020-01-01', prezzo_unitario: null, stato:'aperta',
    created_at:'2026-05-19T13:11:00Z' }] });
  ['10', '0010', 10].forEach(pos => {
    const p = analizza([R({})], conPosCorta(pos));
    t('pos ' + JSON.stringify(pos) + ' riconosciuta come la stessa',
      p.nuove.length === 0 && p.aggiornamenti.length === 1);
  });
  const p = analizza([R({ 'Riga ':'40' })], conPosCorta('40'));
  t('la riga 40 aggiorna la commessa con pos "40"',
    p.nuove.length === 0 && p.aggiornamenti.length === 1);
  const diverso = analizza([R({ 'Riga ':'20' })], conPosCorta('10'));
  t('una posizione DAVVERO diversa resta nuova', diverso.nuove.length === 1);
}

sez('Se un ordine+posizione e gia doppio, comanda la piu VECCHIA');
{
  // Dopo il danno del 25 ago a database ci sono coppie doppie: l'import non
  // deve aggiornare la copia sbagliata. Vince quella con la storia attaccata.
  const ctx = Object.assign({}, CTX, { operazioni: [
    { id:'vecchia', numero_ordine:'2026/OC/00400', pos:'10', quantita: 1,
      scadenza:'2020-01-01', stato:'aperta', created_at:'2026-05-19T13:11:00Z' },
    { id:'doppione', numero_ordine:'2026/OC/00400', pos:'0010', quantita: 1,
      scadenza:'2020-01-01', stato:'aperta', created_at:'2026-08-25T06:46:00Z' }] });
  const p = analizza([R({})], ctx);
  t('aggiorna una sola riga', p.aggiornamenti.length === 1);
  t('e aggiorna la piu vecchia', p.aggiornamenti[0].op.id === 'vecchia');
}

sez('Una commessa CHIUSA non si tocca mai');
for (const stato of ['completata', 'spedita']) {
  const ctx = Object.assign({}, CTX, { operazioni: [{
    id:'o1', numero_ordine:'2026/OC/00400', pos:'0010', quantita: 1,
    scadenza:'2020-01-01', prezzo_unitario: null, stato }] });
  const p = analizza([R({})], ctx);
  t(stato + ': non aggiornata', p.aggiornamenti.length === 0);
  t(stato + ': non duplicata', p.nuove.length === 0);
  t(stato + ': dichiarata fra le bloccate', p.bloccate.length === 1);
}

sez('REGOLA TARIFFA CLIENTE (prezzo -> minuti pagati)');
{
  const p = analizza([R({ 'Ragione Sociale ':'Elcotec S.r.l.',
    'Prezzo Netto Riga ': 54.6, 'Impon. Totale Riga ': 163.8 })], CTX);
  const v = p.nuove[0];
  t('54,6 EUR / 27,3 EUR-h x 60 = 120 min', v.minutiUnitari === 120);
  t('lo dichiara', v.minutiDaTariffa === true);
  t('sempre al minuto intero (la colonna e INTEGER)', Number.isInteger(v.minutiUnitari));
}
{
  const p = analizza([R({ 'Ragione Sociale ':'Elcotec S.r.l.', 'Prezzo Netto Riga ': 0,
    'Impon. Totale Riga ': 0, 'Codice Articolo ':'ART-1' })], CTX);
  t('senza prezzo la tariffa non si applica: resta il default articolo',
    p.nuove[0].minutiUnitari === 42 && p.nuove[0].minutiDaTariffa === false);
}

sez('RESIDUA: non si importa, si CONFRONTA');
// La quantita residua il gestionale la calcola da se (ordinato - spedito).
// Quella del file serve solo a scoprire dove i due archivi divergono.
{
  const conSped = (qtaOp, spedite, residuaFile) => Object.assign({}, CTX, {
    operazioni: [{ id:'o1', numero_ordine:'2026/OC/00400', pos:'0010',
      quantita: qtaOp, scadenza:'2025-12-09', prezzo_unitario: 10, stato:'aperta',
      created_at:'2026-05-19T13:11:00Z' }],
    spedizioni: spedite.map((q, i) => ({ id:'s'+i, operazione_id:'o1', quantita: q })),
  });
  const riga = residuaFile => R({ 'Quantita UMI Ordine/Offerta ': 10,
    'Quantità Residua ': residuaFile });

  // 10 ordinate, 4 spedite -> ne restano 6. Se Alnus dice 6, tutto torna.
  const ok = analizza([riga(6)], conSped(10, [1, 3], 6));
  t('quando i conti tornano non si segnala niente', ok.residuiDiscordanti.length === 0);

  // Alnus ne dichiara di piu di quante ne restano qui: la spedizione l'abbiamo
  // fatta noi e loro non la sanno.
  const a = analizza([riga(10)], conSped(10, [4], 10));
  t('Alnus indietro: segnalato', a.residuiDiscordanti.length === 1);
  t('  e dice che tocca ad Alnus', a.residuiDiscordanti[0].chiIndietro === 'alnus');
  t('  col conto per esteso', a.residuiDiscordanti[0].spedito === 4
    && a.residuiDiscordanti[0].residuoQui === 6
    && a.residuiDiscordanti[0].residuaFile === 10);

  // Il contrario: Alnus sa di una spedizione che qui non e registrata.
  const g = analizza([riga(2)], conSped(10, [], 2));
  t('gestionale indietro: segnalato', g.residuiDiscordanti.length === 1
    && g.residuiDiscordanti[0].chiIndietro === 'gestionale');

  // Ordinati diversi: le due residue non partono dalla stessa base.
  const b = analizza([riga(4)], conSped(8, [], 4));
  t('basi diverse: dichiarate', b.residuiDiscordanti.length === 1
    && b.residuiDiscordanti[0].basiDiverse === true
    && b.residuiDiscordanti[0].ordinatoFile === 10);

  // Una commessa che non c'e ancora non ha spedizioni da confrontare.
  const nuova = analizza([riga(3)], Object.assign({}, CTX, { operazioni: [], spedizioni: [] }));
  t('commessa nuova: niente da confrontare', nuova.residuiDiscordanti.length === 0);

  // Senza la colonna nel file non si inventa nessun confronto.
  const senza = analizza([R({})], conSped(10, [4], 0));
  t('colonna assente: nessuna segnalazione', senza.residuiDiscordanti.length === 0);
}

sez('INTESTAZIONI CON E SENZA ACCENTO: lo stesso foglio le mescola');
{
  t('\'Quantità Residua\' riconosciuta anche con l accento',
    analizza([R({ 'Quantità Residua ': 5 })], CTX).mappa.residua === 'Quantità Residua ');
  t('e la quantita senza accento resta riconosciuta',
    analizza([R({})], CTX).mappa.qta === 'Quantita UMI Ordine/Offerta ');
}

sez('RIGHE INSERVIBILI: si scartano, non si indovinano');
{
  const casi = [
    ['senza codice articolo', { 'Codice Articolo ':'' }, /codice articolo/],
    ['senza cliente',         { 'Ragione Sociale ':'' }, /cliente/],
    ['senza numero ordine',   { 'Ord/Off Cliente ':'' }, /numero ordine/],
    ['quantita zero',         { 'Quantita UMI Ordine/Offerta ': 0 }, /quantita/],
    ['scadenza sentinella',   { 'Data Rich. Evasione ': 2958465 }, /scadenza/],
  ];
  casi.forEach(([nome, patch, re]) => {
    const p = analizza([R(patch)], CTX);
    t(nome, p.nuove.length === 0 && p.scartate.length === 1 && re.test(p.scartate[0].motivo));
  });
}

sez('STESSA DITTA SCRITTA DIVERSAMENTE: si aggancia e si RINOMINA');
// Il 25 ago l'import ha creato CABLOTECH SRL accanto a Cablotech S.r.l.
// Decisione: Alnus detta il nome, quindi la scheda esistente si allinea al
// file. L'id non cambia mai: commesse e storico restano attaccati.
{
  const ctx = Object.assign({}, CTX, { aziende: CTX.aziende.concat([
    { id:'cx', nome:'Cablotech S.r.l.' },
    { id:'cy', nome:'Fabbri Elio snc' },
    { id:'cz', nome:'Metalmeccanica Rossi SRL' }]) });
  const coppie = [['CABLOTECH SRL','Cablotech S.r.l.','cx'],
                  ['FABBRI ELIO S.n.c.','Fabbri Elio snc','cy'],
                  ['METALMECCANICA ROSSI S.R.L.','Metalmeccanica Rossi SRL','cz']];
  coppie.forEach(([daFile, inAnagrafica, id], i) => {
    const p = analizza([R({ 'Ragione Sociale ': daFile, 'Riga ': String((i+1)*10) })], ctx);
    t(daFile + ' non crea un doppione', p.clientiDaCreare.length === 0);
    t(daFile + ' usa la scheda che c era (stesso id)',
      p.nuove.length === 1 && p.nuove[0].cliente.id === id);
    t(daFile + ' rinomina la scheda al nome del file',
      p.clientiDaRinominare.length === 1
      && p.clientiDaRinominare[0].id === id
      && p.clientiDaRinominare[0].da === inAnagrafica
      && p.clientiDaRinominare[0].a === daFile);
  });
  t('nome gia identico: nessuna rinomina',
    analizza([R({ 'Ragione Sociale ':'Cliente Uno' })], ctx).clientiDaRinominare.length === 0);
  t('una ditta davvero nuova resta da creare',
    analizza([R({ 'Ragione Sociale ':'Ditta Mai Vista' })], ctx).clientiDaCreare.length === 1);
  t('la chiave non fonde due ditte diverse',
    sandbox.importOrdiniChiaveNome('Rossi SRL') !== sandbox.importOrdiniChiaveNome('Rossini SRL'));
}

sez('QUANDO NON SI RINOMINA: un nome sbagliato e peggio di uno vecchio');
{
  // Due diciture diverse per lo stesso cliente DENTRO lo stesso file:
  // non c'e' un nome giusto da scegliere.
  const ctx1 = Object.assign({}, CTX, { aziende: CTX.aziende.concat([
    { id:'cx', nome:'Cablotech S.r.l.' }]) });
  const p1 = analizza([
    R({ 'Ragione Sociale ':'CABLOTECH SRL', 'Riga ':'10' }),
    R({ 'Ragione Sociale ':'Cablotech S.R.L', 'Riga ':'20' })], ctx1);
  t('due diciture nello stesso file: non rinomina', p1.clientiDaRinominare.length === 0);
  t('e lo dichiara', p1.rinomineImpossibili.length === 1
    && /diciture diverse/.test(p1.rinomineImpossibili[0].motivo));

  // Il nome nuovo e' gia' occupato da un'ALTRA scheda (il doppione non
  // ancora ripulito): rinominare farebbe due schede con lo stesso nome.
  // Il nome nuovo e gia occupato da UN ALTRA scheda: rinominare farebbe
  // due schede con lo stesso nome identico.
  const ctx2 = Object.assign({}, CTX, { aziende: CTX.aziende.concat([
    { id:'cvecchia', nome:'Cablotech Srl',   created_at:'2026-01-01T00:00:00Z' },
    { id:'cdoppio',  nome:'CABLOTECH SRL',  created_at:'2026-08-25T06:46:00Z' }]) });
  const p2 = analizza([R({ 'Ragione Sociale ':'CABLOTECH SRL' })], ctx2);
  t('fra due copie si aggancia alla PIU VECCHIA',
    p2.nuove.length === 1 && p2.nuove[0].cliente.id === 'cvecchia');
  t('nome gia occupato da un altra scheda: non rinomina',
    p2.clientiDaRinominare.length === 0);
  t('e dice quale', p2.rinomineImpossibili.length === 1
    && /esiste gia/.test(p2.rinomineImpossibili[0].motivo));
}

sez('SENZA CODICE ARTICOLO: riga descrittiva, non si carica');
{
  const p = analizza([R({ 'Codice Articolo ':'', 'Descrizione Articolo ':'MANODOPERA',
    'Ragione Sociale ':'Cliente Uno', 'Quantita UMI Ordine/Offerta ': 7 })], CTX);
  t('la riga non entra', p.nuove.length === 0);
  t('finisce nel suo elenco, non solo negli scarti', p.senzaCodice.length === 1);
  t('e il motivo dice che e descrittiva', /descrittiva/.test(p.scartate[0].motivo));
  t('col dettaglio per sapere quale non e entrata',
    p.senzaCodice[0].numeroOrdine === '2026/OC/00400'
    && p.senzaCodice[0].descrizione === 'MANODOPERA'
    && p.senzaCodice[0].cliente === 'Cliente Uno'
    && p.senzaCodice[0].quantita === 7);
  t('una riga col codice non ci finisce', analizza([R({})], CTX).senzaCodice.length === 0);
}

sez('STATI: il file contiene solo cio che per Alnus e ancora in corso');
{
  const op = (num, pos, stato, art) => ({ id: num + pos, numero_ordine: num, pos,
    quantita: 3, scadenza:'2025-12-09', prezzo_unitario: 10, stato,
    articolo_id: art || 'a1', cliente_id:'c1', created_at:'2026-01-01T00:00:00Z' });

  // c'e nel file ma qui e chiusa -> per Alnus e ancora da fare
  const a = analizza([R({})], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0010', 'spedita')] }));
  t('nel file ma chiusa qui: segnalata', a.statiDiscordanti.chiuseQui.length === 1);
  t('  con codice e cliente', a.statiDiscordanti.chiuseQui[0].codice === 'ART-1');

  // qui e viva ma nel file non c'e -> per Alnus e finita
  const b = analizza([R({})], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0010', 'aperta'), op('2026/OC/00999', '0010', 'aperta')] }));
  t('viva qui ma fuori dal file: segnalata', b.statiDiscordanti.viveQui.length === 1);
  t('  ed e proprio quella giusta',
    b.statiDiscordanti.viveQui[0].numeroOrdine === '2026/OC/00999');
  t('  e dice che e sparito tutto l ordine',
    b.statiDiscordanti.viveQui[0].ordineNelFile === false);
  t('la riga che sta nel file non viene segnalata',
    !b.statiDiscordanti.viveQui.some(r => r.numeroOrdine === '2026/OC/00400'));

  // stessa cosa ma la posizione sparita su un ordine ancora presente
  const c = analizza([R({})], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0010', 'aperta'), op('2026/OC/00400', '0030', 'aperta')] }));
  t('posizione sparita su un ordine ancora nel file: lo dichiara',
    c.statiDiscordanti.viveQui.length === 1 && c.statiDiscordanti.viveQui[0].ordineNelFile === true);

  // una chiusa e fuori dal file e in pari: nessuno dei due la considera viva
  const d = analizza([R({})], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0010', 'aperta'), op('2026/OC/00999', '0010', 'spedita')] }));
  t('chiusa qui e assente nel file: nessuna segnalazione',
    d.statiDiscordanti.viveQui.length === 0 && d.statiDiscordanti.chiuseQui.length === 0);

  // i BOX Senzani restano fuori dal conto (decisione Nico)
  const senz = (riga, rif) => R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.',
    'Ord/Off Cliente ':'500', 'Riga ': riga, 'Codice Articolo ':'SZ-P'+riga,
    'Riferimento Cliente _1': rif, 'Quantita UMI Ordine/Offerta ': 1 });
  const e = analizza([senz('10','EL000999'), senz('20','EL000999')], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00500', '0010', 'completata', 'abox')] }));
  t('il BOX chiuso qui non finisce fra gli stati discordanti',
    e.statiDiscordanti.chiuseQui.length === 0);
  t('  ma resta comunque fra le bloccate', e.bloccate.length === 1);
}

sez('COMPLETATA NON E UNA DIVERGENZA: i due sistemi chiudono in momenti diversi');
// Detto da Nico il 27 ago: in Alnus l'ordine si chiude solo a merce SPEDITA.
// Quindi `completata` qui + ancora aperta la = stato normale di una commessa
// finita che non e ancora partita. Segnalarla riempiva l'elenco di roba
// giusta: 14 righe su 18.
{
  const op=(pos,stato)=>({ id:'o'+pos, numero_ordine:'2026/OC/00400', pos,
    quantita:3, scadenza:'2025-12-09', prezzo_unitario:10, stato,
    articolo_id:'a1', cliente_id:'c1', created_at:'2026-01-01T00:00:00Z' });
  const riga=pos=>R({ 'Riga ':pos });
  const ctx=Object.assign({},CTX,{ operazioni:[
    op('0010','spedita'), op('0020','completata') ] });
  const p=analizza([riga('10'), riga('20')], ctx);
  t('la SPEDITA e una divergenza', p.statiDiscordanti.chiuseQui.length===1
    && p.statiDiscordanti.chiuseQui[0].pos==='0010');
  t('la COMPLETATA non ci finisce',
    !p.statiDiscordanti.chiuseQui.some(r=>r.pos==='0020'));
  t('  ma viene contata a parte', p.statiDiscordanti.prodotteNonSpedite.length===1
    && p.statiDiscordanti.prodotteNonSpedite[0].pos==='0020');
  t('entrambe restano fra le bloccate (non si toccano)', p.bloccate.length===2);
}

sez('UNA RIGA SCARTATA STA COMUNQUE NEL FILE');
// Se le chiavi si prendessero dalle sole righe IMPORTABILI, una commessa la
// cui riga e stata scartata (codice mancante) o fusa in un BOX sembrerebbe
// sparita da Alnus. Sta li', e solo non importabile: sono due cose diverse.
{
  const op = (num, pos) => ({ id: num + pos, numero_ordine: num, pos, quantita: 3,
    scadenza:'2025-12-09', stato:'aperta', articolo_id:'a1', cliente_id:'c1',
    created_at:'2026-01-01T00:00:00Z' });

  // riga senza codice articolo: scartata, ma la commessa non e sparita
  const a = analizza([R({ 'Codice Articolo ':'' })], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0010')] }));
  t('riga senza codice: la commessa non risulta sparita da Alnus',
    a.statiDiscordanti.viveQui.length === 0);
  t('  ma la riga resta segnalata come errore', a.senzaCodice.length === 1);

  // righe Senzani fuse in un BOX: le posizioni originali sono nel file
  const senz = (riga, rif) => R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.',
    'Ord/Off Cliente ':'500', 'Riga ': riga, 'Codice Articolo ':'SZ-P'+riga,
    'Riferimento Cliente _1': rif, 'Quantita UMI Ordine/Offerta ': 1 });
  const b = analizza([senz('10','EL000999'), senz('20','EL000999')], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00500', '0020')] }));
  t('riga fusa nel BOX: la commessa a quella posizione non risulta sparita',
    b.statiDiscordanti.viveQui.length === 0);

  // controprova: una posizione che nel file non c e proprio DEVE uscire
  const c = analizza([R({})], Object.assign({}, CTX, {
    operazioni: [op('2026/OC/00400', '0070')] }));
  t('una posizione davvero assente dal file resta segnalata',
    c.statiDiscordanti.viveQui.length === 1);
}

sez('ANAGRAFICHE MANCANTI: elencate, non inventate in silenzio');
{
  const p = analizza([R({ 'Codice Articolo ':'NUOVO-1', 'Descrizione Articolo ':'Roba nuova',
    'Ragione Sociale ':'Ditta Mai Vista' })], CTX);
  t('articolo nuovo elencato col suo nome', p.articoliDaCreare.length === 1
    && p.articoliDaCreare[0].codice === 'NUOVO-1'
    && p.articoliDaCreare[0].descrizione === 'Roba nuova');
  t('cliente nuovo elencato', p.clientiDaCreare.length === 1
    && p.clientiDaCreare[0] === 'Ditta Mai Vista');
  t('la riga resta importabile', p.nuove.length === 1);
  t('senza articolo in anagrafica i minuti partono da 0', p.nuove[0].minutiUnitari === 0);
}

sez('FILE SBAGLIATO: lo dice invece di importare zero righe in silenzio');
{
  const p = analizza([{ 'Pippo': 1, 'Pluto': 2 }], {});
  t('elenca le colonne obbligatorie che mancano', p.colonneMancanti.length > 0);
  t('e non prova a importare niente', p.nuove.length === 0);
  const vuoto = analizza([], {});
  t('file vuoto: nessun errore', vuoto.righeLette === 0 && vuoto.nuove.length === 0);
}

sez('EXPORT DEL GESTIONALE: il giro esporta -> reimporta regge ancora');
{
  const p = analizza([{ 'Eser':'2026', 'Sz Cl':'OC', 'Ord/Off cliente':'00400', 'Riga':'0010',
    'Codice articolo':'ART-1', 'Scadenza':'30/12/2025', 'Quantita':'3', 'Cliente':'Cliente Uno',
    'Riferimento Cliente':'X1' }], CTX);
  t('riconosce le intestazioni dell export', p.colonneMancanti.length === 0);
  t('e ricostruisce la stessa commessa', p.nuove.length === 1
    && p.nuove[0].numeroOrdine === '2026/OC/00400' && p.nuove[0].pos === '0010');
}

sez('ASSENTE DAL FILE = SPEDITO PER ALNUS: la completata NON si tace');
// Trovato da Nico il 28 ago su 2026/OC/00174/0030-0040. La regola di sopra
// ("completata non e una divergenza") vale SOLO quando la riga sta nel file:
// li Alnus aspetta la spedizione e noi abbiamo finito di produrre, normale.
// Nel verso opposto la riga NON c'e, e per Alnus assente vuol dire chiuso,
// cioe SPEDITO: una completata senza spedizioni dice il contrario di Alnus,
// esattamente come una aperta. Trattandola da chiusa se ne tacevano 10.
{
  const ART = [{ id:'a1', codice:'ART-1', minuti_unitari:42 },
    { id:'abox', codice:'BOX_EL000999' },      // BOX come li crea l'import
    { id:'avecchio', codice:'SZ-D34807_BOX' }, // BOX vecchi, fatti a mano
    { id:'atouch', codice:'PJS-BOX_TOUCH' }];  // NON un kit: prodotto vero
  const op = (num, pos, stato, art, cli) => ({ id:num+pos, numero_ordine:num, pos,
    quantita:3, scadenza:'2025-12-09', prezzo_unitario:10, stato,
    articolo_id: art || 'a1', cliente_id: cli || 'c1',
    created_at:'2026-01-01T00:00:00Z' });
  const ctx = o => Object.assign({}, CTX, { articoli: ART }, o);
  const trovata = (p, pos) => p.statiDiscordanti.viveQui.some(r => r.pos === pos);

  const p = analizza([R({})], ctx({ operazioni: [
    op('2026/OC/00400','0010','aperta'),      // sta nel file: mai segnalata
    op('2026/OC/00400','0030','completata'),  // fuori dal file
    op('2026/OC/00400','0040','aperta'),      // fuori dal file
    op('2026/OC/00400','0050','spedita'),     // fuori dal file: d'accordo
  ] }));
  t('la COMPLETATA fuori dal file viene segnalata', trovata(p, '0030'));
  t('  insieme alla aperta, stesso trattamento', trovata(p, '0040'));
  t('la SPEDITA fuori dal file resta zitta: i due concordano', !trovata(p, '0050'));
  t('la riga presente nel file non si segnala', !trovata(p, '0010'));
  t('  in tutto due segnalazioni, non una', p.statiDiscordanti.viveQui.length === 2);
  t('  e la completata porta con se il suo stato',
    (p.statiDiscordanti.viveQui.find(r => r.pos === '0030') || {}).stato === 'completata');

  // le due regole non si contraddicono: nello stesso piano convivono
  const q = analizza([R({ 'Riga ':'10' })], ctx({ operazioni: [
    op('2026/OC/00400','0010','completata'),  // NEL file  -> si tace
    op('2026/OC/00400','0020','completata'),  // FUORI     -> si segnala
  ] }));
  t('completata NEL file: fra le prodotte non spedite, non fra le discordanti',
    q.statiDiscordanti.prodotteNonSpedite.length === 1
    && q.statiDiscordanti.prodotteNonSpedite[0].pos === '0010'
    && !trovata(q, '0010'));
  t('completata FUORI dal file: segnalata', trovata(q, '0020'));

  // I KIT si giudicano sul RIFERIMENTO, non sulla posizione (28 ago).
  // Qui il kit e una commessa sola, in Alnus sono 15-18 righe, e le posizioni
  // non combaciano mai: confrontarle dichiarava sempre sparito il kit, ed e
  // per questo che prima erano esclusi in blocco. Ma esclusi in blocco vuol
  // dire non guardarli mai.
  const rigaSenz = rif => R({ 'Ragione Sociale ':'SENZANI BREVETTI S.p.a.',
    'Ord/Off Cliente ':'900', 'Riga ':'10', 'Codice Articolo ':'SZ-X',
    'Riferimento Cliente _1': rif, 'Quantita UMI Ordine/Offerta ': 1 });

  // riferimento ANCORA nel file -> per Alnus il kit e aperto: si tace
  const b = analizza([rigaSenz('EL000999')], ctx({ operazioni: [
    op('2026/OC/00500','0020','completata','abox','csz'),   // BOX_EL000999
  ] }));
  t('kit col riferimento ancora in Alnus: taciuto', !trovata(b, '0020'));
  t('  e la posizione non c entra: la commessa sta in 0020, il file in 0010',
    b.statiDiscordanti.viveQui.length === 0);

  // riferimento SPARITO dal file -> per Alnus e finito: si segnala
  const b2 = analizza([rigaSenz('EL000111')], ctx({ operazioni: [
    op('2026/OC/00500','0020','completata','abox','csz'),   // BOX_EL000999
  ] }));
  t('kit col riferimento sparito da Alnus: segnalato', trovata(b2, '0020'));
  t('  e si dichiara come kit, col suo riferimento',
    (b2.statiDiscordanti.viveQui[0] || {}).kit === 'EL000999');

  // il riferimento vale anche per i kit vecchi, che non ce l hanno nel codice
  const b3 = analizza([rigaSenz('D34807')], ctx({ operazioni: [
    Object.assign(op('2026/OC/00501','0020','completata','avecchio','csz'),
      { riferimento_cliente: 'D34807' }),
  ] }));
  t('kit vecchio SZ-..._BOX: riferimento letto dalla colonna', !trovata(b3, '0020'));
  const b4 = analizza([rigaSenz('ALTRO')], ctx({ operazioni: [
    Object.assign(op('2026/OC/00501','0020','completata','avecchio','csz'),
      { riferimento_cliente: 'D34807' }),
  ] }));
  t('  e se quel riferimento non c e piu: segnalato', trovata(b4, '0020'));

  // il CODICE batte la colonna: su BOX_EL000515 la colonna diceva EL0000515
  const b5 = analizza([rigaSenz('EL000999')], ctx({ operazioni: [
    Object.assign(op('2026/OC/00502','0020','completata','abox','csz'),
      { riferimento_cliente: 'EL0000999' }),  // uno zero di troppo, come nei dati veri
  ] }));
  t('riferimento sbagliato in colonna: vince il codice articolo, kit taciuto',
    !trovata(b5, '0020'));

  // un kit SPEDITO resta zitto comunque
  const b6 = analizza([rigaSenz('EL000111')], ctx({ operazioni: [
    op('2026/OC/00503','0020','spedita','abox','csz'),
  ] }));
  t('kit spedito: zitto anche col riferimento sparito', !trovata(b6, '0020'));

  // senza riferimento non si tace: si torna alla regola generale
  const b7 = analizza([rigaSenz('EL000111')], ctx({ operazioni: [
    Object.assign(op('2026/OC/00504','0020','completata','avecchio','csz'),
      { riferimento_cliente: '' }),
  ] }));
  t('kit senza riferimento: giudicato come tutti, non taciuto', trovata(b7, '0020'));

  // ...ma il nome non basta: PJS-BOX_TOUCH e un prodotto, e non e di Senzani
  const c = analizza([R({})], ctx({ operazioni: [
    op('2026/OC/00600','0010','aperta','atouch','c1'),
  ] }));
  t('PJS-BOX_TOUCH non e un kit: si segnala eccome', trovata(c, '0010'));
  // e nemmeno il cliente basta: un articolo normale di Senzani va segnalato
  const d = analizza([R({})], ctx({ operazioni: [
    op('2026/OC/00700','0010','aperta','a1','csz'),
  ] }));
  t('articolo normale di Senzani: si segnala', trovata(d, '0010'));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

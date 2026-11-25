// Test dello SPECCHIO DI ALNUS — 20 nov 2026 (domain/alnus.js).
// Uso: node strumenti/test/test-alnus-specchio.js [cartella del gestionale]
const G = process.argv[2] || '.';
const A = require(require('path').resolve(G, 'domain/alnus.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('Numeri e date di Alnus');
t('1.234,500', A.numAlnus('1.234,500') === 1234.5);
t('3,000- (meno in fondo)', A.numAlnus('3,000-') === -3);
t('-1,000', A.numAlnus('-1,000') === -1);
t('vuoto = null', A.numAlnus('  ') === null);
t('testo = NaN', isNaN(A.numAlnus('nr 1,')));
t('data e ora', A.dataAlnus('20/11/2026', '9:42:53') === '2026-11-20T09:42:53');
t('data senza ora', A.dataAlnus('1/2/2026') === '2026-02-01T00:00:00');

sez('Collaudo: il gestionale contro Alnus');
{
  const M = [
    { data: '2026-11-23', codice: 'A', qta: 50, documento_tipo: 'APERTURA' },
    { data: '2026-11-25', codice: 'A', qta: 6, tipo: 'carico', documento_tipo: 'ALNUS', documento_numero: '2026/EA1/9' },
    { data: '2026-11-25', codice: 'A', qta: 6, tipo: 'carico', documento_tipo: 'DDT', documento_numero: '91', fuori_giacenza: true },
    { data: '2026-11-25', codice: 'A', qta: -3, tipo: 'trasferimento', documento_tipo: 'ALNUS', documento_numero: '2026/UT1/4' },
    { data: '2026-11-25', codice: 'A', qta: 3, tipo: 'trasferimento', documento_tipo: 'ALNUS', documento_numero: '2026/ET1/4' },
    { data: '2026-11-25', codice: 'A', qta: -3, tipo: 'trasferimento', documento_tipo: 'REPARTO', presso_id: null },
    { data: '2026-11-25', codice: 'A', qta: 3, tipo: 'trasferimento', documento_tipo: 'REPARTO', presso_id: 'r' },
    { data: '2026-11-25', codice: 'B', qta: -5, tipo: 'rettifica', documento_tipo: 'ALNUS', documento_numero: '2026/UR1/7' },
    { data: '2026-11-25', codice: 'C', qta: -2, tipo: 'scarico', documento_tipo: 'ALNUS', documento_numero: '2026/UP1/8' },
    { data: '2026-11-25', codice: 'C', qta: -1.5, tipo: 'scarico', documento_tipo: 'PRODUZIONE' },
    { data: '2026-11-25', codice: 'C', qta: -0.5, tipo: 'scarico', documento_tipo: 'PRODUZIONE', fuori_giacenza: true },
    { data: '2026-11-20', codice: 'D', qta: 9, tipo: 'carico', documento_tipo: 'DDT' },
    { data: '2026-11-25', codice: 'TS-1', qta: 4, tipo: 'carico', documento_tipo: 'DDT' },
    { data: '2026-11-25', codice: 'PROD', qta: 1, tipo: 'carico', documento_tipo: 'ALNUS', documento_numero: '2026/EP1/2' },
  ];
  const r = A.collaudoGiacenze(M, '2026-11-25', { codiceDiAlnus: c => !c.startsWith('TS-'), escludi: new Set(['PROD']) });
  const di = c => r.find(x => x.codice === c);
  t('arrivo registrato in tutti e due (il nostro solo registro): torna', di('A').differenza === 0 && di('A').nostro.arrivi === 6 && di('A').alnus.arrivi === 6);
  t('prelievo 01→WIP contro portato in reparto: spostamenti a zero da tutte e due le parti', di('A').alnus.spostamenti === 0 && di('A').nostro.spostamenti === 0);
  t('rettifica solo in Alnus: differenza +5', di('B').differenza === 5 && di('B').alnus.rettifiche === -5);
  t('consumo: lotto (anche la parte gia\' consumata da Alnus) contro UP1: torna', di('C').differenza === 0 && di('C').nostro.consumi === -2);
  t('movimenti prima del giorno di partenza: fuori', !di('D'));
  t('codici che Alnus non conosce: fuori', !di('TS-1'));
  t('prodotti finiti: fuori', !di('PROD'));
  t('apertura: fuori', di('A').alnus.totale === 6);
  t('in testa i codici che non tornano', r[0].codice === 'B');
  t('tipo da causale: EA1 arrivi, UC1 uscite, EP1 altri', A.tipoCollaudo({ documento_tipo: 'ALNUS', documento_numero: '2026/EA1/1' }) === 'arrivi'
    && A.tipoCollaudo({ documento_tipo: 'ALNUS', documento_numero: '2026/UC1/1' }) === 'uscite' && A.tipoCollaudo({ documento_tipo: 'ALNUS', documento_numero: '2026/EP1/1' }) === 'altri');
  t('reso al cliente: uscite', A.tipoCollaudo({ documento_tipo: 'RESO', tipo: 'scarico' }) === 'uscite');
  t('DDT in uscita (vendita): uscite', A.tipoCollaudo({ documento_tipo: 'USCITA', tipo: 'scarico' }) === 'uscite');
  // Giacenza (25 nov): gestionale = righe in conto, Alnus = apertura + righe di Alnus.
  t('giacenza A: gestionale 50 (DDT registro), Alnus 56', di('A').giacenza.nostro === 50 && di('A').giacenza.alnus === 56);
  t('giacenza C: gestionale -1,5 (la parte registro no), Alnus -2', di('C').giacenza.nostro === -1.5 && di('C').giacenza.alnus === -2);
}
{
  // Punto zero: le righe registrate prima dell'apertura sono gia' dentro di lei.
  const M = [
    { data: '2026-11-23', codice: 'A', qta: 50, documento_tipo: 'APERTURA', creato_il: '2026-11-23T11:04:35Z' },
    { data: '2026-11-23', codice: 'A', qta: 4, tipo: 'carico', documento_tipo: 'DDT', creato_il: '2026-11-23T09:00:00Z' },
    { data: '2026-11-23', codice: 'A', qta: 7, tipo: 'carico', documento_tipo: 'DDT', creato_il: '2026-11-23T15:00:00Z' },
    { data: '2026-11-23', codice: 'A', qta: 7, tipo: 'carico', documento_tipo: 'ALNUS', documento_numero: '2026/EA1/1', creato_il: '2026-11-23T14:00:00Z', fuori_giacenza: true },
  ];
  const r = A.collaudoGiacenze(M, '2026-11-23', { dopo: Date.parse('2026-11-23T11:04:35Z') });
  t('punto zero: il DDT del mattino non conta, quello del pomeriggio si', r.length === 1 && r[0].nostro.arrivi === 7 && r[0].differenza === 0);
  t('punto zero: giacenze uguali (foto 54 = apertura 50 + DDT del mattino 4; poi +7 da tutte e due)', r[0].giacenza.nostro === 61 && r[0].giacenza.alnus === 61);
}

sez('Codici letti da Excel (lo zero dei codici Sacmi)');
t('numero a 7 cifre: torna lo zero', A.codiceDaExcel(4010100) === '04010100');
t('testo a 7 cifre: torna lo zero', A.codiceDaExcel(' 4959125 ') === '04959125');
t('8 cifre con lo zero: invariato', A.codiceDaExcel('04010100') === '04010100');
t('8 cifre senza zero: invariato', A.codiceDaExcel(12345678) === '12345678');
t('codice con lettere: invariato', A.codiceDaExcel('24511PHOE00003212166') === '24511PHOE00003212166');
t('vuoto resta vuoto', A.codiceDaExcel(null) === '');

const TAB = '\t';
const giac = [
  'CABLOTEC S.R.L.\tStampa Giacenze di Magazzino\t10:33:11\t20/11/2026\t\t\t',
  'Codice Articolo\t         Versione\tDescrizione Articolo\tCod Dep\tCod Mag\t         Commessa\t\tLotto     Matricola\tData Scad. Lotto\t    Zon\t    Cor\t    Cam\t    Pos\t UM\t         Giacenza\t \t ',
  'A1\t\tFASTON\tSTD\tSPK\t\t \t\t\tF  \t   \t1\t3\tnr\t16,000\t\t',
  'A1\t\tFASTON\tSTD\tWIP\t\t \t\t\t   \t   \t   \t   \tnr\t8,000\t\t',
  '    \t    \t    \t    \t    \t    \t    \t    \t    \t    \t    \t    \t    \tTotale Articolo       \t24,000\t    \t',
  'FILO\t\tFILO\tSTD\t01\t\t \t\t\t   \t   \t   \t   \tmt\t4.330,000\t\t',
  'NEG\t\tX\tSTD\t01\t\t \t\t\t   \t   \t   \t   \tnr\t-1,000\t\t',
  'SZ-1\t039\t\t   PARETE.\t   \tTD \t1\t \t\t\t\t\t\t   \t0\tnr            1,\t',
].join('\r\n');
sez('Stampa giacenze');
{
  const g = A.leggiGiacenzeAlnus(giac);
  t('ora della stampa', g.preso_il === '2026-11-20T10:33:11');
  t('4 righe buone (il totale non conta)', g.righe.length === 4);
  t('riga storta scartata e dichiarata', g.scartate.length === 1 && g.scartate[0] === 'SZ-1');
  t('magazzino e quantita', g.righe[0].magazzino === 'SPK' && g.righe[0].qta === 16 && g.righe[2].qta === 4330 && g.righe[2].um === 'mt');
  t('negativa tenuta', g.righe[3].qta === -1);
  t('un altro file: errore', !!A.leggiGiacenzeAlnus('ciao').errore);
}

const movHead = '     Eser\tNumero Movim.\tCodice Articolo\t         Versione\tDescrizione Articolo   \tDescr. Secondaria\tCodice   Commessa\tCod Mag\tCau Mov\t         Quantità\tUM\tValore Totale\tData Movimento\tC F\tCodice Sogg.\tRagione Sociale\tTipo Doc.\tEs. Doc.\tSez Doc\tNumero Doc.\tCod Op.\t                Lotto/Matricola\t    Dep\t    Zon\t    Cor\t    Cam\t    Pos\tEser Boll\tNumero Bolla\tData Documento\tEse  Boll\tSz Bo\tTp  Bol\tNr.Bolla Consegna\tCentro di Costo\tTime\tPrezzo Unitario';
const mrow = (eser, num, cod, mag, cau, q, data, tipo, anno, ndoc, ora, prezzo, sogg) =>
  [eser, num, cod, '', 'descr', '', '', mag, cau, q, 'nr', '', data, ' ', '', sogg || '', tipo || '', anno || '', tipo || '', ndoc || '', 'ENI', '', 'STD', '', '', '', '', '', '', '', '', '', '', '', '', ora, prezzo || ''].join(TAB);
const mov = ['\t', '', 'CABLOTEC S.R.L.\tStampa movimenti di magazzino\t10:39:55\t20/11/2026\t', movHead,
  mrow('2026', '61542', 'A1', '01', 'UT1', '3,000-', '20/11/2026', 'OP', '2026', '2066', '11:00:00'),
  mrow('2026', '61543', 'A1', 'WIP', 'ET1', '3,000', '20/11/2026', 'OP', '2026', '2066', '11:00:01'),
  mrow('2026', '61610', 'A1', 'WIP', 'UP1', '2,000-', '20/11/2026', 'OP', '2026', '2066', '11:30:00'),
  mrow('2026', '4645', 'A1', '01 ', 'EA1', '80,000', '20/11/2026', 'OF', '2026', '772', '13:09:32', '1,82100 ', 'COMET SPA'),
  mrow('2026', '4600', 'A1', '01', 'EA1', '5,000', '20/11/2026', 'OF', '2026', '772', '9:00:00'),   // prima della fotografia
].join('\r\n');
sez('Stampa movimenti');
let M;
{
  const m = A.leggiMovimentiAlnus(mov);
  M = m.righe;
  t('5 movimenti', M.length === 5 && !m.scartate.length);
  t('segno e magazzino ripulito', M[0].qta === -3 && M[3].magazzino === '01');
  t('data con ora', M[3].data === '2026-11-20T13:09:32');
  t('documento OF con anno e numero', M[3].tipo_doc === 'OF' && M[3].anno_doc === 2026 && M[3].numero_doc === '772');
  t('prezzo e fornitore', M[3].prezzo === 1.821 && M[3].soggetto === 'COMET SPA');
}

sez('Giacenza = apertura + movimenti dopo la fotografia');
{
  const g = A.leggiGiacenzeAlnus(giac);
  const per = A.giacenzaAlnus(g.righe, M, g.preso_il);
  const a1 = per.get('A1');
  t('il movimento delle 9:00 e gia nella fotografia', a1.totale === 24 - 3 + 3 - 2 + 80);
  t('per magazzino: WIP 8+3-2', a1.perMag.WIP === 9);
  t('01: -3 +80', a1.perMag['01'] === 77);
  t('contata solo su 01 e WIP', A.giacenzaContata(a1, new Set(['01', 'WIP'])) === 86);
  t('negativa contata come zero', A.giacenzaContata(per.get('NEG'), null) === 0);
  const fino = A.giacenzaAlnus(g.righe, M, g.preso_il, '2026-11-20T12:00:00');
  t('fino a un\'ora: il carico delle 13 non c\'e', fino.get('A1').totale === 22);
}

sez('OF aperti dall\'estrazione');
const ofM = [
  [null, 'Eser ', 'Sz Ac ', 'Nr.Ord. Acquis. ', 'Nr. Riga ', 'Codice Articolo ', 'Data Cons. Confermata ', 'UM Or ', 'Quantita in UM ordine ', 'Quantit� Residua ', 'Descrizione Articolo ', 'Nomignolo ', 'Prezzo Netto Riga ', 'Articolo Cli/For ', 'UM In ', 'Quantita in UM interna ', 'Anno ODL ', 'Nr. ODL '],
  ['X', 2026, 'OF', 772, 10, 'A1', new Date(2026, 10, 25), 'nr', 100, 100, 'FASTON', 'COMET SPA', 1.82, 'RTT1', 'nr', 100, null, null],
  ['X', 2026, 'OF', 772, 20, 'A1', new Date(2026, 11, 10), 'nr', 50, 40, 'FASTON', 'COMET SPA', 1.82, 'RTT1', 'nr', 50, null, null],
  ['X', 2026, 'OF', 175, 50, 'A1', new Date(2026, 2, 3), 'nr', 2, 2, 'FASTON', 'BOTTURI', null, null, 'nr', 2, null, null],
  ['X', 2026, 'OF', 900, 10, 'FILO', new Date(2027, 0, 5), 'rot', 2, 1, 'FILO', 'FABBI', null, null, 'mt', 200, null, null],
  ['X', 2026, 'OL', 901, 10, 'K_1', 46000, 'nr', 3, 3, 'LAV', 'TECNOCAB', 2, null, 'nr', 3, 2026, 2248],
  [], [null, null],
];
{
  const o = A.leggiOfAlnus(ofM);
  t('5 righe, vuote ignorate', o.righe.length === 5 && !o.scartate.length);
  t('residua con l\'accento rotto', o.righe[1].qta_residua === 40);
  t('consegna dalla data', o.righe[0].consegna === '2026-11-25');
  t('consegna da numero Excel', /^\d{4}-\d{2}-\d{2}$/.test(o.righe[4].consegna));
  t('UM ordine diversa: residua in UM interna (1 rotolo = 100 mt)', o.righe[3].qta_residua === 100 && o.righe[3].um === 'mt');
  t('ODL', o.righe[4].odl === '2026/2248' && o.righe[4].sezionale === 'OL');
  t('un altro file: errore', !!A.leggiOfAlnus([['a', 'b']]).errore);
  const ev = A.leggiOfAlnus([ofM[0], ['X', 2026, 'OF', 950, 10, 'Z9', new Date(2026, 9, 1), 'nr', 4, null, 'EVASA', 'COMET SPA', 1, null, 'nr', 4, null, null]]);
  t('riga evasa con residua vuota: entra con residuo zero', ev.righe.length === 1 && ev.righe[0].qta_residua === 0 && ev.righe[0].qta_ordinata === 4 && !ev.scartate.length);
  const ap = A.ofAlnusAperti(o.righe, M, '2026-11-20T10:33:11', '2026-11-20');
  const a1 = ap.get('A1');
  t('80 arrivati sull\'OF 772 dopo la fotografia: 100+40−80 = 60, piu i 2 di Botturi', a1.aperto === 62);
  t('il carico delle 9:00 (prima della foto) non toglie niente in piu', a1.righe.find(r => r.numero === 772 && r.riga === 10).aperto === 20);
  t('l\'OF di marzo e scaduto', a1.scaduto === 2);
  t('arrivi in ordine di consegna: la riga 20 resta intera', a1.righe.find(r => r.riga === 20).aperto === 40);
}

sez('Confronto da ordinare');
{
  const g = A.leggiGiacenzeAlnus(giac);
  const giacenza = A.giacenzaAlnus(g.righe, M, g.preso_il);
  const ofA = A.ofAlnusAperti(A.leggiOfAlnus(ofM).righe, M, g.preso_il, '2026-11-20');
  const r = A.confrontoDaOrdinare({
    fabbisogno: new Map([['A1', 300], ['FILO', 100], ['CL1', 50], ['NUOVO', 10]]),
    tipi: new Map([['CL1', 'C/L']]),
    giacenza, ofAlnus: ofA, ofNostri: new Map([['A1', 20]]),
    daOrdinareAlnus: new Map([['A1', 118], ['SOLO-ALNUS', 7]]), magazzini: null });
  const di = (c) => r.find(x => x.codice === c);
  t('A1: 300 − 102 − 62 − 20 = 116', di('A1').nostro === 116 && di('A1').differenza === -2);
  t('FILO coperto', di('FILO').nostro === 0);
  t('C/L non entra', !di('CL1'));
  t('codice nuovo senza giacenza', di('NUOVO').nostro === 10 && di('NUOVO').alnus === 0);
  t('codice solo di Alnus', di('SOLO-ALNUS').nostro === 0 && di('SOLO-ALNUS').alnus === 7);
  const s = A.confrontoDaOrdinare({ fabbisogno: new Map([['A1', 300]]), giacenza, ofAlnus: ofA, contaScaduti: false });
  t('senza scaduti: 2 in piu', s[0].nostro === 300 - 102 - 60);
}

sez('Controllo delle giacenze');
{
  const calc = A.giacenzaAlnus([{ codice: 'A', magazzino: '01', qta: 10 }, { codice: 'B', magazzino: '01', qta: 5 }], [], '2026-11-20T10:00:00');
  const d = A.controlloGiacenze(calc, [{ codice: 'A', magazzino: '01', qta: 6 }, { codice: 'A', magazzino: 'WIP', qta: 4 }, { codice: 'C', magazzino: '01', qta: 1 }]);
  t('A torna sommando i magazzini', !d.some(x => x.codice === 'A'));
  t('B sparito dalla stampa e C nuovo', d.length === 2 && d.some(x => x.codice === 'B' && x.differenza === 5) && d.some(x => x.codice === 'C' && x.differenza === -1));
}

sez('I magazzini (Nico, 20 nov): 02 dentro lo 01, 05 eliminato, SPK a parte');
{
  t('02 diventa 01', A.magazzinoAlnus('02') === '01' && A.magazzinoAlnus(' 01 ') === '01');
  t('05 non esiste', A.magazzinoAlnus('05') === null);
  t('SPK e WIP restano', A.magazzinoAlnus('SPK') === 'SPK' && A.magazzinoAlnus('wip') === 'WIP');
  t('di serie contano 01 e WIP', A.MAGAZZINI_CONTATI_DI_SERIE.join() === '01,WIP');
  const g = A.giacenzaAlnus([{ codice: 'X', magazzino: '01', qta: 10 }, { codice: 'X', magazzino: '02', qta: 5 },
    { codice: 'X', magazzino: '05', qta: 150 }, { codice: 'X', magazzino: 'SPK', qta: 16 }, { codice: 'X', magazzino: 'WIP', qta: 2 }],
    [{ data: '2026-11-21T08:00:00', codice: 'X', magazzino: '02', qta: 1 }, { data: '2026-11-21T08:00:00', codice: 'X', magazzino: '05', qta: -3 }], '2026-11-20T10:00:00');
  const x = g.get('X');
  t('01 = 10 + 5 dello 02 + 1 movimento', x.perMag['01'] === 16 && !('02' in x.perMag) && !('05' in x.perMag));
  t('contata 01 + WIP = 18, SPK fuori', A.giacenzaContata(x, new Set(A.MAGAZZINI_CONTATI_DI_SERIE)) === 18);
  const d = A.controlloGiacenze(g, [{ codice: 'X', magazzino: '01', qta: 16 }, { codice: 'X', magazzino: '05', qta: 999 }, { codice: 'X', magazzino: 'SPK', qta: 16 }, { codice: 'X', magazzino: 'WIP', qta: 2 }]);
  t('il controllo ignora lo 05', d.length === 0);
}

sez('Il fabbisogno fatto dal gestionale (stessa forma di mancanti)');
{
  const c1 = { id: 'c1', numero_op: '2026/OP/01917' }, c2 = { id: 'c2', numero_op: '2026/OP/01918' };
  const fabbisogno = new Map([['A1', [{ commessa: c1, qta: 200 }, { commessa: c2, qta: 100 }]], ['CL1', [{ commessa: c2, qta: 5 }]]]);
  const giacenza = A.giacenzaAlnus([{ codice: 'A1', magazzino: '01', qta: 120 }, { codice: 'A1', magazzino: 'WIP', qta: 30 }, { codice: 'SOLO-OF', magazzino: '01', qta: 0 }], [], '2026-11-20T10:00:00');
  const ofAlnus = A.ofAlnusAperti([
    { anno: 2026, sezionale: 'OF', numero: 772, riga: 10, codice: 'A1', fornitore: 'COMET', qta_residua: 100, consegna: '2026-12-01' },
    { anno: 2026, sezionale: 'OF', numero: 175, riga: 10, codice: 'A1', fornitore: 'BOTTURI', qta_residua: 5, consegna: '2026-03-01' },
    { anno: 2026, sezionale: 'OF', numero: 800, riga: 10, codice: 'SOLO-OF', fornitore: 'FABBI', qta_residua: 9, consegna: null }], [], '2026-11-20T10:00:00', '2026-11-20');
  const r = A.righeFabbisognoSpecchio({ fabbisogno, giacenza, ofAlnus, magazzini: null,
    ofNostri: [{ codice: 'A1', aperto: 20, consegna: '2026-11-28', ordine: 'OFS 3/2026', fornitore: 'FABBI SRL' }],
    tipi: new Map([['A1', 'acq'], ['CL1', 'C/L']]), descr: new Map([['A1', 'Faston']]), um: new Map([['A1', 'nr']]) });
  const di = (c) => r.find(x => x.codice === c);
  const a = di('A1');
  t('impegno = somma delle liste', a.impegno === 300);
  t('giacenza con WIP', a.giacenza === 150);
  t('richiesta = 300 − 150', a.qta_richiesta === 150);
  t('da ordinare = 150 − (100 + 5 + 20)', a.qta_da_ordinare === 25);
  t('consegne in ordine di data, nostro OF compreso', a.consegne.map(x => x.ordine).join(',') === 'OF 175/2026,OFS 3/2026,OF 772/2026');
  t('prima consegna e fornitore', a.prima_consegna === '2026-03-01' && a.fornitore === 'BOTTURI');
  t('OP della commessa servita per prima', a.numero_op === '2026/OP/01917');
  t('tipo maiuscolo, descrizione, um, fonte', a.tipo_parte === 'ACQ' && a.descrizione === 'Faston' && a.um === 'nr' && a.fonte === 'specchio');
  t('C/L presente col suo tipo', di('CL1').tipo_parte === 'C/L' && di('CL1').qta_da_ordinare === 5);
  t('codice solo in OF: entra, niente da ordinare, consegna senza data esclusa dall\'elenco', di('SOLO-OF') && di('SOLO-OF').qta_da_ordinare === 0 && di('SOLO-OF').consegne.length === 0 && di('SOLO-OF').in_arrivo === 9);
  const s = A.righeFabbisognoSpecchio({ fabbisogno, giacenza, ofAlnus, contaScaduti: false });
  t('senza scaduti: l\'OF di marzo non conta', s.find(x => x.codice === 'A1').qta_da_ordinare === 50);
}

sez('Giacenza del gestionale (foto Alnus + nostri fatti)');
{
  const FOTO = '2026-11-20T10:33:11';
  const MAG = new Set(['01', 'WIP']);
  const apertura = [{ codice: '05 095 0146', magazzino: '01', qta: 130 }, { codice: 'A1', magazzino: 'WIP', qta: 10 },
    { codice: 'A1', magazzino: 'SPK', qta: 99 }, { codice: 'CL', magazzino: '02', qta: 50 }];
  const movimenti = [
    { codice: 'A1', tipo: 'carico', qta: 100, fuori_giacenza: true, creato_il: '2026-11-21T08:00:00' },
    { codice: 'A1', tipo: 'carico', qta: 7, creato_il: '2026-11-19T08:00:00' },
    { codice: 'TS-1', tipo: 'carico', qta: 40, creato_il: '2026-10-01T08:00:00' },
    { codice: 'TS-1', tipo: 'scarico', qta: -12, creato_il: '2026-11-21T09:00:00' },
    { codice: 'TS-1', tipo: 'trasferimento', qta: -5, fuori_giacenza: true, creato_il: '2026-11-21T09:00:00' },
    { codice: 'A1', tipo: 'rettifica', qta: -3, creato_il: '2026-11-22T09:00:00' } ];
  const commesse = new Map([
    ['c1', { materiali: [{ codice: 'A1', qta_pz: 2, tipo: 'ACQ' }, { codice: 'M', qta_pz: 1, tipo: 'MAC' }, { codice: 'cl', qta_pz: 1, tipo: 'C/L' }] }],
    ['c2', { materiali_da_ddt: true, materiali: [{ codice: 'TS-1', qta_pz: 3, tipo: 'C/L' }, { codice: '05 095 0146', qta_pz: 1, tipo: 'ACQ' }] }],
    ['c3', { materiali: [] }] ]);
  const lotti = [
    { operazione_id: 'c1', quantita: 5, creato_il: '2026-11-21T10:00:00' },
    { operazione_id: 'c1', quantita: 50, creato_il: '2026-11-20T09:00:00' },
    { operazione_id: 'c2', quantita: 4, creato_il: '2026-11-21T10:00:00' },
    { operazione_id: 'c3', quantita: 1, creato_il: '2026-11-21T10:00:00' } ];
  const r = A.giacenzaGestionale({ apertura, aperturaIl: FOTO, magazzini: MAG, movimenti, lotti, commesse });
  const g = c => r.per.get(c);
  t('solo in foto: 130 − 4 del lotto (ACQ di commessa da DDT)', g('05 095 0146').totale === 126);
  t('A1: 10 (SPK fuori) + 100 DDT fornitore dopo − 10 consumo − 3 rettifica; carico di prima no', g('A1').totale === 97 && g('A1').carichi === 100);
  t('C/L di commessa normale scaricato (02 dentro 01)', g('CL').totale === 45);
  t('MAC non scaricato', !g('M'));
  t('TS-1: 40 di prima − 12 del trigger, il C/L da DDT non si riscarica', g('TS-1').totale === 28 && g('TS-1').consumi === 0);
  t('lotto prima della foto ignorato, lotto senza lista dichiarato', g('A1').consumi === -10 && r.lottiSenzaLista.length === 1);
  const al = A.giacenzaAlnus(apertura, [], FOTO);
  const conf = A.confrontoGiacenze(r.per, al, MAG);
  const di = c => conf.find(x => x.codice === c);
  t('confronto: differenza = gestionale − Alnus', di('05 095 0146').qAlnus === 130 && di('05 095 0146').differenza === -4);
  t('confronto: codice solo nel gestionale, segnato', di('TS-1').qAlnus === 0 && di('TS-1').differenza === 28 && di('TS-1').soloGestionale && !di('A1').soloGestionale);
  const lov = A.giacenzaGestionale({ apertura: [{ codice: 'L', magazzino: 'WIP', qta: 53 }], aperturaIl: '2026-11-20T09:33:11+00:00', magazzini: MAG,
    movimenti: [{ codice: 'L', tipo: 'carico', qta: 50, fuori_giacenza: true, data: '2026-11-18', creato_il: '2026-11-20T15:06:15+00:00' }] });
  t('DDT del 18 registrato il 20 dopo la foto: conta (vale creato_il, non la data del DDT)', lov.per.get('L').totale === 103);
  const neg = A.giacenzaGestionale({ apertura: [{ codice: 'N', magazzino: '01', qta: -340 }], aperturaIl: FOTO, magazzini: MAG });
  t('negativo in Alnus: confronto alla pari, non portato a zero', A.confrontoGiacenze(neg.per, A.giacenzaAlnus([{ codice: 'N', magazzino: '01', qta: -340 }], [], FOTO), MAG)[0].differenza === 0);
  const zero = A.giacenzaGestionale({ apertura, aperturaIl: FOTO, magazzini: MAG, movimenti: [], lotti: [], commesse });
  t('senza fatti dopo la foto: identica ad Alnus', A.confrontoGiacenze(zero.per, al, MAG).every(x => x.differenza === 0));
}

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);

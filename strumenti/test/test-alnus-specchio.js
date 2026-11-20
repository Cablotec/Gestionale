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

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);

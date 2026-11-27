// Test degli OF D'ACQUISTO APERTI — 20 nov 2026 (OF massivi).
// Il «da ordinare» di Alnus non sa degli OF fatti nel gestionale: si toglie
// quanto e' negli OF emessi e non ancora arrivato.
// Uso: node strumenti/test/test-of-aperti.js [cartella del gestionale]
const G = process.argv[2] || '.';
const M = require(require('path').resolve(G, 'domain/materiali.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('Il numero d\'ordine scritto sul DDT');
t('OFS 3/2026 (vecchio testo) vale come OF', M.chiaveOfDaRif('OFS 3/2026') === 'OF 2026/3');
t('of 12 / 2026 (minuscole, spazi): serie OF, Alnus', M.chiaveOfDaRif('of 12 / 2026') === 'OF 2026/12');
t('OL 901/2026', M.chiaveOfDaRif('OL 901/2026') === 'OL 2026/901');
t('OF n. 7/2026', M.chiaveOfDaRif('OF n. 7/2026') === 'OF 2026/7');
t('ordine cliente 4700000482: niente', M.chiaveOfDaRif('4700000482') === null);
t('2026/OC/00392: niente', M.chiaveOfDaRif('2026/OC/00392') === null);
t('vuoto: niente', M.chiaveOfDaRif(null) === null);

const ordini = [
  { id: 'a', tipo: 'acquisto', stato: 'emesso', anno: 2026, numero: 3,
    righe: [{ codice: 'fast-1', qta: 100 }, { codice: 'CAVO', qta: 50 }, { codice: 'FAST-1', qta: 20 }] },
  { id: 'b', tipo: 'acquisto', stato: 'emesso', anno: 2026, numero: 5, righe: [{ codice: 'CAVO', qta: 30 }] },
  { id: 'c', tipo: 'acquisto', stato: 'annullato', anno: 2026, numero: 4, righe: [{ codice: 'CAVO', qta: 999 }] },
  { id: 'd', tipo: 'terzista', stato: 'emesso', anno: 2026, numero: 6, righe: [{ operazione_id: 'x', pezzi: 10 }] },
];
const mov = [
  { tipo: 'carico', codice: 'CAVO', qta: 20, ordine_rif: 'OFS 3/2026' },
  { tipo: 'carico', codice: 'CAVO', qta: 40, ordine_rif: 'OFS 5/2026' },   // oltre l'ordinato
  { tipo: 'carico', codice: 'FAST-1', qta: 10, ordine_rif: 'OFS 5/2026' }, // codice non in quell'ordine
  { tipo: 'scarico', codice: 'FAST-1', qta: 5, ordine_rif: 'OFS 3/2026' },
  { tipo: 'carico', codice: 'FAST-1', qta: 7, ordine_rif: '4700000482' },
];

sez('Aperto = emesso − arrivato, per ordine e codice');
{
  const a = M.ordinatoApertoOf(ordini, mov);
  t('FAST-1: due righe dello stesso ordine sommate, maiuscole', a.get('FAST-1') && a.get('FAST-1').aperto === 120);
  t('FAST-1: un DDT di un altro ordine o di un cliente non conta', a.get('FAST-1').ordini[0].arrivato === 0);
  t('CAVO: 50−20 sul 3 + 0 sul 5 (arrivato oltre) = 30', a.get('CAVO') && a.get('CAVO').aperto === 30);
  t('CAVO: due ordini elencati', a.get('CAVO').ordini.length === 2);
  t('annullati e terzisti non contano', a.size === 2);
}

sez('Movimenti non letti: si toglie l\'ordine intero');
{
  const a = M.ordinatoApertoOf(ordini, null);
  t('CAVO 80', a.get('CAVO').aperto === 80);
}

sez('L\'ordine che si sta modificando non toglie se stesso');
{
  const a = M.ordinatoApertoOf(ordini, mov, 'a');
  t('FAST-1 sparisce', !a.has('FAST-1'));
  t('CAVO resta solo il 5, tutto arrivato', a.get('CAVO').aperto === 0);
}

sez('Serie: un OF di Alnus col suo numero, sincronizzato');
{
  const ord = [
    { id: 'n', tipo: 'acquisto', stato: 'emesso', serie: 'OL', anno: 2026, numero: 3, righe: [{ codice: 'A', qta: 10 }] },
    { id: 'a', tipo: 'acquisto', stato: 'emesso', serie: 'OF', origine: 'alnus', anno: 2026, numero: 3, sincronizzato_il: '2026-11-20T10:00:00',
      righe: [{ codice: 'A', qta: 150, qta_residua: 100, consegna: '2026-12-05' }, { codice: 'A', qta: 50, qta_residua: 50, consegna: '2026-12-01' }] },
    { id: 'c', tipo: 'acquisto', stato: 'chiuso', serie: 'OF', anno: 2026, numero: 4, righe: [{ codice: 'A', qta: 999 }] },
  ];
  const mv = [
    { tipo: 'carico', codice: 'A', qta: 30, ordine_rif: 'OF 3/2026', data: '2026-11-21T09:00:00' },   // dopo: conta
    { tipo: 'carico', codice: 'A', qta: 40, ordine_rif: 'OF 3/2026', data: '2026-11-19T09:00:00' },   // prima: gia nel residuo
    { tipo: 'carico', codice: 'A', qta: 4, ordine_rif: 'OL 3/2026', data: '2026-11-21' },
  ];
  const a = M.ordinatoApertoOf(ord, mv).get('A');
  const di = (id) => a.ordini.find(x => x.id === id);
  t('OL 3 e OF 3 non si confondono', di('n').arrivato === 4 && di('n').aperto === 6);
  t('OF di Alnus: residuo 150 meno i 30 arrivati dopo la sincronizzazione', di('a').ordinato === 150 && di('a').aperto === 120);
  t('consegna = la prima delle righe', di('a').consegna === '2026-12-01');
  t('serie e origine riportate', di('a').serie === 'OF' && di('a').origine === 'alnus' && di('n').serie === 'OL');
  t('chiuso non conta', a.ordini.length === 2 && a.aperto === 126);
}
{
  // 25 nov: un nostro DDT con la data del giorno della sincronizzazione, registrato DOPO.
  const ord = [{ id: 'c', tipo: 'acquisto', stato: 'emesso', serie: 'OF', anno: 2026, numero: 730, origine: 'alnus',
    sincronizzato_il: '2026-11-23T11:04:29Z', righe: [{ codice: 'X', qta: 400, qta_residua: 400 }] }];
  const dopo = { tipo: 'carico', codice: 'X', qta: 100, ordine_rif: 'OF 730/2026', data: '2026-11-23', creato_il: '2026-11-23T15:01:38Z' };
  const prima = { tipo: 'carico', codice: 'X', qta: 100, ordine_rif: 'OF 730/2026', data: '2026-11-23', creato_il: '2026-11-23T09:00:00Z' };
  t('DDT dello stesso giorno registrato dopo la sincronizzazione: scala', M.ordinatoApertoOf(ord, [dopo]).get('X').aperto === 300);
  t('DDT registrato prima della sincronizzazione: gia nel residuo', M.ordinatoApertoOf(ord, [prima]).get('X').aperto === 400);
}

sez('27 nov: gli OF di Alnus li chiudiamo noi (partenza al punto zero, scalano i nostri DDT)');
{
  const ap = { documento_tipo: 'APERTURA', tipo: 'carico', codice: 'Z', qta: 1, creato_il: '2026-11-23T11:04:35Z' };
  const of = (extra) => Object.assign({ id: 'o', tipo: 'acquisto', stato: 'emesso', serie: 'OF', anno: 2026, numero: 839, origine: 'alnus',
    data: '2026-11-10', sincronizzato_il: '2026-11-27T09:57:45Z', righe: [{ riga: 10, codice: 'FR515', qta: 10, qta_residua: 0 }] }, extra || {});
  const ea1 = { documento_tipo: 'ALNUS', tipo: 'carico', codice: 'FR515', qta: 10, note: 'Alnus · EA1 · mag 01 · OF 2026/839 · ESA', creato_il: '2026-11-26T12:22:28Z' };
  const ddt = { documento_tipo: 'DDT', tipo: 'carico', codice: 'FR515', qta: 10, ordine_rif: 'OF 839/2026', creato_il: '2026-11-27T10:30:00Z' };
  const a0 = (ords, mv) => { const x = M.ordinatoApertoOf(ords, mv).get('FR515'); return x ? x.aperto : 0; };
  t('evaso in Alnus (EA1 dopo lo zero), nessun nostro DDT: da noi ancora aperto 10', a0([of()], [ap, ea1]) === 10);
  t('col nostro DDT registrato DOPO l\'import degli OF: chiuso', a0([of()], [ap, ea1, ddt]) === 0);
  const ddtPrima = Object.assign({}, ddt, { creato_il: '2026-11-26T15:00:00Z' });
  t('col nostro DDT registrato PRIMA dell\'import degli OF: chiuso lo stesso (conta il punto zero)', a0([of()], [ap, ea1, ddtPrima]) === 0);
  const ddtVecchio = Object.assign({}, ddt, { creato_il: '2026-11-20T10:00:00Z' });
  t('un nostro DDT di prima del punto zero non scala (e\' gia\' nel residuo)', a0([of({ righe: [{ codice: 'FR515', qta: 10, qta_residua: 10 }] })], [ap, ddtVecchio]) === 10);
  const eaPrima = Object.assign({}, ea1, { creato_il: '2026-11-20T10:00:00Z' });
  t('un EA1 di prima del punto zero non rida\' niente (residuo 0 = era gia\' evaso)', a0([of()], [ap, eaPrima]) === 0);
  t('OF nato dopo il punto zero: parte intero anche se Alnus l\'ha gia\' evaso', a0([of({ data: '2026-11-24' })], [ap]) === 10);
  t('mai oltre l\'ordinato: due EA1 da 10 su una riga da 10', a0([of()], [ap, ea1, Object.assign({}, ea1, { creato_il: '2026-11-26T13:00:00Z' })]) === 10);
  t('l\'EA1 di un altro OF non conta', a0([of()], [ap, Object.assign({}, ea1, { note: 'Alnus · EA1 · mag 01 · OF 2026/840 · ESA' })]) === 0);
  t('OL: la serie conta', M.chiaveOfDaNotaAlnus('Alnus · EA1 · mag 01 · OL 2026/24 · ERO') === 'OL 2026/24');
  t('chiuso a mano (saldo): non conta piu\'', a0([of({ stato: 'chiuso' })], [ap, ea1]) === 0);
  t('senza punto zero: la regola di prima (residuo 0 = niente)', a0([of()], [ea1]) === 0);
  // Due righe dello stesso codice: gli EA1 tornano alle righe evase, i nostri DDT scalano nell'ordine.
  const due = of({ righe: [{ riga: 10, codice: 'FR515', qta: 6, qta_residua: 0 }, { riga: 20, codice: 'FR515', qta: 4, qta_residua: 4 }] });
  const idx = M.indiceArriviOf([ap, Object.assign({}, ea1, { qta: 6 }), Object.assign({}, ddt, { qta: 7 })]);
  const r = M.righeApertoOf(due, idx).righe;
  t('righe: partenza 6 + 4', r[0].partenza === 6 && r[1].partenza === 4);
  t('righe: il nostro DDT da 7 chiude la prima e lascia 3 sulla seconda', r[0].aperto === 0 && r[1].aperto === 3);
  t('righe: il residuo di Alnus resta per il paragone', r[0].residuoAlnus === 0 && r[1].residuoAlnus === 4);
  // Collaudo: residuo di Alnus contro il nostro aperto.
  const ord3 = [of(), of({ id: 'p', numero: 627, sincronizzato_il: '2026-11-27T09:44:00Z', righe: [{ codice: 'GUIDA', qta: 100, qta_residua: 100 }] }),
    of({ id: 'q', numero: 900, righe: [{ codice: 'X', qta: 5, qta_residua: 5 }] }), of({ id: 's', numero: 901, stato: 'chiuso', righe: [{ codice: 'Y', qta: 5, qta_residua: 5 }] })];
  const col = M.collaudoOf(ord3, [ap, ea1]);
  const per = (n) => col.filter(x => x.of.numero === n).map(x => x.perche).join(',');
  t('collaudo: 839 evaso in Alnus senza il nostro DDT = manca_ddt', per(839) === 'manca_ddt');
  t('collaudo: 627 non nell\'ultima estrazione e aperto da noi = assente', per(627) === 'assente');
  t('collaudo: 900 uguale nei due = niente', per(900) === '');
  t('collaudo: 901 chiuso a mano qui, aperto in Alnus = chiuso_a_mano', per(901) === 'chiuso_a_mano');
  t('collaudo: col nostro DDT l\'839 torna', M.collaudoOf([of()], [ap, ea1, ddt]).length === 0);
  t('collaudo: senza punto zero non si fa', M.collaudoOf([of()], [ea1]) === null);
  t('punto zero = ultima apertura',M.puntoZeroMovimenti([ap, { documento_tipo: 'APERTURA', creato_il: '2026-11-20T09:33:11Z' }]) === Date.parse('2026-11-23T11:04:35Z'));
}

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);

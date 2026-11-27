// Test delle VARIANTI della lista di una commessa — 24 nov 2026 (Teknox OP 2135:
// la distinta dell'ordine cambia rispetto a quella del prodotto).
// Uso: node strumenti/test/test-varianti-lista.js [cartella del gestionale]
const G = process.argv[2] || '.';
const M = require(require('path').resolve(G, 'domain/materiali.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

const base = [
  { codice: 'CK03VS', descrizione: 'custodia', um: 'nr', tipo: 'ACQ', qta_pz: 8, qta: 400, fasi_esterne: null },
  { codice: 'CKF03', descrizione: 'frutto', um: 'nr', tipo: 'ACQ', qta_pz: 2, qta: 100, fasi_esterne: { T1: 1 } },
  { codice: 'CAVO', descrizione: 'cavo', um: 'mt', tipo: 'ACQ', qta_pz: 10.2, qta: 510 },
  { codice: 'FUSIBILE', descrizione: 'fusibile', um: 'nr', tipo: 'ACQ', qta_pz: 1, qta: 50 },
];
const voluta = [
  { codice: 'CK03VS', qta_pz: 4 },
  { codice: 'CKSF03', descrizione: 'frutto molla', um: 'nr', tipo: 'ACQ', qta_pz: 2, fasi_esterne: { T1: 1 } },
  { codice: 'FUSIBILE', qta_pz: 1 },
  { codice: 'KIT_KF', descrizione: 'kit fili', um: 'nr', tipo: 'ACQ', qta_pz: 1 },
];

sez('Dal confronto alle varianti');
const meta = { motivo: 'OP 2135 di Alnus', il: '2026-11-24', chi: 'nico' };
const V = M.variantiDaConfronto(base, voluta, [{ da: 'ckf03', a: 'CKSF03' }], [], meta);
const di = (tipo, c) => V.find(v => v.tipo === tipo && v.codice === c);
t('quattro varianti', V.length === 4);
t('quantita dimezzata, per pezzo', di('quantita', 'CK03VS') && di('quantita', 'CK03VS').qta_pz === 4);
t('sostituzione dichiarata, quantita uguale = null', di('sostituito', 'CKF03') && di('sostituito', 'CKF03').nuovo === 'CKSF03' && di('sostituito', 'CKF03').qta_pz === null);
t('cavo tolto', !!di('tolto', 'CAVO'));
t('kit aggiunto con descrizione', di('aggiunto', 'KIT_KF') && di('aggiunto', 'KIT_KF').descrizione === 'kit fili');
t('fusibile invariato: nessuna variante', !V.some(v => v.codice === 'FUSIBILE'));
t('motivo, data e autore sulle nuove', V.every(v => v.motivo === 'OP 2135 di Alnus' && v.chi === 'nico'));
{
  const V2 = M.variantiDaConfronto(base, voluta, [], [], meta);
  t('senza sostituzione dichiarata: tolto + aggiunto', !!V2.find(v => v.tipo === 'tolto' && v.codice === 'CKF03') && !!V2.find(v => v.tipo === 'aggiunto' && v.codice === 'CKSF03'));
}
{
  const vecchie = [Object.assign({}, di('tolto', 'CAVO'), { motivo: 'kit da Elcotec', il: '2026-11-20', chi: 'claudio' })];
  const V3 = M.variantiDaConfronto(base, voluta, [{ da: 'CKF03', a: 'CKSF03' }], vecchie, { motivo: 'altro', il: '2026-11-25', chi: 'nico' });
  const c = V3.find(v => v.tipo === 'tolto' && v.codice === 'CAVO');
  t('una variante che non cambia tiene motivo, data e autore', c.motivo === 'kit da Elcotec' && c.chi === 'claudio' && c.il === '2026-11-20');
}

sez('Riapplicate alla distinta (rigenera)');
{
  const { righe, saltate } = M.applicaVarianti(base, V, 50);
  const r = (c) => righe.find(x => x.codice === c);
  t('nessuna saltata', saltate.length === 0);
  t('stessa lista voluta: 4 righe', righe.length === 4);
  t('CK03VS 4/pz × 50 = 200, ricorda la distinta', r('CK03VS').qta === 200 && r('CK03VS').qta_pz_distinta === 8 && r('CK03VS').variante === 'quantita');
  t('CKSF03 al posto di CKF03, terzisti tenuti', r('CKSF03').al_posto_di === 'CKF03' && r('CKSF03').qta === 100 && r('CKSF03').fasi_esterne.T1 === 1);
  t('cavo tolto', !r('CAVO'));
  t('kit aggiunto 50', r('KIT_KF').qta === 50 && r('KIT_KF').variante === 'aggiunto' && r('KIT_KF').tipo === 'ACQ');
  t('la base non viene toccata', base[0].qta === 400 && base.length === 4);
}
{
  const { righe } = M.applicaVarianti(base, V, 20);
  t('con 20 pezzi le varianti scalano (CK03VS 80, kit 20)', righe.find(x => x.codice === 'CK03VS').qta === 80 && righe.find(x => x.codice === 'KIT_KF').qta === 20);
}
{
  const nuovaBase = base.filter(r => r.codice !== 'CAVO');
  const { righe, saltate } = M.applicaVarianti(nuovaBase, V, 50);
  t('distinta cambiata: il tolto senza codice e\' saltato e detto', saltate.length === 1 && saltate[0].codice === 'CAVO' && righe.length === 4);
}
{
  const conKit = base.concat([{ codice: 'KIT_KF', qta_pz: 3, qta: 150 }]);
  const { righe } = M.applicaVarianti(conKit, V, 50);
  t('aggiunto che ora e\' in distinta: vale la quantita della variante', righe.filter(x => x.codice === 'KIT_KF').length === 1 && righe.find(x => x.codice === 'KIT_KF').qta === 50);
}
t('senza varianti la lista e\' la distinta', M.applicaVarianti(base, null, 50).righe.length === 4);

sez('Modifiche dalla fase (terzista o reparto)');
{
  // Riga: 8/pz, di cui 6 a Bellini (B) e 2 in reparto.
  const lista = [{ codice: 'K', qta_pz: 8, qta: 400, fasi_esterne: { B: 6 } }, { codice: 'Z', qta_pz: 1, qta: 50, fasi_esterne: null }];
  const BEL = { id: 'B', reparto: false }, REP = { id: 'R', reparto: true };
  t('quota di Bellini 6, del reparto 2', M.quotaInFase(lista[0], BEL) === 6 && M.quotaInFase(lista[0], REP) === 2);
  let x = M.modificaInFase(lista, BEL, [{ tipo: 'quantita', codice: 'K', qta_pz: 3 }], 50).righe;
  t('Bellini da 6 a 3: totale 5/pz, reparto resta 2', x[0].qta_pz === 5 && x[0].fasi_esterne.B === 3 && x[0].qta === 250 && M.quotaInFase(x[0], REP) === 2);
  x = M.modificaInFase(lista, REP, [{ tipo: 'quantita', codice: 'K', qta_pz: 4 }], 50).righe;
  t('reparto da 2 a 4: totale 10/pz, Bellini resta 6', x[0].qta_pz === 10 && x[0].fasi_esterne.B === 6);
  x = M.modificaInFase(lista, BEL, [{ tipo: 'tolto', codice: 'K' }], 50).righe;
  t('tolto da Bellini: resta in reparto 2/pz, nessun terzista', x[0].qta_pz === 2 && x[0].fasi_esterne === null);
  x = M.modificaInFase(lista, REP, [{ tipo: 'tolto', codice: 'Z' }], 50).righe;
  t('tolto dal reparto un codice solo suo: la riga sparisce', x.length === 1);
  x = M.modificaInFase(lista, BEL, [{ tipo: 'aggiunto', codice: 'NUOVO', qta_pz: 2, descrizione: 'n', tipo_parte: 'ACQ' }], 50).righe;
  const n = x.find(r => r.codice === 'NUOVO');
  t('aggiunto a Bellini: va a Bellini', n.qta_pz === 2 && n.fasi_esterne.B === 2 && n.qta === 100 && n.tipo === 'ACQ');
  x = M.modificaInFase(lista, REP, [{ tipo: 'aggiunto', codice: 'NUOVO', qta_pz: 2 }], 50).righe;
  t('aggiunto al reparto: nessun terzista', x.find(r => r.codice === 'NUOVO').fasi_esterne === null);
  x = M.modificaInFase(lista, BEL, [{ tipo: 'aggiunto', codice: 'Z', qta_pz: 1 }], 50).righe;
  t('aggiunto a Bellini un codice che e\' gia\' in reparto: si somma', x.find(r => r.codice === 'Z').qta_pz === 2 && x.find(r => r.codice === 'Z').fasi_esterne.B === 1);
  const s = M.modificaInFase(lista, BEL, [{ tipo: 'sostituito', codice: 'K', nuovo: 'KS' }], 50);
  const k = s.righe.find(r => r.codice === 'K'), ks = s.righe.find(r => r.codice === 'KS');
  t('sostituito solo per Bellini: K resta 2 in reparto, KS 6 a Bellini', k.qta_pz === 2 && !k.fasi_esterne && ks.qta_pz === 6 && ks.fasi_esterne.B === 6 && ks.al_posto_di === 'K');
  t('la lista di partenza non cambia', lista[0].qta_pz === 8 && lista[0].fasi_esterne.B === 6);
  // Dalla fase alle varianti e ritorno (il rigenera).
  const V = M.variantiDaConfronto(lista, s.righe, s.sostituzioni, [], {});
  t('sostituzione parziale = quantita + aggiunto (non sostituito)', V.length === 2 && V.some(v => v.tipo === 'quantita' && v.codice === 'K')
    && V.some(v => v.tipo === 'aggiunto' && v.codice === 'KS' && v.fasi_esterne.B === 6 && v.al_posto_di === 'K'));
  const g = M.applicaVarianti(lista, V, 50).righe;
  t('rigenera: stessa lista, con le destinazioni', g.find(r => r.codice === 'K').qta_pz === 2 && !g.find(r => r.codice === 'K').fasi_esterne
    && g.find(r => r.codice === 'KS').fasi_esterne.B === 6 && g.find(r => r.codice === 'KS').al_posto_di === 'K');
  const tutta = M.modificaInFase([{ codice: 'K', qta_pz: 6, fasi_esterne: { B: 6 } }], BEL, [{ tipo: 'sostituito', codice: 'K', nuovo: 'KS' }], 50);
  const V2 = M.variantiDaConfronto([{ codice: 'K', qta_pz: 6, fasi_esterne: { B: 6 } }], tutta.righe, tutta.sostituzioni, [], {});
  t('sostituito per intero: una variante «sostituito»', V2.length === 1 && V2[0].tipo === 'sostituito' && V2[0].nuovo === 'KS');
  const V3 = M.variantiDaConfronto(lista, M.modificaInFase(lista, REP, [{ tipo: 'quantita', codice: 'K', qta_pz: 0 }, { tipo: 'aggiunto', codice: 'X', qta_pz: 0 }], 50).righe, [], [], {});
  t('spostare solo la destinazione e\' una variante', M.variantiDaConfronto(lista, [{ codice: 'K', qta_pz: 8, fasi_esterne: { B: 8 } }, lista[1]], [], [], {}).length === 1 && V3.length === 1);
}

console.log('\nPortare le varianti nella distinta del prodotto (27 nov)');
{
  const dist = [{ codice: 'A', qta: 2, um: 'nr' }, { codice: 'B', qta: 1, um: 'nr' }, { codice: 'C', qta: 3, um: 'mt', tipo: 'MAC' },
    { codice: 'D', qta: 1 }, { codice: 'D', qta: 2 }, { codice: 'E', qta: 4 }];
  const v = [
    { tipo: 'tolto', codice: 'a' },
    { tipo: 'quantita', codice: 'D', qta_pz: 5 },
    { tipo: 'sostituito', codice: 'B', nuovo: 'B2', qta_pz: null, descrizione: 'B nuovo', um: 'nr', tipo_parte: 'ACQ' },
    { tipo: 'aggiunto', codice: 'F', qta_pz: 0.5, um: 'mt', descrizione: 'filo', tipo_parte: 'MAC' },
    { tipo: 'aggiunto', codice: 'E', qta_pz: 6 },
    { tipo: 'tolto', codice: 'ZZ' },
    { tipo: 'sostituito', codice: 'C', nuovo: 'E' },
    { tipo: 'tolto', codice: 'C', in_distinta: '2026-11-20' },
  ];
  const r = M.distintaConVarianti(dist, v);
  const di = (c) => r.distinta.filter(x => x.codice === c);
  t('tolto A (maiuscole indifferenti)', !di('A').length);
  t('quantita D: due righe diventano una da 5', di('D').length === 1 && di('D')[0].qta === 5);
  t('sostituito B → B2, quantita di prima, descrizione nuova', di('B2').length === 1 && di('B2')[0].qta === 1 && di('B2')[0].descrizione === 'B nuovo' && !di('B').length);
  t('aggiunto F nuovo, MAC sull\'arco', di('F').length === 1 && di('F')[0].qta === 0.5 && di('F')[0].tipo === 'MAC');
  t('aggiunto E gia\' presente = quantita 6', di('E').length === 1 && di('E')[0].qta === 6);
  t('saltate: codice sparito, sostituto gia\' in distinta, gia\' portata', r.saltate.length === 3);
  t('C resta (sostituzione saltata)', di('C').length === 1 && di('C')[0].tipo === 'MAC');
  t('la distinta di partenza non cambia', dist.length === 6 && dist[0].codice === 'A');
  t('applicate 5', r.applicate.length === 5);
  // Dopo: la variante portata non si riapplica e resta come storia.
  const lista = [{ codice: 'A', qta_pz: 2, qta: 2 }];
  t('applicaVarianti salta le varianti in_distinta', M.applicaVarianti(lista, [{ tipo: 'tolto', codice: 'A', in_distinta: '2026-11-27' }], 1).righe.length === 1);
  const storia = M.variantiDaConfronto(lista, lista, [], [{ tipo: 'tolto', codice: 'X', in_distinta: '2026-11-27' }], {});
  t('variantiDaConfronto tiene la storia delle varianti portate', storia.length === 1 && storia[0].in_distinta === '2026-11-27');
}

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);

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
  { codice: 'CKSF03', descrizione: 'frutto molla', um: 'nr', tipo: 'ACQ', qta_pz: 2 },
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

console.log('\n' + ok + ' ok, ' + ko + ' KO');
process.exit(ko ? 1 : 0);

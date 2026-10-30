// Test di `mancaSuDomanda` (domain/materiali.js) — 30 ott 2026.
//
// Nico su `05 095 0155`: la lista Materiali diceva "manca 100", le commesse
// aperte ne vogliono 300. Alnus impegna solo gli ordini gia' lanciati
// (00433/0020, OP 02074, 100 pz) e non vede 00492/0060 (senza OP, 200 pz).
// La colonna Manca adesso aggiunge al "da ordinare" di Alnus la domanda che
// solo noi vediamo, al netto della giacenza che avanza oltre l'impegno.
//
//   node strumenti/test/test-manca-su-domanda.js .
const path = require('path');
const G = process.argv[2] || '.';
const { mancaSuDomanda } = require(path.resolve(G, 'domain/materiali.js'));

let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

// (mancaAlnus, giacenza, impegno, nostraDomanda)
t('05 095 0155: Alnus 100, noi 300, giacenza 0 -> 300',
  mancaSuDomanda(100, 0, 100, 300).manca === 300);
t('05 135 0725: Alnus 35 (215 su 250), noi 550 -> 335',
  mancaSuDomanda(35, 215, 250, 550).manca === 335);
t('stessa domanda di Alnus -> il numero di Alnus',
  mancaSuDomanda(100, 0, 100, 100).manca === 100);
t('domanda nostra PIU PICCOLA dell impegno -> resta Alnus (la parte che non vediamo e sua)',
  mancaSuDomanda(40, 60, 100, 50).manca === 40);
t('codice coperto per Alnus, la giacenza che avanza basta all extra -> 0',
  mancaSuDomanda(0, 500, 100, 300).manca === 0);
t('codice coperto per Alnus, la giacenza che avanza copre solo una parte -> il resto',
  mancaSuDomanda(0, 150, 100, 300).manca === 150);
t('se Alnus gia dice che manca, non avanza niente per l extra',
  mancaSuDomanda(20, 80, 100, 160).manca === 80);
t('extra dichiarato a parte', mancaSuDomanda(100, 0, 100, 300).extra === 200
  && mancaSuDomanda(100, 0, 100, 300).mancaAlnus === 100);
t('valori vuoti non esplodono', mancaSuDomanda(null, null, null, null).manca === 0);
t('decimali puliti', mancaSuDomanda(28.35, 52.65, 81, 133.5).manca === 80.85);

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

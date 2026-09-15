// Test di `mancanteSottoScorta` e della categoria `coperto` — 15 set 2026.
//
// Nasce da un cambio di significato, non da un difetto. Fino al 14 set la
// tabella `mancanti` conteneva SOLO le righe con un problema: l'import
// scartava quelle sane, e "la riga c'e" bastava come diagnosi. Dal 15 entra
// tutto il file — la scheda Materiali e una lista di materiali, e la giacenza
// di un pezzo che non manca e proprio il dato che le serve.
//
// ⚠ Il rischio di un cambio cosi e che la regola resti SCRITTA DUE VOLTE:
// una nell'import (che non c e piu) e una in lettura. Questa prova fissa la
// seconda, perche adesso e l'unica: se `mancanteSottoScorta` sbaglia, il
// triangolino in Ordini cliente ricomincia a dire "⚠83" su una commessa a
// posto, e gli allarmi di tutta l'app si svuotano di senso.
//
//   node strumenti/test/test-sotto-scorta.js .
const fs = require('fs'), vm = require('vm'), path = require('path');
const G = process.argv[2] || '.';
const sandbox = { state: { sessioni: [], mancanti: [], operazioni: [] }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(G, 'domain/scheduling.js'), 'utf8')
  .replace(/\r\n/g, '\n'), sandbox);
const sotto = sandbox.mancanteSottoScorta;
const cat = sandbox.mancanteCategoria;
const bloccante = sandbox.mancanteBloccante;
const stato = sandbox.statoMateriale;
const mc = sandbox.mancantiCommessa;

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('LA REGOLA E LA STESSA CHE STAVA NELL IMPORT');
t('da ordinare > 0: manca', sotto({ qta_da_ordinare: 5, giacenza: 100, impegno: 0 }));
t('giacenza sotto l impegno: manca', sotto({ qta_da_ordinare: 0, giacenza: 3, impegno: 10 }));
t('giacenza pari all impegno: NON manca', !sotto({ qta_da_ordinare: 0, giacenza: 10, impegno: 10 }));
t('giacenza sopra l impegno: NON manca', !sotto({ qta_da_ordinare: 0, giacenza: 40, impegno: 10 }));
// Il file non sempre porta i due numeri. Senza, l unica cosa onesta e non
// accusare: inventare un buco dove i dati non ci sono e il modo piu veloce
// per far smettere di credere agli allarmi.
t('senza giacenza ne impegno: NON manca', !sotto({ qta_da_ordinare: 0 }));
t('con la sola giacenza: NON manca', !sotto({ qta_da_ordinare: 0, giacenza: 5 }));
t('riga inesistente: NON manca', !sotto(null));

sez('LA CATEGORIA: coperto vince su tutto');
// ⚠ L ORDINE DEI CONTROLLI E LA REGOLA. 'coperto' e l unica risposta che si
// legge sui NUMERI invece che sul tipo parte, ed e la piu forte. Metterla
// dopo avrebbe fatto chiamare "di consumo" un faston che non manca, e
// soprattutto "in arrivo" un codice che nessuno ha mai ordinato — perche
// `qta_da_ordinare` e zero anche quando non c e niente da ordinare.
t('sano e basta -> coperto', cat({ qta_da_ordinare: 0, giacenza: 50, impegno: 10 }) === 'coperto');
t('sano ma di consumo -> coperto, non consumo',
  cat({ qta_da_ordinare: 0, giacenza: 50, impegno: 10, tipo_parte: 'MAC' }) === 'coperto');
t('sano ma conto lavoro -> coperto',
  cat({ qta_da_ordinare: 0, giacenza: 50, impegno: 10, tipo_parte: 'C/L' }) === 'coperto');
t('di consumo e davvero sotto scorta -> consumo',
  cat({ qta_da_ordinare: 4, tipo_parte: 'MAC' }) === 'consumo');
t('conto lavoro e sotto scorta -> attesa cliente',
  cat({ qta_da_ordinare: 4, tipo_parte: 'C/L' }) === 'attesa_cliente');
t('da comprare -> da ordinare', cat({ qta_da_ordinare: 4, tipo_parte: 'ACQ' }) === 'da_ordinare');
t('gia ordinato (manca ma non c e da ordinare) -> in arrivo',
  cat({ qta_da_ordinare: 0, giacenza: 1, impegno: 9, tipo_parte: 'ACQ' }) === 'in_arrivo');

sez('IL ROSSO NON SI ACCENDE SU UNA RIGA SANA');
t('un codice coperto non e bloccante', !bloccante({ qta_da_ordinare: 0, giacenza: 50, impegno: 1 }));
t('un codice coperto non ha uno stato da raccontare',
  stato({ qta_da_ordinare: 0, giacenza: 50, impegno: 1 }, '2026-09-15').stato === 'coperto');
// Una riga coperta puo avere lo stesso una consegna in arrivo: si e ordinato
// e nel frattempo la giacenza e tornata a posto. Lo stato resta 'coperto' —
// la consegna e un fatto per conto suo, e la si vede nel banner.
t('coperto anche con una consegna prevista',
  stato({ qta_da_ordinare: 0, giacenza: 50, impegno: 1,
    consegne: [{ data: '2026-09-20', qta: 5 }] }, '2026-09-15').stato === 'coperto');

sez('IL TRIANGOLINO CONTA I PROBLEMI, NON I MATERIALI');
// E il punto che si sarebbe rotto per primo: `mancantiCommessa` filtrava per
// numero_op e basta. Con tutto il file in archivio una commessa da 83
// componenti avrebbe mostrato "⚠83" il giorno dell import.
sandbox.state.mancanti = [
  { numero_op: '01917', codice: 'A', qta_da_ordinare: 2, giacenza: 0, impegno: 2, tipo_parte: 'ACQ' },
  { numero_op: '01917', codice: 'B', qta_da_ordinare: 0, giacenza: 90, impegno: 10 },
  { numero_op: '01917', codice: 'C', qta_da_ordinare: 0, giacenza: 90, impegno: 10 },
  { numero_op: '01918', codice: 'D', qta_da_ordinare: 0, giacenza: 90, impegno: 10 },
];
const r1 = mc({ numero_op: '01917', stato_preparazione: 'vuoto' }, '2026-09-15');
t('conta solo il codice che manca davvero', r1.nCodici === 1);
t('e lo dichiara bloccante', r1.nBloccanti === 1);
const r2 = mc({ numero_op: '01918', stato_preparazione: 'vuoto' }, '2026-09-15');
t('commessa con soli codici coperti: nessuna segnalazione', r2.nCodici === 0);

sez('LE CONSEGNE SI VEDONO ANCHE SU UNA RIGA COPERTA');
// Scelta dichiarata: un ordine fornitore in arrivo e un fatto per conto suo.
// Nasconderlo perche nel frattempo la giacenza basta vorrebbe dire smettere
// di vedere arrivare la merce che si e comprata.
sandbox.state.mancanti = [
  { numero_op: '01919', codice: 'E', qta_da_ordinare: 0, giacenza: 90, impegno: 10,
    consegne: [{ data: '2026-09-20', qta: 7, ordine: 'OF-1' }] },
];
const cp = sandbox.consegnePreviste('2026-09-15');
t('la consegna di un codice coperto resta visibile', cp.prossime.length === 1);
t('e porta con se l ordine fornitore', cp.prossime[0].ordine === 'OF-1');

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

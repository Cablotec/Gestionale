// Test della SPEDIZIONE PREPARATA — 8 set 2026.
// Chiesto da un collega di Nico: poter riportare sulla commessa il numero di
// DDT che Alnus ha gia assegnato PRIMA che la merce parta.
// Una preparata e la riga col DDT ma senza quantita: il foglio pronto, non
// una spedizione. Deve valere ZERO in ogni conto finche non la si conferma.
const fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
const sandbox = { state: { sessioni: [] }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8').replace(/\r\n/g, '\n'), sandbox);
const prep = sandbox.spedizionePreparata;
const ultima = sandbox.ultimaSpedizione;
const inStorico = sandbox.commessaInStorico;

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('COSA E UNA PREPARATA');
{
  t('senza quantita', prep({ id:'s1', quantita: null, ddt:'4456' }) === true);
  t('quantita non definita', prep({ id:'s1', ddt:'4456' }) === true);
  t('quantita zero: e comunque un foglio, non una spedizione',
    prep({ id:'s1', quantita: 0, ddt:'4456' }) === true);
  t('con la quantita e una spedizione vera', prep({ id:'s1', quantita: 5 }) === false);
  t('niente non e una preparata', prep(null) === false);
}

sez('VALE ZERO: le somme non la vedono');
{
  // ⚠ Non c'e una guardia da nessuna parte: tutti i punti che sommano lo
  // spedito fanno `Number(s.quantita || 0)`, e `null` fa zero da solo. Questo
  // test tiene ferma quella proprieta: se un domani qualcuno somma senza il
  // `|| 0`, una preparata comincerebbe a contare come spedita.
  const somma = (righe) => righe.reduce((n, s) => n + Number(s.quantita || 0), 0);
  t('preparata sola: zero spedito',
    somma([{ quantita: null, ddt:'4456' }]) === 0);
  t('una vera e una preparata: conta solo la vera',
    somma([{ quantita: 3 }, { quantita: null, ddt:'4456' }]) === 3);
}

sez("NON E MAI L'ULTIMA SPEDIZIONE");
{
  const S = [
    { operazione_id:'op1', data:'2026-09-01', quantita: 4 },
    { operazione_id:'op1', data:'2026-12-31', quantita: null, ddt:'4456' },
  ];
  // Senza la guardia, la bozza col 31/12 diventava "l'ultima spedizione" e
  // teneva la commessa fuori dallo Storico per mesi.
  t('la bozza con data futura non sposta la data', ultima('op1', S) === '2026-09-01');
  t('con la sola bozza non c e nessuna data',
    ultima('op2', [{ operazione_id:'op2', data:'2026-12-31', quantita: null }]) === null);
}

sez('LO STORICO non si popola di bozze');
{
  const oggi = '2026-09-08';
  // Una commessa APERTA con solo il DDT preparato non e spedita e non deve
  // comparire fra le spedite: e' il caso normale di questa funzione.
  const aperta = { id:'op1', stato:'aperta' };
  t('commessa aperta con DDT preparato: resta in Ordini cliente',
    inStorico(aperta, [{ operazione_id:'op1', data:'2026-09-08', quantita:null, ddt:'4456' }], oggi) === false);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

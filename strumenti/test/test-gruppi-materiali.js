// Test di `gruppoMateriale` (domain/scheduling.js).
// In quale gruppo finisce una voce mancante del riquadro della commessa.
//
// Nasce da un difetto vero (7 set, trovato da Nico): "perche' mi dice che
// TS-342010003_K e' da ordinare al terzista, quando vedi che c'e' gia' un
// ordine fornitore? al massimo e' in ritardo". La UI toglieva le lavorazioni
// da ogni gruppo e le raccoglieva tutte sotto "da ordinare", OF emesso o no.
// Due domande diverse schiacciate in una: `lavorazione` dice DOVE si prende,
// `st.stato` dice SE e' gia' stata comprata.
const fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
const sandbox = { state: { sessioni: [] }, console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(G + '/domain/scheduling.js', 'utf8').replace(/\r\n/g, '\n'), sandbox);
const gruppo = sandbox.gruppoMateriale;

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const v = (stato, lavorazione) => ({ st: { stato }, lavorazione: !!lavorazione });

sez('IL CASO DI NICO: una lavorazione gia ordinata non e da ordinare');
{
  t('lavorazione con OF e data passata -> in ritardo',
    gruppo({ st:{ stato:'in_ritardo', of:'OF/1234', data:'2026-08-01' }, lavorazione:true })
      === 'in_ritardo');
  t('lavorazione ordinata con data futura -> in arrivo',
    gruppo(v('in_arrivo', true)) === 'in_arrivo');
  t('lavorazione che nessuno ha ordinato -> gruppo lavorazioni',
    gruppo(v('da_ordinare', true)) === 'lavorazione');
}

sez('I MATERIALI normali non cambiano comportamento');
{
  t('in ritardo', gruppo(v('in_ritardo')) === 'in_ritardo');
  t('in arrivo', gruppo(v('in_arrivo')) === 'in_arrivo');
  t('da ordinare', gruppo(v('da_ordinare')) === 'da_ordinare');
  t('lo manda il cliente', gruppo(v('attesa_cliente')) === 'attesa_cliente');
  t('di consumo', gruppo(v('consumo')) === 'consumo');
}

sez('UNO E UN SOLO gruppo, per ogni combinazione');
{
  // Un doppione conterebbe la voce due volte, un buco la farebbe sparire dal
  // riquadro senza che nessuno se ne accorga: e' il difetto peggiore di
  // tutti, perche' non si vede.
  const GRUPPI = ['in_ritardo', 'in_arrivo', 'da_ordinare', 'attesa_cliente',
    'lavorazione', 'consumo'];
  const STATI = ['in_ritardo', 'in_arrivo', 'da_ordinare', 'attesa_cliente', 'consumo'];
  let tutte = true;
  STATI.forEach(s => [false, true].forEach(lav => {
    const g = gruppo(v(s, lav));
    if (GRUPPI.indexOf(g) < 0) { tutte = false; console.log('     ' + s + '/' + lav + ' -> ' + g); }
  }));
  t('ogni combinazione cade in un gruppo noto', tutte);
  t('una lavorazione non finisce mai fra i materiali di consumo',
    gruppo(v('consumo', true)) === 'lavorazione');
  t('ne fra quelli che manda il cliente',
    gruppo(v('attesa_cliente', true)) === 'lavorazione');
}

sez('Voci mal formate: si decide comunque, non si esplode');
{
  t('senza stato -> da ordinare', gruppo({ lavorazione: false }) === 'da_ordinare');
  t('senza stato ma lavorazione -> gruppo lavorazioni',
    gruppo({ lavorazione: true }) === 'lavorazione');
  t('oggetto vuoto -> da ordinare', gruppo({}) === 'da_ordinare');
  t('niente del tutto -> da ordinare', gruppo(null) === 'da_ordinare');
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

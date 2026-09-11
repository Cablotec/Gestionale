// Test del MATERIALE DI CONSUMO (MAC) — 7 set 2026, richiesta di Nico:
// "nell'import distinte se noti in alcune colonna MAC, vuol dire che e'
// materiale che non va a fabbisogno, come una minuteria".
//
// La regola in una riga: il MAC STA nella lista della commessa (chi lavora
// la minuteria la deve vedere) ma NON entra nel fabbisogno.
// Ogni test qui e' quella decisione vista da un punto diverso della catena:
// se cade, e' la decisione che si sta perdendo.
const fs = require('fs'), vm = require('vm');
const G = process.argv[2] || '.';
const M = require(require('path').resolve(G, 'domain/materiali.js'));

// `leggiDistintaExcel` e le sue compagne vivono in app.js, che e' un guscio
// da browser: si estraggono le quattro funzioni pure e si provano da sole.
const src = fs.readFileSync(G + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(['const DIST_COLONNE', 'function distNorm', 'function distNum',
  'function leggiDistintaExcel'].map(m => {
    const i = src.indexOf(m); return src.slice(i, src.indexOf('\n}\n', i) + 3);
  }).join('\n'), sandbox);
const leggi = sandbox.leggiDistintaExcel;

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

// La griglia come la da SheetJS: intestazioni col loro spazio in coda, come
// nel file vero (`distinta enviro.xlsx`).
const TESTA = ['', 'Fase ', 'Nr. Riga ', 'Codice Componente ', 'Quantità Impiego ',
  'Descrizione Articolo ', 'T.P D.B ', 'Tip Par ', 'UM '];
const riga = (cod, qta, tipo, tpdb) =>
  ['X', '10', '10', cod, String(qta), 'DESCR ' + cod, tpdb || '', tipo || '', 'nr'];

sez('LETTURA: la colonna si chiama "Tip Par", abbreviata');
{
  const e = leggi([TESTA, riga('MINUT-1', 3, 'MAC'), riga('PEZZO-1', 2, 'ACQ')]);
  t('trova la colonna', e.colonnaTipo === true);
  t('legge il tipo riga per riga', e.righe[0].tipo === 'MAC' && e.righe[1].tipo === 'ACQ');
  t('conta le righe di consumo', e.consumo === 1);
}
{
  // ⚠ Il file vero ha DUE colonne con dentro MAC. `T.P D.B` ce l'ha su tutte
  // e 46 le righe C/L, cioe' sui sottoassiemi, che a fabbisogno ci vanno
  // eccome: leggere quella sbagliata toglierebbe dal conto i pezzi grossi.
  const e = leggi([TESTA, riga('SOTTOASS-1', 1, 'C/L', 'MAC')]);
  t('NON legge "T.P D.B": un C/L resta C/L', e.righe[0].tipo === 'C/L');
  t('e non finisce fra i consumi', e.consumo === 0);
}
{
  const e = leggi([['Codice Componente ', 'Quantità Impiego '], ['X-1', '2']]);
  t('senza la colonna si dichiara, non si indovina', e.colonnaTipo === false);
  t('e nessuna riga diventa consumo', e.consumo === 0 && e.righe[0].tipo === null);
}

sez('ESPLOSIONE: il consumo si mette da parte, non sparisce');
const articoli = [
  { codice: 'PRODOTTO', distinta: [
    { codice: 'MINUT-1', qta: 4, tipo: 'MAC' },
    { codice: 'PEZZO-1', qta: 2, tipo: 'ACQ' },
    { codice: 'SOTTOASS', qta: 1, tipo: 'C/L' } ] },
  { codice: 'SOTTOASS', distinta: [
    { codice: 'PEZZO-2', qta: 3, tipo: 'ACQ' },
    { codice: 'MINUT-2', qta: 5, tipo: 'MAC' } ] },
];
{
  const figliDi = new Map();
  M.applicaDistinteProdotti(figliDi, articoli);
  const e = M.esplodiDistinta('PRODOTTO', 2, figliDi);
  t('i materiali veri restano materiali', e.materiali.has('PEZZO-1') && e.materiali.has('PEZZO-2'));
  t('la minuteria del primo livello va a parte', e.consumo.get('MINUT-1') === 8);
  t('anche quella DENTRO un sottoassieme', e.consumo.get('MINUT-2') === 10);
  t('e non resta fra i materiali', !e.materiali.has('MINUT-1') && !e.materiali.has('MINUT-2'));
  t('il sottoassieme C/L si esplode come sempre', e.materiali.get('PEZZO-2') === 6);
}

sez('FABBISOGNO: il MAC non entra, ma la lista lo tiene');
{
  const lista = [
    { codice: 'PEZZO-1', qta: 4, tipo: null },
    { codice: 'MINUT-1', qta: 8, tipo: 'MAC' },
    { codice: 'COMP GENERICO', qta: 1, tipo: null },
  ];
  const perCod = M.fabbisognoDaListe([{ id: 'op1', scadenza: '2026-01-01', materiali: lista }]);
  t('il materiale vero fa fabbisogno', perCod.has('PEZZO-1'));
  t('il consumo NO', !perCod.has('MINUT-1'));
  t('il segnaposto neanche, come prima', !perCod.has('COMP GENERICO'));
  t('la lista della commessa resta intera', lista.length === 3);
}
{
  // Retro-compatibilita': le liste salvate PRIMA del 7 set non hanno `tipo`.
  // Un dato vecchio non deve cambiare significato perche' e' arrivato un
  // campo nuovo: senza tipo si fa fabbisogno, come si e' sempre fatto.
  const perCod = M.fabbisognoDaListe([{ id: 'op1', scadenza: '2026-01-01',
    materiali: [{ codice: 'VECCHIO-1', qta: 2 }] }]);
  t('riga senza `tipo`: fa fabbisogno come prima', perCod.has('VECCHIO-1'));
}
{
  const perCod = M.fabbisognoDaListe([{ id: 'op1', scadenza: '2026-01-01',
    materiali: [{ codice: 'X-1', qta: 2, tipo: 'mac' }] }]);
  t('il tipo si legge senza badare alle maiuscole', !perCod.has('X-1'));
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

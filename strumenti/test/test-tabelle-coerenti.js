// I NOMI DELLE TABELLE DEVONO COMBACIARE FRA I QUATTRO FRONTEND — 16 set 2026.
//
// Nasce da un difetto vero, ed e il piu caro trovato finora.
// `mobile.html` leggeva `sb.from('chiusure')`. Quella tabella non esiste: si
// chiama `chiusure_aziendali`, come la legge il gestionale. PostgREST
// rispondeva "Could not find the table", l errore finiva in `ch.error` che
// nessuno guardava, e `state.chiusure` restava `[]`.
//
// Il risultato non e stato "una schermata vuota". E stato che
// `isGiornoNonLavorativo` sul telefono ha smesso di saltare le chiusure, e le
// richieste di ferie a cavallo di Natale hanno scritto assenze SUI GIORNI IN
// CUI L AZIENDA E CHIUSA: 5 giornate, 40 ore, su dati veri.
//
// ⚠ Il difetto non e stato il refuso. E stato che il refuso non poteva fare
// rumore: `risposta.data || []` trasforma una tabella inesistente in un
// archivio vuoto, e un archivio vuoto si legge come "non c e niente da
// saltare".
//
// Questa prova e statica e costa niente: i quattro frontend parlano allo
// stesso database, quindi un nome che compare in uno solo e sospetto per
// definizione. `app.js` fa da riferimento perche e quello che gira contro lo
// schema vero da piu tempo.
//
//   node strumenti/test/test-tabelle-coerenti.js .
const fs = require('fs'), path = require('path');
const G = process.argv[2] || '.';
const leggi = (f) => fs.readFileSync(path.resolve(G, f), 'utf8').replace(/\r\n/g, '\n');

// Ogni `from('nome')` del file. Si prende anche `.from("nome")`, per sicurezza.
const tabelleDi = (src) => {
  const s = new Set();
  const re = /\.from\(\s*['"]([a-z0-9_]+)['"]\s*\)/g;
  let m; while ((m = re.exec(src))) s.add(m[1]);
  return s;
};

const app = tabelleDi(leggi('app.js'));
const mobile = tabelleDi(leggi('mobile.html'));
const prelievo = tabelleDi(leggi('prelievo.html'));
const core = tabelleDi(leggi('core/db.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };

sez('IL REFUSO CHE HA FATTO IL DANNO');
t('mobile legge `chiusure_aziendali`', mobile.has('chiusure_aziendali'));
t('e NON la inesistente `chiusure`', !mobile.has('chiusure'));
t('anche il gestionale legge `chiusure_aziendali`', app.has('chiusure_aziendali'));

sez('NESSUN FRONTEND PARLA DA SOLO A UNA TABELLA');
// Un nome usato da un frontend solo non e per forza sbagliato — `prelievi_magazzino`
// lo usa giustamente solo prelievo.html — quindi le eccezioni si dichiarano qui,
// una per una, invece di indebolire il controllo.
const SOLO_SUE = {
  'prelievi_magazzino': 'la scheda prelievi vive solo in prelievo.html',
};
const noteApp = new Set([...app, ...core]);
[['mobile.html', mobile], ['prelievo.html', prelievo]].forEach(([nome, set]) => {
  [...set].sort().forEach(tab => {
    if (noteApp.has(tab)) { ok++; console.log('  ok   ' + nome + ' → ' + tab); return; }
    if (SOLO_SUE[tab]) { ok++; console.log('  ok   ' + nome + ' → ' + tab + '  (' + SOLO_SUE[tab] + ')'); return; }
    ko++;
    console.log('  KO   ' + nome + ' → ' + tab
      + '  — nessun altro frontend conosce questa tabella.');
    console.log('       Se e giusta, aggiungila a SOLO_SUE dicendo perche.');
    console.log('       Se e un refuso, ricorda che a database NON dara errore visibile:');
    console.log('       l elenco tornera vuoto e sembrera che non ci sia niente.');
  });
});

sez('LE REGOLE COPIATE DEVONO RESTARE COPIE, NON VARIANTI');
// `mobile.html` e autonomo: non carica `app.js`, quindi le regole delle
// finestre ferie ci stanno dentro COPIATE. E una duplicazione accettata e
// dichiarata — ma una copia che deriva e il modo in cui il telefono e il
// browser dicono cose diverse alla stessa persona, sulla stessa domanda,
// nello stesso giorno. Qui si confrontano carattere per carattere.
const srcApp = leggi('app.js'), srcMob = leggi('mobile.html');
// Si confronta il CODICE, non i commenti: quelli possono e devono essere
// diversi, perche parlano a chi legge quel file. Si tolgono le righe di
// commento e si appiattiscono gli spazi.
// ⚠ Lo spogliatore e ingenuo (taglia da `//` a fine riga) e andrebbe in
// confusione su una stringa che contenesse `//`. In queste cinque funzioni
// non ce ne sono; se un domani ce ne fossero, questo controllo va rifatto
// meglio invece che disattivato.
const corpo = (src, firma) => {
  const i = src.indexOf(firma);
  if (i < 0) return null;
  const j = src.indexOf('\n}\n', i);
  if (j < 0) return null;
  return src.slice(i, j + 2)
    .split('\n').map(r => r.replace(/\/\/.*$/, '')).join(' ')
    .replace(/\s+/g, ' ').trim();
};
[
  'function finestraApertaOra(oggiIso) {',
  'function ggmmIT(s) {',
  'function frasePeriodoAperto(oggiIso) {',
  'function isoDentroIntervallo(iso, ggmmDa, ggmmA) {',
  'function tipoInseribileDa(tipo, esente) {',
].forEach(firma => {
  const a = corpo(srcApp, firma), b = corpo(srcMob, firma);
  const nome = firma.replace('function ', '').split('(')[0];
  if (!a || !b) { ko++; console.log('  KO   ' + nome + ' — manca in ' + (!a ? 'app.js' : 'mobile.html')); return; }
  t(nome + ' identica nei due frontend', a === b);
});
// La frase del rifiuto non sta in una funzione a se: si confronta il testo.
const frase = 'che si prenota dal ';
t('la frase del rifiuto e la stessa',
  srcApp.includes(frase) && srcMob.includes(frase)
  && srcApp.includes('questa data sta nella finestra') && srcMob.includes('questa data sta nella finestra'));

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

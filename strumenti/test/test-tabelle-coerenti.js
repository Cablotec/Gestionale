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

sez('LE REGOLE DEL CALENDARIO STANNO UNA VOLTA SOLA, NEL MOTORE');
// Fino al 29 set `mobile.html` le aveva COPIATE, e qui si controllava che le
// copie restassero uguali carattere per carattere. Non bastava: le copie
// controllate erano sette, quelle vere venticinque, e le altre si erano gia'
// allontanate (nomi dei festivi, frasi dei rifiuti). Dal 30 set stanno in
// domain/calendario.js, caricato da gestionale, kiosk e telefono, e il
// controllo e' quello opposto: NESSUNA pagina le ridefinisce.
// Una ridefinizione non darebbe errore — l'ultima caricata vince in silenzio —
// ed e' proprio cosi' che una copia torna a nascere.
const srcApp = leggi('app.js'), srcMob = leggi('mobile.html'), srcCal = leggi('domain/calendario.js');
const REGOLE = ['z', 'toLocalISO', 'parseISODate', 'fmtIT', 'fmtT', 'todayISO', 'ggmmIT', 'parseGGMM',
  'isoDentroIntervallo', 'FESTIVI_NAZ_FISSI', 'calcolaPasqua', 'festiviNazionali', 'festiviNazIsoSet',
  'festivoDelGiorno', 'chiusureIsoSet', 'isGiornoNonLavorativo', 'chiusuraDelGiorno', 'motivoNonLavorativo',
  'eventiDelGiorno', 'eventoEtichetta', 'getImpostazione', 'getFinestreAssenze', 'getGruppiEsentiAssenze',
  'finestraApertaOra', 'frasePeriodoAperto', 'tipoInseribileDa', 'verificaAccessoAssenza', 'getAssenza',
  'primoGiornoInseribile'];
const definita = (src, n) => new RegExp('^(?:async )?function ' + n + '\\s*\\(|^(?:const|let|var) ' + n + '\\s*=', 'm').test(src);
REGOLE.forEach(n => {
  const qui = definita(srcCal, n), inApp = definita(srcApp, n), inMob = definita(srcMob, n);
  t(n + ' nel motore e in nessuna pagina', qui && !inApp && !inMob);
});
['index.html', 'kiosk.html', 'mobile.html'].forEach(g => {
  const h = leggi(g);
  const iCal = h.indexOf('src="domain/calendario.js'), iSch = h.indexOf('src="domain/scheduling.js');
  t(g + ' carica il motore del calendario prima della pianificazione', iCal >= 0 && iSch >= 0 && iCal < iSch);
  t(g + ' carica le regole dei mezzi', h.includes('src="domain/mezzi.js'));
});

sez('LE ALTRE REGOLE COMUNI, UNA VOLTA SOLA (30 set)');
const srcMez = leggi('domain/mezzi.js'), srcDb = leggi('core/db.js'), srcPre = leggi('prelievo.html');
const pagine = [['app.js', srcApp], ['mobile.html', srcMob], ['prelievo.html', srcPre]];
[['checkSovrapposizioni', srcMez, 'domain/mezzi.js'],
 ['checkSovrapposizioniOperatori', srcMez, 'domain/mezzi.js'],
 ['erroreAccessoInItaliano', srcDb, 'core/db.js']].forEach(([n, casa, dove]) => {
  const altrove = pagine.filter(([, s]) => definita(s, n)).map(([p]) => p);
  t(n + ' in ' + dove + ' e in nessuna pagina' + (altrove.length ? ' (anche in ' + altrove.join(', ') + ')' : ''),
    definita(casa, n) && !altrove.length);
});
// Era morta in tutte e due le copie: nessuno la chiamava piu'.
t('rigaPerSessione non esiste piu', pagine.every(([, s]) => !definita(s, 'rigaPerSessione')));

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

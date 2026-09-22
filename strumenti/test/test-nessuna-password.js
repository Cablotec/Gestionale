// Nessuna password nei file che finiscono sotto gli occhi di chiunque.
//
// Il 22 set 2026 la password dell'account tecnico era in `core/db.js` e in
// `app.js`, cioe' scaricabile da internet con una riga di curl: GitHub Pages
// serve quei file a ogni browser che apre il gestionale, e il repository e'
// pubblico. Chi la leggeva entrava e vedeva ordini, clienti, prezzi e
// timbrature di tutti.
//
// ⚠ Questo test NON contiene la password (la scriverebbe di nuovo nel repo):
// cerca la FORMA, cioe' una password scritta a mano in un punto pubblicato.
//
// ⚠ Se un giorno fallisce, la risposta non e' allentare il controllo: le
// credenziali vanno in `PW.txt` fuori dal repo (vedi strumenti/credenziali.js),
// e le postazioni si abilitano una volta a mano.
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || '.';

// Serviti da GitHub Pages: li legge chiunque apra il sito.
const pubblicati = ['app.js', 'core/db.js', 'index.html', 'kiosk.html',
  'mobile.html', 'prelievo.html'];
// Non serviti da Pages, ma il repository e' pubblico: si leggono lo stesso.
const nelRepo = ['strumenti/backup.js', 'strumenti/anomalie-alnus.js',
  'strumenti/credenziali.js', 'strumenti/test/prova-coperture.js'];

let ok = 0, ko = 0;
const t = (nome, condizione, dettaglio) => {
  if (condizione) { ok++; return; }
  ko++;
  console.log('  KO ' + nome + (dettaglio ? '\n     ' + dettaglio : ''));
};

for (const f of pubblicati.concat(nelRepo)) {
  let src;
  try { src = fs.readFileSync(path.join(base, f), 'utf8'); }
  catch (e) { t(f + ' leggibile', false, e.message); continue; }

  // Righe di commento escluse: parlano di cosa NON fare, e vanno lasciate.
  const righe = src.split(/\r?\n/).filter(r => !/^\s*(\/\/|\*|<!--)/.test(r));
  const codice = righe.join('\n');

  // 1. const QUALCOSA_PASSWORD = 'letterale'
  const assegnazione = codice.match(/\b[A-Za-z_$][\w$]*(PASSWORD|PASSWD|PWD)\b\s*=\s*['"`][^'"`]+['"`]/i);
  t(f + ': nessuna password assegnata a mano', !assegnazione,
    assegnazione ? 'trovato: ' + assegnazione[0].slice(0, 40) + '…' : '');

  // 2. signInWithPassword({ ..., password: 'letterale' })
  // ⚠ Deve essere una CHIAVE di oggetto (preceduta da `{` o `,`) e minuscola:
  // senza questi due vincoli il test prendeva l'etichetta 'Password: ' del
  // modulo di accesso e falliva su un testo a schermo.
  const login = codice.match(/[{,]\s*password\s*:\s*['"`][^'"`]+['"`]/);
  t(f + ': nessun login con password scritta', !login,
    login ? 'trovato: ' + login[0].slice(0, 40) + '…' : '');
}

// 3. La password non deve nemmeno essere RICAVABILE da core/db.js: gli
//    strumenti che prima la leggevano da li' devono passare da PW.txt.
for (const f of nelRepo) {
  const src = fs.readFileSync(path.join(base, f), 'utf8');
  const righe = src.split(/\r?\n/).filter(r => !/^\s*(\/\/|\*)/.test(r)).join('\n');
  t(f + ': non estrae la password da core/db.js',
    !/APP_PASSWORD|KIOSK_PASSWORD/.test(righe));
}

// 4. PW.txt sta FUORI dalla cartella del gestionale e non e' versionato.
const dentro = fs.existsSync(path.join(base, 'PW.txt'));
t('PW.txt non e dentro il repository', !dentro,
  dentro ? 'trovato in ' + path.resolve(base, 'PW.txt') + ' — spostarlo fuori' : '');

console.log(ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

// Uscire da una scheda e' sempre lo stesso gesto.
//
// 22 set 2026, segnalato da Nico: *"quando elimino una sessione, all'interno
// dell'ordine mi si chiude ogni volta la scheda"*. Nel Consuntivo della
// commessa `openSessioneModal(s)` veniva chiamata SENZA il secondo argomento
// — quello che dice "dove tornare quando hai finito" — e `finalize()`
// chiudeva il modal ridisegnando solo la scheda di sfondo: la commessa
// spariva. Tutti gli altri chiamanti lo passavano; uno se n'era dimenticato.
//
// ⚠ E' una classe di difetto, non un caso singolo: un argomento facoltativo
// dimenticato non da' nessun errore. Qui si controlla che nessuno lo salti.
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || '.';
const src = fs.readFileSync(path.join(base, 'app.js'), 'utf8');

let ok = 0, ko = 0;
const t = (nome, condizione, dettaglio) => {
  if (condizione) { ok++; return; }
  ko++;
  console.log('  KO ' + nome + (dettaglio ? '\n     ' + dettaglio : ''));
};

// ── 1. Ogni chiamata a openSessioneModal passa il "dove tornare" ──
const righe = src.split(/\r?\n/);
const chiamate = [];
righe.forEach((r, i) => {
  if (!/openSessioneModal\s*\(/.test(r)) return;
  if (/function openSessioneModal/.test(r)) return;      // la definizione
  if (/^\s*(\/\/|\*)/.test(r)) return;                    // commenti
  chiamate.push({ n: i + 1, testo: r.trim() });
});
t('ci sono chiamate da controllare', chiamate.length > 0,
  'nessuna trovata: il controllo non sta guardando niente');
for (const c of chiamate) {
  // Dopo l'argomento `s` deve esserci una virgola prima della parentesi chiusa.
  const m = c.testo.match(/openSessioneModal\s*\(([^)]*)\)/);
  const dueArgomenti = m ? m[1].includes(',') : /openSessioneModal\s*\([^)]*,/.test(c.testo);
  t('riga ' + c.n + ': openSessioneModal dice dove tornare', dueArgomenti, c.testo.slice(0, 90));
}

// ── 2. Dentro openSessioneModal nessuna uscita salta `finalize` ──
const i0 = src.indexOf('function openSessioneModal(');
t('openSessioneModal trovata', i0 >= 0);
if (i0 >= 0) {
  let d = 0, fine = i0;
  for (let k = src.indexOf('{', i0); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) { fine = k; break; } }
  }
  const corpo = src.slice(i0, fine + 1)
    .split(/\r?\n/).filter(r => !/^\s*(\/\/|\*)/.test(r)).join('\n');

  // `closeModal` puo' comparire UNA volta sola: dentro `finalize` stessa.
  const quanti = (corpo.match(/closeModal/g) || []).length;
  t('closeModal usata solo dentro finalize', quanti === 1,
    'trovata ' + quanti + ' volte: ogni uscita deve passare da finalize()');

  // Le uscite attese, tutte agganciate a finalize
  t('la ✕ passa da finalize', /mclose[^\n]*onclick\s*:\s*finalize/.test(corpo));
  t('Annulla passa da finalize', /onclick\s*:\s*finalize[^\n]*Annulla|Annulla[^\n]*onclick\s*:\s*finalize/.test(corpo)
    || /onclick:finalize \}, 'Annulla'/.test(corpo));
  t('Esc passa da finalize', /__modalGuardia\s*=\s*finalize/.test(corpo));
  t('Elimina e Salva chiamano finalize', (corpo.match(/finalize\(\)/g) || []).length >= 2);
}

console.log(ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

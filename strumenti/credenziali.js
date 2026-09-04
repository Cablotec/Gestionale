// Le credenziali dell'account tecnico, lette da un file LOCALE fuori dal repo.
//
// Il repo e pubblico: `core/db.js` porta l'account kiosk in chiaro perche i
// gusci devono poter entrare da soli, ma l'account che SCRIVE non ci puo
// stare. Sta in `PW.txt` accanto alla cartella del gestionale, e qui si legge
// senza mai passare dalla chat.
//
// Formato accettato (tollerante: righe vuote e maiuscole non contano):
//   email: kiosk@cablotec.local
//   password: ...
//
//   email: AI@cablotec.local
//   password: ...
//
// ⚠⚠ SUPABASE NORMALIZZA LE EMAIL IN MINUSCOLO. Nel file puoi scrivere
// `AI@cablotec.local`, ma il token portera `ai@cablotec.local` — ed e quello
// che le policy confrontano. Per questo il confronto qui e insensibile alle
// maiuscole e le policy usano `lower(...)`. Con un confronto esatto la policy
// non combacerebbe mai, e l'RLS rifiuterebbe IN SILENZIO: HTTP 200, zero
// righe, nessun errore. E il modo peggiore per accorgersene.
const fs = require('fs');
const path = require('path');

// `radice` = la cartella del gestionale. Il file sta un livello sopra.
function percorsoDefault(radice) {
  return path.resolve(radice || '.', '../PW.txt');
}

// Ritorna { email, password } per il primo blocco che nomina `email`.
// La password e la prima riga successiva che ha un `:` con qualcosa dopo.
function leggiCredenziali(email, opzioni) {
  const o = opzioni || {};
  const file = o.file || percorsoDefault(o.radice);
  let testo;
  try { testo = fs.readFileSync(file, 'utf8'); }
  catch (e) { throw new Error('credenziali non leggibili da ' + file + ': ' + e.message); }
  const righe = testo.split(/\r?\n/);
  const cercata = String(email).trim().toLowerCase();
  for (let i = 0; i < righe.length; i++) {
    const m = righe[i].match(/([\w.+-]+@[\w.-]+)/);
    if (!m || m[1].toLowerCase() !== cercata) continue;
    for (let k = i + 1; k < Math.min(i + 4, righe.length); k++) {
      const v = righe[k].split(':').slice(1).join(':').trim();
      if (v) return { email: m[1], password: v };
    }
    throw new Error('trovata ' + email + ' in ' + file + ' ma senza password sotto');
  }
  throw new Error(email + ' non e in ' + file);
}

module.exports = { leggiCredenziali, percorsoDefault };

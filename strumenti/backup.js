/* ═══════════════════════════════════════════════════════════════════
   STRUMENTI/BACKUP.JS — Copia locale di tutti i dati (Cablotec Gestionale)

   Perché esiste: il 7 ago 2026 una cancellazione per sbaglio in anagrafica
   ha scollegato 144 timbrature (238 h). Si è potuto rimettere a posto solo
   perché il giorno prima quei dati erano stati letti per un'altra ragione.
   È stata fortuna. Questo script la sostituisce con una copia fatta apposta.

   Cosa fa: legge OGNI tabella via REST (paginando oltre il tetto di 1000
   righe di PostgREST, come fetchTutte) e scrive un file JSON per tabella
   dentro una cartella datata. Sola lettura: non scrive niente sul database.

   Uso:
     node strumenti/backup.js
     node strumenti/backup.js "D:/altro/percorso"

   DOVE FINISCONO: fuori dal repo, in ..\backup-gestionale\AAAA-MM-GG_HHMM\
   Il repo è PUBBLICO: un backup dentro il repo pubblicherebbe i dati di
   tutta l'azienda. Il percorso predefinito sta fuori apposta, e c'è anche
   un .gitignore come seconda rete.

   Credenziali: le stesse di core/db.js (account kiosk, sola lettura utile),
   lette da lì per non averne una seconda copia che invecchia.
   ═══════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

// Le tabelle caricate dall'app, più quelle nate dopo (mancanti, ore_esterne,
// produttori). Se ne aggiungi una al gestionale, aggiungila anche qui.
const TABELLE = [
  'profili', 'utenti', 'aziende', 'articoli', 'tipi_lavorazione',
  'operazioni', 'operazioni_fasi', 'operazioni_addetti', 'operazioni_fornitori',
  'sessioni_lavoro', 'spedizioni', 'consegne_commessa',
  'mezzi', 'prenotazioni', 'prenotazioni_utenti', 'consegne',
  'assenze', 'tipi_assenza', 'chiusure_aziendali', 'attivita_extra',
  'impostazioni', 'mancanti', 'ore_esterne', 'produttori',
];

// ── Credenziali dal file vero, così non se ne creano due copie ──
function leggiConfig() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'core', 'db.js'), 'utf8');
  const prendi = (nome) => {
    const m = src.match(new RegExp(nome + '\\s*=\\s*["\']([^"\']+)["\']'));
    if (!m) throw new Error('non trovo ' + nome + ' in core/db.js');
    return m[1];
  };
  return {
    url: prendi('SUPABASE_URL'),
    key: prendi('SUPABASE_ANON_KEY'),
    email: prendi('APP_EMAIL'),
    password: prendi('APP_PASSWORD'),
  };
}

async function login(cfg) {
  const r = await fetch(cfg.url + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: cfg.email, password: cfg.password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('login fallito: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// Paginata: PostgREST ne dà al massimo 1000 per volta e una select nuda su una
// tabella cresciuta oltre PERDE le righe in eccesso, in silenzio.
async function scaricaTabella(cfg, token, tabella) {
  const PAGINA = 1000;
  const righe = [];
  for (let da = 0; ; da += PAGINA) {
    const r = await fetch(cfg.url + '/rest/v1/' + tabella + '?select=*', {
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + token,
        Range: da + '-' + (da + PAGINA - 1),
        'Range-Unit': 'items',
      },
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 160));
    }
    const blocco = await r.json();
    righe.push(...blocco);
    if (blocco.length < PAGINA) break;
  }
  return righe;
}

const z = (n) => String(n).padStart(2, '0');

async function main() {
  const cfg = leggiConfig();
  const d = new Date();
  const stampo = `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}`;
  const radice = process.argv[2] || path.join(__dirname, '..', '..', 'backup-gestionale');
  const cartella = path.join(radice, stampo);
  fs.mkdirSync(cartella, { recursive: true });
  // Seconda rete: se un domani qualcuno sposta i backup dentro il repo, il
  // .gitignore evita che finiscano su GitHub. Il repo è pubblico.
  fs.writeFileSync(path.join(radice, '.gitignore'), '*\n');

  const token = await login(cfg);
  console.log('backup in ' + cartella + '\n');

  const riepilogo = { quando: d.toISOString(), tabelle: {}, errori: {} };
  let totRighe = 0;
  for (const t of TABELLE) {
    try {
      const righe = await scaricaTabella(cfg, token, t);
      fs.writeFileSync(path.join(cartella, t + '.json'), JSON.stringify(righe));
      riepilogo.tabelle[t] = righe.length;
      totRighe += righe.length;
      console.log('  ' + String(righe.length).padStart(6) + '  ' + t);
    } catch (e) {
      // Una tabella che non esiste ancora (migrazione non fatta) non deve far
      // fallire tutto il backup: si annota e si va avanti.
      riepilogo.errori[t] = e.message;
      console.log('  ' + '   —'.padStart(6) + '  ' + t + '   (' + e.message.slice(0, 60) + ')');
    }
  }
  fs.writeFileSync(path.join(cartella, '_riepilogo.json'), JSON.stringify(riepilogo, null, 1));

  const nErr = Object.keys(riepilogo.errori).length;
  console.log('\n' + totRighe + ' righe in ' + Object.keys(riepilogo.tabelle).length + ' tabelle'
    + (nErr ? '  ·  ' + nErr + ' tabelle non lette' : ''));

  // Guardia: un backup che scarica zero righe è un backup che non c'è. Meglio
  // accorgersene subito che il giorno in cui serve.
  if (totRighe === 0) {
    console.error('\n⚠ ZERO righe scaricate: il backup NON è valido.');
    process.exit(1);
  }
}

main().catch(e => { console.error('\n⚠ backup fallito: ' + (e.message || e)); process.exit(1); });

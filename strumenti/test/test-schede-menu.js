// OGNI SCHEDA DICHIARATA DEVE AVERE CHI LA DISEGNA — 16 set 2026.
//
// Nasce dal riordino dei menu, e dall avvertimento che stava in CLAUDE.md da
// giorni come cosa da fare PRIMA di toccare gli id:
//
//   la catena di `else if` in `renderTab` NON FALLISCE su un id sconosciuto.
//   Cade in fondo e la scheda resta BIANCA, senza errore in console.
//
// Una stringa dimenticata in un rename non si vede: si scopre quando qualcuno
// apre quella scheda, magari fra due settimane. Adesso c e un `else` finale
// che scrive un cartello — ma un cartello lo legge solo chi ci passa. Questo
// test lo trova prima, e costa niente.
//
// Sorveglia i due versi:
//   1. ogni id in TAB_STRUCTURE ha un ramo nella catena (o un alias che lo
//      rimappa su qualcosa che ce l ha) -> altrimenti scheda bianca;
//   2. ogni ramo della catena chiama una funzione che ESISTE davvero.
//
//   node strumenti/test/test-schede-menu.js .
const fs = require('fs'), path = require('path');
const G = process.argv[2] || '.';
const src = fs.readFileSync(path.resolve(G, 'app.js'), 'utf8').replace(/\r\n/g, '\n');

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond, extra) => {
  if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); if (extra) console.log('       ' + extra); }
};

// ── Gli id dichiarati nei menu ──────────────────────────────────────
const blocco = src.slice(src.indexOf('const TAB_STRUCTURE'), src.indexOf('function bindTabs'));
const idMenu = [...blocco.matchAll(/\{\s*id:\s*'([a-z_]+)'/g)].map(m => m[1]);

// ── I rami della catena in renderTab ────────────────────────────────
const iRt = src.indexOf('function renderTab(name)');
const fineRt = src.indexOf('} catch (e) {', iRt);
const corpoRt = src.slice(iRt, fineRt);
const rami = {};
[...corpoRt.matchAll(/name === '([a-z_]+)'\)\s*\n?\s*([A-Za-z]+)\(root\)/g)]
  .forEach(m => { rami[m[1]] = m[2]; });
// Gli alias: `if (name === 'x') name = 'y';`
const alias = {};
[...corpoRt.matchAll(/name === '([a-z_]+)'(?:\s*\|\|\s*name === '([a-z_]+)')*\)\s*name = '([a-z_]+)'/g)]
  .forEach(m => { alias[m[1]] = m[3]; if (m[2]) alias[m[2]] = m[3]; });
// La forma con piu' id in OR va ripresa a mano: la regex sopra tiene solo i primi due.
[...corpoRt.matchAll(/if \(([^)]*name === '[a-z_]+'[^)]*)\) name = '([a-z_]+)';/g)].forEach(m => {
  [...m[1].matchAll(/name === '([a-z_]+)'/g)].forEach(x => { alias[x[1]] = m[2]; });
});

sez('CHI DISEGNA COSA — ' + idMenu.length + ' schede nei menu');
idMenu.forEach(id => {
  const finale = alias[id] || id;
  const fn = rami[finale];
  t(id + (alias[id] ? ' → ' + finale : '') + (fn ? '  (' + fn + ')' : ''), !!fn,
    'Nessun ramo in renderTab: questa scheda resterebbe BIANCA.');
});

sez('E LE FUNZIONI CHIAMATE ESISTONO');
Object.entries(rami).forEach(([id, fn]) => {
  t(fn, src.includes('function ' + fn + '('),
    'Il ramo `' + id + '` chiama una funzione che non esiste.');
});

sez('LA RETE DI SICUREZZA C E');
// ⚠ Questo controllo protegge il controllo: se un domani qualcuno togliesse
// l `else` finale, gli id sconosciuti tornerebbero a dare una pagina bianca
// silenziosa invece di un cartello.
t('renderTab ha un else finale che dichiara la scheda sconosciuta',
  /else\s*\{[\s\S]{0,400}?Scheda sconosciuta/.test(corpoRt),
  'Senza, un id che non combacia non da errore: la scheda resta bianca.');

// ── I rami morti: un ramo senza scheda nei menu e senza alias che ci porti ──
sez('NIENTE RAMI ORFANI');
const raggiungibili = new Set(idMenu.map(id => alias[id] || id));
Object.keys(rami).forEach(id => {
  if (raggiungibili.has(id)) { ok++; console.log('  ok   ' + id + ' e raggiungibile'); return; }
  ko++;
  console.log('  KO   ' + id + ' non e in nessun menu e nessun alias ci porta');
  console.log('       O va rimesso nei menu, o il ramo va tolto: sta li a non far niente.');
});

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

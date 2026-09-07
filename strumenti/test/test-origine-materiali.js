// Test dell'ORIGINE dei materiali — 7 set 2026.
// Nasce da una domanda di Nico: "non capisco perche' mi ritrovo all'interno
// il cod 83010FILO00101042GVM senza che sia in distinta".
// Non era un difetto: la distinta mostra UN livello, la lista della commessa
// mostra le foglie dopo l'esplosione. Mancava il filo fra le due cose, ed e'
// quello che `origini` adesso dichiara.
const M = require(require('path').resolve(process.argv[2] || '.', 'domain/materiali.js'));

let ok = 0, ko = 0;
const sez = t => console.log('\n' + t);
const t = (nome, cond) => { if (cond) { ok++; console.log('  ok   ' + nome); }
  else { ko++; console.log('  KO   ' + nome); } };
const org = (e, cod) => e.origini.has(cod) ? [...e.origini.get(cod)].sort() : null;

// Il caso vero: ENVIRO ha in distinta il cablaggio, il filo sta dentro il
// cablaggio. Nella distinta di ENVIRO il filo non si vede.
const ARTICOLI = [
  { codice: 'ENVIRO', distinta: [
    { codice: 'TS-342015G00', qta: 1, tipo: 'C/L' },
    { codice: 'GUARNIZIONE',  qta: 2, tipo: 'ACQ' } ] },
  { codice: 'TS-342015G00', distinta: [
    { codice: '83010FILO00101042GVM', qta: 3, tipo: 'ACQ' },
    { codice: 'FASTON',              qta: 4, tipo: 'MAC' } ] },
];
const esplodi = (radice, q, articoli) => {
  const figliDi = new Map();
  M.applicaDistinteProdotti(figliDi, articoli || ARTICOLI);
  return M.esplodiDistinta(radice, q, figliDi);
};

sez('IL CASO DI NICO: il filo dice da dove viene');
{
  const e = esplodi('ENVIRO', 1);
  t('il filo c e fra i materiali', e.materiali.has('83010FILO00101042GVM'));
  t('e dichiara il cablaggio da cui arriva',
    String(org(e, '83010FILO00101042GVM')) === 'TS-342015G00');
  t('il cablaggio stesso NON e un materiale', !e.materiali.has('TS-342015G00'));
}
{
  const e = esplodi('ENVIRO', 1);
  // Chi sta gia' scritto nella distinta non ha origine da dichiarare: e' li'
  // dove lo si e' messo, e dirlo sarebbe rumore.
  t('un materiale di primo livello non ha origine', org(e, 'GUARNIZIONE') === null);
}
{
  const e = esplodi('ENVIRO', 1);
  t('vale anche per il consumo dentro un sottoassieme',
    e.consumo.has('FASTON') && String(org(e, 'FASTON')) === 'TS-342015G00');
}

sez('LO STESSO CODICE SOTTO DUE SOTTOASSIEMI: si dicono tutti e due');
{
  // Dirne uno solo manderebbe a cercarlo nel posto sbagliato meta delle volte.
  const e = esplodi('P', 2, [
    { codice: 'P', distinta: [{ codice: 'SUB-A', qta: 1 }, { codice: 'SUB-B', qta: 1 }] },
    { codice: 'SUB-A', distinta: [{ codice: 'VITE', qta: 2 }] },
    { codice: 'SUB-B', distinta: [{ codice: 'VITE', qta: 3 }] },
  ]);
  t('le quantita si sommano', e.materiali.get('VITE') === 10);
  t('e le origini sono due', String(org(e, 'VITE')) === 'SUB-A,SUB-B');
}

sez('TRE LIVELLI: comanda il sottoassieme che lo contiene davvero');
{
  const e = esplodi('P', 1, [
    { codice: 'P',     distinta: [{ codice: 'SUB-1', qta: 1 }] },
    { codice: 'SUB-1', distinta: [{ codice: 'SUB-2', qta: 1 }] },
    { codice: 'SUB-2', distinta: [{ codice: 'PERNO', qta: 5 }] },
  ]);
  t('il perno viene da SUB-2, non da SUB-1', String(org(e, 'PERNO')) === 'SUB-2');
  t('ed e li che si va a modificarlo', !e.materiali.has('SUB-2'));
}

sez('Niente sottoassiemi: nessuna origine, nessun rumore');
{
  const e = esplodi('SEMPLICE', 1, [
    { codice: 'SEMPLICE', distinta: [{ codice: 'A', qta: 1 }, { codice: 'B', qta: 2 }] },
  ]);
  t('nessuna riga porta un origine', e.origini.size === 0);
}

sez('Un ANELLO non manda in tilt la provenienza');
{
  const e = esplodi('X', 1, [
    { codice: 'X', distinta: [{ codice: 'Y', qta: 1 }] },
    { codice: 'Y', distinta: [{ codice: 'X', qta: 1 }] },
  ]);
  t('il ciclo si dichiara', e.cicli.size > 0);
}

console.log('\n' + ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

// RIUNIONI — regole pure sulle azioni decise in riunione (14 ott 2026).
// Niente DOM, niente Supabase: le usa la scheda Riunioni e le prova
// `strumenti/test/test-riunioni.js`.
//
// Un'azione: { punto, argomento, azione, scadenza 'YYYY-MM-DD'|null,
//              urgente bool, responsabili [id utente], stato 'aperta'|'fatta'|'annullata',
//              fatta_il, commenti, riunione_id, ordine }

// Quanti giorni prima della scadenza un'azione aperta diventa "in scadenza".
const RIU_GIORNI_VICINA = 3;

// Differenza in giorni fra due date ISO (b - a), a mezzogiorno per non
// inciampare nel cambio d'ora.
function riuGiorniFra(aIso, bIso) {
  const a = new Date(aIso + 'T12:00:00'), b = new Date(bIso + 'T12:00:00');
  return Math.round((b - a) / 86400000);
}

// La condizione di un'azione rispetto a oggi. Ordine delle domande voluto:
// chiusa batte tutto; poi la data (scaduta e' piu' grave di "urgente"
// generico); poi l'urgenza; poi la vicinanza.
//   'fatta' | 'annullata' | 'scaduta' | 'urgente' | 'vicina' | 'ok' | 'senza'
function riuCondizione(a, oggiIso) {
  if (!a) return 'senza';
  if (a.stato === 'fatta') return 'fatta';
  if (a.stato === 'annullata') return 'annullata';
  if (a.scadenza) {
    const g = riuGiorniFra(oggiIso, a.scadenza);
    if (g < 0) return 'scaduta';
    if (a.urgente) return 'urgente';
    if (g <= RIU_GIORNI_VICINA) return 'vicina';
    return 'ok';
  }
  return a.urgente ? 'urgente' : 'senza';
}

// Peso per ordinare "cosa guardare prima": scadute, urgenti, vicine,
// con data, senza data; le chiuse in fondo.
const RIU_PESO = { scaduta: 0, urgente: 1, vicina: 2, ok: 3, senza: 4, fatta: 8, annullata: 9 };

function riuOrdinaDaFare(azioni, oggiIso) {
  return azioni.slice().sort((x, y) => {
    const px = RIU_PESO[riuCondizione(x, oggiIso)], py = RIU_PESO[riuCondizione(y, oggiIso)];
    if (px !== py) return px - py;
    const sx = x.scadenza || '9999', sy = y.scadenza || '9999';
    if (sx !== sy) return sx < sy ? -1 : 1;
    return (x.riunione_id - y.riunione_id) || ((x.ordine || 0) - (y.ordine || 0)) || (x.id - y.id);
  });
}

// I responsabili sono gli id degli UTENTI registrati (tabella `utenti`),
// non testo: il nome si legge dall'anagrafica, esatto e sempre aggiornato
// (14 ott, Nico: "nome e cognome esattamente come sono registrati").
// L'azione e' di questa persona? `utenteId` = l'utente legato all'account.
function riuEDi(a, utenteId) {
  if (!utenteId) return false;
  return (a.responsabili || []).indexOf(utenteId) >= 0;
}

// I conti per il riepilogo in cima alla scheda.
function riuConteggi(azioni, oggiIso) {
  const c = { aperte: 0, scadute: 0, urgenti: 0, vicine: 0, fatte: 0, annullate: 0 };
  azioni.forEach(a => {
    const k = riuCondizione(a, oggiIso);
    if (k === 'fatta') c.fatte++;
    else if (k === 'annullata') c.annullate++;
    else {
      c.aperte++;
      if (k === 'scaduta') c.scadute++;
      else if (k === 'urgente') c.urgenti++;
      else if (k === 'vicina') c.vicine++;
    }
  });
  return c;
}

// Le persone usate come responsabili (id), le piu' frequenti prima;
// a parita', nell'ordine dato da `nomeDi` (alfabetico).
function riuPersoneUsate(azioni, nomeDi) {
  const n = new Map();
  azioni.forEach(a => (a.responsabili || []).forEach(id => { if (id) n.set(id, (n.get(id) || 0) + 1); }));
  const nome = nomeDi || (x => String(x));
  return [...n.entries()].sort((a, b) => b[1] - a[1] || nome(a[0]).localeCompare(nome(b[0]))).map(e => e[0]);
}

if (typeof module !== 'undefined') module.exports = {
  RIU_GIORNI_VICINA, riuGiorniFra, riuCondizione, riuOrdinaDaFare,
  riuEDi, riuConteggi, riuPersoneUsate,
};

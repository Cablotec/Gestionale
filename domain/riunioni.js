// RIUNIONI — regole pure sulle azioni decise in riunione (14 ott 2026).
// Niente DOM, niente Supabase: le usa la scheda Riunioni e le prova
// `strumenti/test/test-riunioni.js`.
//
// Un'azione: { punto, argomento, azione, scadenza 'YYYY-MM-DD'|null,
//              urgente bool, responsabili [testo], stato 'aperta'|'fatta'|'annullata',
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

// "Claudio/Cocco, Alessandra" → ['Claudio','Cocco','Alessandra'].
// Separatori: / , ; e la parola "e". Doppioni (anche di maiuscole) tolti,
// vince la forma scritta per prima.
function riuResponsabiliDaTesto(testo) {
  const visti = new Set(), out = [];
  String(testo || '').split(/[\/,;]|\s+e\s+/i).forEach(p => {
    const n = p.trim().replace(/\s+/g, ' ');
    if (!n) return;
    const k = n.toLowerCase();
    if (visti.has(k)) return;
    visti.add(k); out.push(n);
  });
  return out;
}

// L'azione e' di questa persona? Nel file si scrive il NOME ("Claudio"),
// a volte nome e cognome. Combacia il nome completo o il solo nome di
// battesimo del profilo, senza badare alle maiuscole.
function riuEDi(a, nomeProfilo) {
  const pieno = String(nomeProfilo || '').trim().toLowerCase();
  if (!pieno) return false;
  const primo = pieno.split(/\s+/)[0];
  return (a.responsabili || []).some(r => {
    const x = String(r).trim().toLowerCase();
    return x === pieno || x === primo;
  });
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

// Tutti i nomi usati come responsabili, per i suggerimenti e i filtri,
// in ordine di frequenza (i piu' usati prima).
function riuNomiUsati(azioni) {
  const n = new Map();
  azioni.forEach(a => (a.responsabili || []).forEach(r => {
    const k = String(r).trim();
    if (k) n.set(k, (n.get(k) || 0) + 1);
  }));
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0]);
}

if (typeof module !== 'undefined') module.exports = {
  RIU_GIORNI_VICINA, riuGiorniFra, riuCondizione, riuOrdinaDaFare,
  riuResponsabiliDaTesto, riuEDi, riuConteggi, riuNomiUsati,
};

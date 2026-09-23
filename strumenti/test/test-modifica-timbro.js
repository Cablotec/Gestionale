// Modificare un timbro non deve spostarlo di nascosto.
//
// 23 set 2026, segnalato da Claudio Benini su Ryan Gagliani (giovedi 17):
// cancellata la timbratura 11:00→12:30, poi impossibile prolungare quella
// 10:38→11:00 — *"esce il messaggio che si sovrappone ad un'altra timbratura
// che non c'e'"*. E infatti a schermo non c'era: erano **164 millisecondi**.
//
// Il campo `datetime-local` arriva ai SECONDI. Il timbro comincia alle
// `08:38:02.164`, nell'istante esatto in cui finisce il precedente (le quote
// di un gruppo sono fette consecutive). Rileggere il campo e rispedirlo
// riportava l'inizio a `.000`, cioe' 164 ms PRIMA — una sovrapposizione vera,
// invisibile sullo schermo dove tutti e due dicono `10:38`.
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || '.';
const src = fs.readFileSync(path.join(base, 'app.js'), 'utf8');

function estrai(nome) {
  let i = src.indexOf('function ' + nome + '(');
  if (i < 0) {
    // ⚠ Arrow su UNA riga: si prende la riga intera. Contare le graffe non
    // funziona, perche' dentro un template literal `${...}` ce ne sono gia'
    // — la prima si apre e si chiude subito e il corpo esce troncato.
    const j = src.indexOf('const ' + nome + ' =');
    if (j < 0) throw new Error('non trovata: ' + nome);
    const resto = src.slice(j);
    const nl = resto.indexOf(String.fromCharCode(10));
    return nl < 0 ? resto : resto.slice(0, nl);
  }
  if (src.slice(Math.max(0, i - 6), i) === 'async ') i -= 6;
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(i, k + 1); }
  }
  throw new Error('corpo non chiuso: ' + nome);
}

const z = (n) => String(n).padStart(2, '0');
// ⚠ `const` dichiarata dentro `eval` resta prigioniera dell'eval e non si vede
// da fuori; `var` invece esce. Le `function` escono da sole.
eval(estrai('dtLocalStr').replace(/^const /, 'var '));
eval(estrai('istanteDaCampo'));

let ok = 0, ko = 0;
const t = (nome, atteso, avuto) => {
  if (JSON.stringify(atteso) === JSON.stringify(avuto)) { ok++; return; }
  ko++;
  console.log('  KO ' + nome + '\n     atteso ' + JSON.stringify(atteso) + '\n     avuto  ' + JSON.stringify(avuto));
};

// I dati VERI del caso Ryan (17 set). Le due quote sono incatenate al ms.
const ISO_INIZIO = '2026-09-17T08:38:02.164+00:00';
const ISO_FINE   = '2026-09-17T09:00:53.164+00:00';
const PREC_FINE  = '2026-09-17T08:38:02.164+00:00';   // fine della quota prima
const inizioDt = new Date(ISO_INIZIO);
const fineDt = new Date(ISO_FINE);

// 1. campo non toccato → l'istante originale resta identico, millisecondi compresi
t('inizio non toccato resta intatto', ISO_INIZIO,
  istanteDaCampo(dtLocalStr(inizioDt), inizioDt, ISO_INIZIO));

// 2. campo cambiato → si riscrive davvero
const nuovaFine = istanteDaCampo('2026-09-17T12:30:00', fineDt, ISO_FINE);
t('fine cambiata viene riscritta', '2026-09-17T10:30:00.000Z', nuovaFine);

// 3. campo svuotato → sessione aperta
t('fine svuotata = aperta', null, istanteDaCampo('', fineDt, ISO_FINE));

// 4. senza originale (sessione nuova) si converte e basta
t('senza originale si converte', '2026-09-17T10:30:00.000Z',
  istanteDaCampo('2026-09-17T12:30:00', null, null));

// 5. ⚠ IL CASO DI CLAUDIO: cambiando solo la fine, l'inizio non deve
//    scivalare dentro il timbro precedente.
const inizioSalvato = istanteDaCampo(dtLocalStr(inizioDt), inizioDt, ISO_INIZIO);
const a1 = new Date(inizioSalvato).getTime();
const b2 = new Date(PREC_FINE).getTime();
t('nessuna sovrapposizione col timbro precedente', false, a1 < b2);
t('gli estremi si toccano esattamente', 0, b2 - a1);

// 6. ⚠ La regola NON e' stata allargata: 164 ms di sovrapposizione VERA
//    (inizio spostato a mano) restano un conflitto.
const spostatoAMano = istanteDaCampo('2026-09-17T10:38:01', inizioDt, ISO_INIZIO);
t('un inizio spostato davvero si riscrive', '2026-09-17T08:38:01.000Z', spostatoAMano);
t('e allora si sovrappone, come deve', true, new Date(spostatoAMano).getTime() < b2);

console.log(ok + ' ok, ' + ko + ' ko');
process.exit(ko ? 1 : 0);

-- EVENTI AZIENDALI — 16 set 2026.
-- Da eseguire dal pannello Supabase (SQL Editor), non da qui.
--
-- ⚠⚠ PERCHE' UNA TABELLA NUOVA E NON UNA COLONNA SU `chiusure_aziendali`.
-- Ogni lettore di `chiusure_aziendali` interpreta una riga come "questo giorno
-- non si lavora": il motore di pianificazione, gli sfondi del Gantt, il
-- calendario, il telefono. Bastava dimenticare un filtro in uno di quei punti
-- e un pranzo sarebbe diventato una chiusura aziendale in silenzio, col
-- pianificatore che smette di programmare quel giorno.
-- Qui il motore non vede mai questa tabella: il calendario le unisce solo per
-- MOSTRARLE. Unire per disegnare va bene; a non doversi mai confondere e' la
-- regola.
--
-- ⚠ UN EVENTO NON TOGLIE TEMPO DI LAVORO (deciso da Nico, 16 set). Se in quel
-- giorno non si lavora, quella e' una chiusura e va in `chiusure_aziendali`.
-- Per questo qui NON c'e' nessuna colonna tipo `blocca_lavoro`: e' proprio
-- cio' che rende sicuro tenere le due tabelle separate.
--
-- ⚠ Niente colonna `tipo`: "pranzo" o "riunione" e' il TITOLO, e l'icona la
-- sceglie chi crea l'evento. Un elenco di tipi qui dentro sarebbe una regola
-- scritta dove non la si puo' cambiare senza toccare il codice.

create table if not exists eventi (
  id          uuid primary key default gen_random_uuid(),
  data        date not null,
  data_fine   date,            -- null = un giorno solo
  ora         text,            -- '12:30' · null = tutto il giorno
  titolo      text not null,   -- 'Pranzo aziendale'
  descrizione text,
  luogo       text,
  icona       text,            -- ⚠ NON PIU USATA dal 16 set: il campo e stato
                               -- tolto dal form il giorno dopo averlo messo
                               -- (scegliere un emoji e un gesto in piu a ogni
                               -- evento, per un segno che dice solo "qui c e
                               -- qualcosa"). La colonna resta: non si droppa
                               -- una colonna per un campo tolto, si smette di
                               -- usarla e lo si scrive.
  colore      text,
  creato_il   timestamptz default now()
);

create index if not exists eventi_data_idx on eventi (data);

alter table eventi enable row level security;

-- Lettura a tutti gli autenticati: gli operatori lo vedono dal telefono.
-- Scrittura idem, come per le altre anagrafiche di calendario: il freno sta
-- nella UI (la sezione e' sotto Gestione, che e' adminOnly).
-- ⚠ E un freno nella UI e' un freno per modo di dire: se un domani serve
-- davvero, la policy va stretta qui, non nella schermata.
drop policy if exists eventi_lettura on eventi;
create policy eventi_lettura on eventi
  for select to authenticated using (true);

drop policy if exists eventi_scrittura on eventi;
create policy eventi_scrittura on eventi
  for all to authenticated using (true) with check (true);

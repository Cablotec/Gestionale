-- ═══════════════════════════════════════════════════════════════════
-- movimenti_magazzino  (13 ott 2026)
--
-- L'INGRESSO MERCI del gestionale, primo mattone del magazzino proprio
-- (decisione di Nico: "un giorno Alnus sarà sorpassato dal nostro
-- gestionale"). Pilota: Enviro di Tema (TS-342010003, ordine Tema
-- 4700000327), gestito interamente da Nico apposta per la prova.
--
-- DA DOVE ARRIVANO LE RIGHE: dai DDT letti in automatico.
-- `C:\Users\User032\Desktop\DDT_arrivi\watcher.ps1` sorveglia la cartella
-- delle scansioni (\\srv02\scansioni\User032), dove finiscono sia i DDT
-- cartacei scansionati sia i PDF digitali salvati dalla mail. Claude legge
-- il documento e `registra.py` scrive qui con l'account ai@cablotec.local.
--
-- FORMA: una riga = un MOVIMENTO di un codice, non "un arrivo DDT".
-- Oggi esistono solo i carichi da DDT; domani in questa stessa tabella
-- entrano scarichi per produzione, resi e rettifiche. La giacenza e' la
-- SOMMA DEI MOVIMENTI: `qta` ha il segno (carico +, scarico −), cosi' il
-- conto e' un sum() e non un case su `tipo`.
--
-- ⚠⚠ UN MOVIMENTO NON SI CORREGGE E NON SI CANCELLA: se ne scrive un altro.
-- Un DDT letto male si sistema con una RETTIFICA (stesso codice, qta di
-- segno opposto, nota col perche'), non riscrivendo la riga. E' la stessa
-- ragione per cui `ore_esterne` congela la tariffa: un fatto avvenuto non
-- si riscrive, e chi guarda lo storico deve poter vedere anche l'errore.
-- Per questo NESSUNO ha UPDATE o DELETE (nemmeno ai@): se un giorno
-- servisse davvero cancellare, si fa dal pannello.
--
-- ⚠ FONTE DELLA GIACENZA: finche' un codice e' contato da Alnus, i suoi
-- carichi qui sono INFORMAZIONE ("arrivato con DDT ..."), non si sommano
-- alla giacenza Alnus: lo stesso pezzo conterebbe due volte appena il
-- magazzino carica il DDT anche in Alnus. Quale prodotto passa al conto del
-- gestionale (Enviro per primo) si decide nel passo della vista, con una
-- colonna additiva che Claude aggiunge da solo con mig_aggiungi_colonna.
--
-- DOPPIONI: lo stesso DDT riletto (scansionato due volte, o arrivato sia
-- di carta sia via mail) non deve caricare due volte. L'indice unico su
-- documento + posizione lo rende IMPOSSIBILE, non solo evitato dallo
-- script: un secondo INSERT viene respinto con un errore, non ignorato.
-- ═══════════════════════════════════════════════════════════════════

create table if not exists movimenti_magazzino (
  id                uuid primary key default gen_random_uuid(),
  data              date not null,            -- quando e' avvenuto (per un DDT: la sua data)
  tipo              text not null check (tipo in ('carico', 'scarico', 'rettifica')),
  codice            text not null,            -- codice NOSTRO: 'TS-536000577'
  codice_mittente   text,                     -- com'e' scritto sul documento: '536000577'
  descrizione       text,
  qta               numeric not null,         -- con segno: carico +, scarico −
  um                text,
  mittente          text,                     -- ragione sociale letta sul documento
  azienda_id        uuid references aziende(id) on delete set null,
  documento_tipo    text,                     -- 'DDT'
  documento_numero  text,                     -- '1000003813'
  documento_data    date,
  documento_pos     text,                     -- posizione sul documento: '000440'
  ordine_rif        text,                     -- ordine di riferimento: '4700000327'
  note              text,                     -- annotazioni a mano, dubbi di lettura
  file              text,                     -- nome del file da cui e' stato letto
  creato_da         text default lower(coalesce(auth.jwt() ->> 'email', '')),
  creato_il         timestamptz default now()
);

create index if not exists movimenti_magazzino_codice_idx on movimenti_magazzino (codice);
create index if not exists movimenti_magazzino_ordine_idx on movimenti_magazzino (ordine_rif);
create unique index if not exists movimenti_magazzino_documento_uq
  on movimenti_magazzino (documento_tipo, mittente, documento_numero, documento_pos)
  where documento_numero is not null;

-- Le due serrature (vedi CLAUDE.md): il GRANT e la RLS. Niente `to anon`.
grant select, insert, update, delete on public.movimenti_magazzino to authenticated;
grant select, insert, update, delete on public.movimenti_magazzino to service_role;

alter table movimenti_magazzino enable row level security;

-- Leggere: tutti gli autenticati (gestionale, telefono, kiosk).
drop policy if exists movimenti_lettura on movimenti_magazzino;
create policy movimenti_lettura on movimenti_magazzino
  for select to authenticated using (true);

-- Scrivere: per ora SOLO l'automazione DDT. Quando dal gestionale si potra'
-- registrare un movimento a mano, la policy si allarga QUI, non nella UI.
-- UPDATE e DELETE: nessuna policy, di proposito (vedi sopra).
drop policy if exists movimenti_inserimento_claude on movimenti_magazzino;
create policy movimenti_inserimento_claude on movimenti_magazzino
  for insert to authenticated
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'ai@cablotec.local');

-- ── VERIFICA ───────────────────────────────────────────────────────────
-- Deve rispondere due righe: movimenti_inserimento_claude (INSERT) e
-- movimenti_lettura (SELECT), piu' righe = 0.
select policyname, cmd,
       (select count(*) from movimenti_magazzino) as righe
from pg_policies
where schemaname = 'public' and tablename = 'movimenti_magazzino'
order by policyname;

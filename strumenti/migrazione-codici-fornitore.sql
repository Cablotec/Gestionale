-- ── CODICI FORNITORE SUI NOSTRI CODICI (19 nov 2026) ────────────────────
-- Nico: "per ogni codice nostro, all'interno della sua scheda voglio poter
-- mettere uno o piu' cod. fornitori".
-- Una riga = un nostro codice come lo chiama UN fornitore (Fabbi lo chiama
-- "FB123", Comet "CM-77"). Un nostro codice ne puo' avere quanti servono.
--
-- Tabella a se' e non colonna su `materiali`: vale anche per codici che
-- l'anagrafica materiali non ha (TS-, codici nuovi), e l'indice unico
-- impedisce che lo stesso codice di un fornitore punti a due nostri codici
-- (il DDT scansionato non saprebbe quale scegliere).
--
-- Chi la usa: la scheda del codice (lettura a tutti, scrittura admin), il
-- carico a mano di un DDT e l'automazione delle scansioni (ai@ legge): un
-- DDT che riporta solo il codice del fornitore si traduce nel nostro.

create table if not exists public.codici_fornitore (
  id                uuid primary key default gen_random_uuid(),
  codice            text not null,                       -- nostro codice
  azienda_id        uuid not null references public.aziende(id) on delete cascade,
  codice_fornitore  text not null,                       -- come lo scrive il fornitore
  nota              text,
  creato_il         timestamptz default now(),
  creato_da         text default lower(coalesce(auth.jwt() ->> 'email', ''))
);
create unique index if not exists codici_fornitore_uq
  on public.codici_fornitore (azienda_id, upper(trim(codice_fornitore)));
create index if not exists codici_fornitore_codice_idx on public.codici_fornitore (upper(trim(codice)));

-- Le due serrature (vedi CLAUDE.md): GRANT e RLS. Niente `to anon`.
grant select, insert, update, delete on public.codici_fornitore to authenticated;
grant select, insert, update, delete on public.codici_fornitore to service_role;
alter table public.codici_fornitore enable row level security;

drop policy if exists codici_fornitore_lettura on public.codici_fornitore;
create policy codici_fornitore_lettura on public.codici_fornitore
  for select to authenticated using (true);
drop policy if exists codici_fornitore_scrive on public.codici_fornitore;
create policy codici_fornitore_scrive on public.codici_fornitore
  for insert to authenticated
  with check (exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists codici_fornitore_modifica on public.codici_fornitore;
create policy codici_fornitore_modifica on public.codici_fornitore
  for update to authenticated
  using (exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin'))
  with check (exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists codici_fornitore_elimina on public.codici_fornitore;
create policy codici_fornitore_elimina on public.codici_fornitore
  for delete to authenticated
  using (exists (select 1 from public.profili where id = auth.uid() and ruolo = 'admin'));

select 'CODICI FORNITORE PRONTI · righe: ' || count(*) as esito from public.codici_fornitore;

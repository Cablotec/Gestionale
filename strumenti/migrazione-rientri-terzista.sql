-- ── RIENTRI DAL TERZISTA (17 nov 2026) ─────────────────────────────────
-- Il passo «Rientro (DDT)» del ciclo produttivo: il semilavorato torna dal
-- terzista col SUO DDT. Si registra data, numero del suo DDT e pezzi
-- rientrati, per commessa. Piu' rientri parziali sono normali (5 + 5 pz).
-- ⚠ Non muove la giacenza: il materiale presso il terzista lo scarica il
-- lotto (`mov_scarica_lotto`, per quota); gli avanzi tornano in sede con
-- `mov_rientro_in_sede`. Questa tabella dice solo COSA E' TORNATO E QUANDO.
-- Lettura a tutti gli autenticati; scrivere ed eliminare solo l'admin.

create table if not exists rientri_terzista (
  id            uuid primary key default gen_random_uuid(),
  operazione_id uuid not null references operazioni(id) on delete cascade,
  terzista_id   uuid not null references aziende(id) on delete restrict,
  data          date not null default current_date,
  ddt_numero    text,
  pezzi         numeric not null check (pezzi > 0),
  nota          text,
  creato_il     timestamptz not null default now(),
  creato_da     uuid default auth.uid()
);
create index if not exists rientri_terzista_operazione on rientri_terzista (operazione_id);

grant select, insert, delete on public.rientri_terzista to authenticated;
grant select, insert, update, delete on public.rientri_terzista to service_role;
alter table rientri_terzista enable row level security;

drop policy if exists rientri_terzista_lettura on rientri_terzista;
create policy rientri_terzista_lettura on rientri_terzista for select to authenticated using (true);
drop policy if exists rientri_terzista_crea on rientri_terzista;
create policy rientri_terzista_crea on rientri_terzista for insert to authenticated
  with check (exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));
drop policy if exists rientri_terzista_elimina on rientri_terzista;
create policy rientri_terzista_elimina on rientri_terzista for delete to authenticated
  using (exists (select 1 from profili where id = auth.uid() and ruolo = 'admin'));

select 'RIENTRI TERZISTA PRONTI · righe: ' || count(*) as esito from rientri_terzista;

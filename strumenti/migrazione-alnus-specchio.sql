-- ── LO SPECCHIO DI ALNUS (20 nov 2026) ──────────────────────────────────
-- Nico: un passo verso l'indipendenza da Alnus. Il gestionale tiene una
-- copia del magazzino di Alnus, SEPARATA dai nostri `movimenti_magazzino`
-- (che hanno gia' i DDT scansionati e i lotti Enviro: mescolarli
-- conterebbe due volte gli stessi fatti), e con quella calcola il SUO
-- «da ordinare» da mettere accanto a quello di Alnus.
--
--   giacenza Alnus = fotografia d'APERTURA + movimenti successivi
--   OF in arrivo   = residua della fotografia OF − carichi EA1 successivi
--
-- Tre file di Alnus: «Stampa Giacenze di Magazzino» (CAPRTGIA), «Stampa
-- movimenti di magazzino» (CAPRTMVMP), l'estrazione degli OF aperti (xlsx).
-- Una fotografia OF nuova sostituisce la precedente; le giacenze no: la
-- prima e' l'apertura, le altre sono controlli.
-- Admin: ci sono prezzi e valori. Scrivono solo gli admin, dall'app.

create table if not exists public.alnus_fotografie (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null check (tipo in ('giacenze', 'of')),
  preso_il   timestamptz not null,           -- quando Alnus ha fatto la stampa
  apertura   boolean not null default false, -- giacenze: punto di partenza
  righe      integer,
  file       text,
  creato_il  timestamptz default now(),
  creato_da  text default lower(coalesce(auth.jwt() ->> 'email', ''))
);

create table if not exists public.alnus_giacenze (
  id            bigint generated always as identity primary key,
  fotografia_id uuid not null references public.alnus_fotografie(id) on delete cascade,
  codice        text not null,
  descrizione   text,
  um            text,
  magazzino     text not null,
  qta           numeric not null
);
create index if not exists alnus_giacenze_foto_idx on public.alnus_giacenze (fotografia_id);

create table if not exists public.alnus_of_righe (
  id               bigint generated always as identity primary key,
  fotografia_id    uuid not null references public.alnus_fotografie(id) on delete cascade,
  anno             integer not null,
  sezionale        text,                     -- OF acquisto, OL conto lavoro
  numero           integer not null,
  riga             integer,
  codice           text not null,
  descrizione      text,
  fornitore        text,                     -- nomignolo di Alnus
  codice_fornitore text,
  um               text,
  qta_ordinata     numeric,
  qta_residua      numeric not null,         -- in UM interna
  consegna         date,
  prezzo           numeric,
  odl              text
);
create index if not exists alnus_of_righe_foto_idx on public.alnus_of_righe (fotografia_id);

create table if not exists public.alnus_movimenti (
  id          bigint generated always as identity primary key,
  eser        integer not null,
  numero      bigint not null,
  causale     text not null,
  codice      text not null,
  descrizione text,
  magazzino   text not null,
  qta         numeric not null,               -- col segno
  um          text,
  data        timestamptz not null,
  tipo_doc    text,
  anno_doc    integer,
  numero_doc  text,
  soggetto    text,
  bolla       text,
  prezzo      numeric,
  operatore   text,
  importato_il timestamptz default now(),
  -- La stessa riga non entra due volte, anche con periodi sovrapposti.
  constraint alnus_movimenti_uq unique (eser, numero, causale)
);
create index if not exists alnus_movimenti_data_idx on public.alnus_movimenti (data);

-- Le due serrature (vedi CLAUDE.md): GRANT e RLS. Niente `to anon`.
do $$
declare t text;
begin
  foreach t in array array['alnus_fotografie', 'alnus_giacenze', 'alnus_of_righe', 'alnus_movimenti'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin', t);
    execute format('create policy %I on public.%I for all to authenticated '
      || 'using (exists (select 1 from public.profili where id = auth.uid() and ruolo = ''admin'')) '
      || 'with check (exists (select 1 from public.profili where id = auth.uid() and ruolo = ''admin''))', t || '_admin', t);
  end loop;
end $$;

select 'SPECCHIO ALNUS PRONTO · fotografie: ' || (select count(*) from public.alnus_fotografie)
  || ' · movimenti: ' || (select count(*) from public.alnus_movimenti) as esito;

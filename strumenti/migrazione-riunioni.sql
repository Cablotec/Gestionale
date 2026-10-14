-- RIUNIONI — azioni decise in riunione, chi le fa, entro quando (14 ott 2026)
--
-- Chiesto da Nico, dal file del verbale del 1 ottobre: una sezione che vedono
-- SOLO i partecipanti alle riunioni (sei persone, in `riunioni_membri`).
--
-- ⚠⚠ IL "SOLO LORO" STA NEL DATABASE, NON NEL MENU. Nascondere la scheda e'
-- cortesia: chi ha un account potrebbe comunque leggere la tabella con la
-- chiave pubblica. Qui la RLS chiede `membro_riunioni()`, e chi non e' nella
-- lista riceve zero righe anche chiedendo a mano. Non tutti i membri sono
-- admin, e non tutti gli admin sono membri: per questo la regola NON e' il ruolo.
--
-- ⚠ La lista dei membri si cambia SOLO da qui (pannello SQL): nessuna policy
-- di scrittura su `riunioni_membri`, altrimenti un membro potrebbe aggiungere
-- chiunque. In fondo al file i due comandi per aggiungere/togliere.
--
-- ⚠ Nessun nome ne' contenuto di riunione in questo file: il repo e' pubblico.
--
-- ⚠ Dal 30 ott le tabelle nuove nascono mute: i GRANT sono qui dentro.
-- Niente `to anon`.

begin;

-- ── Chi puo' entrare ───────────────────────────────────────────────
create table public.riunioni_membri (
  profilo_id  uuid primary key references public.profili(id) on delete cascade,
  aggiunto_il timestamptz not null default now()
);

-- security definer: legge la lista anche dove la RLS di riunioni_membri
-- non lascerebbe guardare. Ritorna solo vero/falso per CHI CHIEDE.
create or replace function public.membro_riunioni()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.riunioni_membri where profilo_id = auth.uid());
$$;
revoke all on function public.membro_riunioni() from public;
grant execute on function public.membro_riunioni() to authenticated;

-- ── Le riunioni ────────────────────────────────────────────────────
create table public.riunioni (
  id         bigint generated always as identity primary key,
  data       date not null,
  titolo     text,
  note       text,
  creato_da  uuid default auth.uid() references public.profili(id) on delete set null,
  creato_il  timestamptz not null default now()
);

-- ── Le azioni (una riga del file Excel) ────────────────────────────
-- urgente = "URGENTE" scritto al posto della data: si tiene separato perche'
-- una scadenza la si puo' aggiungere dopo senza perdere l'urgenza.
-- stato fatta + fatta_il null e' ammesso: nel file c'e' "ok" senza data.
create table public.riunioni_azioni (
  id            bigint generated always as identity primary key,
  riunione_id   bigint not null references public.riunioni(id) on delete restrict,
  punto         text not null,
  argomento     text,
  azione        text not null,
  scadenza      date,
  urgente       boolean not null default false,
  responsabili  text[] not null default '{}',
  stato         text not null default 'aperta' check (stato in ('aperta','fatta','annullata')),
  fatta_il      date,
  commenti      text,
  ordine        int not null default 0,
  creato_da     uuid default auth.uid() references public.profili(id) on delete set null,
  creato_il     timestamptz not null default now(),
  modificato_da uuid references public.profili(id) on delete set null,
  modificato_il timestamptz
);
create index riunioni_azioni_riunione on public.riunioni_azioni (riunione_id);

-- Chi ha toccato per ultimo, scritto dal database (non si fida della pagina).
create or replace function public.riunioni_azioni_modificata()
returns trigger language plpgsql as $$
begin
  new.modificato_il := now();
  new.modificato_da := auth.uid();
  return new;
end $$;
create trigger riunioni_azioni_modificata before update on public.riunioni_azioni
  for each row execute function public.riunioni_azioni_modificata();

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.riunioni_membri enable row level security;
alter table public.riunioni        enable row level security;
alter table public.riunioni_azioni enable row level security;

create policy riunioni_membri_leggi on public.riunioni_membri
  for select to authenticated using (public.membro_riunioni());

create policy riunioni_tutto on public.riunioni
  for all to authenticated
  using (public.membro_riunioni()) with check (public.membro_riunioni());

create policy riunioni_azioni_tutto on public.riunioni_azioni
  for all to authenticated
  using (public.membro_riunioni()) with check (public.membro_riunioni());

-- Fino al 30 ott Supabase concede ancora tutto ad `anon` sulle tabelle nuove:
-- si toglie, cosi' la RLS non e' l'unica serratura (lezione del 22 set).
revoke all on public.riunioni_membri, public.riunioni, public.riunioni_azioni from anon;
grant select on public.riunioni_membri to authenticated;
grant select, insert, update, delete on public.riunioni        to authenticated;
grant select, insert, update, delete on public.riunioni_azioni to authenticated;
grant select, insert, update, delete on public.riunioni_membri to service_role;
grant select, insert, update, delete on public.riunioni        to service_role;
grant select, insert, update, delete on public.riunioni_azioni to service_role;

-- ── Membri e verbale del 1 ottobre: NON in questo file ─────────────
-- ⚠⚠ Il repo e' PUBBLICO (Pages). Il contenuto delle riunioni e chi vi
-- partecipa sono proprio le cose che questa sezione tiene riservate: i loro
-- INSERT sono stati dati a Nico in chat e incollati a mano dal pannello.

commit;

-- ── Verifica, dopo gli INSERT dati in chat (6 · 1 · 7) ───────────────
select (select count(*) from public.riunioni_membri) as membri,
       (select count(*) from public.riunioni)        as riunioni,
       (select count(*) from public.riunioni_azioni) as azioni;

-- ── Per cambiare i membri in futuro ────────────────────────────────
-- aggiungere:  insert into public.riunioni_membri (profilo_id)
--              select id from public.profili where lower(email) = 'nome.cognome@cablotec.net';
-- togliere:    delete from public.riunioni_membri
--              where profilo_id = (select id from public.profili where lower(email) = 'nome.cognome@cablotec.net');

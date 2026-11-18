-- ── ORDINI FORNITORE (18 nov 2026) ────────────────────────────────────
-- Primo uso: l'ordine al TERZISTA fac simile (tipo 'terzista'). Un ordine
-- raggruppa piu' commesse dello stesso terzista; le righe sono una
-- FOTOGRAFIA presa alla creazione (prodotto, pezzi, €/pz, totale), cosi'
-- la ristampa esce identica anche se poi cambia la scheda prodotto.
-- Domani la stessa tabella regge gli OF d'acquisto (tipo 'acquisto':
-- Fabbi, Comet, Agencavi...), con righe di codici da comprare.
-- Numero: progressivo dell'anno, UNA serie per tutti gli ordini, assegnato
-- dal database (crea_ordine_fornitore) e mai ricalcolato. Un ordine non si
-- cancella: si annulla (annulla_ordine_fornitore), e le sue commesse
-- tornano libere per un ordine nuovo.
-- Lettura a tutti gli autenticati; creare e annullare solo l'admin, e
-- SOLO dalle due funzioni (nessun insert/update diretto dall'app).

create table if not exists ordini_fornitore (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null default 'terzista' check (tipo in ('terzista', 'acquisto')),
  anno         int  not null,
  numero       int  not null,
  fornitore_id uuid not null references aziende(id) on delete restrict,
  data         date not null default current_date,
  consegna     date,
  note         text,
  righe        jsonb not null default '[]'::jsonb,
  stato        text not null default 'emesso' check (stato in ('emesso', 'annullato')),
  creato_il    timestamptz not null default now(),
  creato_da    uuid default auth.uid(),
  annullato_il timestamptz,
  annullato_da uuid,
  unique (anno, numero)
);
create index if not exists ordini_fornitore_fornitore on ordini_fornitore (fornitore_id);

grant select on public.ordini_fornitore to authenticated;
grant select, insert, update, delete on public.ordini_fornitore to service_role;
alter table ordini_fornitore enable row level security;
drop policy if exists ordini_fornitore_lettura on ordini_fornitore;
create policy ordini_fornitore_lettura on ordini_fornitore for select to authenticated using (true);

-- Crea l'ordine col numero successivo dell'anno. Per i terzisti rifiuta una
-- commessa gia' in un ordine emesso allo stesso terzista.
create or replace function crea_ordine_fornitore(
  p_tipo text, p_fornitore uuid, p_data date, p_consegna date, p_note text, p_righe jsonb)
returns ordini_fornitore
language plpgsql security definer set search_path = public as $$
declare
  v_anno int := extract(year from coalesce(p_data, current_date))::int;
  v_num  int;
  v_doppia text;
  v_riga ordini_fornitore;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può creare un ordine fornitore';
  end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Un ordine senza righe non si crea';
  end if;
  if p_tipo = 'terzista' then
    select r->>'etichetta' into v_doppia
      from ordini_fornitore o, jsonb_array_elements(o.righe) r
     where o.stato = 'emesso' and o.tipo = 'terzista' and o.fornitore_id = p_fornitore
       and (r->>'operazione_id') in (select x->>'operazione_id' from jsonb_array_elements(p_righe) x)
     limit 1;
    if v_doppia is not null then
      raise exception 'La commessa % e'' gia'' in un ordine a questo terzista', v_doppia;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('ordini_fornitore'), v_anno);
  select coalesce(max(numero), 0) + 1 into v_num from ordini_fornitore where anno = v_anno;
  insert into ordini_fornitore (tipo, anno, numero, fornitore_id, data, consegna, note, righe)
  values (p_tipo, v_anno, v_num, p_fornitore, coalesce(p_data, current_date), p_consegna, nullif(trim(p_note), ''), p_righe)
  returning * into v_riga;
  return v_riga;
end $$;

create or replace function annulla_ordine_fornitore(p_id uuid)
returns ordini_fornitore
language plpgsql security definer set search_path = public as $$
declare v_riga ordini_fornitore;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può annullare un ordine fornitore';
  end if;
  update ordini_fornitore set stato = 'annullato', annullato_il = now(), annullato_da = auth.uid()
   where id = p_id and stato = 'emesso' returning * into v_riga;
  if v_riga.id is null then raise exception 'Ordine non trovato o gia'' annullato'; end if;
  return v_riga;
end $$;

revoke all on function crea_ordine_fornitore(text, uuid, date, date, text, jsonb) from public, anon;
revoke all on function annulla_ordine_fornitore(uuid) from public, anon;
grant execute on function crea_ordine_fornitore(text, uuid, date, date, text, jsonb) to authenticated;
grant execute on function annulla_ordine_fornitore(uuid) to authenticated;

select 'ORDINI FORNITORE PRONTI · righe: ' || count(*) as esito from ordini_fornitore;

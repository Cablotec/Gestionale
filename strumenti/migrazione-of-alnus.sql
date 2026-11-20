-- ── GLI OF DI ALNUS DIVENTANO ORDINI DEL GESTIONALE (20 nov 2026) ──────
-- Nico: "potremmo caricare gli ordini fornitori attuali nel nostro
-- gestionale per buoni?". Gli OF aperti di Alnus entrano in
-- `ordini_fornitore` come ordini veri, con il LORO numero e una serie a
-- parte: «OF 830/2026» (acquisto) e «OL 901/2026» (conto lavoro), distinti
-- dai nostri. Cosi' gli arrivi si legano da soli: ogni carico di Alnus
-- (causale EA1) porta il numero OF.
-- ⚠ UNA SERIE SOLA (Nico, 20 nov: "vorrei avere solo OF. Gli OFS li puoi
-- eliminare"): gli ordini fac simile OFS di prova si CANCELLANO; quelli veri
-- ai terzisti si abbinano agli OF di Alnus col campo «n. OF» della riga
-- fornitore sulla commessa. Un ordine creato nel gestionale prende il numero
-- OF successivo all'ultimo dell'anno (Alnus compreso).
-- Finche' gli OF si fanno in Alnus, ogni estrazione degli OF aperti li
-- SINCRONIZZA (sincronizza_of_alnus): nuovi entrano, esistenti si
-- aggiornano (righe, residuo, consegne), quelli spariti dall'estrazione
-- diventano «chiuso» (evasi o chiusi in Alnus). Non si modificano ne' si
-- annullano dal gestionale: comanda Alnus.
alter table public.ordini_fornitore add column if not exists serie text not null default 'OF';
alter table public.ordini_fornitore alter column serie set default 'OF';
alter table public.ordini_fornitore add column if not exists origine text not null default 'gestionale';
alter table public.ordini_fornitore add column if not exists sincronizzato_il timestamptz;

-- Lo stato «chiuso» (evaso o chiuso in Alnus).
-- (il vecchio controllo sullo stato, qualunque nome abbia)
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con join pg_class t on t.oid = con.conrelid
            where t.relname = 'ordini_fornitore' and con.contype = 'c'
              and pg_get_constraintdef(con.oid) ilike '%stato%'
  loop
    execute format('alter table public.ordini_fornitore drop constraint %I', c);
  end loop;
end $$;
alter table public.ordini_fornitore add constraint ordini_fornitore_stato_check
  check (stato in ('emesso', 'annullato', 'chiuso'));

-- Il numero e' unico DENTRO la sua serie: OF 3/2026 e OFS 3/2026 convivono.
-- (il vecchio vincolo unico su anno + numero, qualunque nome abbia)
do $$
declare c text;
begin
  for c in select con.conname from pg_constraint con join pg_class t on t.oid = con.conrelid
            where t.relname = 'ordini_fornitore' and con.contype = 'u'
              and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
                    where a.attrelid = t.oid and a.attnum = any (con.conkey)) = array['anno', 'numero']
  loop
    execute format('alter table public.ordini_fornitore drop constraint %I', c);
  end loop;
end $$;
create unique index if not exists ordini_fornitore_serie_anno_numero_uq
  on public.ordini_fornitore (serie, anno, numero);

-- Via gli ordini fac simile di prova (OFS 1-4/2026): Nico abbina quelli veri.
delete from public.ordini_fornitore where origine = 'gestionale';

-- crea: serie OF, numero successivo all'ultimo OF dell'anno (Alnus compreso).
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
  select coalesce(max(numero), 0) + 1 into v_num from ordini_fornitore where anno = v_anno and serie = 'OF';
  insert into ordini_fornitore (tipo, serie, anno, numero, fornitore_id, data, consegna, note, righe)
  values (p_tipo, 'OF', v_anno, v_num, p_fornitore, coalesce(p_data, current_date), p_consegna, nullif(trim(p_note), ''), p_righe)
  returning * into v_riga;
  return v_riga;
end $$;

-- modifica e annulla: non sugli ordini di Alnus.
create or replace function modifica_ordine_fornitore(
  p_id uuid, p_consegna date, p_note text, p_righe jsonb)
returns ordini_fornitore
language plpgsql security definer set search_path = public as $$
declare
  v_of ordini_fornitore;
  v_doppia text;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può modificare un ordine fornitore';
  end if;
  select * into v_of from ordini_fornitore where id = p_id for update;
  if v_of.id is null then raise exception 'Ordine non trovato'; end if;
  if v_of.origine = 'alnus' then raise exception 'Un ordine di Alnus si modifica in Alnus'; end if;
  if v_of.stato <> 'emesso' then raise exception 'Un ordine annullato non si modifica'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Un ordine senza righe non resta: annullalo';
  end if;
  if v_of.tipo = 'terzista' then
    select r->>'etichetta' into v_doppia
      from ordini_fornitore o, jsonb_array_elements(o.righe) r
     where o.id <> p_id and o.stato = 'emesso' and o.tipo = 'terzista' and o.fornitore_id = v_of.fornitore_id
       and (r->>'operazione_id') in (select x->>'operazione_id' from jsonb_array_elements(p_righe) x)
     limit 1;
    if v_doppia is not null then
      raise exception 'La commessa % e'' gia'' in un altro ordine a questo terzista', v_doppia;
    end if;
  end if;
  update ordini_fornitore
     set righe = p_righe, consegna = p_consegna, note = nullif(trim(p_note), ''),
         revisione = revisione + 1, modificato_il = now(), modificato_da = auth.uid()
   where id = p_id
  returning * into v_of;
  return v_of;
end $$;

create or replace function annulla_ordine_fornitore(p_id uuid)
returns ordini_fornitore
language plpgsql security definer set search_path = public as $$
declare v_riga ordini_fornitore;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può annullare un ordine fornitore';
  end if;
  if exists (select 1 from ordini_fornitore where id = p_id and origine = 'alnus') then
    raise exception 'Un ordine di Alnus si chiude in Alnus';
  end if;
  update ordini_fornitore set stato = 'annullato', annullato_il = now(), annullato_da = auth.uid()
   where id = p_id and stato = 'emesso' returning * into v_riga;
  if v_riga.id is null then raise exception 'Ordine non trovato o gia'' annullato'; end if;
  return v_riga;
end $$;

-- La sincronizzazione: p_ordini = [{ serie, anno, numero, fornitore_id, data, consegna, righe }].
create or replace function sincronizza_of_alnus(p_ordini jsonb, p_preso_il timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  v_id uuid;
  v_chiavi text[] := '{}';
  v_conflitti text[] := '{}';
  n_nuovi int := 0; n_agg int := 0; n_chiusi int := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può caricare gli ordini di Alnus';
  end if;
  if p_ordini is null or jsonb_typeof(p_ordini) <> 'array' or jsonb_array_length(p_ordini) = 0 then
    raise exception 'Nessun ordine da caricare';
  end if;
  for o in select * from jsonb_array_elements(p_ordini) loop
    v_chiavi := v_chiavi || ((o->>'serie') || ' ' || (o->>'anno') || '/' || (o->>'numero'));
    v_id := null;
    select id into v_id from ordini_fornitore
     where serie = o->>'serie' and anno = (o->>'anno')::int and numero = (o->>'numero')::int;
    if v_id is null then
      insert into ordini_fornitore (tipo, serie, origine, anno, numero, fornitore_id, data, consegna, righe, stato, sincronizzato_il)
      values ('acquisto', o->>'serie', 'alnus', (o->>'anno')::int, (o->>'numero')::int, (o->>'fornitore_id')::uuid,
              coalesce((o->>'data')::date, current_date), (o->>'consegna')::date, o->'righe', 'emesso', p_preso_il);
      n_nuovi := n_nuovi + 1;
    else
      update ordini_fornitore
         set fornitore_id = (o->>'fornitore_id')::uuid, consegna = (o->>'consegna')::date, righe = o->'righe',
             stato = 'emesso', sincronizzato_il = p_preso_il
       where id = v_id and origine = 'alnus';
      -- Stesso numero gia' usato da un ordine creato nel gestionale: non si tocca, si segnala.
      if not found then
        v_conflitti := v_conflitti || ((o->>'serie') || ' ' || (o->>'numero') || '/' || (o->>'anno'));
      else
        n_agg := n_agg + 1;
      end if;
    end if;
  end loop;
  -- Spariti dall'estrazione degli aperti: evasi o chiusi in Alnus.
  update ordini_fornitore set stato = 'chiuso', sincronizzato_il = p_preso_il
   where origine = 'alnus' and stato = 'emesso'
     and (serie || ' ' || anno || '/' || numero) <> all (v_chiavi);
  get diagnostics n_chiusi = row_count;
  return jsonb_build_object('nuovi', n_nuovi, 'aggiornati', n_agg, 'chiusi', n_chiusi, 'conflitti', to_jsonb(v_conflitti));
end $$;

revoke all on function crea_ordine_fornitore(text, uuid, date, date, text, jsonb) from public, anon;
revoke all on function modifica_ordine_fornitore(uuid, date, text, jsonb) from public, anon;
revoke all on function annulla_ordine_fornitore(uuid) from public, anon;
revoke all on function sincronizza_of_alnus(jsonb, timestamptz) from public, anon;
grant execute on function crea_ordine_fornitore(text, uuid, date, date, text, jsonb) to authenticated;
grant execute on function modifica_ordine_fornitore(uuid, date, text, jsonb) to authenticated;
grant execute on function annulla_ordine_fornitore(uuid) to authenticated;
grant execute on function sincronizza_of_alnus(jsonb, timestamptz) to authenticated;

select 'OF DI ALNUS PRONTI · ordini: ' || count(*) || ' · serie: '
  || coalesce((select string_agg(distinct serie, ' ') from ordini_fornitore), '-') as esito
  from ordini_fornitore;

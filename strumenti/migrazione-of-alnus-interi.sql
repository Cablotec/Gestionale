-- ── OF DI ALNUS INTERI e NOMI ALNUS DEI FORNITORI (20 nov 2026) ──────────
-- Nico: "per completezza era meglio estrarre tutte le righe OF anche quelle
-- evase per avere l'OF intero" e "Alnus nell'estrazione prende nomignoli
-- invece della ragione sociale" (MM MALPA E LUCA = MM TECHNOLOGY).
-- 1. `aziende.nomi_alnus`: i nomignoli con cui Alnus chiama quella scheda.
--    Si scelgono all'import degli OF (o nella scheda azienda) e da li' il
--    gestionale li riconosce da solo (OF, fornitore abituale dei materiali).
-- 2. `sincronizza_of_alnus` accetta lo stato di ogni ordine (un OF con tutte
--    le righe a residuo zero arriva gia' «chiuso») e chiude gli ordini spariti
--    SOLO negli anni presenti nell'estrazione: un file del 2026 non tocca il 2025.

alter table public.aziende add column if not exists nomi_alnus text[] not null default '{}';

create or replace function sincronizza_of_alnus(p_ordini jsonb, p_preso_il timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  v_id uuid;
  v_stato text;
  v_chiavi text[] := '{}';
  v_anni int[] := '{}';
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
    if not ((o->>'anno')::int = any (v_anni)) then v_anni := v_anni || (o->>'anno')::int; end if;
    v_stato := case when o->>'stato' = 'chiuso' then 'chiuso' else 'emesso' end;
    v_id := null;
    select id into v_id from ordini_fornitore
     where serie = o->>'serie' and anno = (o->>'anno')::int and numero = (o->>'numero')::int;
    if v_id is null then
      insert into ordini_fornitore (tipo, serie, origine, anno, numero, fornitore_id, data, consegna, righe, stato, sincronizzato_il)
      values ('acquisto', o->>'serie', 'alnus', (o->>'anno')::int, (o->>'numero')::int, (o->>'fornitore_id')::uuid,
              coalesce((o->>'data')::date, current_date), (o->>'consegna')::date, o->'righe', v_stato, p_preso_il);
      n_nuovi := n_nuovi + 1;
    else
      update ordini_fornitore
         set fornitore_id = (o->>'fornitore_id')::uuid, consegna = (o->>'consegna')::date, righe = o->'righe',
             data = coalesce((o->>'data')::date, data), stato = v_stato, sincronizzato_il = p_preso_il
       where id = v_id and origine = 'alnus';
      if not found then
        v_conflitti := v_conflitti || ((o->>'serie') || ' ' || (o->>'numero') || '/' || (o->>'anno'));
      else
        n_agg := n_agg + 1;
      end if;
    end if;
  end loop;
  -- Spariti dall'estrazione, ma solo negli anni che l'estrazione contiene.
  update ordini_fornitore set stato = 'chiuso', sincronizzato_il = p_preso_il
   where origine = 'alnus' and stato = 'emesso' and anno = any (v_anni)
     and (serie || ' ' || anno || '/' || numero) <> all (v_chiavi);
  get diagnostics n_chiusi = row_count;
  return jsonb_build_object('nuovi', n_nuovi, 'aggiornati', n_agg, 'chiusi', n_chiusi, 'conflitti', to_jsonb(v_conflitti));
end $$;

revoke all on function sincronizza_of_alnus(jsonb, timestamptz) from public, anon;
grant execute on function sincronizza_of_alnus(jsonb, timestamptz) to authenticated;

select 'OF INTERI PRONTI · colonna nomi_alnus: '
  || (select count(*) from information_schema.columns where table_name = 'aziende' and column_name = 'nomi_alnus') as esito;

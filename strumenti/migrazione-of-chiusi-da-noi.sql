-- ── GLI OF DI ALNUS LI CHIUDIAMO NOI (27 nov 2026) ────────────────────────
-- Nico: "possiamo trovare il modo di caricare tutti gli OF aperti in modo che li
-- chiuda io correttamente?". Stessa regola della giacenza dal 25 nov: da Alnus si
-- prende COSA e' stato ordinato; quanto manca lo calcola il gestionale (partenza
-- al punto zero − i nostri DDT, domain/materiali.js `righeApertoOf`).
-- 1. `sincronizza_of_alnus` non tocca piu' lo stato: gli OF nuovi entrano
--    «emesso», quelli gia' caricati aggiornano righe, consegna, fornitore e data,
--    quelli che mancano dal file restano come sono (prima venivano CHIUSI: il 27
--    nov un file parziale ne ha chiusi 15 con righe ancora da ricevere).
-- 2. Il saldo a mano: `salda_ordine_fornitore(id, chiudi, nota)` (admin) chiude un
--    OF d'acquisto che il fornitore non completera', o lo riapre. Colonne
--    `saldato_il`, `saldato_da`, `saldo_nota`.
-- 3. Una volta sola: gli OF di Alnus chiusi dalle sincronizzazioni di prima
--    tornano «emesso». Quelli gia' evasi prima del punto zero hanno il residuo a
--    zero e restano «evasi» nel calcolo; non serve rifare l'import.

alter table public.ordini_fornitore add column if not exists saldato_il timestamptz;
alter table public.ordini_fornitore add column if not exists saldato_da text;
alter table public.ordini_fornitore add column if not exists saldo_nota text;

create or replace function sincronizza_of_alnus(p_ordini jsonb, p_preso_il timestamptz)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  v_id uuid;
  v_chiavi text[] := '{}';
  v_anni int[] := '{}';
  v_conflitti text[] := '{}';
  n_nuovi int := 0; n_agg int := 0; n_assenti int := 0;
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
    v_id := null;
    select id into v_id from ordini_fornitore
     where serie = o->>'serie' and anno = (o->>'anno')::int and numero = (o->>'numero')::int;
    if v_id is null then
      insert into ordini_fornitore (tipo, serie, origine, anno, numero, fornitore_id, data, consegna, righe, stato, sincronizzato_il)
      values ('acquisto', o->>'serie', 'alnus', (o->>'anno')::int, (o->>'numero')::int, (o->>'fornitore_id')::uuid,
              coalesce((o->>'data')::date, current_date), (o->>'consegna')::date, o->'righe', 'emesso', p_preso_il);
      n_nuovi := n_nuovi + 1;
    else
      -- Lo stato NON si tocca: lo decide il gestionale (i nostri DDT, il saldo a mano).
      update ordini_fornitore
         set fornitore_id = (o->>'fornitore_id')::uuid, consegna = (o->>'consegna')::date, righe = o->'righe',
             data = coalesce((o->>'data')::date, data), sincronizzato_il = p_preso_il
       where id = v_id and origine = 'alnus';
      if not found then
        v_conflitti := v_conflitti || ((o->>'serie') || ' ' || (o->>'numero') || '/' || (o->>'anno'));
      else
        n_agg := n_agg + 1;
      end if;
    end if;
  end loop;
  -- Spariti dall'estrazione: solo contati, restano come sono.
  select count(*) into n_assenti from ordini_fornitore
   where origine = 'alnus' and stato = 'emesso' and anno = any (v_anni)
     and (serie || ' ' || anno || '/' || numero) <> all (v_chiavi);
  return jsonb_build_object('nuovi', n_nuovi, 'aggiornati', n_agg, 'chiusi', 0, 'assenti', n_assenti,
    'conflitti', to_jsonb(v_conflitti));
end $$;

create or replace function salda_ordine_fornitore(p_id uuid, p_chiudi boolean, p_nota text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare r ordini_fornitore%rowtype;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può chiudere o riaprire un ordine';
  end if;
  select * into r from ordini_fornitore where id = p_id for update;
  if not found then raise exception 'Ordine non trovato'; end if;
  if r.tipo <> 'acquisto' then raise exception 'Si chiudono a mano solo gli ordini d''acquisto'; end if;
  if p_chiudi then
    if r.stato <> 'emesso' then raise exception 'L''ordine non è aperto'; end if;
    update ordini_fornitore set stato = 'chiuso', saldato_il = now(),
      saldato_da = coalesce(auth.jwt()->>'email', auth.uid()::text), saldo_nota = nullif(trim(coalesce(p_nota, '')), '')
     where id = p_id;
  else
    if r.stato <> 'chiuso' then raise exception 'L''ordine non è chiuso'; end if;
    update ordini_fornitore set stato = 'emesso', saldato_il = null, saldato_da = null, saldo_nota = null where id = p_id;
  end if;
end $$;

revoke all on function sincronizza_of_alnus(jsonb, timestamptz) from public, anon;
grant execute on function sincronizza_of_alnus(jsonb, timestamptz) to authenticated;
revoke all on function salda_ordine_fornitore(uuid, boolean, text) from public, anon;
grant execute on function salda_ordine_fornitore(uuid, boolean, text) to authenticated;

-- Una volta sola: gli OF di Alnus chiusi dalle sincronizzazioni di prima tornano aperti.
update ordini_fornitore set stato = 'emesso' where origine = 'alnus' and stato = 'chiuso' and saldato_il is null;

select 'OF CHIUSI DA NOI · OF di Alnus emessi: ' || (select count(*) from ordini_fornitore where origine = 'alnus' and stato = 'emesso')
  || ' · chiusi: ' || (select count(*) from ordini_fornitore where origine = 'alnus' and stato = 'chiuso')
  || ' · funzione saldo: ' || (select count(*) from pg_proc where proname = 'salda_ordine_fornitore') as esito;

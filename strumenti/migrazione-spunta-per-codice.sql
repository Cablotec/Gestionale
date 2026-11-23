-- ═══════════════════════════════════════════════════════════════════
-- LA SPUNTA DIVENTA UNA REGOLA PER CODICE (24 nov 2026, Nico: "eliminare
-- completamente la spunta" «Giacenza nel gestionale (C/L del cliente)»).
--
-- Prima la colonna `operazioni.materiali_da_ddt` diceva, commessa per
-- commessa, se i suoi C/L avevano la giacenza nel gestionale. Ora lo dice il
-- CODICE: un C/L che Alnus non conosce (oggi i TS- di Tema) ha la giacenza nel
-- gestionale; un C/L di Alnus segue Alnus (la giacenza arriva coi movimenti
-- importati) e le nostre liste lo registrano fuori giacenza.
-- Verificato il 24 nov: la spunta era accesa su 10 commesse Tema, 308 C/L
-- tutti TS-, nessuno noto ad Alnus; e gli unici C/L delle commesse vive che
-- Alnus non conosce sono quei TS-. Oggi il risultato non cambia.
--
-- Tre pezzi:
--   1. `codice_di_alnus(codice)`: la STESSA regola dell'app (`codiceDiAlnus`):
--      Fabbisogno (`mancanti`), foto o movimenti dello Specchio, righe
--      d'apertura o di Alnus fra i movimenti.
--   2. `mov_conferma_invio_terzista`: un C/L sposta la giacenza se Alnus non
--      lo conosce, su qualunque commessa (prima: solo commesse con la spunta).
--   3. `mov_scarica_lotto`: il lotto scarica i C/L che Alnus non conosce, su
--      qualunque commessa (i C/L di Alnus li scarica l'UP1 di Alnus).
-- La colonna `materiali_da_ddt` resta: non la legge piu' nessuno.
-- ═══════════════════════════════════════════════════════════════════

create or replace function public.codice_di_alnus(p_codice text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from mancanti where upper(trim(codice)) = upper(trim(p_codice)))
      or exists (select 1 from alnus_giacenze where upper(trim(codice)) = upper(trim(p_codice)))
      or exists (select 1 from alnus_movimenti where upper(trim(codice)) = upper(trim(p_codice)))
      or exists (select 1 from movimenti_magazzino where documento_tipo in ('APERTURA', 'ALNUS')
                   and upper(trim(codice)) = upper(trim(p_codice)));
$$;
revoke all on function public.codice_di_alnus(text) from public, anon;
grant execute on function public.codice_di_alnus(text) to authenticated;

create or replace function public.mov_conferma_invio_terzista(p_invio uuid, p_righe jsonb,
  p_nota text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inv   record;
  v_op    record;
  v_nome  text;
  v_rep   boolean;
  v_r     record;
  v_rr    jsonb;
  v_q     numeric;
  v_disp  numeric;
  v_conta boolean;
  v_nota  text;
  v_doc   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n     integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' confermare una richiesta';
  end if;
  select * into v_inv from invii_terzista where id = p_invio for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if v_inv.stato <> 'da_preparare' then
    raise exception 'Questa richiesta e'' gia'' %', v_inv.stato;
  end if;
  if jsonb_typeof(p_righe) <> 'array' then raise exception 'Righe non valide'; end if;
  select nome, coalesce(is_reparto, false) into v_nome, v_rep from aziende where id = v_inv.terzista_id;

  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));

  v_doc  := case when v_rep then 'REPARTO' else 'TERZISTA' end;
  v_nota := case when v_rep then 'In reparto' else 'Invio a ' || coalesce(v_nome, '?') end
            || coalesce(' · ' || (select nome from tipi_lavorazione where id = v_inv.fase_id), '')
            || coalesce(' · ' || nullif(trim(coalesce(p_nota, v_inv.nota)), ''), '');

  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           upper(trim(coalesce(r->>'tipo', ''))) as tipo,
           coalesce(nullif(r->>'operazione_id', '')::uuid, v_inv.operazione_id) as op_id
    from jsonb_array_elements(v_inv.righe) r
  loop
    v_q := null;
    select nullif(x->>'qta', '')::numeric into v_q
      from jsonb_array_elements(p_righe) x
     where trim(x->>'codice') = v_r.cod
       and coalesce(nullif(x->>'operazione_id', '')::uuid, v_inv.operazione_id) = v_r.op_id
     limit 1;
    continue when v_q is null or v_q = 0;
    if v_q < 0 then raise exception '%: quantita'' negativa', v_r.cod; end if;

    select id, numero_ordine, pos, riferimento_cliente
      into v_op from operazioni where id = v_r.op_id;
    if not found then raise exception '%: commessa della riga non trovata', v_r.cod; end if;

    -- 24 nov: decide il codice, non la spunta della commessa.
    v_conta := v_r.tipo = 'C/L' and not codice_di_alnus(v_r.cod);
    if v_conta then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      if v_q > v_disp then
        raise exception '%: ne sposti % (commessa %/%) ma in sede ne restano %',
          v_r.cod, v_q, v_op.numero_ordine, v_op.pos, v_disp;
      end if;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, fuori_giacenza, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_r.descr, -v_q, v_r.um,
       v_doc, coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       null, v_op.id, p_invio, not v_conta, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_r.descr, v_q, v_r.um,
       v_doc, coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       v_inv.terzista_id, v_op.id, p_invio, not v_conta, v_chi);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nessuna quantita'' da spostare'; end if;

  select jsonb_agg(r || jsonb_build_object('qta_inviata', coalesce(
           (select nullif(x->>'qta', '')::numeric from jsonb_array_elements(p_righe) x
             where trim(x->>'codice') = trim(r->>'codice')
               and coalesce(nullif(x->>'operazione_id', '')::uuid, v_inv.operazione_id)
                 = coalesce(nullif(r->>'operazione_id', '')::uuid, v_inv.operazione_id)
             limit 1), 0)))
    into v_rr from jsonb_array_elements(v_inv.righe) r;
  update invii_terzista set stato = 'inviato', righe = coalesce(v_rr, righe),
    inviato_il = now(), inviato_da = v_chi,
    nota = coalesce(nullif(trim(p_nota), ''), nota)
  where id = p_invio;
  return v_n;
end $$;
revoke all on function public.mov_conferma_invio_terzista(uuid, jsonb, text) from public;
grant execute on function public.mov_conferma_invio_terzista(uuid, jsonb, text) to authenticated;

-- ── 3. Lo scarico del lotto, in proporzione alle quote ──────────────
-- Stessa firma. Senza reparto ne' terzisti scrive le stesse righe di prima.
-- La quota di un posto, per pezzo, viene dalla riga della lista:
--   terzista -> fasi_esterne[<suo id>]
--   reparto  -> qta_pz meno la somma di fasi_esterne
--   altro    -> 0 (si tocca solo come ultima risorsa)
create or replace function public.mov_scarica_lotto(p_lotto uuid, p_operazione uuid,
  p_data date, p_pezzi numeric, p_tipo text, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op    record;
  v_r     record;
  v_t     record;
  v_rep   uuid;
  v_resto numeric;
  v_q     numeric;
  v_quota numeric;
  v_sede  numeric;
  v_doc   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', 'database'));
  v_n     integer := 0;
begin
  if p_pezzi is null or p_pezzi <= 0 then return 0; end if;
  select id, numero_ordine, pos, quantita, riferimento_cliente, materiali
    into v_op from operazioni where id = p_operazione;
  if not found or jsonb_typeof(v_op.materiali) <> 'array' then
    return 0;
  end if;
  select id into v_rep from aziende where is_reparto limit 1;
  v_doc := coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, '');

  for v_r in
    select trim(r->>'codice') as cod, r->>'descrizione' as descr, r->>'um' as um,
           coalesce(nullif(r->>'qta_pz', '')::numeric,
                    (r->>'qta')::numeric / nullif(v_op.quantita, 0)) as qpz,
           case when jsonb_typeof(r->'fasi_esterne') = 'object' then r->'fasi_esterne' else '{}'::jsonb end as fe
    from jsonb_array_elements(v_op.materiali) r
    where upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
      and coalesce(trim(r->>'codice'), '') <> ''
      and not codice_di_alnus(r->>'codice')   -- 24 nov: i C/L di Alnus li scarica l'UP1
      and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0
  loop
    v_resto := round((v_r.qpz * p_pezzi)::numeric, 4);
    continue when v_resto is null or v_resto <= 0;

    -- 1) Ogni posto di QUESTA commessa, fino alla sua quota.
    for v_t in
      select presso_id, sum(qta) as s from movimenti_magazzino
      where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
        and not fuori_giacenza
      group by presso_id having sum(qta) > 0 order by presso_id
    loop
      exit when v_resto <= 0;
      if v_t.presso_id = v_rep then
        select greatest(0, v_r.qpz - coalesce(sum(nullif(value, '')::numeric), 0)) into v_quota
          from jsonb_each_text(v_r.fe);
      else
        v_quota := coalesce(nullif(v_r.fe->>(v_t.presso_id::text), '')::numeric, 0);
      end if;
      v_q := least(v_resto, v_t.s, round((v_quota * p_pezzi)::numeric, 4));
      continue when v_q is null or v_q <= 0;
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
      v_n := v_n + 1;
      v_resto := v_resto - v_q;
    end loop;

    -- 2) Il resto dalla sede, fin dove c'e'.
    if v_resto > 0 then
      select coalesce(sum(qta), 0) into v_sede from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      v_q := least(v_resto, greatest(v_sede, 0));
      if v_q > 0 then
        insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
          documento_tipo, documento_numero, documento_data, documento_pos,
          ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
        values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
          p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end if;
    end if;

    -- 3) Ultima risorsa: quello che resta negli altri posti della commessa.
    if v_resto > 0 then
      for v_t in
        select presso_id, sum(qta) as s from movimenti_magazzino
        where operazione_id = p_operazione and codice = v_r.cod and presso_id is not null
          and not fuori_giacenza
        group by presso_id having sum(qta) > 0 order by presso_id
      loop
        exit when v_resto <= 0;
        -- `s` qui e' gia' al netto di quanto preso al giro 1: le righe sono
        -- state scritte nella stessa transazione e la somma le vede.
        v_q := least(v_resto, v_t.s);
        continue when v_q <= 0;
        insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
          documento_tipo, documento_numero, documento_data, documento_pos,
          ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
        values (p_data, p_tipo, v_r.cod, v_r.descr, -v_q, v_r.um, 'PRODUZIONE', v_doc,
          p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, v_t.presso_id, p_operazione, v_chi);
        v_n := v_n + 1;
        v_resto := v_resto - v_q;
      end loop;
    end if;

    -- 4) Se ancora non basta, la sede va in negativo (come prima): il conto
    --    deve tornare, e il rosso in Movimenti dice che manca un carico.
    if v_resto > 0 then
      insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
        documento_tipo, documento_numero, documento_data, documento_pos,
        ordine_rif, note, lotto_id, presso_id, operazione_id, creato_da)
      values (p_data, p_tipo, v_r.cod, v_r.descr, -v_resto, v_r.um, 'PRODUZIONE', v_doc,
        p_data, v_r.cod, v_op.riferimento_cliente, p_nota, p_lotto, null, p_operazione, v_chi);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;

-- Verifica (non scrive niente): un TS- di Tema no, il connettore Comet si.
select public.codice_di_alnus('TS-400011551') as ts_tema, public.codice_di_alnus('A32100THB00TEH00101T') as comet;

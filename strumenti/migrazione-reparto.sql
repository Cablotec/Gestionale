-- ═══════════════════════════════════════════════════════════════════
-- FASE «REPARTO» — il WIP interno  (16 nov 2026, Nico)
--
-- Nico: "una volta avviato il processo lavorativo di un ordine, il materiale
-- che non va al terzista va in lavorazione". Senza questo passaggio il
-- gestionale lo vedeva ancora sullo scaffale, libero per le altre commesse.
--
-- MODELLO: il reparto e' un POSTO come il terzista. Un'anagrafica speciale
-- (`aziende.is_reparto`, ne esiste una sola) usata come `presso_id`:
--   · la richiesta e' una riga di `invii_terzista` con terzista_id = reparto;
--   · la conferma sposta i C/L sede -> reparto per la commessa (trasferimento,
--     il totale non cambia); ACQ e MAC restano registrati fuori giacenza;
--   · il materiale in reparto e' riservato alla sua commessa (come dal terzista).
-- Il gestionale nasconde questa anagrafica da tutti gli elenchi.
--
-- Cambiano tre funzioni:
--   1. mov_conferma_invio_terzista: per il reparto scrive documento REPARTO e
--      la nota "In reparto" invece di "Invio a".
--   2. mov_scarica_lotto: scarica IN PROPORZIONE ALLE QUOTE. Un codice da
--      100/pz, 30 al terzista e 70 in casa: un lotto da 10 pz toglie 300 dal
--      terzista e 700 dal reparto (prima svuotava il terzista per primo). Se
--      in un posto non basta: il resto dalla sede, poi (ultima risorsa)
--      dagli altri posti della stessa commessa, poi la sede va in negativo
--      come prima.
--   3. mov_rientro_in_sede (nuova): gli avanzi di una commessa tornano in sede,
--      dal reparto o da un terzista.
--
-- ⚠ Senza questa migrazione il gestionale non si rompe: non trova il reparto
-- e non mostra i bottoni.
-- Da eseguire tutto insieme; poi, A PARTE, il blocco di VERIFICA in fondo.
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. L'anagrafica del reparto ─────────────────────────────────────
alter table aziende add column if not exists is_reparto boolean not null default false;
create unique index if not exists aziende_un_solo_reparto on aziende (is_reparto) where is_reparto;
-- Un'azienda deve essere cliente o fornitore (`aziende_almeno_un_ruolo`): il
-- reparto non e' nessuno dei due, e' il terzo ruolo ammesso.
alter table aziende drop constraint if exists aziende_almeno_un_ruolo;
alter table aziende add constraint aziende_almeno_un_ruolo
  check (is_cliente or is_fornitore or is_reparto);
insert into aziende (nome, attivo, is_cliente, is_fornitore, is_reparto)
select 'Reparto', true, false, false, true
where not exists (select 1 from aziende where is_reparto);

-- ── 2. La conferma, che riconosce il reparto ────────────────────────
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

    select id, numero_ordine, pos, riferimento_cliente, materiali_da_ddt
      into v_op from operazioni where id = v_r.op_id;
    if not found then raise exception '%: commessa della riga non trovata', v_r.cod; end if;

    v_conta := coalesce(v_op.materiali_da_ddt, false) and v_r.tipo = 'C/L';
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
  select id, numero_ordine, pos, quantita, riferimento_cliente, materiali, materiali_da_ddt
    into v_op from operazioni where id = p_operazione;
  if not found or coalesce(v_op.materiali_da_ddt, false) = false
     or jsonb_typeof(v_op.materiali) <> 'array' then
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
-- mov_annulla_lotto e il trigger restano quelli del 5 nov: annullano posto
-- per posto qualunque cosa lo scarico abbia scritto.

-- ── 4. Il rientro degli avanzi ──────────────────────────────────────
-- p_righe: [{ "codice": "...", "qta": 3 }]; null = TUTTO quello che quel
-- posto ha per la commessa. Solo i C/L contati (gli altri sono fuori giacenza).
create or replace function public.mov_rientro_in_sede(p_operazione uuid, p_presso uuid,
  p_righe jsonb default null, p_nota text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op   record;
  v_nome text;
  v_rep  boolean;
  v_r    record;
  v_disp numeric;
  v_inv  uuid := gen_random_uuid();
  v_nota text;
  v_chi  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n    integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare un rientro';
  end if;
  select id, numero_ordine, pos, riferimento_cliente into v_op from operazioni where id = p_operazione;
  if not found then raise exception 'Commessa non trovata'; end if;
  select nome, coalesce(is_reparto, false) into v_nome, v_rep from aziende where id = p_presso;
  if not found then raise exception 'Posto non trovato'; end if;

  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));
  v_nota := 'Rientro in sede ' || case when v_rep then 'dal reparto' else 'da ' || v_nome end
            || coalesce(' · ' || nullif(trim(p_nota), ''), '');

  for v_r in
    select m.codice as cod, max(m.descrizione) as descr, max(m.um) as um, sum(m.qta) as s,
           (select nullif(x->>'qta', '')::numeric from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) x
             where trim(x->>'codice') = m.codice limit 1) as chiesto
    from movimenti_magazzino m
    where m.operazione_id = p_operazione and m.presso_id = p_presso and not m.fuori_giacenza
    group by m.codice
    having sum(m.qta) > 0
  loop
    v_disp := case when p_righe is null then v_r.s else v_r.chiesto end;
    continue when v_disp is null or v_disp <= 0;
    if v_disp > v_r.s then
      raise exception '%: ne fai rientrare % ma ce ne sono %', v_r.cod, v_disp, v_r.s;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_r.descr, -v_disp, v_r.um, 'RIENTRO',
       coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''), current_date, v_r.cod,
       v_op.riferimento_cliente, v_nota, p_presso, p_operazione, v_inv, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_r.descr, v_disp, v_r.um, 'RIENTRO',
       coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''), current_date, v_r.cod,
       v_op.riferimento_cliente, v_nota, null, p_operazione, v_inv, v_chi);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Niente da far rientrare'; end if;
  return v_n;
end $$;
revoke all on function public.mov_rientro_in_sede(uuid, uuid, jsonb, text) from public;
grant execute on function public.mov_rientro_in_sede(uuid, uuid, jsonb, text) to authenticated;

select 'MIGRAZIONE REPARTO ESEGUITA · reparto: ' || coalesce((select id::text from aziende where is_reparto), 'NON CREATO') as esito;


-- ═══════════════════════════════════════════════════════════════════
-- VERIFICA, senza lasciare tracce. Da eseguire DOPO e DA SOLA.
-- Sul primo C/L della 00392: mette 10 pz di materiale in reparto e, se c'e'
-- una quota esterna, la sua parte presso quel terzista; registra un lotto
-- finto da 2 pz e controlla che ognuno abbia dato la SUA quota; cancella il
-- lotto e controlla che tutto sia tornato. Poi si ferma con un ERRORE APPOSTA
-- che annulla tutto.
-- ⚠ La risposta GIUSTA e' un messaggio rosso che comincia con:
--    VERIFICA OK (annullata)
-- ═══════════════════════════════════════════════════════════════════
do $$
declare v_op uuid; v_cod text; v_qpz numeric; v_fe jsonb; v_ter uuid; v_qter numeric;
        v_rep uuid; v_lotto uuid; v_dal_rep numeric; v_dal_ter numeric; v_dopo numeric;
begin
  select id into v_rep from aziende where is_reparto;
  select id into v_op from operazioni where numero_ordine = '2026/OC/00392' and pos = '0010';
  select trim(r->>'codice'), coalesce(nullif(r->>'qta_pz', '')::numeric, 1),
         case when jsonb_typeof(r->'fasi_esterne') = 'object' then r->'fasi_esterne' else '{}'::jsonb end
    into v_cod, v_qpz, v_fe
    from operazioni o, jsonb_array_elements(o.materiali) r
    where o.id = v_op and upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
    order by (jsonb_typeof(r->'fasi_esterne') = 'object') desc limit 1;
  select key::uuid, value::numeric into v_ter, v_qter from jsonb_each_text(v_fe) limit 1;
  v_qter := coalesce(v_qter, 0);
  -- 10 pz di materiale: la quota interna in reparto, quella esterna dal terzista.
  if v_qpz - v_qter > 0 then
    insert into movimenti_magazzino (data, tipo, codice, qta, documento_tipo, presso_id, operazione_id)
      values (current_date, 'trasferimento', v_cod, 10 * (v_qpz - v_qter), 'REPARTO', v_rep, v_op);
  end if;
  if v_ter is not null then
    insert into movimenti_magazzino (data, tipo, codice, qta, documento_tipo, presso_id, operazione_id)
      values (current_date, 'trasferimento', v_cod, 10 * v_qter, 'TERZISTA', v_ter, v_op);
  end if;
  insert into consegne_commessa (operazione_id, data, quantita, nota)
    values (v_op, current_date, 2, 'PROVA migrazione reparto') returning id into v_lotto;
  select coalesce(-sum(qta), 0) into v_dal_rep from movimenti_magazzino where lotto_id = v_lotto and presso_id = v_rep;
  select coalesce(-sum(qta), 0) into v_dal_ter from movimenti_magazzino where lotto_id = v_lotto and presso_id = v_ter;
  delete from consegne_commessa where id = v_lotto;
  select coalesce(sum(qta), 0) into v_dopo from movimenti_magazzino where lotto_id = v_lotto;
  if v_dal_rep = 2 * (v_qpz - v_qter) and v_dal_ter = 2 * v_qter and v_dopo = 0 then
    raise exception 'VERIFICA OK (annullata): % · lotto 2 pz: % dal reparto, % dal terzista, annullo tornato a zero',
      v_cod, v_dal_rep, v_dal_ter;
  else
    raise exception 'VERIFICA KO (annullata): % · dal reparto % (atteso %), dal terzista % (atteso %), dopo annullo % (atteso 0)',
      v_cod, v_dal_rep, 2 * (v_qpz - v_qter), v_dal_ter, 2 * v_qter, v_dopo;
  end if;
end $$;

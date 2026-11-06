-- ═══════════════════════════════════════════════════════════════════
-- RICHIESTA PER TERZISTA SU PIU' COMMESSE (Nico, 6 nov 2026)
-- Una lista sola per tre ordini Enviro dello stesso prodotto: ogni riga
-- della richiesta porta ora la SUA commessa (`righe[].operazione_id`), e
-- la conferma scrive i movimenti su quella. Il materiale presso il terzista
-- resta cosi' riservato al proprio ordine, come prima.
-- Le righe senza `operazione_id` (richieste di prima) prendono quella della
-- richiesta: niente cambia per loro.
-- p_righe: [{ "codice": "...", "operazione_id": "...", "qta": 12 }]
-- ═══════════════════════════════════════════════════════════════════
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
  v_r     record;
  v_rr    jsonb;
  v_q     numeric;
  v_disp  numeric;
  v_conta boolean;
  v_nota  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_n     integer := 0;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' confermare un invio a terzista';
  end if;
  select * into v_inv from invii_terzista where id = p_invio for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if v_inv.stato <> 'da_preparare' then
    raise exception 'Questa richiesta e'' gia'' %', v_inv.stato;
  end if;
  if jsonb_typeof(p_righe) <> 'array' then raise exception 'Righe non valide'; end if;
  select nome into v_nome from aziende where id = v_inv.terzista_id;

  perform pg_advisory_xact_lock(hashtext('mov_invia_terzista'));

  v_nota := 'Invio a ' || coalesce(v_nome, '?')
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

    -- Il gestionale conta solo i C/L delle commesse "Materiali da DDT".
    -- Riga per riga: la seconda commessa dello stesso codice vede la sede
    -- gia' scesa per la prima.
    v_conta := coalesce(v_op.materiali_da_ddt, false) and v_r.tipo = 'C/L';
    if v_conta then
      select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
        where codice = v_r.cod and presso_id is null and not fuori_giacenza;
      if v_q > v_disp then
        raise exception '%: ne mandi % (commessa %/%) ma in sede ne restano %',
          v_r.cod, v_q, v_op.numero_ordine, v_op.pos, v_disp;
      end if;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, presso_id, operazione_id, invio_id, fuori_giacenza, creato_da)
    values
      (current_date, 'trasferimento', v_r.cod, v_r.descr, -v_q, v_r.um,
       'TERZISTA', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       null, v_op.id, p_invio, not v_conta, v_chi),
      (current_date, 'trasferimento', v_r.cod, v_r.descr, v_q, v_r.um,
       'TERZISTA', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos::text, ''),
       current_date, v_r.cod, v_op.riferimento_cliente, v_nota,
       v_inv.terzista_id, v_op.id, p_invio, not v_conta, v_chi);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Nessuna quantita'' da inviare'; end if;

  -- Ogni riga si ricorda quanto e' partito davvero (per codice E commessa).
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

-- VERIFICA: la funzione deve leggere `operazione_id` dalle righe.
select case when position('op_id' in pg_get_functiondef('public.mov_conferma_invio_terzista(uuid, jsonb, text)'::regprocedure)) > 0
  then 'VERIFICA OK: conferma per commessa' else 'VERIFICA KO' end as esito;

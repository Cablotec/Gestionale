-- ═══════════════════════════════════════════════════════════════════
-- PASSO 2 DEL RISERVATO: IL REPARTO CONTA IN GIACENZA (24 nov 2026, Nico:
-- «ogni pezzo ha un posto e un padrone»; il gestionale deve migliorare Alnus).
--
-- «Portato in reparto» sposta DAVVERO il materiale dalla sede al reparto,
-- anche sui codici di Alnus (prima: fuori giacenza, solo registro). E' il
-- nostro UT1/ET1: la sede scende, il reparto della commessa sale, il totale
-- (= Alnus 01 + WIP) non cambia. I MAC restano fuori (consumo).
-- Verso i terzisti NON cambia ancora niente (passo 5).
--
-- Due pezzi:
--   1. `mov_conferma_invio_terzista`: verso il reparto conta tutto tranne MAC.
--      Il controllo «non piu' di quanto c'e' in sede» vale quindi anche per
--      gli ACQ di Alnus (niente piu' 510 m di cavo su 234).
--   2. Teknox 00442/0020 (OP 2026/OP/02135), l'unica commessa con un reparto
--      confermato su codici di Alnus: il suo materiale in reparto passa in
--      giacenza. I movimenti non si cambiano: 4 righe per codice (si annulla
--      la coppia fuori giacenza, si scrive la coppia in giacenza). Verificato
--      il 24 nov: 49 codici, nessuna sede sotto zero. Rilanciabile: la seconda
--      volta non scrive niente.
--
-- ⚠ Fino al passo 3 (lotto che scarica il reparto) e 4 (l'UP1 di Alnus che
--   non riconsuma) un EP1/UP1 della Teknox in Alnus toglierebbe lo stesso
--   materiale una seconda volta dalla sede.
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
    -- PASSO 2 (24 nov): verso il REPARTO conta tutto tranne i MAC, anche i
    -- codici di Alnus (sede -> reparto, come UT1/ET1 da 01 a WIP). Verso un
    -- terzista resta la regola di prima (passo 5).
    v_conta := (v_r.tipo = 'C/L' and not codice_di_alnus(v_r.cod))
            or (v_rep and v_r.tipo <> 'MAC');
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

-- 2. Teknox: il materiale in reparto passa in giacenza.
with rep as (
  select m.codice, max(m.descrizione) as descr, max(m.um) as um, sum(m.qta) as q
  from movimenti_magazzino m
  where m.operazione_id = '960267de-6f9c-449d-ab5e-934b60e7ea7e' and m.presso_id = '2c8e2381-b5d2-4189-b441-412ed534e453' and m.fuori_giacenza
  group by m.codice
  having sum(m.qta) > 0
), t as (
  select * from rep
  where not exists (select 1 from invii_terzista i, jsonb_array_elements(i.righe) r
                    where i.id = '60ce7693-0cf0-4f8f-8cfc-d310c1f08a48' and trim(r->>'codice') = rep.codice and upper(trim(coalesce(r->>'tipo', ''))) = 'MAC')
    and not exists (select 1 from movimenti_magazzino where documento_numero = '2026/OC/00442/0020 in giacenza')
)
insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, documento_tipo, documento_numero, documento_data,
  documento_pos, ordine_rif, note, presso_id, operazione_id, invio_id, fuori_giacenza, creato_da)
select current_date, 'trasferimento', t.codice, t.descr, x.segno * t.q, t.um, 'REPARTO', '2026/OC/00442/0020 in giacenza', current_date,
  t.codice, 'OQ0000032', 'Il materiale in reparto passa in giacenza (passo 2 del riservato)', x.presso,
  '960267de-6f9c-449d-ab5e-934b60e7ea7e', '60ce7693-0cf0-4f8f-8cfc-d310c1f08a48', x.fuori, 'passo 2 · 24/11'
from t cross join (values (-1, '2c8e2381-b5d2-4189-b441-412ed534e453'::uuid, true), (1, null::uuid, true),
                          (-1, null::uuid, false), (1, '2c8e2381-b5d2-4189-b441-412ed534e453'::uuid, false)) x(segno, presso, fuori);

-- Verifica (sola lettura): 49 codici in reparto in giacenza, fuori giacenza
-- restano solo i 4 MAC, nessuna sede sotto zero fra quei codici.
select
  (select count(*) from (select codice from movimenti_magazzino where operazione_id = '960267de-6f9c-449d-ab5e-934b60e7ea7e' and presso_id = '2c8e2381-b5d2-4189-b441-412ed534e453' and not fuori_giacenza
     group by codice having sum(qta) > 0) a) as codici_in_giacenza,
  (select string_agg(codice, ', ') from (select codice from movimenti_magazzino where operazione_id = '960267de-6f9c-449d-ab5e-934b60e7ea7e' and presso_id = '2c8e2381-b5d2-4189-b441-412ed534e453' and fuori_giacenza
     group by codice having sum(qta) > 0) b) as restano_fuori,
  (select count(*) from (select s.codice from movimenti_magazzino s
     where s.presso_id is null and not s.fuori_giacenza
       and s.codice in (select codice from movimenti_magazzino where operazione_id = '960267de-6f9c-449d-ab5e-934b60e7ea7e' and presso_id = '2c8e2381-b5d2-4189-b441-412ed534e453')
     group by s.codice having sum(s.qta) < 0) c) as sedi_sotto_zero;

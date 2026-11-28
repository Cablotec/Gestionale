-- DDT IN USCITA DAGLI ORDINI (28 nov 2026, Nico: "devo trovare un modo che dal DDT,
-- pesco dagli ordini le quantita' che spedisco e di conseguenza produce").
--
-- Una bolla al cliente copre piu' commesse (la BO 898 a JMA: cinque righe OD). Prima si
-- registrava la spedizione commessa per commessa, scrivendo cinque volte lo stesso numero.
-- Ora «＋ DDT in uscita» (causale Vendita) propone le righe d'ordine del cliente e questa
-- funzione le registra TUTTE INSIEME:
--   * per ogni riga: se e' un OD e mancano pezzi prodotti, prima il LOTTO della differenza
--     (consegne_commessa, data del DDT, rif. «DDT n», nota «Prodotto alla spedizione (OD)»:
--     come il riquadro Spedizione dal 27 nov), poi la SPEDIZIONE (spedizioni, col numero);
--     i trigger gia' esistenti scrivono consumi, carico e scarico del prodotto;
--   * su una OC si spediscono SOLO i pronti (prodotti − spediti): oltre, si ferma
--     (deciso da Nico: resta «prima la produzione»);
--   * stato della commessa: «completata» se tutto prodotto, «spedita» (con consegnato_il)
--     se tutto spedito, come fa l'app;
--   * eventuali righe di CODICI (materiale sciolto sulla stessa bolla) passano da
--     `mov_ddt_uscita`, causale Vendita, nella stessa transazione;
--   * TUTTO O NIENTE (deciso da Nico): al primo errore non resta scritto nulla.
-- Solo admin. Lo stesso numero di DDT nello stesso anno non entra due volte.
-- Rilanciabile.

create or replace function public.ddt_uscita_da_ordini(p_azienda uuid, p_numero text, p_data date,
  p_righe jsonb, p_codici jsonb default null, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num    text := trim(coalesce(p_numero, ''));
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_nome   text;
  v_uid    uuid := auth.uid();
  r        jsonb;
  i        int := 0;
  n_lotti  int := 0;
  n_cod    int := 0;
  v_opid   uuid;
  v_pezzi  numeric;
  o        record;
  v_prod   numeric;
  v_sped   numeric;
  v_pronti numeric;
  v_lotto  numeric;
  v_eti    text;
  v_gia    text;
begin
  if not exists (select 1 from profili where id = v_uid and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare un DDT in uscita';
  end if;
  select nome into v_nome from aziende where id = p_azienda;
  if v_nome is null then raise exception 'Cliente non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT'; end if;
  if p_data is null then raise exception 'Manca la data del DDT'; end if;
  if (p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0)
     and (p_codici is null or jsonb_typeof(p_codici) <> 'array' or jsonb_array_length(p_codici) = 0) then
    raise exception 'Il DDT non ha righe';
  end if;

  -- Lo stesso numero nello stesso anno: gia' su una spedizione (anche preparata) o su un DDT in uscita.
  select coalesce(o2.numero_ordine, '') || '/' || coalesce(o2.pos, '') into v_gia
    from spedizioni s join operazioni o2 on o2.id = s.operazione_id
   where trim(s.ddt) = v_num and extract(year from s.data) = extract(year from p_data) limit 1;
  if v_gia is not null then
    raise exception 'Il DDT % del % e'' gia'' registrato (spedizione di %)', v_num, extract(year from p_data), v_gia;
  end if;
  if exists (select 1 from movimenti_magazzino where documento_tipo in ('RESO', 'USCITA') and documento_numero = v_num
             and extract(year from documento_data) = extract(year from p_data)) then
    raise exception 'Il DDT % del % e'' gia'' registrato fra i DDT in uscita', v_num, extract(year from p_data);
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) loop
    i := i + 1;
    v_opid  := nullif(r->>'operazione_id', '')::uuid;
    v_pezzi := nullif(r->>'pezzi', '')::numeric;
    select * into o from operazioni where id = v_opid for update;
    if not found then raise exception 'Riga %: commessa non trovata', i; end if;
    v_eti := coalesce(o.numero_ordine, '') || '/' || coalesce(o.pos, '');
    if o.cliente_id is distinct from p_azienda then
      raise exception '%: la commessa non e'' di %', v_eti, v_nome;
    end if;
    if v_pezzi is null or v_pezzi <= 0 or v_pezzi <> trunc(v_pezzi) then
      raise exception '%: i pezzi devono essere interi e maggiori di zero', v_eti;
    end if;
    -- Le righe gia' fatte da questo stesso DDT contano (stessa commessa su due righe).
    select coalesce(sum(quantita), 0) into v_prod from consegne_commessa where operazione_id = o.id;
    select coalesce(sum(quantita), 0) into v_sped from spedizioni where operazione_id = o.id;
    if v_pezzi > coalesce(o.quantita, 0) - v_sped then
      raise exception '%: da spedire % pz, non %', v_eti, greatest(coalesce(o.quantita, 0) - v_sped, 0), v_pezzi;
    end if;
    v_pronti := greatest(v_prod - v_sped, 0);
    v_lotto  := greatest(v_pezzi - v_pronti, 0);
    if v_lotto > 0 then
      if coalesce(o.numero_ordine, '') !~* '/OD/' then
        raise exception '%: pronti % pz, non %. Prima registra la produzione', v_eti, v_pronti, v_pezzi;
      end if;
      if v_lotto > coalesce(o.quantita, 0) - v_prod then
        raise exception '%: da produrre % pz, non %', v_eti, greatest(coalesce(o.quantita, 0) - v_prod, 0), v_lotto;
      end if;
      insert into consegne_commessa (operazione_id, data, quantita, ddt, nota, creato_da)
      values (o.id, p_data, v_lotto, 'DDT ' || v_num, 'Prodotto alla spedizione (OD)', v_uid);
      n_lotti := n_lotti + 1;
      v_prod := v_prod + v_lotto;
    end if;
    insert into spedizioni (operazione_id, data, quantita, ddt, destinatario, note, creato_da)
    values (o.id, p_data, v_pezzi, v_num, null, v_nota, v_uid);
    v_sped := v_sped + v_pezzi;
    if v_sped >= coalesce(o.quantita, 0) and coalesce(o.quantita, 0) > 0 then
      update operazioni set stato = 'spedita', consegnato_il = coalesce(consegnato_il, p_data) where id = o.id;
    elsif v_prod >= coalesce(o.quantita, 0) and coalesce(o.quantita, 0) > 0 and o.stato in ('aperta', 'sospesa') then
      update operazioni set stato = 'completata' where id = o.id;
    end if;
  end loop;

  if p_codici is not null and jsonb_typeof(p_codici) = 'array' and jsonb_array_length(p_codici) > 0 then
    n_cod := mov_ddt_uscita(p_azienda, v_num, p_data, 'Vendita', p_codici, v_nota);
  end if;

  return jsonb_build_object('righe', i, 'lotti', n_lotti, 'codici', n_cod);
end $$;
revoke all on function public.ddt_uscita_da_ordini(uuid, text, date, jsonb, jsonb, text) from public, anon;
grant execute on function public.ddt_uscita_da_ordini(uuid, text, date, jsonb, jsonb, text) to authenticated;

select 'DDT DAGLI ORDINI PRONTO' as esito;

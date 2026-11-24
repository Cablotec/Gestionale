-- RESO AL CLIENTE (24 nov 2026, Nico: "come segno dei cod. di reso che sto facendo a Tema?
-- sono cod che non risulteranno su Alnus").
--
-- Un reso e' materiale NOSTRO in giacenza (C/L del cliente che Alnus non conosce, i TS- di
-- Tema) che esce verso il cliente con un DDT. Prima si poteva solo con una rettifica a mano
-- col motivo «Reso»: la giacenza tornava, ma il movimento non era un'uscita legata al DDT
-- e al cliente, e non compariva fra i documenti in uscita.
--
-- Funzione `mov_reso_cliente` (security definer, solo admin, tutto o niente):
--   * una riga `scarico` per riga del reso, `documento_tipo` RESO, `documento_numero` = n. DDT,
--     `documento_pos` 0001…, `azienda_id` e `mittente` = il cliente;
--   * da dove esce: la sede (`presso_id` null) o un posto del gestionale (reparto, terzista)
--     per la sua commessa;
--   * non si rende piu' di quanto c'e' in quel posto (in conto);
--   * i codici di Alnus si rendono in Alnus: rifiutati (`codice_di_alnus`);
--   * lo stesso numero di reso allo stesso cliente non entra due volte.
-- Rilanciabile (create or replace). Nessuna tabella nuova.

create or replace function public.mov_reso_cliente(p_cliente uuid, p_numero text, p_data date, p_righe jsonb, p_nota text default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_cli   text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_nota  text := nullif(trim(coalesce(p_nota, '')), '');
  r       jsonb;
  i       int := 0;
  v_cod   text;
  v_qta   numeric;
  v_posto uuid;
  v_op    uuid;
  v_disp  numeric;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' registrare un reso';
  end if;
  select nome into v_cli from aziende where id = p_cliente;
  if v_cli is null then raise exception 'Cliente non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT di reso'; end if;
  if p_data is null then raise exception 'Manca la data del reso'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Il reso non ha righe';
  end if;
  if exists (select 1 from movimenti_magazzino where documento_tipo = 'RESO' and documento_numero = v_num
             and azienda_id = p_cliente) then
    raise exception 'Il reso % a % e'' gia'' registrato', v_num, v_cli;
  end if;

  for r in select * from jsonb_array_elements(p_righe) loop
    i := i + 1;
    v_cod   := upper(trim(coalesce(r->>'codice', '')));
    v_qta   := nullif(r->>'qta', '')::numeric;
    v_posto := nullif(r->>'presso_id', '')::uuid;
    v_op    := nullif(r->>'operazione_id', '')::uuid;
    if v_cod = '' then raise exception 'Riga %: manca il codice', i; end if;
    if v_qta is null or v_qta <= 0 then raise exception 'Riga % (%): la quantita'' deve essere maggiore di zero', i, v_cod; end if;
    if codice_di_alnus(v_cod) then
      raise exception '%: e'' un codice di Alnus, il reso va fatto in Alnus', v_cod;
    end if;
    select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
     where codice = v_cod and not fuori_giacenza
       and presso_id is not distinct from v_posto
       and (v_posto is null or operazione_id is not distinct from v_op);
    -- Le righe gia' scritte da questo stesso reso contano (stesso codice su due righe).
    if v_qta > v_disp then
      raise exception '%: ne rendi % ma % ce ne sono %', v_cod, v_qta,
        case when v_posto is null then 'in sede' else 'in quel posto' end, v_disp;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, azienda_id,
      documento_tipo, documento_numero, documento_data, documento_pos, note, presso_id, operazione_id,
      fuori_giacenza, creato_da)
    values (p_data, 'scarico', v_cod, nullif(trim(coalesce(r->>'descrizione', '')), ''), -v_qta,
      nullif(trim(coalesce(r->>'um', '')), ''), v_cli, p_cliente,
      'RESO', v_num, p_data, lpad(i::text, 4, '0'),
      'Reso a ' || v_cli || coalesce(' · ' || v_nota, ''), v_posto, case when v_posto is null then null else v_op end,
      false, v_chi);
  end loop;
  return i;
end $$;
revoke all on function public.mov_reso_cliente(uuid, text, date, jsonb, text) from public, anon;
grant execute on function public.mov_reso_cliente(uuid, text, date, jsonb, text) to authenticated;

select 'RESO AL CLIENTE PRONTO' as esito;

-- DDT IN USCITA CON CAUSALE (25 nov 2026, Nico: "sempre in Documenti, aggiungi il pulsante
-- DDT in uscita dove all'interno ingloberemo anche reso al cliente e le varie causali").
--
-- Un DDT in uscita e' materiale che esce dal magazzino del gestionale verso un'azienda
-- (cliente o fornitore) con una CAUSALE: Vendita, Reso, Conto visione, Riparazione,
-- Sostituzione in garanzia, Omaggio, Campionatura (l'elenco sta nell'app: una causale
-- nuova non chiede SQL).
--   * colonna `movimenti_magazzino.causale` (testo, facoltativa);
--   * funzione `mov_ddt_uscita` (security definer, solo admin, tutto o niente): una riga
--     `scarico` per riga, `documento_tipo` RESO per la causale Reso (come i resi di prima),
--     USCITA per tutte le altre; `causale` scritta; da dove esce: sede o un posto del
--     gestionale per la sua commessa; mai oltre il disponibile in quel posto; lo stesso
--     numero alla stessa azienda non entra due volte.
-- `mov_reso_cliente` resta (i resi di prima sono suoi) ma l'app usa questa.
-- Rilanciabile.

alter table public.movimenti_magazzino add column if not exists causale text;

create or replace function public.mov_ddt_uscita(p_azienda uuid, p_numero text, p_data date, p_causale text,
  p_righe jsonb, p_nota text default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_cau   text := nullif(trim(coalesce(p_causale, '')), '');
  v_doc   text;
  v_nome  text;
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
    raise exception 'Solo un amministratore puo'' registrare un DDT in uscita';
  end if;
  select nome into v_nome from aziende where id = p_azienda;
  if v_nome is null then raise exception 'Destinatario non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT'; end if;
  if p_data is null then raise exception 'Manca la data del DDT'; end if;
  if v_cau is null then raise exception 'Manca la causale'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Il DDT non ha righe';
  end if;
  v_doc := case when lower(v_cau) = 'reso' then 'RESO' else 'USCITA' end;
  if exists (select 1 from movimenti_magazzino where documento_tipo in ('RESO', 'USCITA') and documento_numero = v_num
             and azienda_id = p_azienda) then
    raise exception 'Il DDT % a % e'' gia'' registrato', v_num, v_nome;
  end if;

  for r in select * from jsonb_array_elements(p_righe) loop
    i := i + 1;
    v_cod   := upper(trim(coalesce(r->>'codice', '')));
    v_qta   := nullif(r->>'qta', '')::numeric;
    v_posto := nullif(r->>'presso_id', '')::uuid;
    v_op    := nullif(r->>'operazione_id', '')::uuid;
    if v_cod = '' then raise exception 'Riga %: manca il codice', i; end if;
    if v_qta is null or v_qta <= 0 then raise exception 'Riga % (%): la quantita'' deve essere maggiore di zero', i, v_cod; end if;
    -- Le righe gia' scritte da questo stesso DDT contano (stesso codice su due righe).
    select coalesce(sum(qta), 0) into v_disp from movimenti_magazzino
     where codice = v_cod and not fuori_giacenza
       and presso_id is not distinct from v_posto
       and (v_posto is null or operazione_id is not distinct from v_op);
    if v_qta > v_disp then
      raise exception '%: ne escono % ma % ce ne sono %', v_cod, v_qta,
        case when v_posto is null then 'in sede' else 'in quel posto' end, v_disp;
    end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, azienda_id,
      documento_tipo, documento_numero, documento_data, documento_pos, causale, note, presso_id, operazione_id,
      fuori_giacenza, creato_da)
    values (p_data, 'scarico', v_cod, nullif(trim(coalesce(r->>'descrizione', '')), ''), -v_qta,
      nullif(trim(coalesce(r->>'um', '')), ''), v_nome, p_azienda,
      v_doc, v_num, p_data, lpad(i::text, 4, '0'), v_cau,
      v_cau || ' a ' || v_nome || coalesce(' · ' || v_nota, ''), v_posto, case when v_posto is null then null else v_op end,
      false, v_chi);
  end loop;
  return i;
end $$;
revoke all on function public.mov_ddt_uscita(uuid, text, date, text, jsonb, text) from public, anon;
grant execute on function public.mov_ddt_uscita(uuid, text, date, text, jsonb, text) to authenticated;

-- I resi di prima prendono la loro causale.
update public.movimenti_magazzino set causale = 'Reso' where documento_tipo = 'RESO' and causale is null;

select 'DDT IN USCITA PRONTO' as esito;

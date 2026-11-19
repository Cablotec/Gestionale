-- ── DDT IN ENTRATA CARICATI A MANO (19 nov 2026) ───────────────────────
-- Nico: "possibilita' anche per DDT in entrata da inserire manualmente".
-- Accanto all'automazione delle scansioni (ai@), un admin registra dalla
-- scheda Produzione → Documenti un DDT ricevuto: mittente (scheda Aziende),
-- numero, data e righe. Ogni riga diventa un CARICO in movimenti_magazzino,
-- con le stesse colonne dei carichi letti dalle scansioni.
--
-- Perche' una FUNZIONE: la tabella resta scritta solo da ai@ e dalle funzioni
-- del database (come mov_rettifica). Questa controlla che chi chiama sia
-- admin, che il DDT non sia gia' caricato (stesso numero dallo stesso
-- mittente) e scrive tutte le righe insieme o nessuna.
--
-- `fuori_giacenza` per riga lo decide l'app: un codice che la giacenza la
-- tiene ancora Alnus (ACQ e simili) si registra come INFORMAZIONE, o la sua
-- riga Alnus verrebbe sostituita dalla sola quantita' di questo DDT.
-- Un errore non si cancella: si corregge con una rettifica.

create or replace function public.mov_carica_ddt(p_azienda uuid, p_numero text, p_data date, p_righe jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_mitt  text;
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  r       jsonb;
  i       int := 0;
  v_cod   text;
  v_qta   numeric;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' caricare un DDT';
  end if;
  select nome into v_mitt from aziende where id = p_azienda;
  if v_mitt is null then raise exception 'Mittente non trovato in Aziende'; end if;
  if v_num = '' then raise exception 'Manca il numero del DDT'; end if;
  if p_data is null then raise exception 'Manca la data del DDT'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Il DDT non ha righe';
  end if;
  if exists (select 1 from movimenti_magazzino where documento_tipo = 'DDT' and documento_numero = v_num
             and (azienda_id = p_azienda or upper(mittente) = upper(v_mitt))) then
    raise exception 'Il DDT % di % e'' gia'' caricato', v_num, v_mitt;
  end if;

  for r in select * from jsonb_array_elements(p_righe) loop
    i := i + 1;
    v_cod := upper(trim(coalesce(r->>'codice', '')));
    v_qta := nullif(r->>'qta', '')::numeric;
    if v_cod = '' then raise exception 'Riga %: manca il codice', i; end if;
    if v_qta is null or v_qta <= 0 then raise exception 'Riga % (%): la quantita'' deve essere maggiore di zero', i, v_cod; end if;
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente, azienda_id,
      documento_tipo, documento_numero, documento_data, documento_pos, ordine_rif, note, fuori_giacenza, creato_da)
    values (p_data, 'carico', v_cod, nullif(trim(coalesce(r->>'descrizione', '')), ''), v_qta,
      nullif(trim(coalesce(r->>'um', '')), ''), v_mitt, p_azienda,
      'DDT', v_num, p_data, lpad(i::text, 4, '0'), nullif(trim(coalesce(r->>'ordine_rif', '')), ''),
      nullif(trim(coalesce(r->>'note', '')), ''), coalesce((r->>'fuori_giacenza')::boolean, false), v_chi);
  end loop;
  return i;
end $$;
revoke all on function public.mov_carica_ddt(uuid, text, date, jsonb) from public, anon;
grant execute on function public.mov_carica_ddt(uuid, text, date, jsonb) to authenticated;

select 'DDT IN ENTRATA A MANO PRONTO' as esito;

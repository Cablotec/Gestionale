-- MODIFICA DI UN DDT IN ENTRATA (25 nov 2026, Nico: "ho sbagliato la data, vorrei poter
-- modificare i DDT in caso di errore").
--
-- ⚠ Eccezione DICHIARATA a «un movimento non si modifica», come per le rettifiche a mano:
-- vale SOLO per i carichi dei DDT in entrata (tipo `carico`, `documento_tipo` DDT) di
-- un mittente. Mai per righe di Alnus, aperture, lotti, reparto, terzisti, resi.
--
-- `mov_modifica_ddt(p_azienda, p_numero, p_nuovo_numero, p_data, p_righe)`
--   (security definer, solo admin, tutto o niente):
--   * numero e data valgono per TUTTE le righe del DDT (data e documento_data);
--   * p_righe = [{ "id": uuid, "qta": n }]: quantita' nuova della riga; 0 = riga tolta
--     (cancellata). Le righe non elencate restano come sono;
--   * il nuovo numero non puo' essere quello di un altro DDT dello stesso mittente;
--   * ogni riga cambiata porta la traccia nella nota:
--     «modificato il gg/mm/aaaa da <chi> (era: DDT n del gg/mm, q.ta' x)»;
--   * il DDT non puo' restare senza righe (si toglie riga per riga finche' ne resta una).
-- Il residuo degli OF si ricalcola da solo (e' la somma dei carichi con quell'ordine).
-- Rilanciabile.

create or replace function public.mov_modifica_ddt(p_azienda uuid, p_numero text, p_nuovo_numero text,
  p_data date, p_righe jsonb default '[]'::jsonb)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_num   text := trim(coalesce(p_numero, ''));
  v_nuovo text := trim(coalesce(p_nuovo_numero, ''));
  v_chi   text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_oggi  text := to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY');
  v_n     int := 0;
  v_tot   int;
  v_resta int;
  r       jsonb;
  v_m     record;
  v_q     numeric;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' modificare un DDT';
  end if;
  if v_num = '' then raise exception 'Manca il numero del DDT da modificare'; end if;
  if v_nuovo = '' then raise exception 'Manca il numero del DDT'; end if;
  if p_data is null then raise exception 'Manca la data del DDT'; end if;
  select count(*) into v_tot from movimenti_magazzino
    where azienda_id = p_azienda and documento_tipo = 'DDT' and documento_numero = v_num and tipo = 'carico';
  if v_tot = 0 then raise exception 'DDT % non trovato fra i carichi di questo mittente', v_num; end if;
  if v_nuovo <> v_num and exists (select 1 from movimenti_magazzino
      where azienda_id = p_azienda and documento_tipo = 'DDT' and documento_numero = v_nuovo) then
    raise exception 'Il DDT % di questo mittente c''e'' gia''', v_nuovo;
  end if;
  if p_righe is not null and jsonb_typeof(p_righe) = 'array' then
    select v_tot - count(*) into v_resta from jsonb_array_elements(p_righe) x
      where coalesce(nullif(x->>'qta', '')::numeric, 1) = 0;
    if v_resta <= 0 then raise exception 'Il DDT resterebbe senza righe'; end if;
  end if;

  -- Righe: quantita' nuove o tolte.
  for r in select * from jsonb_array_elements(coalesce(p_righe, '[]'::jsonb)) loop
    select * into v_m from movimenti_magazzino where id = nullif(r->>'id', '')::uuid
      and azienda_id = p_azienda and documento_tipo = 'DDT' and documento_numero = v_num and tipo = 'carico';
    if v_m.id is null then raise exception 'Una riga non appartiene a questo DDT'; end if;
    v_q := nullif(r->>'qta', '')::numeric;
    if v_q is null or v_q < 0 then raise exception '%: quantita'' non valida', v_m.codice; end if;
    if v_q = 0 then
      delete from movimenti_magazzino where id = v_m.id;
      v_n := v_n + 1;
    elsif v_q <> v_m.qta then
      update movimenti_magazzino set qta = v_q,
        note = concat_ws(' · ', nullif(note, ''), 'modificato il ' || v_oggi || ' da ' || v_chi || ' (era q.ta'' '
          || rtrim(to_char(v_m.qta, 'FM999999990.###'), '.') || ')')
      where id = v_m.id;
      v_n := v_n + 1;
    end if;
  end loop;

  -- Testata: numero e data su tutte le righe rimaste.
  if v_nuovo <> v_num or exists (select 1 from movimenti_magazzino where azienda_id = p_azienda and documento_tipo = 'DDT'
      and documento_numero = v_num and tipo = 'carico' and (data <> p_data or documento_data is distinct from p_data)) then
    update movimenti_magazzino set
      note = concat_ws(' · ', nullif(note, ''), 'modificato il ' || v_oggi || ' da ' || v_chi || ' (era: DDT ' || documento_numero
        || ' del ' || to_char(coalesce(documento_data, data), 'DD/MM/YYYY') || ')'),
      documento_numero = v_nuovo, data = p_data, documento_data = p_data
    where azienda_id = p_azienda and documento_tipo = 'DDT' and documento_numero = v_num and tipo = 'carico';
    v_n := v_n + 1;
  end if;
  return v_n;
end $$;
revoke all on function public.mov_modifica_ddt(uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.mov_modifica_ddt(uuid, text, text, date, jsonb) to authenticated;

select 'MODIFICA DDT PRONTA' as esito;

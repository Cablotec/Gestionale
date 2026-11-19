-- ── MODIFICA DEGLI ORDINI FORNITORE (19 nov 2026) ──────────────────────
-- Nico: "possibilita' di modificare OFS". Un ordine EMESSO si modifica
-- (righe, consegna, note) tenendo il suo numero; ogni modifica alza la
-- REVISIONE, che la stampa mostra: il fornitore deve poter distinguere
-- l'ordine corretto da quello che ha gia' in mano. Un annullato non si tocca.
-- Si scrive SOLO da questa funzione (admin), come crea/annulla.

alter table ordini_fornitore add column if not exists revisione     int not null default 0;
alter table ordini_fornitore add column if not exists modificato_il timestamptz;
alter table ordini_fornitore add column if not exists modificato_da uuid;

create or replace function modifica_ordine_fornitore(
  p_id uuid, p_consegna date, p_note text, p_righe jsonb)
returns ordini_fornitore
language plpgsql security definer set search_path = public as $$
declare
  v_of ordini_fornitore;
  v_doppia text;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore può modificare un ordine fornitore';
  end if;
  select * into v_of from ordini_fornitore where id = p_id for update;
  if v_of.id is null then raise exception 'Ordine non trovato'; end if;
  if v_of.stato <> 'emesso' then raise exception 'Un ordine annullato non si modifica'; end if;
  if p_righe is null or jsonb_typeof(p_righe) <> 'array' or jsonb_array_length(p_righe) = 0 then
    raise exception 'Un ordine senza righe non resta: annullalo';
  end if;
  if v_of.tipo = 'terzista' then
    select r->>'etichetta' into v_doppia
      from ordini_fornitore o, jsonb_array_elements(o.righe) r
     where o.id <> p_id and o.stato = 'emesso' and o.tipo = 'terzista' and o.fornitore_id = v_of.fornitore_id
       and (r->>'operazione_id') in (select x->>'operazione_id' from jsonb_array_elements(p_righe) x)
     limit 1;
    if v_doppia is not null then
      raise exception 'La commessa % e'' gia'' in un altro ordine a questo terzista', v_doppia;
    end if;
  end if;
  update ordini_fornitore
     set righe = p_righe, consegna = p_consegna, note = nullif(trim(p_note), ''),
         revisione = revisione + 1, modificato_il = now(), modificato_da = auth.uid()
   where id = p_id
  returning * into v_of;
  return v_of;
end $$;

revoke all on function modifica_ordine_fornitore(uuid, date, text, jsonb) from public, anon;
grant execute on function modifica_ordine_fornitore(uuid, date, text, jsonb) to authenticated;

select 'MODIFICA ORDINI PRONTA · ordini: ' || count(*) || ' · colonna revisione: '
  || (select count(*) from information_schema.columns where table_name = 'ordini_fornitore' and column_name = 'revisione') as esito
  from ordini_fornitore;

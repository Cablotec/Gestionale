-- ═══════════════════════════════════════════════════════════════════
-- MOVIMENTI DI ALNUS REALI (23 nov 2026, Nico: "li renderei reali, per
-- vedere se tutto gira bene"; "mi serve vedere se il nostro gestionale gira
-- in modo indipendente").
--
-- Fino a oggi lo Specchio Alnus teneva foto e movimenti di Alnus in tabelle a
-- parte (alnus_giacenze, alnus_movimenti). Da qui diventano movimenti VERI in
-- movimenti_magazzino, e la giacenza di ogni codice e' la SOMMA dei movimenti,
-- come per Tema.
--
-- UNA funzione, `mov_allinea_alnus()`, admin, rilanciabile quante volte si
-- vuole (non scrive due volte la stessa cosa):
--   1. APERTURA: per la foto d'apertura piu' recente, una riga per codice
--      (documento_tipo 'APERTURA') = foto − saldo che il gestionale aveva a
--      quell'ora. Cosi' all'ora della foto il saldo e' esattamente la foto.
--      I codici di Alnus non piu' nella foto ma con saldo vanno a zero.
--      I codici che Alnus non conosce (TS- di Tema) non si toccano.
--   2. MOVIMENTI: ogni movimento di alnus_movimenti dopo la foto diventa una
--      riga (documento_tipo 'ALNUS', chiave anno/causale/numero).
-- Magazzini: 01, 02 e WIP sono la sede (come il Fabbisogno di Alnus, che
-- conta 01 + WIP; lo 02 e' gia' fuso nello 01). SPK e 05 restano fuori.
-- L'ora: `creato_il` = ora di Alnus (movimenti) o della foto (apertura), cosi'
-- "prima / dopo la foto" si decide sempre sull'ora vera.
-- ═══════════════════════════════════════════════════════════════════

-- La stessa riga di Alnus (o di apertura) non entra due volte.
create unique index if not exists movimenti_magazzino_alnus_uq
  on movimenti_magazzino (documento_tipo, documento_numero, documento_pos)
  where documento_tipo in ('ALNUS', 'APERTURA');

create or replace function public.mov_allinea_alnus()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_foto      alnus_fotografie%rowtype;
  v_aperture  integer := 0;
  v_movimenti integer := 0;
  v_gia       boolean;
begin
  if not exists (select 1 from profili where id = auth.uid() and ruolo = 'admin') then
    raise exception 'Solo un amministratore puo'' allineare i movimenti di Alnus';
  end if;

  select * into v_foto from alnus_fotografie
    where tipo = 'giacenze' and apertura order by preso_il desc limit 1;
  if v_foto.id is null then raise exception 'Manca la foto d''apertura delle giacenze nello Specchio Alnus'; end if;

  -- 1. APERTURA (una volta per foto)
  select exists (select 1 from movimenti_magazzino
    where documento_tipo = 'APERTURA' and documento_numero = v_foto.id::text) into v_gia;
  if not v_gia then
    with foto as (
      select upper(trim(codice)) as codice, max(descrizione) as descrizione, max(um) as um, sum(qta) as qta
      from alnus_giacenze
      where fotografia_id = v_foto.id and upper(trim(magazzino)) in ('01', '02', 'WIP')
      group by upper(trim(codice))
    ),
    di_alnus as (
      select upper(trim(codice)) as codice from alnus_giacenze
      union select upper(trim(codice)) from alnus_movimenti
    ),
    saldo as (
      select upper(trim(codice)) as codice, sum(qta) as qta
      from movimenti_magazzino
      where presso_id is null and not coalesce(fuori_giacenza, false)
        and coalesce(creato_il, now()) <= v_foto.preso_il
      group by upper(trim(codice))
    ),
    righe as (
      select coalesce(f.codice, s.codice) as codice, f.descrizione, f.um,
             coalesce(f.qta, 0) - coalesce(s.qta, 0) as delta,
             coalesce(f.qta, 0) as foto
      from foto f full join saldo s on s.codice = f.codice
      where f.codice is not null or s.codice in (select codice from di_alnus)
    )
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente,
      documento_tipo, documento_numero, documento_pos, documento_data, note, creato_da, creato_il)
    select v_foto.preso_il::date, 'rettifica', r.codice, r.descrizione, r.delta, r.um, 'Alnus',
      'APERTURA', v_foto.id::text, r.codice, v_foto.preso_il::date,
      'Apertura da Alnus · foto del ' || to_char(v_foto.preso_il at time zone 'Europe/Rome', 'DD/MM/YYYY HH24:MI')
        || ' · giacenza ' || rtrim(to_char(r.foto, 'FM999999990.###'), '.'),
      'alnus', v_foto.preso_il
    from righe r
    where r.delta <> 0 or r.foto <> 0;
    get diagnostics v_aperture = row_count;
  end if;

  -- 2. MOVIMENTI dopo la foto
  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um, mittente,
    documento_tipo, documento_numero, documento_pos, documento_data, note, creato_da, creato_il)
  select (m.data at time zone 'Europe/Rome')::date,
    case when upper(m.causale) in ('ER1', 'UR1') then 'rettifica'
         when upper(m.causale) like 'UT%' or upper(m.causale) like 'ET%' then 'trasferimento'
         when m.qta >= 0 then 'carico' else 'scarico' end,
    upper(trim(m.codice)), m.descrizione, m.qta, m.um, coalesce(nullif(trim(m.soggetto), ''), 'Alnus'),
    'ALNUS', m.eser || '/' || upper(m.causale) || '/' || m.numero, upper(trim(m.magazzino)),
    (m.data at time zone 'Europe/Rome')::date,
    'Alnus · ' || upper(m.causale) || ' · mag ' || upper(trim(m.magazzino))
      || coalesce(' · ' || nullif(trim(m.tipo_doc), '') || ' ' || coalesce(m.anno_doc::text || '/', '') || m.numero_doc, '')
      || coalesce(' · ' || nullif(trim(m.operatore), ''), ''),
    'alnus', m.data
  from alnus_movimenti m
  where m.data > v_foto.preso_il and upper(trim(m.magazzino)) in ('01', '02', 'WIP')
  on conflict do nothing;
  get diagnostics v_movimenti = row_count;

  return jsonb_build_object('foto', v_foto.preso_il, 'aperture', v_aperture, 'movimenti', v_movimenti);
end $$;

revoke all on function public.mov_allinea_alnus() from public, anon;
grant execute on function public.mov_allinea_alnus() to authenticated;

-- Verifica (non scrive niente): la funzione esiste.
select proname from pg_proc where proname = 'mov_allinea_alnus';

-- ═══════════════════════════════════════════════════════════════════
-- SCARICHI DI PRODUZIONE  (14 ott 2026)
--
-- Un lotto di produzione (`consegne_commessa`) consuma i materiali della
-- commessa: per le commesse con "Materiali da DDT" il database scrive da
-- solo lo SCARICO dei codici C/L in `movimenti_magazzino`.
--
-- PERCHE' ADESSO: due ordini Enviro aperti sugli stessi codici (00392 e
-- 00394, magazzino unico deciso da Nico il 14 ott). Senza scarico, quando
-- la 00392 e' prodotta il suo materiale resta in giacenza e la 00394 lo
-- vede ancora disponibile: lo stesso pezzo montato due volte, sulla carta.
--
-- PERCHE' IL LOTTO E NON LA SPEDIZIONE: il gestionale scala gia' il
-- fabbisogno sui pezzi PRODOTTI (`commessaSuResiduo`, lotti in
-- consegne_commessa). Scaricare alla spedizione vorrebbe dire che fra
-- produzione e spedizione la commessa non chiede piu' quel materiale ma il
-- magazzino lo conta ancora: il residuo finirebbe a un'altra commessa.
-- I due conti devono muoversi con lo stesso gesto.
--
-- PERCHE' UN TRIGGER E NON IL CODICE DELL'APP: un lotto nasce da tre
-- strade (bottone "+ Registra produzione", chiusura della commessa, domani
-- forse il kiosk). Nel database le prende tutte, e lotto e scarico hanno
-- la stessa sorte: o entrambi o nessuno. E' la regola gia' scritta per le
-- spedizioni — "le due meta' dello stesso gesto devono avere la stessa
-- sorte" — portata dove la si puo' garantire.
--
-- COSA SCARICA: per ogni riga C/L della lista congelata della commessa,
-- qta_pz × pezzi del lotto, con il segno meno. MAC e ACQ no (MAC e'
-- consumo, ACQ resta su Alnus). Commessa senza il flag: niente.
--
-- ⚠ UN MOVIMENTO NON SI CANCELLA (regola della tabella). Se il lotto viene
-- cancellato, il trigger scrive una RETTIFICA uguale e contraria per ogni
-- scarico di quel lotto; se cambia la quantita' (oggi nessuna schermata lo
-- fa, ma il pannello si'), una rettifica per la differenza. Lo storico
-- mostra cosi' anche il lotto annullato.
--
-- ⚠ I lotti registrati PRIMA di questa migrazione, o prima di mettere la
-- spunta, non scaricano niente. Il 14 ott le due commesse Enviro non
-- avevano lotti: nessun arretrato.
--
-- SICUREZZA: le funzioni girano come il proprietario (security definer),
-- quindi scrivono in movimenti_magazzino senza aprire la policy di INSERT a
-- tutti gli utenti. Un utente continua a NON poter scrivere un movimento a
-- mano: puo' solo registrare un lotto, e lo scarico lo fa il database.
-- ═══════════════════════════════════════════════════════════════════

-- Il lotto da cui viene uno scarico: serve a trovarli per annullarli.
alter table movimenti_magazzino add column if not exists lotto_id uuid;
create index if not exists movimenti_magazzino_lotto_idx on movimenti_magazzino (lotto_id);

-- ── Scrive gli scarichi di UN lotto, per `pezzi` pezzi (negativo = rettifica che restituisce)
create or replace function public.mov_scarica_lotto(p_lotto uuid, p_operazione uuid,
  p_data date, p_pezzi numeric, p_tipo text, p_nota text)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_op  record;
  v_n   integer := 0;
begin
  if p_pezzi is null or p_pezzi = 0 then return 0; end if;
  select id, numero_ordine, pos, quantita, riferimento_cliente, materiali, materiali_da_ddt
    into v_op from operazioni where id = p_operazione;
  if not found or coalesce(v_op.materiali_da_ddt, false) = false
     or jsonb_typeof(v_op.materiali) <> 'array' then
    return 0;
  end if;

  insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
    documento_tipo, documento_numero, documento_data, documento_pos,
    ordine_rif, note, lotto_id, creato_da)
  select p_data, p_tipo, trim(r->>'codice'), r->>'descrizione',
         -- qta_pz salvato sulla riga; se manca, dal totale diviso i pezzi.
         -round((coalesce(nullif(r->>'qta_pz', '')::numeric,
                          (r->>'qta')::numeric / nullif(v_op.quantita, 0)) * p_pezzi)::numeric, 4),
         r->>'um',
         'PRODUZIONE', coalesce(v_op.numero_ordine, '') || '/' || coalesce(v_op.pos, ''),
         p_data, trim(r->>'codice'), v_op.riferimento_cliente, p_nota, p_lotto,
         lower(coalesce(auth.jwt() ->> 'email', 'database'))
  from jsonb_array_elements(v_op.materiali) r
  where upper(trim(coalesce(r->>'tipo', ''))) = 'C/L'
    and coalesce(trim(r->>'codice'), '') <> ''
    and coalesce(nullif(r->>'qta_pz', '')::numeric, (r->>'qta')::numeric) > 0;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── Il trigger: nasce, cambia o sparisce un lotto
create or replace function public.mov_trigger_lotto()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform mov_scarica_lotto(new.id, new.operazione_id, new.data, new.quantita, 'scarico',
      'Lotto di produzione: ' || new.quantita || ' pz');
    return new;
  elsif tg_op = 'UPDATE' then
    if coalesce(new.quantita, 0) <> coalesce(old.quantita, 0) then
      perform mov_scarica_lotto(new.id, new.operazione_id, new.data,
        coalesce(new.quantita, 0) - coalesce(old.quantita, 0), 'rettifica',
        'Lotto di produzione corretto: da ' || old.quantita || ' a ' || new.quantita || ' pz');
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    -- Rettifica uguale e contraria a TUTTO quello che quel lotto ha mosso
    -- (scarichi e rettifiche gia' fatte): restituisce esattamente il netto.
    insert into movimenti_magazzino (data, tipo, codice, descrizione, qta, um,
      documento_tipo, documento_numero, documento_data, documento_pos,
      ordine_rif, note, lotto_id, creato_da)
    select current_date, 'rettifica', m.codice, max(m.descrizione), -sum(m.qta), max(m.um),
           'PRODUZIONE', max(m.documento_numero), max(m.documento_data), m.codice,
           max(m.ordine_rif), 'Lotto di produzione annullato: ' || old.quantita || ' pz',
           old.id, lower(coalesce(auth.jwt() ->> 'email', 'database'))
    from movimenti_magazzino m
    where m.lotto_id = old.id
    group by m.codice
    having sum(m.qta) <> 0;
    return old;
  end if;
  return null;
end $$;

revoke all on function public.mov_scarica_lotto(uuid, uuid, date, numeric, text, text) from public;
revoke all on function public.mov_trigger_lotto() from public;

drop trigger if exists consegne_commessa_scarico on consegne_commessa;
create trigger consegne_commessa_scarico
  after insert or update of quantita or delete on consegne_commessa
  for each row execute function public.mov_trigger_lotto();

-- ── VERIFICA, senza lasciare tracce (da eseguire DOPO il blocco sopra) ──
-- Registra un lotto finto da 1 pz sulla 00392, conta gli scarichi, lo
-- cancella, conta le rettifiche. Poi si ferma con un ERRORE APPOSTA: un
-- errore annulla tutto quello che il blocco ha scritto, lotto e movimenti.
-- ⚠ Quindi la risposta GIUSTA e' un messaggio rosso che dice:
--    VERIFICA OK (annullata): scarichi 65, rettifiche 65, netto 0
-- Qualunque altro numero, o un errore diverso, vuol dire che non va.
do $$
declare v_op uuid; v_lotto uuid; v_s int; v_r int; v_netto numeric;
begin
  select id into v_op from operazioni where numero_ordine = '2026/OC/00392' and pos = '0010';
  insert into consegne_commessa (operazione_id, data, quantita, nota)
    values (v_op, current_date, 1, 'PROVA migrazione scarichi') returning id into v_lotto;
  select count(*) into v_s from movimenti_magazzino where lotto_id = v_lotto and tipo = 'scarico';
  delete from consegne_commessa where id = v_lotto;
  select count(*) into v_r from movimenti_magazzino where lotto_id = v_lotto and tipo = 'rettifica';
  select coalesce(sum(qta), 0) into v_netto from movimenti_magazzino where lotto_id = v_lotto;
  raise exception 'VERIFICA OK (annullata): scarichi %, rettifiche %, netto %', v_s, v_r, v_netto;
end $$;

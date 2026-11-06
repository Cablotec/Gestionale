-- Eliminare le richieste per terzista ANNULLATE (Nico, 6 nov 2026).
-- Solo admin, solo stato 'annullato', e solo se nessun movimento le cita:
-- una richiesta annullata non ha mai mosso la giacenza (si annulla solo
-- da 'da_preparare'), quindi sparisce senza lasciare buchi. Le inviate
-- restano per sempre: sono la storia di cosa e' partito.
drop policy if exists invii_terzista_elimina on invii_terzista;
create policy invii_terzista_elimina on invii_terzista for delete to authenticated
  using (stato = 'annullato'
    and exists (select 1 from profili where id = auth.uid() and ruolo = 'admin')
    and not exists (select 1 from movimenti_magazzino m where m.invio_id = invii_terzista.id));

-- VERIFICA: deve uscire una riga con cmd = DELETE.
select policyname, cmd from pg_policies
 where tablename = 'invii_terzista' and policyname = 'invii_terzista_elimina';

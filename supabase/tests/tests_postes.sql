-- Tests des postes Responsable commercial et RLA.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000020','commercial@dgs.ml'),('00000000-0000-0000-0000-000000000021','rla@dgs.ml');
update profils set actif=true, poste='commercial' where id='00000000-0000-0000-0000-000000000020';
update profils set actif=true, poste='rla' where id='00000000-0000-0000-0000-000000000021';
insert into remunerations values ('00000000-0000-0000-0000-000000000021', 600000);

insert into pv_execution (id,chantier_id,type,tiers,objet,montant_ht,statut,signe_le,initie_par) values ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','client','Client ENR','Acompte 40 %',12800000,'Signé',current_date,'00000000-0000-0000-0000-000000000006');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000020';
insert into factures_clients (pv_id,objet,echeance) values ('30000000-0000-0000-0000-000000000002','Acompte 40 %',current_date+20);
select pg_temp.check(true,'le responsable commercial émet une facture client');
select pg_temp.check((select count(*) from rentabilite_chantiers())=2, 'le responsable commercial voit la rentabilité de tous les projets');
select pg_temp.check(pg_temp.echoue($$select encaisser_facture((select id from factures_clients order by cree_le desc limit 1))$$), 'le responsable commercial n''encaisse pas');
select pg_temp.check((select count(*) from remunerations)=0, 'le responsable commercial ne voit pas les salaires');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into factures_fournisseurs (fournisseur,numero,chantier_id,objet,montant_ht) values ('Distributeur solaire','F-118','10000000-0000-0000-0000-000000000002','Onduleurs',4200000);
select pg_temp.check(true,'le RLA enregistre une facture fournisseur');
select pg_temp.check(pg_temp.echoue($$select decider_facture_fournisseur((select id from factures_fournisseurs where numero='F-118'), true)$$), 'le RLA ne donne pas de bon à payer');
select pg_temp.check(pg_temp.echoue($$select payer_facture_fournisseur((select id from factures_fournisseurs where numero='F-118'))$$), 'le RLA ne paie pas');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select montant from frais_generaux_du_mois(current_date) where source='Paie') >= 600000, 'le salaire du RLA compte dans les frais généraux');
commit;
\echo 'Tous les tests des nouveaux postes passent.'

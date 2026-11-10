-- Tests des paramètres par pays, de l'AIB, des annulations et des avoirs.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

select pg_temp.check((select valeur from parametres where pays='BJ' and cle='aib') = 1, 'AIB à 1 % par défaut au Bénin');
select pg_temp.check((select valeur from parametres where pays='ML' and cle='aib') = 0, 'AIB non applicable par défaut au Mali');

-- Paramètres : le RAF peut les régler, pas le chef de projet
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
update parametres set valeur = 10 where cle = 'tva';
select pg_temp.check((select valeur from parametres where pays='ML' and cle='tva') = 18, 'un chef de projet ne change pas la TVA');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
update parametres set valeur = 5 where cle = 'aib';
select pg_temp.check((select valeur = 5 and modifie_par = '00000000-0000-0000-0000-000000000003' from parametres where pays='ML' and cle='aib'), 'le RAF règle l''AIB de son pays, et c''est tracé');
select pg_temp.check(pg_temp.echoue($$update parametres set valeur = 150 where cle = 'tva'$$), 'un taux au-delà de 100 % est refusé');
update parametres set valeur = 0 where cle = 'aib';
commit;
select pg_temp.check((select valeur from parametres where pays='BJ' and cle='aib') = 1, 'le réglage du Mali ne touche pas le Bénin');

-- Facture client avec AIB, puis annulation et refacturation du même PV
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
insert into pv_execution (chantier_id,type,tiers,objet,montant_ht) values ('10000000-0000-0000-0000-000000000001','client','Client AIB','PV AIB',1000000);
select signer_pv((select id from pv_execution where objet='PV AIB'));
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
insert into factures_clients (pv_id,objet,echeance,taux_aib) values ((select id from pv_execution where objet='PV AIB'),'Facture AIB',current_date+30,5);
select pg_temp.check((select montant_tva = 180000 and montant_ttc = 1180000 and montant_aib = 50000 and net_a_payer = 1130000
                      from factures_clients where objet='Facture AIB'), 'AIB 5 % sur le HT : net à encaisser = TTC − AIB');
select pg_temp.check(pg_temp.echoue($$select annuler_facture_client((select id from factures_clients where objet='Facture AIB'), '  ')$$), 'une annulation demande un motif');
select annuler_facture_client((select id from factures_clients where objet='Facture AIB'), 'Mauvais taux AIB');
select pg_temp.check((select statut = 'Annulée' and annulee_par = '00000000-0000-0000-0000-000000000003' and motif_annulation = 'Mauvais taux AIB'
                      from factures_clients where objet='Facture AIB'), 'la facture est annulée avec qui et pourquoi');
select pg_temp.check((select statut from pv_execution where objet='PV AIB') = 'Signé', 'le PV redevient à facturer');
insert into factures_clients (pv_id,objet,echeance,taux_aib,taux_tva) values ((select id from pv_execution where objet='PV AIB'),'Facture AIB corrigée',current_date+30,1,0);
select pg_temp.check((select montant_tva = 0 and montant_aib = 10000 and net_a_payer = 990000 from factures_clients where objet='Facture AIB corrigée'),
                     'le PV est refacturé, ici exonéré de TVA avec AIB 1 %');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$select annuler_facture_client((select id from factures_clients where objet='Facture AIB corrigée'), 'x')$$), 'un chef de projet n''annule pas une facture');
commit;

-- Avoir sur une facture encaissée
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select encaisser_facture((select id from factures_clients where objet='Facture AIB corrigée'));
select pg_temp.check(pg_temp.echoue($$select annuler_facture_client((select id from factures_clients where objet='Facture AIB corrigée'), 'Erreur')$$), 'une facture encaissée ne s''annule pas');
insert into avoirs_clients (facture_id, motif, montant_ht) values ((select id from factures_clients where objet='Facture AIB corrigée'), 'Remise accordée', 200000);
select pg_temp.check((select numero like 'AV-%-001' and taux_aib = 1 and taux_tva = 0 and net_a_payer = 198000 and chantier_id = '10000000-0000-0000-0000-000000000001'
                      from avoirs_clients), 'l''avoir reprend le projet et les taux de la facture');
select pg_temp.check(pg_temp.echoue($$insert into avoirs_clients (facture_id, motif, montant_ht) values ((select id from factures_clients where objet='Facture AIB corrigée'), 'Trop', 900000)$$),
                     'les avoirs ne dépassent pas la facture');
select pg_temp.check((select facture_ht from rentabilite_chantiers() where chantier_id='10000000-0000-0000-0000-000000000001')
                     = (select sum(montant_ht) from factures_clients where chantier_id='10000000-0000-0000-0000-000000000001' and statut <> 'Annulée') - 200000,
                     'la rentabilité déduit l''avoir');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$insert into avoirs_clients (facture_id, motif, montant_ht) values ((select id from factures_clients limit 1), 'x', 1)$$), 'un chef de projet n''émet pas d''avoir');
commit;

-- Facture fournisseur : annulation, puis ressaisie du même numéro
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
insert into factures_fournisseurs (fournisseur,numero,objet,montant_ht,taux_aib) values ('Fournisseur AIB','FA-1','Ciment',500000,3);
select pg_temp.check((select montant_aib = 15000 and net_a_payer = 575000 from factures_fournisseurs where numero='FA-1'), 'AIB retenu par DGS sur la facture fournisseur');
select annuler_facture_fournisseur((select id from factures_fournisseurs where numero='FA-1'), 'Montant erroné');
insert into factures_fournisseurs (fournisseur,numero,objet,montant_ht) values ('Fournisseur AIB','FA-1','Ciment',550000);
select pg_temp.check((select count(*) from factures_fournisseurs where numero='FA-1') = 2, 'la facture annulée peut être ressaisie correctement');
commit;

-- PV : annulation
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
insert into pv_execution (chantier_id,type,tiers,objet,montant_ht) values ('10000000-0000-0000-0000-000000000001','client','Client X','PV erroné',300000);
select annuler_pv((select id from pv_execution where objet='PV erroné'), 'Doublon');
select pg_temp.check((select statut from pv_execution where objet='PV erroné') = 'Annulé', 'le chef de projet annule son PV non signé');
select pg_temp.check(pg_temp.echoue($$select annuler_pv((select id from pv_execution where objet='PV AIB'), 'x')$$), 'il n''annule pas un PV facturé');
commit;
\echo 'Tous les tests des paramètres, de l''AIB et des corrections passent.'

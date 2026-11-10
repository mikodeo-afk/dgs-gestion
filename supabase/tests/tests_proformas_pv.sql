-- Tests des proformas de soumission et des PV d'exécution.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Proforma : le RT initie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000030';
insert into proformas (client,objet,domaine,montant_ht,date_limite) values ('Opérateur télécom','AO pose fibre lot 2','Télécoms',45000000,current_date+10);
select pg_temp.check((select numero from proformas) like 'PF-%-001', 'le RT initie une proforma numérotée');
select pg_temp.check((select montant_ttc from proformas) = 53100000, 'la proforma affiche HT, TVA et TTC');
select pg_temp.check(pg_temp.echoue($$select viser_proforma((select id from proformas limit 1), true)$$), 'le RT ne vise pas sa proforma');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$insert into proformas (client,objet,domaine,montant_ht) values ('X','Y','BTP',1)$$), 'un chef de projet n''initie pas de proforma');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$select viser_proforma((select id from proformas limit 1), true)$$), 'le RAF ne vise pas les proformas');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.check(viser_proforma((select id from proformas limit 1), true) = 'À viser', 'après le visa du DG, la proforma attend encore le DO');
select pg_temp.check(pg_temp.echoue($$select viser_proforma((select id from proformas limit 1), true)$$), 'le DG ne vise pas deux fois');
select pg_temp.check(pg_temp.echoue($$select resultat_proforma((select id from proformas limit 1), true)$$), 'une proforma non validée ne peut pas être gagnée');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select pg_temp.check(viser_proforma((select id from proformas limit 1), true) = 'Validée', 'avec le visa du DO, la proforma est validée');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000030';
select resultat_proforma((select id from proformas limit 1), true);
select pg_temp.check((select statut from proformas) = 'Gagnée', 'la soumission est marquée gagnée');
insert into proformas (client,objet,domaine,montant_ht) values ('Mairie','Éclairage solaire','Énergie',9000000);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.echoue($$select viser_proforma((select id from proformas where client='Mairie'), false)$$), 'un refus demande un motif');
select viser_proforma((select id from proformas where client='Mairie'), false, 'Prix trop bas');
select pg_temp.check((select statut from proformas where client='Mairie') = 'Rejetée', 'un refus du DO rejette la proforma');
commit;

-- PV d'exécution : le chef de projet, sur ses projets
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
insert into pv_execution (chantier_id,type,tiers,objet,avancement,montant_ht) values ('10000000-0000-0000-0000-000000000001','client','Client TEL','Situation n°2',60,5200000);
insert into pv_execution (chantier_id,type,tiers,objet,montant_ht) values ('10000000-0000-0000-0000-000000000001','prestataire','Sous-traitant génie civil','Tranchées 2 km',2400000);
select pg_temp.check((select count(*) from pv_execution where objet in ('Situation n°2','Tranchées 2 km')) = 2, 'le chef de projet établit des PV client et prestataire');
insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'pv', id, pays||'/pv/'||id||'/signe.pdf', 'signe.pdf' from pv_execution where id = (select id from pv_execution where objet='Situation n°2');
select signer_pv((select id from pv_execution where objet='Situation n°2'));
insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'pv', id, pays||'/pv/'||id||'/signe.pdf', 'signe.pdf' from pv_execution where id = (select id from pv_execution where objet='Tranchées 2 km');
select signer_pv((select id from pv_execution where objet='Tranchées 2 km'));
select pg_temp.check((select count(*) from pv_execution where statut='Signé' and objet in ('Situation n°2','Tranchées 2 km')) = 2, 'le chef de projet enregistre la signature');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check(pg_temp.echoue($$insert into pv_execution (chantier_id,type,tiers,objet,montant_ht) values ('10000000-0000-0000-0000-000000000001','client','X','Y',1)$$), 'un technicien n''établit pas de PV');
commit;

-- Factures à partir des PV
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$insert into factures_clients (chantier_id,objet,montant_ht,echeance) values ('10000000-0000-0000-0000-000000000001','Sans PV',1000,current_date)$$), 'pas de facture client sans PV');
insert into factures_clients (pv_id,objet,echeance) values ((select id from pv_execution where objet='Situation n°2'),'Situation n°2',current_date+30);
select pg_temp.check((select montant_ht = 5200000 and chantier_id = '10000000-0000-0000-0000-000000000001' from factures_clients where objet='Situation n°2'), 'la facture reprend le projet et le montant du PV');
select pg_temp.check((select statut from pv_execution where objet='Situation n°2') = 'Facturé', 'le PV passe à « Facturé »');
select pg_temp.check(pg_temp.echoue($$insert into factures_clients (pv_id,objet,echeance) values ((select id from pv_execution where objet='Situation n°2'),'Doublon',current_date)$$), 'un PV ne sert qu''à une facture');
select pg_temp.check(pg_temp.echoue($$insert into factures_clients (pv_id,objet,echeance) values ((select id from pv_execution where objet='Tranchées 2 km'),'Mauvais type',current_date)$$), 'un PV prestataire ne sert pas à une facture client');
insert into factures_fournisseurs (fournisseur,numero,objet,montant_ht,pv_id) values ('Sous-traitant génie civil','ST-9','Tranchées 2 km',2400000,(select id from pv_execution where objet='Tranchées 2 km'));
select pg_temp.check((select chantier_id = '10000000-0000-0000-0000-000000000001' from factures_fournisseurs where numero='ST-9'), 'la facture prestataire est imputée au projet du PV');
insert into factures_fournisseurs (fournisseur,numero,objet,montant_ht,bon_commande_id) values ('Autre fournisseur','AF-1','Câble',1300000,(select id from bons_commande where statut='Validé'));
select pg_temp.check((select chantier_id = '10000000-0000-0000-0000-000000000002' from factures_fournisseurs where numero='AF-1'), 'la facture liée à un bon de commande est imputée à son projet');
commit;
\echo 'Tous les tests des proformas et PV passent.'

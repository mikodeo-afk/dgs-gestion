-- Tests du circuit des achats : RLA → RAF → DO.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- 1. Le RLA initie une demande pour un projet.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into demandes_achat (chantier_id,objet,details,montant_estime) values ('10000000-0000-0000-0000-000000000002','Câble solaire 6 mm²','500 m',1500000);
select pg_temp.check((select numero from demandes_achat) = 'DA-' || to_char(current_date,'YYYY') || '-001', 'le RLA initie une demande d''achat numérotée');
select pg_temp.check(pg_temp.echoue($$select initier_bon_commande((select id from demandes_achat limit 1),'X',1000)$$), 'le RLA n''initie pas de bon de commande');
commit;

-- Les autres postes n'initient pas de demande d'achat.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$insert into demandes_achat (chantier_id,objet) values ('10000000-0000-0000-0000-000000000002','Test')$$), 'le RAF n''initie pas de demande d''achat');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check(pg_temp.echoue($$insert into demandes_achat (chantier_id,objet) values ('10000000-0000-0000-0000-000000000002','Test')$$), 'un technicien n''initie pas de demande d''achat');
select pg_temp.check((select count(*) from demandes_achat) = 0, 'un technicien ne voit pas les demandes d''achat');
commit;

-- 2. Le RAF étudie et initie le bon de commande.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(initier_bon_commande((select id from demandes_achat limit 1),'Distributeur solaire',1400000,18,current_date+7) like 'BC-%', 'le RAF initie le bon de commande');
select pg_temp.check((select statut from demandes_achat) = 'Commandée', 'la demande passe à « Commandée »');
select pg_temp.check((select montant_tva = 252000 and montant_ttc = 1652000 from bons_commande), 'le bon de commande affiche HT, TVA et TTC');
select pg_temp.check(pg_temp.echoue($$select decider_bon_commande((select id from bons_commande limit 1), true)$$), 'le RAF ne valide pas le bon de commande');
select pg_temp.check(pg_temp.echoue($$update bons_commande set statut='Validé'$$) or (select statut from bons_commande) = 'À valider', 'on ne valide pas un bon en modifiant la table');
commit;

-- 3. Seul le DO valide.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.echoue($$select decider_bon_commande((select id from bons_commande limit 1), true)$$), 'le PDG ne valide pas les bons de commande par défaut');
select pg_temp.check((select count(*) from bons_commande) = 1, 'le PDG voit les bons de commande');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select pg_temp.check(pg_temp.echoue($$select decider_bon_commande((select id from bons_commande limit 1), false)$$), 'un rejet sans motif est refusé');
select decider_bon_commande((select id from bons_commande limit 1), false, 'Demander un 2e devis');
select pg_temp.check((select statut from demandes_achat) = 'Soumise', 'un bon rejeté renvoie la demande au RAF');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select initier_bon_commande((select id from demandes_achat limit 1),'Autre fournisseur',1300000);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select decider_bon_commande((select id from bons_commande where statut='À valider'), true);
select pg_temp.check((select count(*) from bons_commande where statut='Validé' and valide_par='00000000-0000-0000-0000-000000000002') = 1, 'le DO valide le bon de commande');
commit;

-- Le DO peut déléguer la validation à quelqu'un.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into droits_personne (profil_id, cle, accorde) values ('00000000-0000-0000-0000-000000000006','bc.valider',true);
commit;
select pg_temp.check(a_droit('bc.valider','00000000-0000-0000-0000-000000000006'), 'le DO peut accorder la validation des bons de commande');
delete from droits_personne where cle = 'bc.valider';
\echo 'Tous les tests des achats passent.'

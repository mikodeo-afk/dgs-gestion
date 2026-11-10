-- Tests des bordereaux des prix, quantitatifs de chantier, lignes de PV et justificatifs.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Le RAF enregistre un client et un prestataire avec leurs bordereaux
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
insert into tiers (type, nom, ifu) values ('client', 'Opérateur Mobile SA', '0001'), ('prestataire', 'Génie Civil Plus', null);
insert into bordereau_prix (tiers_id, designation, unite, prix_unitaire_ht) values
  ((select id from tiers where nom='Opérateur Mobile SA'), 'Fouille en tranchée', 'ml', 2500),
  ((select id from tiers where nom='Opérateur Mobile SA'), 'Pose de fibre', 'ml', 1200),
  ((select id from tiers where nom='Génie Civil Plus'), 'Fouille en tranchée', 'ml', 1500);
select pg_temp.check((select count(*) from bordereau_prix where pays='ML') = 3, 'les bordereaux sont enregistrés dans le pays');
select pg_temp.check(pg_temp.echoue($$insert into tiers (type, nom) values ('client', 'opérateur mobile sa ')$$), 'pas deux clients du même nom');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select pg_temp.check((select count(*) from bordereau_prix) = 0, 'un chef d''équipe ne voit pas les prix');
select pg_temp.check(pg_temp.echoue($$insert into tiers (type, nom) values ('client', 'X')$$), 'un chef d''équipe n''enregistre pas de client');
commit;

-- Dossier administratif obligatoire avant d'utiliser la société
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.check(pg_temp.echoue($$update chantiers set client_id = (select id from tiers where nom='Opérateur Mobile SA') where id = '10000000-0000-0000-0000-000000000001'$$),
                     'un client sans dossier administratif ne peut pas être rattaché à un chantier');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'tiers', id, 'ML/tiers/'||id||'/a.pdf', 'a.pdf' from tiers where nom='Génie Civil Plus'$$),
                     'un document de société doit avoir un type');
select pg_temp.check(pg_temp.echoue($$insert into justificatifs (objet,objet_id,chemin,nom_fichier,type_document) select 'tiers', id, 'ML/tiers/'||id||'/a.pdf', 'a.pdf', 'Attestation de régularité fiscale' from tiers where nom='Génie Civil Plus'$$),
                     'un document fiscal doit avoir sa date de validité');
insert into justificatifs (objet,objet_id,chemin,nom_fichier,type_document) select 'tiers', id, 'ML/tiers/'||id||'/rccm.pdf', 'rccm.pdf', 'RCCM' from tiers where nom in ('Opérateur Mobile SA','Génie Civil Plus');
select pg_temp.check(dossier_administratif((select id from tiers where nom='Génie Civil Plus')), 'le RAF dépose le dossier administratif');
commit;

-- Le PDG renseigne les activités et quantitatifs prévisionnels du chantier
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
update chantiers set client_id = (select id from tiers where nom='Opérateur Mobile SA') where id = '10000000-0000-0000-0000-000000000001';
insert into chantier_lignes (chantier_id, ordre, bordereau_id, designation, unite, quantite_prevue) values
  ('10000000-0000-0000-0000-000000000001', 1, (select id from bordereau_prix where designation='Fouille en tranchée' and prix_unitaire_ht=2500), '-', '-', 2000),
  ('10000000-0000-0000-0000-000000000001', 2, (select id from bordereau_prix where designation='Pose de fibre'), '-', '-', 2000);
select pg_temp.check((select sum(montant_ht) from chantier_lignes where chantier_id='10000000-0000-0000-0000-000000000001') = 7400000,
                     'les lignes reprennent libellé et prix du bordereau du client');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$insert into chantier_lignes (chantier_id, designation, unite, quantite_prevue) values ('10000000-0000-0000-0000-000000000001','X','u',1)$$),
                     'le chef de projet ne modifie pas les quantitatifs du marché');

-- PV client : quantités exécutées, prix du marché
insert into pv_execution (chantier_id, type, tiers, tiers_id, objet) values
  ('10000000-0000-0000-0000-000000000001', 'client', 'Opérateur Mobile SA', (select id from tiers where nom='Opérateur Mobile SA'), 'Attachement n°1');
insert into pv_lignes (pv_id, chantier_ligne_id, designation, unite, quantite, prix_unitaire_ht) values
  ((select id from pv_execution where objet='Attachement n°1'), (select id from chantier_lignes where ordre=1 and chantier_id='10000000-0000-0000-0000-000000000001'), '-', '-', 800, 1),
  ((select id from pv_execution where objet='Attachement n°1'), (select id from chantier_lignes where ordre=2 and chantier_id='10000000-0000-0000-0000-000000000001'), '-', '-', 500, 1);
select pg_temp.check((select montant_ht from pv_execution where objet='Attachement n°1') = 2600000,
                     'le montant du PV = somme des quantités exécutées × prix du marché');
select pg_temp.check(pg_temp.echoue($$select signer_pv((select id from pv_execution where objet='Attachement n°1'))$$),
                     'pas de signature sans le document signé déposé');
select pg_temp.check(pg_temp.echoue($$insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'pv', id, 'BJ/pv/'||id||'/x.pdf', 'x.pdf' from pv_execution where objet='Attachement n°1'$$),
                     'le fichier se range dans le dossier de son pays');
insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'pv', id, 'ML/pv/'||id||'/pv-signe.pdf', 'pv-signe.pdf' from pv_execution where objet='Attachement n°1';
select signer_pv((select id from pv_execution where objet='Attachement n°1'));
select pg_temp.check((select statut from pv_execution where objet='Attachement n°1') = 'Signé', 'avec le document déposé, le PV est signé');
select pg_temp.check(pg_temp.echoue($$update pv_lignes set quantite = 900 where pv_id = (select id from pv_execution where objet='Attachement n°1')$$),
                     'les quantités d''un PV signé ne changent plus');

-- PV prestataire : prix du bordereau du prestataire
insert into pv_execution (chantier_id, type, tiers, tiers_id, objet) values
  ('10000000-0000-0000-0000-000000000001', 'prestataire', 'Génie Civil Plus', (select id from tiers where nom='Génie Civil Plus'), 'Attachement ST n°1');
select pg_temp.check(pg_temp.echoue($$insert into pv_lignes (pv_id, bordereau_id, designation, unite, quantite, prix_unitaire_ht)
  values ((select id from pv_execution where objet='Attachement ST n°1'), (select id from bordereau_prix where designation='Pose de fibre'), '-', '-', 10, 1)$$),
  'on ne prend pas le prix d''un autre tiers');
insert into pv_lignes (pv_id, chantier_ligne_id, bordereau_id, designation, unite, quantite, prix_unitaire_ht) values
  ((select id from pv_execution where objet='Attachement ST n°1'), (select id from chantier_lignes where ordre=1 and chantier_id='10000000-0000-0000-0000-000000000001'),
   (select id from bordereau_prix where prix_unitaire_ht=1500), '-', '-', 800, 1);
select pg_temp.check((select montant_ht from pv_execution where objet='Attachement ST n°1') = 1200000, 'PV prestataire au prix de son bordereau');
insert into justificatifs (objet,objet_id,chemin,nom_fichier) select 'pv', id, 'ML/pv/'||id||'/st.jpg', 'st.jpg' from pv_execution where objet='Attachement ST n°1';
select signer_pv((select id from pv_execution where objet='Attachement ST n°1'));
commit;

-- Factures à partir des PV signés
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
insert into factures_clients (pv_id, objet, echeance) values ((select id from pv_execution where objet='Attachement n°1'), 'Attachement n°1', current_date + 30);
select pg_temp.check((select montant_ht from factures_clients where objet='Attachement n°1') = 2600000, 'la facture client reprend le total des lignes du PV');
insert into factures_fournisseurs (fournisseur, numero, objet, montant_ht, pv_id) values ('Génie Civil Plus', 'GCP-1', 'Attachement ST n°1', 1, (select id from pv_execution where objet='Attachement ST n°1'));
select pg_temp.check((select montant_ht from factures_fournisseurs where numero='GCP-1') = 1200000, 'la facture du prestataire reprend le montant de son PV');
select pg_temp.check((select count(*) from justificatifs) >= 2, 'le RAF voit les justificatifs');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select pg_temp.check((select count(*) from justificatifs) = 0, 'un chef d''équipe ne voit pas les justificatifs');
select pg_temp.check(pg_temp.echoue($$insert into justificatifs (objet,objet_id,chemin,nom_fichier) values ('pv', gen_random_uuid(), 'ML/pv/x/y.pdf', 'y.pdf')$$), 'un chef d''équipe ne dépose pas de justificatif de PV');
commit;
\echo 'Tous les tests des quantitatifs et justificatifs passent.'

-- Ouverture d'un chantier
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
insert into chantiers (code, nom, domaine, client_id) values ('BTP-090', 'Siège client', 'BTP', (select id from tiers where nom='Opérateur Mobile SA'));
select pg_temp.check((select validation from chantiers where code='BTP-090') = 'À valider', 'un nouveau chantier attend son ouverture');
select pg_temp.check(pg_temp.echoue($$update chantiers set validation = 'Validé' where code='BTP-090'$$), 'on ne force pas l''ouverture à la main');
select pg_temp.check(pg_temp.echoue($$select valider_chantier((select id from chantiers where code='BTP-090'))$$), 'le DG ne valide pas le chantier qu''il a créé');
insert into chantiers (code, nom, domaine) values ('BTP-091', 'Clôture', 'BTP');
insert into justificatifs (objet, objet_id, chemin, nom_fichier) select 'bc_client', id, 'ML/bc_client/'||id||'/bc.pdf', 'bc.pdf' from chantiers where code='BTP-091';
select pg_temp.check((select validation = 'Validé' and ouverture = 'Bon de commande du client' from chantiers where code='BTP-091'), 'le bon de commande du client ouvre le chantier');
update chantiers set chef_projet_id = '00000000-0000-0000-0000-000000000006' where code in ('BTP-090','BTP-091');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$insert into pv_execution (chantier_id, type, tiers, objet) select id, 'client', 'X', 'Y' from chantiers where code='BTP-090'$$), 'pas de PV sur un chantier non ouvert');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$select valider_chantier((select id from chantiers where code='BTP-090'))$$), 'le RAF ne valide pas l''ouverture');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select valider_chantier((select id from chantiers where code='BTP-090'));
select pg_temp.check((select validation = 'Validé' and ouverture = 'Validé sans bon de commande' from chantiers where code='BTP-090'), 'sans bon de commande, le DO valide l''ouverture');
commit;
\echo 'Ouverture des chantiers : OK.'

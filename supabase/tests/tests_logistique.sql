-- Tests de la logistique : stock, matériel de travail et matériel roulant.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.erreur(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;

-- RLA : articles et mouvements
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into articles (id, code, designation, unite, seuil_alerte) values
  ('60000000-0000-0000-0000-000000000001', 'CIM-50', 'Ciment CPA 50 kg', 'sac', 20),
  ('60000000-0000-0000-0000-000000000002', 'FO-48', 'Câble fibre 48 FO', 'm', 0);
select pg_temp.check(pg_temp.echoue($$insert into articles (code, designation, unite) values ('cim-50', 'Doublon', 'sac')$$), 'un code article est unique');
select entree_stock('60000000-0000-0000-0000-000000000001', null, 100, 5000, null, 'Quincaillerie', 'Livraison 1');
select entree_stock('60000000-0000-0000-0000-000000000001', null, 100, 6000);
select pg_temp.check(cmp_article('60000000-0000-0000-0000-000000000001') = 5500, 'coût moyen pondéré : 5 500 FCFA le sac');
select pg_temp.check(pg_temp.erreur($$select utiliser_stock('60000000-0000-0000-0000-000000000001', null, null, 10, null)$$) like '%chantier%', 'une utilisation est imputée à un chantier');
select utiliser_stock('60000000-0000-0000-0000-000000000001', null, null, 50, '10000000-0000-0000-0000-000000000001', 'Massif pylône');
select pg_temp.check(deplacer_stock('60000000-0000-0000-0000-000000000001', null, null, '10000000-0000-0000-0000-000000000001', null, 60, 'Approvisionnement') = 'Transfert',
                     'dépôt → chantier : transfert');
select pg_temp.check(quantite_en_stock('60000000-0000-0000-0000-000000000001', null) = 90
                     and quantite_en_stock('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001') = 60,
                     'transfert : 90 au dépôt, 60 sur le chantier');
select pg_temp.check(pg_temp.erreur($$select utiliser_stock('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 61, '10000000-0000-0000-0000-000000000001')$$) like '%Stock insuffisant%',
                     'on n''utilise pas plus que le stock de l''endroit');
select pg_temp.check(pg_temp.echoue($$select utiliser_stock('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 5, '10000000-0000-0000-0000-000000000002')$$),
                     'le stock d''un chantier ne sert pas à un autre chantier');
select utiliser_stock('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 45, '10000000-0000-0000-0000-000000000001');
select pg_temp.check(inventaire_stock('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, 12, 'Comptage') = -3, 'inventaire : écart de −3 tracé');
select pg_temp.check((select quantite = 95 and valeur = 95 * 5500 from consommation_chantier('10000000-0000-0000-0000-000000000001') where code = 'CIM-50'),
                     'matériel utilisé sur le chantier : 95 sacs, valorisés au CMP');
select pg_temp.check((select sum(quantite) from etat_stock() where code = 'CIM-50') = 102, 'état du stock : 90 + 12');
select pg_temp.check(not exists (select 1 from alertes_logistique() where genre = 'Stock'), 'pas d''alerte au-dessus du seuil');
select utiliser_stock('60000000-0000-0000-0000-000000000001', null, null, 85, '10000000-0000-0000-0000-000000000002');
select pg_temp.check(exists (select 1 from alertes_logistique() where genre = 'Stock' and libelle like 'CIM-50%'), 'alerte quand le stock passe sous le seuil');

-- Matériel remis par le client, dotation du jour à un technicien, utilisation et retour
insert into articles (id, code, designation, unite, client_id) values
  ('60000000-0000-0000-0000-000000000003', 'ONT-CL', 'Boîtier ONT (fourni par le client)', 'pièce', (select id from tiers where nom = 'Quincaillerie'));
select entree_stock('60000000-0000-0000-0000-000000000003', null, 40, 25000, null, null, 'Livraison client');
select pg_temp.check((select prix_unitaire = 0 and fournisseur = 'Quincaillerie' from mouvements_stock where article_id = '60000000-0000-0000-0000-000000000003'),
                     'le matériel du client entre sans valeur, au nom du client');
select pg_temp.check(deplacer_stock('60000000-0000-0000-0000-000000000003', null, null, null, '00000000-0000-0000-0000-000000000010', 10, 'Dotation du jour') = 'Dotation',
                     'dépôt → technicien : dotation');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select utiliser_stock('60000000-0000-0000-0000-000000000003', null, '00000000-0000-0000-0000-000000000010', 7, '10000000-0000-0000-0000-000000000001', 'Raccordements du jour');
select pg_temp.check(pg_temp.echoue($$select utiliser_stock('60000000-0000-0000-0000-000000000003', null, null, 1, '10000000-0000-0000-0000-000000000001')$$),
                     'le technicien ne déclare que le matériel qu''il détient');
select pg_temp.check(pg_temp.echoue($$select deplacer_stock('60000000-0000-0000-0000-000000000003', null, '00000000-0000-0000-0000-000000000010', null, null, 3)$$),
                     'le retour au dépôt est enregistré par le gestionnaire');
select pg_temp.check((select sum(quantite) from etat_stock() where code = 'ONT-CL' and detenteur_id = '00000000-0000-0000-0000-000000000010') = 3,
                     'le technicien voit ce qu''il détient encore : 3');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select pg_temp.check(deplacer_stock('60000000-0000-0000-0000-000000000003', null, '00000000-0000-0000-0000-000000000010', null, null, 3, 'Non utilisé') = 'Retour',
                     'technicien → dépôt : retour du matériel non utilisé');
select pg_temp.check(quantite_en_stock('60000000-0000-0000-0000-000000000003', null, '00000000-0000-0000-0000-000000000010') = 0
                     and quantite_en_stock('60000000-0000-0000-0000-000000000003', null) = 33, 'dépôt : 40 − 10 + 3 = 33');
select pg_temp.check(pg_temp.echoue($$insert into mouvements_stock (article_id, type, quantite) values ('60000000-0000-0000-0000-000000000001', 'Entrée', 1000)$$),
                     'pas de mouvement saisi en direct dans la table');
commit;

-- Chef de projet : voit le stock de son chantier, ne le gère pas
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$select entree_stock('60000000-0000-0000-0000-000000000001', null, 10, 1)$$), 'le chef de projet ne gère pas le stock');
select pg_temp.check(pg_temp.echoue($$select deplacer_stock('60000000-0000-0000-0000-000000000003', null, null, null, '00000000-0000-0000-0000-000000000006', 1)$$), 'ni ne se dote lui-même');
select pg_temp.check((select count(*) from mouvements_stock where lieu_id = '10000000-0000-0000-0000-000000000001') > 0, 'il voit les mouvements de son chantier');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from mouvements_stock where lieu_id is null and detenteur_id is null and chantier_id is distinct from '10000000-0000-0000-0000-000000000001') = 0
                     and (select count(*) from mouvements_stock) > 0, 'un technicien ne voit que les mouvements de son chantier');
commit;

-- Matériel
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into equipements (id, code, categorie, type, designation, immatriculation, unite_compteur) values
  ('70000000-0000-0000-0000-000000000001', 'VH-001', 'Matériel roulant', 'Pick-up', 'Toyota Hilux', 'AB 1234 MD', 'km'),
  ('70000000-0000-0000-0000-000000000002', 'GE-001', 'Matériel de travail', 'Groupe électrogène', 'Groupe 20 kVA', null, 'h');
select pg_temp.check(pg_temp.echoue($$insert into equipements (code, categorie, type, designation, immatriculation) values ('VH-002', 'Matériel roulant', 'Camion', 'Camion', 'ab1234md')$$),
                     'une immatriculation est unique');
select pg_temp.check(pg_temp.echoue($$update equipements set chantier_id = '10000000-0000-0000-0000-000000000001' where code = 'VH-001'$$),
                     'l''affectation passe par la fonction (historique)');
select affecter_equipement('70000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Bon', 12000, 'Chantier TEL-001');
select pg_temp.check((select chantier_id = '10000000-0000-0000-0000-000000000001' and compteur = 12000 from equipements where code = 'VH-001')
                     and (select count(*) from equipement_affectations where equipement_id = '70000000-0000-0000-0000-000000000001') = 1,
                     'le véhicule est affecté au chantier, avec son conducteur, et c''est historisé');
insert into entretiens (equipement_id, type, description, compteur, cout, prestataire, prochain_compteur)
values ('70000000-0000-0000-0000-000000000001', 'Entretien', 'Vidange + filtres', 15000, 85000, 'Garage X', 15100);
select pg_temp.check((select compteur from equipements where code = 'VH-001') = 15000, 'le compteur suit le dernier relevé');
select pg_temp.check(exists (select 1 from alertes_logistique() where genre = 'Entretien' and libelle like 'VH-001%'), 'alerte : prochaine vidange proche');
insert into justificatifs (objet, objet_id, chemin, nom_fichier, type_document, valide_jusquau)
values ('equipement', '70000000-0000-0000-0000-000000000001', 'ML/equipement/70000000-0000-0000-0000-000000000001/assurance.pdf', 'assurance.pdf', 'Assurance', current_date + 10);
select pg_temp.check(pg_temp.echoue($$insert into justificatifs (objet, objet_id, chemin, nom_fichier, type_document) values ('equipement', '70000000-0000-0000-0000-000000000001', 'ML/equipement/70000000-0000-0000-0000-000000000001/vt.pdf', 'vt.pdf', 'Visite technique')$$),
                     'une visite technique a une date de validité');
select pg_temp.check(exists (select 1 from alertes_logistique() where genre = 'Document' and detail = 'Assurance'), 'alerte : assurance qui expire dans 10 jours');
commit;

-- Le conducteur voit son véhicule et saisit ses pleins ; il ne modifie pas la fiche
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from equipements where code = 'VH-001') = 1, 'le conducteur voit son véhicule');
insert into pleins (equipement_id, litres, montant, compteur) values ('70000000-0000-0000-0000-000000000001', 50, 40000, 15400);
select pg_temp.check((select compteur from equipements where code = 'VH-001') = 15400, 'le plein met à jour le kilométrage');
select pg_temp.check(pg_temp.echoue($$select affecter_equipement('70000000-0000-0000-0000-000000000001', null, null, 'Bon')$$), 'le conducteur ne réaffecte pas le véhicule');
select pg_temp.check(pg_temp.echoue($$insert into pleins (equipement_id, litres, montant) values ('70000000-0000-0000-0000-000000000002', 10, 8000)$$), 'ni ne saisit de plein sur un autre matériel');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select affecter_equipement('70000000-0000-0000-0000-000000000002', null, null, 'Réformé', null, 'Moteur hors service');
select pg_temp.check(pg_temp.echoue($$select affecter_equipement('70000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, null)$$), 'un matériel réformé ne s''affecte plus');
commit;
\echo 'Tous les tests de la logistique passent.'

-- Import Excel
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into tiers (type, nom) values ('client', 'Opérateur Télécom');
select pg_temp.check((importer_stock('entree', null, null, '[
  {"ligne":2,"code":"drop-2fo","designation":"Câble drop 2 FO","unite":"m","provenance":"DGS","quantite":"1000","prix":"150","fournisseur":"Fibre SA"},
  {"ligne":3,"code":"CIM-50","quantite":"10","prix":"6000"},
  {"ligne":4,"code":"PTO","designation":"Prise terminale optique","unite":"pièce","provenance":"opérateur télécom","seuil":"20"}
]'::jsonb) ->> 'articles_crees')::int = 2, 'import : deux articles créés');
select pg_temp.check(quantite_en_stock((select id from articles where code = 'DROP-2FO'), null) = 1000, 'import : 1 000 m de câble entrés au dépôt');
select pg_temp.check((select client_id is not null and seuil_alerte = 20 from articles where code = 'PTO'), 'import : provenance client et seuil repris');
select pg_temp.check(pg_temp.erreur($$select importer_stock('entree', null, null, '[{"ligne":2,"code":"CIM-50","quantite":"5"},{"ligne":3,"code":"NOUVEAU","quantite":"5"}]'::jsonb)$$) like 'Ligne 3 :%',
                     'import : la ligne en erreur est signalée');
select pg_temp.check(quantite_en_stock('60000000-0000-0000-0000-000000000001', null) = 15, 'import en erreur : rien n''est enregistré');
select importer_stock('inventaire', null, '00000000-0000-0000-0000-000000000010', '[{"ligne":2,"code":"ONT-CL","quantite":"2"}]'::jsonb);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check(pg_temp.echoue($$select importer_stock('entree', null, null, '[{"ligne":2,"code":"CIM-50","quantite":"5"}]'::jsonb)$$), 'import réservé au gestionnaire du stock');
commit;
\echo 'Import Excel : OK.'

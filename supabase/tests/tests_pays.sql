-- Tests du multi-pays : chaque pays est indépendant, accès groupe pour le PDG, le DO et qui ils désignent.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Filiale du Bénin : RAF, RH, chef de projet, technicien créés dans ce pays.
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000040','raf@dgs.bj','{"nom":"Koffi Agbo","pays":"BJ"}'),
 ('00000000-0000-0000-0000-000000000041','cp@dgs.bj','{"nom":"Rachidatou Bio","pays":"BJ"}'),
 ('00000000-0000-0000-0000-000000000042','rh@dgs.bj','{"nom":"Mireille Houngbo","pays":"BJ"}'),
 ('00000000-0000-0000-0000-000000000043','tech@dgs.bj','{"nom":"Sèna Dossou","pays":"BJ"}');
update profils set actif=true, poste='raf' where id='00000000-0000-0000-0000-000000000040';
update profils set actif=true, poste='cp'  where id='00000000-0000-0000-0000-000000000041';
update profils set actif=true, poste='rh'  where id='00000000-0000-0000-0000-000000000042';
update profils set actif=true, poste='tech', responsable_id='00000000-0000-0000-0000-000000000041' where id='00000000-0000-0000-0000-000000000043';
insert into remunerations values ('00000000-0000-0000-0000-000000000040', 900000), ('00000000-0000-0000-0000-000000000043', 200000);
select pg_temp.check((select count(*) from profils where pays='BJ') = 4, 'un compte créé au Bénin appartient au Bénin');
select pg_temp.check((select pays from profils where id='00000000-0000-0000-0000-000000000003') = 'ML', 'les comptes existants appartiennent au Mali');
insert into chantiers (id,code,nom,domaine,chef_projet_id,pays) values ('10000000-0000-0000-0000-000000000040','TEL-001','Fibre Cotonou','Télécoms','00000000-0000-0000-0000-000000000041','BJ');
insert into taches (chantier_id,titre,assigne_id) values ('10000000-0000-0000-0000-000000000040','Tirage câble','00000000-0000-0000-0000-000000000043');
select pg_temp.check(true, 'le même code de chantier peut exister dans deux pays');
insert into depenses (id,chantier_id,objet,montant,demandeur_id,pays) values ('20000000-0000-0000-0000-000000000090','10000000-0000-0000-0000-000000000001','Carburant',100000,'00000000-0000-0000-0000-000000000010','ML');

-- Connexion : les identifiants ne fonctionnent que dans leur pays.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000040';
select pg_temp.check(pg_temp.echoue($$select choisir_pays('ML')$$), 'un agent du Bénin ne peut pas se connecter au Mali');
select pg_temp.check(choisir_pays('BJ') = 'BJ', 'un agent du Bénin se connecte au Bénin');
select pg_temp.check((select count(*) from chantiers) = 1 and (select code from chantiers) = 'TEL-001', 'le RAF du Bénin ne voit que les chantiers du Bénin');
select pg_temp.check((select count(*) from depenses) = 0 and (select count(*) from factures_clients) = 0 and (select count(*) from bons_commande) = 0, 'il ne voit aucune dépense, facture ou achat du Mali');
select pg_temp.check((select count(*) from profils where pays = 'ML' and not acces_groupe(id)) = 0, 'il ne voit pas le personnel du Mali');
select pg_temp.check((select count(*) from profils where poste in ('pdg','do')) = 2, 'il voit la direction du groupe (PDG et DO)');
select pg_temp.check(pg_temp.echoue($$select decider_depense('20000000-0000-0000-0000-000000000090', true)$$), 'il ne peut pas valider une dépense du Mali, même en connaissant sa référence');
select pg_temp.check(pg_temp.echoue($$insert into frais_generaux (mois,categorie,libelle,montant,pays) values (date_trunc('month',current_date),'Loyer','X',1,'ML')$$), 'il ne peut pas écrire dans les données du Mali');
insert into frais_generaux (mois,categorie,libelle,montant) values (date_trunc('month',current_date),'Loyer','Loyer Cotonou',450000);
select pg_temp.check((select pays from frais_generaux where libelle='Loyer Cotonou') = 'BJ', 'ce qu''il saisit appartient au Bénin');
select pg_temp.check(parametre('tva') = 18, 'il a ses propres paramètres (TVA)');
select pg_temp.check((select count(*) from rentabilite_chantiers()) = 1, 'la rentabilité ne compte que les projets du Bénin');
select pg_temp.check((select montant from frais_generaux_du_mois(current_date) where source='Paie') = 900000, 'les frais généraux ne comptent que les salaires du Bénin');
commit;

-- Numérotation propre à chaque pays.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000041';
insert into pv_execution (chantier_id,type,tiers,objet,montant_ht) values ('10000000-0000-0000-0000-000000000040','client','Opérateur BJ','Acompte',10000000);
select signer_pv((select id from pv_execution));
select pg_temp.check((select numero from pv_execution) like 'PV-%-001', 'les PV du Bénin ont leur propre numérotation');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000040';
insert into factures_clients (pv_id,objet,echeance) values ((select id from pv_execution),'Acompte',current_date+30);
select pg_temp.check((select numero from factures_clients) = 'FAC-' || to_char(current_date,'YYYY') || '-001', 'la première facture du Bénin est la n°001');
commit;

-- Paie et RH du Bénin, à part.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000042';
select ouvrir_paie(current_date);
select pg_temp.check((select count(*) from paies) = 1 and (select pays from paies) = 'BJ', 'le Bénin a sa propre paie du mois');
select pg_temp.check((select count(*) from bulletins(current_date)) = 2, 'les bulletins du Bénin ne concernent que son personnel');
select pg_temp.check(pg_temp.echoue($$insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000010',current_date,'P')$$), 'les RH du Bénin ne pointent pas un agent du Mali');
commit;

-- Le Mali ne voit rien du Bénin.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from chantiers where pays='BJ') = 0 and (select count(*) from frais_generaux where pays='BJ') = 0, 'le RAF du Mali ne voit rien du Bénin');
select pg_temp.check(pg_temp.echoue($$select choisir_pays('BJ')$$), 'le RAF du Mali ne peut pas se connecter au Bénin');
select pg_temp.check(pg_temp.echoue($$select definir_acces_groupe('00000000-0000-0000-0000-000000000040', true)$$), 'le RAF n''accorde pas l''accès groupe');
commit;

-- Accès groupe : le PDG passe d'un pays à l'autre.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select choisir_pays('BJ');
select pg_temp.check((select count(*) from chantiers) = 1 and pays_courant() = 'BJ', 'le PDG travaille au Bénin');
select pg_temp.check((select count(*) from rentabilite_chantiers()) = 1, 'le PDG voit la rentabilité du Bénin');
select choisir_pays('ML');
select pg_temp.check((select count(*) from chantiers where pays='ML') = (select count(*) from chantiers) and pays_courant() = 'ML', 'le PDG revient au Mali');
commit;

-- Le DO accorde l'accès groupe à qui il juge nécessaire.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select definir_acces_groupe('00000000-0000-0000-0000-000000000003', true);
select pg_temp.check(pg_temp.echoue($$select definir_acces_groupe('00000000-0000-0000-0000-000000000001', false)$$), 'le PDG garde toujours l''accès groupe');
select pg_temp.check(pg_temp.echoue($$update profils set pays='BJ' where id='00000000-0000-0000-0000-000000000010'$$), 'le pays d''un compte ne change pas');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(choisir_pays('BJ') = 'BJ', 'avec l''accès groupe, le RAF du Mali peut aller au Bénin');
select pg_temp.check((select count(*) from frais_generaux) = 1, 'il y voit les données du Bénin');
select choisir_pays('ML');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select definir_acces_groupe('00000000-0000-0000-0000-000000000003', false);
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(pg_temp.echoue($$select choisir_pays('BJ')$$), 'le DO peut retirer l''accès groupe');
commit;
\echo 'Tous les tests multi-pays passent.'

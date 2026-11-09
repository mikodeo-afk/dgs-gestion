-- Tests des droits. Chaque bloc agit comme un employé connecté.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
\set QUIET 1
-- Comptes : le premier devient PDG.
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001','pdg@dgs.ml','{"nom":"Moussa Keïta"}'),
 ('00000000-0000-0000-0000-000000000002','do@dgs.ml','{"nom":"Aminata Traoré"}'),
 ('00000000-0000-0000-0000-000000000003','raf@dgs.ml','{"nom":"Ibrahim Coulibaly"}'),
 ('00000000-0000-0000-0000-000000000006','cp@dgs.ml','{"nom":"Seydou Konaté"}'),
 ('00000000-0000-0000-0000-000000000008','ce@dgs.ml','{"nom":"Bakary Touré"}'),
 ('00000000-0000-0000-0000-000000000010','tech@dgs.ml','{"nom":"Adama Sidibé"}'),
 ('00000000-0000-0000-0000-000000000011','tech2@dgs.ml','{"nom":"Lassina Doumbia"}'),
 ('00000000-0000-0000-0000-000000000099','intrus@x.com','{"nom":"Inscription publique","poste":"pdg"}');

-- Le serveur (clé de service, sans auth.uid) active les employés créés par les RH.
update profils set actif=true, poste='do'  where id='00000000-0000-0000-0000-000000000002';
update profils set actif=true, poste='raf' where id='00000000-0000-0000-0000-000000000003';
update profils set actif=true, poste='cp', responsable_id='00000000-0000-0000-0000-000000000002' where id='00000000-0000-0000-0000-000000000006';
update profils set actif=true, poste='ce', responsable_id='00000000-0000-0000-0000-000000000006' where id='00000000-0000-0000-0000-000000000008';
update profils set actif=true, poste='tech', responsable_id='00000000-0000-0000-0000-000000000008' where id in ('00000000-0000-0000-0000-000000000010');
update profils set actif=true, poste='tech' where id='00000000-0000-0000-0000-000000000011';
insert into remunerations values ('00000000-0000-0000-0000-000000000010',250000),('00000000-0000-0000-0000-000000000006',800000);

create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;

select pg_temp.check((select poste from profils where id='00000000-0000-0000-0000-000000000001')='pdg' and (select actif from profils where id='00000000-0000-0000-0000-000000000001'), 'le premier compte est PDG et actif');
select pg_temp.check((select poste from profils where id='00000000-0000-0000-0000-000000000099')='tech' and not (select actif from profils where id='00000000-0000-0000-0000-000000000099'), 'une inscription publique reste technicien inactif, même si elle demande « pdg »');

-- ---- DO : crée un chantier, gère les droits
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into chantiers (id,code,nom,domaine,chef_projet_id) values ('10000000-0000-0000-0000-000000000001','TEL-001','Fibre ACI 2000','Télécoms','00000000-0000-0000-0000-000000000006'),('10000000-0000-0000-0000-000000000002','ENR-001','Solaire Kalaban','Énergie',null);
insert into chantiers_finance values ('10000000-0000-0000-0000-000000000001',26000000,18500000);
insert into taches (chantier_id,titre,assigne_id,avancement) values ('10000000-0000-0000-0000-000000000001','Tranchée','00000000-0000-0000-0000-000000000010',40),('10000000-0000-0000-0000-000000000002','Panneaux','00000000-0000-0000-0000-000000000011',60);
select pg_temp.check(public.a_droit('dep.valider_tout'), 'le DO a les mêmes droits que le PDG');
insert into droits_personne (profil_id,cle,accorde) values ('00000000-0000-0000-0000-000000000010','fin.voir',true);
commit;

-- ---- RAF : pas de création de chantier, pas de gestion des droits
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check(not public.a_droit('droits.gerer') and not public.a_droit('dep.valider_tout') and public.a_droit('dep.valider'), 'le RAF valide jusqu''au seuil et ne gère pas les droits');
select pg_temp.check((select count(*) from remunerations)=2, 'le RAF voit les salaires');
savepoint s; do $$ begin begin insert into chantiers (code,nom,domaine) values ('X','x','BTP'); raise exception 'aurait dû échouer'; exception when insufficient_privilege then null; end; end $$; release s;
select pg_temp.check(true,'le RAF ne peut pas créer de chantier');
savepoint s2; do $$ begin begin insert into droits_personne (profil_id,cle,accorde) values ('00000000-0000-0000-0000-000000000003','droits.gerer',true); raise exception 'aurait dû échouer'; exception when insufficient_privilege then null; end; end $$; release s2;
select pg_temp.check(true,'le RAF ne peut pas s''accorder des droits');
commit;

-- ---- Technicien : voit ses tâches, l'avancement global, son salaire seulement
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from taches)=1, 'le technicien ne voit que sa tâche');
select pg_temp.check((select count(*) from avancement_chantiers())=2, 'le technicien voit l''avancement de tous les chantiers');
select pg_temp.check((select count(*) from remunerations)=1, 'le technicien ne voit que son propre salaire');
select pg_temp.check(public.a_droit('fin.voir'), 'le droit accordé par le DO s''applique');
select pg_temp.check((select count(*) from chantiers_finance)=1, 'avec ce droit il voit les montants de son seul chantier');
update taches set avancement=55 where titre='Tranchée';
select pg_temp.check((select avancement from taches where titre='Tranchée')=55, 'le technicien met à jour son avancement');
savepoint s; do $$ begin begin update taches set titre='autre' where titre='Tranchée'; raise exception 'aurait dû échouer'; exception when raise_exception then if sqlerrm not like 'Vous pouvez seulement%' then raise; end if; end; end $$; release s;
select pg_temp.check(true,'le technicien ne peut pas renommer la tâche');
update taches set avancement=99 where titre='Panneaux';
select pg_temp.check((select count(*) from taches where titre='Panneaux')=0, 'la tâche d''un autre lui est invisible');
commit;

-- ---- Chef de projet : ses chantiers ; chef d'équipe : son équipe
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select pg_temp.check((select count(*) from taches)=1, 'le chef de projet voit les tâches de son chantier');
insert into taches (chantier_id,titre,assigne_id) values ('10000000-0000-0000-0000-000000000001','Tirage câble','00000000-0000-0000-0000-000000000010');
savepoint s; do $$ begin begin insert into taches (chantier_id,titre) values ('10000000-0000-0000-0000-000000000002','x'); raise exception 'aurait dû échouer'; exception when insufficient_privilege then null; end; end $$; release s;
select pg_temp.check(true,'le chef de projet ne crée pas de tâche sur le chantier d''un autre');
select pg_temp.check((select count(*) from remunerations)=1, 'le chef de projet ne voit que son salaire');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select pg_temp.check((select count(*) from taches)=2, 'le chef d''équipe voit les tâches de son équipe');
commit;

-- ---- Garde-fous sur les droits
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
savepoint s; do $$ begin begin insert into droits_personne (profil_id,cle,accorde) values ('00000000-0000-0000-0000-000000000001','droits.gerer',false); raise exception 'aurait dû échouer'; exception when raise_exception then if sqlerrm like 'aurait%' then raise; end if; end; end $$; release s;
select pg_temp.check(true,'personne ne retire la gestion des droits au PDG');
savepoint s2; do $$ begin begin update profils set poste='tech' where id='00000000-0000-0000-0000-000000000001'; raise exception 'aurait dû échouer'; exception when raise_exception then if sqlerrm like 'aurait%' then raise; end if; end; end $$; release s2;
select pg_temp.check(true,'le DO ne peut pas rétrograder le PDG');
update profils set poste='ce' where id='00000000-0000-0000-0000-000000000011';
select pg_temp.check((select poste from profils where id='00000000-0000-0000-0000-000000000011')='ce','le DO change le poste d''un employé');
commit;

-- ---- Compte inactif : ne voit rien
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000099';
select pg_temp.check((select count(*) from chantiers)=0 and (select count(*) from profils)=0, 'un compte inactif ne voit aucune donnée');
commit;
\echo 'Tous les tests de droits passent.'

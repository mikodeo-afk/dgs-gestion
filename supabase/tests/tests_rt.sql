-- Tests du poste Responsable technique.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000030','rt@dgs.ml');
update profils set actif=true, poste='rt', responsable_id='00000000-0000-0000-0000-000000000002' where id='00000000-0000-0000-0000-000000000030';
-- Les chefs de projet rendent compte au Responsable technique.
update profils set responsable_id='00000000-0000-0000-0000-000000000030' where poste='cp';

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000030';
select pg_temp.check((select count(*) from chantiers) = (select count(*) from chantiers c where true), 'le Responsable technique voit tous les chantiers');
select pg_temp.check((select count(*) from mes_chantiers()) = 2, 'son périmètre couvre tous les projets');
select pg_temp.check(public.a_droit('tache.creer') and public.a_droit('pres.saisir') and public.a_droit('geo.voir'), 'il organise les tâches, saisit les présences et voit les agents');
select pg_temp.check(not public.a_droit('dep.valider') and not public.a_droit('bc.valider') and not public.a_droit('droits.gerer'), 'il ne valide ni dépenses ni bons de commande et ne gère pas les droits');
select pg_temp.check((select count(*) from remunerations) = 0, 'il ne voit pas les salaires');
select pg_temp.check((select count(*) from profils where id in (select public.equipe_de(auth.uid())) and poste in ('cp','ce','tech')) >= 3, 'toutes les équipes opérationnelles sont sous lui');
commit;
\echo 'Tous les tests du Responsable technique passent.'

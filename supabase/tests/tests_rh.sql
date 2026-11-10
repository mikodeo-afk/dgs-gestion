-- Tests présences et paie (à lancer après tests.sql et tests_finances.sql).
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000000004','rh@dgs.ml');
update profils set actif=true, poste='rh', nom='Fatoumata Diarra' where id='00000000-0000-0000-0000-000000000004';

-- RH : présences de tout le monde, tout jour ; ouvre et prépare la paie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000010', date_trunc('month',current_date)::date, 'A');
select pg_temp.check(true,'les RH saisissent une absence passée');
select ouvrir_paie(current_date);
insert into lignes_paie (mois,profil_id,primes,avances) values (date_trunc('month',current_date)::date,'00000000-0000-0000-0000-000000000010',25000,50000);
select pg_temp.check((select retenue_absences from bulletins(current_date) where profil_id='00000000-0000-0000-0000-000000000010') = round(250000/22.0),
  'une absence non justifiée retire un 22e du salaire');
select pg_temp.check((select net from bulletins(current_date) where profil_id='00000000-0000-0000-0000-000000000010')
  = (250000+25000-round(250000/22.0)) - round((250000+25000-round(250000/22.0))*0.036) - 50000, 'le net tient compte des primes, de l''INPS et des avances');
select pg_temp.check(pg_temp.echoue($$select avancer_paie(current_date,'Validée')$$), 'les RH ne valident pas la paie');
select avancer_paie(current_date,'Soumise');
select pg_temp.check(pg_temp.echoue($$update lignes_paie set primes=99999$$) or (select primes from lignes_paie limit 1)=25000, 'une paie soumise ne se modifie plus');
commit;

-- Chef d'équipe : son équipe, aujourd'hui seulement
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000010', current_date, 'P') on conflict (profil_id,jour) do update set statut='P';
select pg_temp.check(true,'le chef d''équipe saisit la présence du jour de son équipe');
select pg_temp.check(pg_temp.echoue($$insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000010', current_date - 1, 'P') on conflict (profil_id,jour) do update set statut='P'$$), 'le chef d''équipe ne modifie pas un jour passé');
select pg_temp.check(pg_temp.echoue($$insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000003', current_date, 'A')$$), 'le chef d''équipe ne saisit pas la présence du RAF');
commit;

-- Technicien : son bulletin seulement, pas de saisie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from bulletins(current_date))=1, 'le technicien ne voit que son bulletin');
select pg_temp.check(pg_temp.echoue($$insert into presences (profil_id,jour,statut) values ('00000000-0000-0000-0000-000000000011', current_date, 'P')$$), 'le technicien ne saisit pas de présence');
select pg_temp.check(pg_temp.echoue($$select avancer_paie(current_date,'Payée')$$), 'le technicien ne fait pas avancer la paie');
commit;

-- RAF valide, DO paie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from bulletins(current_date))=(select count(*) from remunerations where salaire_base>0), 'le RAF voit tous les bulletins');
select avancer_paie(current_date,'Validée');
select pg_temp.check(pg_temp.echoue($$select avancer_paie(current_date,'Payée')$$), 'le RAF ne paie pas les salaires');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select avancer_paie(current_date,'Payée');
select pg_temp.check((select statut from paies)='Payée', 'le DO marque les salaires payés');
commit;
\echo 'Tous les tests RH passent.'

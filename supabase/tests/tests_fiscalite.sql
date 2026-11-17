-- Tests de l'agent comptable fiscal : droits, employés déclarés, registre des déclarations.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Mise en place (hors droits) : salaires au Bénin, un salarié non déclaré.
insert into remunerations (profil_id, salaire_base, declare_cnss, numero_cnss) values
  ('00000000-0000-0000-0000-000000000043', 200000, true, '1234567'),
  ('00000000-0000-0000-0000-000000000041', 450000, false, null)
on conflict (profil_id) do update set salaire_base = excluded.salaire_base, declare_cnss = excluded.declare_cnss, numero_cnss = excluded.numero_cnss;

select pg_temp.check((select valeur from parametres where pays = 'BJ' and cle = 'vps') = 4, 'VPS du Bénin à 4 %');
select pg_temp.check(not exists (select 1 from parametres where pays = 'ML' and cle = 'vps'), 'les règles du Mali ne sont pas encore chargées');
select pg_temp.check(pg_temp.echoue($$update parametres set valeur = 2 where pays = 'BJ' and cle = 'cnss_mensuelle'$$), 'la périodicité CNSS vaut 0 ou 1');

-- RAF du Bénin : voit la masse salariale fiscale et enregistre une déclaration.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000040';
select pg_temp.check((select count(*) from masse_salariale_fiscale(current_date)) = 3, 'le RAF lit la masse salariale du Bénin (et seulement elle)');
select pg_temp.check((select brut from masse_salariale_fiscale(current_date) where numero_cnss = '1234567') <= 200000, 'brut calculé comme le bulletin');
select pg_temp.check((select count(*) from masse_salariale_fiscale(current_date) where not declare_cnss) = 1, 'le salarié non déclaré est signalé');
insert into declarations_fiscales (obligation, periode, echeance, montant_calcule, montant_declare, reference)
values ('TVA', '2026-10', '2026-11-10', 180000, 180000, 'Q-001');
select pg_temp.check((select pays from declarations_fiscales where periode = '2026-10') = 'BJ', 'la déclaration appartient au Bénin');
select pg_temp.check(pg_temp.echoue($$insert into declarations_fiscales (obligation, periode, echeance) values ('TVA', '2026-10', '2026-11-10')$$), 'une seule déclaration par obligation et période');
select pg_temp.check(pg_temp.echoue($$insert into declarations_fiscales (obligation, periode, echeance, pays) values ('ITS', '2026-10', '2026-11-10', 'ML')$$), 'pas de déclaration dans un autre pays');
update declarations_fiscales set statut = 'Payée', paye_le = now() where periode = '2026-10';
commit;

-- Technicien : ni calendrier ni registre.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000043';
select pg_temp.check(pg_temp.echoue($$select * from masse_salariale_fiscale(current_date)$$), 'le technicien n''accède pas à la masse salariale');
select pg_temp.check((select count(*) from declarations_fiscales) = 0, 'le technicien ne voit pas les déclarations');
select pg_temp.check(pg_temp.echoue($$insert into declarations_fiscales (obligation, periode, echeance) values ('ITS', '2026-10', '2026-11-10')$$), 'ni n''en enregistre');
commit;

-- RAF du Mali : ne voit pas les déclarations du Bénin.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from declarations_fiscales) = 0, 'le Mali ne voit pas les déclarations du Bénin');
commit;


-- États financiers : clôture d'exercice
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000040';
select pg_temp.check((donnees_cloture(2026) ->> 'stock_fin') is not null, 'le RAF lit les données d''inventaire');
insert into clotures_exercice (annee, saisies) values (2026, '{"capital": 10000000}');
select pg_temp.check((select pays from clotures_exercice where annee = 2026) = 'BJ', 'la clôture appartient au Bénin');
select pg_temp.check(pg_temp.echoue($$update clotures_exercice set statut = 'Arrêté' where annee = 2026$$), 'pas d''arrêté sans états calculés');
update clotures_exercice set etats = '{"actif":[]}', statut = 'Arrêté' where annee = 2026;
select pg_temp.check((select arrete_le is not null from clotures_exercice where annee = 2026), 'l''arrêté est daté');
select pg_temp.check(pg_temp.echoue($$update clotures_exercice set saisies = '{}' where annee = 2026$$), 'des états arrêtés ne se modifient pas');
update clotures_exercice set statut = 'Brouillon' where annee = 2026;
update clotures_exercice set saisies = '{"capital": 12000000}' where annee = 2026;
select pg_temp.check((select (saisies ->> 'capital')::int from clotures_exercice where annee = 2026) = 12000000, 'rouverts, ils se modifient');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000043';
select pg_temp.check(pg_temp.echoue($$select donnees_cloture(2026)$$), 'le technicien ne lit pas les données d''inventaire');
select pg_temp.check((select count(*) from clotures_exercice) = 0, 'ni les clôtures');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from clotures_exercice) = 0, 'le Mali ne voit pas la clôture du Bénin');
commit;
\echo Tous les tests de l agent comptable fiscal passent.

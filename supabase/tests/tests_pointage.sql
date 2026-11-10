-- Tests du pointage par téléphone (GPS + selfie) et du contrôle par les RH.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.erreur(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;

select pg_temp.check(round(distance_m(12.6360, -8.0000, 12.6370, -8.0000)) between 110 and 112, 'la distance GPS est calculée en mètres');

-- Technicien : pas de pointage tant que la position du chantier n'est pas connue
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from chantiers_pointage()) = 0, 'aucun chantier proposé sans position GPS');
select pg_temp.check(pg_temp.erreur($$select pointer('10000000-0000-0000-0000-000000000001', 12.6360, -8.0, 10, 'ML/00000000-0000-0000-0000-000000000010/a.jpg')$$) like '%position du chantier%',
                     'pointer exige la position du chantier');
commit;
update chantiers set latitude = 12.6360, longitude = -8.0000, rayon_pointage = 300 where code = 'TEL-001';

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select string_agg(code, ',') from chantiers_pointage()) = 'TEL-001', 'le technicien voit seulement son chantier pour pointer');
select pg_temp.check(pg_temp.erreur($$select pointer('10000000-0000-0000-0000-000000000001', 12.6400, -8.0, 10, 'ML/00000000-0000-0000-0000-000000000010/a.jpg')$$) like '%hors du rayon%',
                     'hors du rayon (445 m pour 300 m), le pointage est refusé');
select pg_temp.check(pg_temp.erreur($$select pointer('10000000-0000-0000-0000-000000000001', 12.6361, -8.0, 400, 'ML/00000000-0000-0000-0000-000000000010/a.jpg')$$) like '%trop imprécise%',
                     'un GPS trop imprécis est refusé');
select pg_temp.check(pg_temp.erreur($$select pointer('10000000-0000-0000-0000-000000000001', 12.6361, -8.0, 10, null)$$) like '%selfie%', 'le selfie est obligatoire');
select pg_temp.check(pg_temp.echoue($$select pointer('10000000-0000-0000-0000-000000000001', 12.6361, -8.0, 10, 'ML/00000000-0000-0000-0000-000000000011/a.jpg')$$),
                     'on ne pointe pas avec le selfie d''un autre');
select pg_temp.check(pg_temp.echoue($$select pointer('10000000-0000-0000-0000-000000000002', 12.6361, -8.0, 10, 'ML/00000000-0000-0000-0000-000000000010/a.jpg')$$),
                     'on ne pointe pas sur un chantier qui n''est pas le sien');
select pointer('10000000-0000-0000-0000-000000000001', 12.6370, -8.0, 12, 'ML/00000000-0000-0000-0000-000000000010/selfie.jpg');
select pg_temp.check((select statut = 'P' and heure_arrivee is not null and distance_m between 110 and 112 and controle = 'À contrôler'
                      and chantier_id = '10000000-0000-0000-0000-000000000001' and precision_m = 12
                      from presences where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date),
                     'dans le rayon, l''arrivée est enregistrée avec la distance, à contrôler');
select pg_temp.check(pg_temp.erreur($$select pointer('10000000-0000-0000-0000-000000000001', 12.6361, -8.0, 10, 'ML/00000000-0000-0000-0000-000000000010/b.jpg')$$) like '%déjà pointé%',
                     'on ne pointe qu''une fois par jour');
select pg_temp.check(pg_temp.echoue($$update presences set controle = 'Conforme' where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date$$)
                     or (select controle from presences where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date) = 'À contrôler',
                     'l''agent ne valide pas lui-même son pointage');
select pg_temp.check(pg_temp.echoue($$update profils set photo_reference = 'x', visage_enregistre = true where id = '00000000-0000-0000-0000-000000000010'$$)
                     or (select photo_reference is null from profils where id = '00000000-0000-0000-0000-000000000010'),
                     'l''agent ne change pas sa photo de référence');
commit;

-- Le chef d'équipe ne trafique pas un pointage, ni n'en fabrique un
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select pg_temp.check(pg_temp.echoue($$update presences set distance_m = 10 where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date$$),
                     'un pointage ne se modifie pas à la main');
select pg_temp.check(pg_temp.echoue($$select controler_pointage('00000000-0000-0000-0000-000000000010', current_date, true)$$), 'le chef d''équipe ne contrôle pas les selfies');
commit;

-- RH : photo de référence et contrôle
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
select pg_temp.check(pg_temp.echoue($$select definir_photo_reference('00000000-0000-0000-0000-000000000010', 'ML/00000000-0000-0000-0000-000000000010/x.jpg')$$),
                     'la photo de référence est rangée à part');
select definir_photo_reference('00000000-0000-0000-0000-000000000010', 'ML/reference/00000000-0000-0000-0000-000000000010-1.jpg');
select pg_temp.check((select visage_enregistre and photo_reference like 'ML/reference/%' from profils where id = '00000000-0000-0000-0000-000000000010'),
                     'les RH enregistrent la photo de référence');
select pg_temp.check(pg_temp.echoue($$select controler_pointage('00000000-0000-0000-0000-000000000010', current_date, false, '')$$), 'un rejet demande un motif');
select controler_pointage('00000000-0000-0000-0000-000000000010', current_date, false, 'Ce n''est pas lui sur la photo');
select pg_temp.check((select statut = 'A' and controle = 'Rejeté' and controle_par = '00000000-0000-0000-0000-000000000004'
                      from presences where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date),
                     'un selfie rejeté rend l''agent absent, avec qui et pourquoi');
select controler_pointage('00000000-0000-0000-0000-000000000010', current_date, true);
select pg_temp.check((select statut = 'P' and controle = 'Conforme' and motif_rejet is null
                      from presences where profil_id = '00000000-0000-0000-0000-000000000010' and jour = current_date),
                     'après vérification, le pointage est conforme');
commit;

-- Un jour sans pointage ne se contrôle pas
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
select pg_temp.check(pg_temp.echoue($$select controler_pointage('00000000-0000-0000-0000-000000000010', current_date - 400, true)$$), 'pas de contrôle sans pointage');
commit;
\echo 'Tous les tests du pointage par téléphone passent.'

-- Tests des raccordements : équipes, dossiers, rapports d'installation et matériel consommé.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.erreur(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;

-- Manager (CP) : équipe et dossiers du jour
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
insert into equipes (id, nom, chef_id, chantier_id) values
  ('80000000-0000-0000-0000-000000000001', 'Équipe Eugène', '00000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001');
insert into equipe_membres values ('80000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011');
select pg_temp.check((importer_dossiers('10000000-0000-0000-0000-000000000001', '[
  {"client":"BOKO HOSSOU","ligne":"121383143","mobile":"147332343","msan":"AKP-PL72 FAT293","latitude":"6.38020658913341","longitude":"2.46653753160029","date_demande":"2025-11-08","date_limite":"2025-11-10","offre":"FTTH_PRO_25M"},
  {"client":"SOULE MONLOTO AICHATOU","ligne":"121328435","mobile":"166741286","msan":"GOD-PL126 FAT091","date_demande":"2025-11-06","date_limite":"2025-11-08","offre":"FTTH_Home_20M"}
]'::jsonb) ->> 'crees')::int = 2, 'import de deux dossiers');
select pg_temp.check((importer_dossiers('10000000-0000-0000-0000-000000000001', '[{"client":"BOKO HOSSOU","ligne":"0121383143"}]'::jsonb) ->> 'doublons')::int = 1,
                     'un dossier déjà ouvert pour la même ligne est ignoré');
select pg_temp.check(pg_temp.erreur($$select importer_dossiers('10000000-0000-0000-0000-000000000001', '[{"client":"X"}]'::jsonb)$$) like '%ligne manquant%', 'la ligne est obligatoire');
select pg_temp.check(affecter_raccordements(array(select id from raccordements), '80000000-0000-0000-0000-000000000001') = 2, 'affectation des deux dossiers à l''équipe');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check(pg_temp.echoue($$select importer_dossiers('10000000-0000-0000-0000-000000000001', '[{"client":"X","ligne":"1"}]'::jsonb)$$), 'le technicien n''importe pas de dossiers');
select pg_temp.check(pg_temp.echoue($$insert into equipes (nom, chef_id, chantier_id) values ('Pirate', '00000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001')$$), 'ni ne crée d''équipe');
select pg_temp.check((select count(*) from raccordements) = 2, 'le chef d''équipe voit les dossiers de son équipe');
commit;

-- Gestionnaire du stock : correspondance des rubriques et dotation du chef d'équipe
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into articles (id, code, designation, unite) values
  ('60000000-0000-0000-0000-000000000010', 'CPC', 'Câble CPC', 'm'),
  ('60000000-0000-0000-0000-000000000011', 'PINCE', 'Pince d''ancrage', 'pièce');
insert into materiel_raccordement (rubrique, article_id) values
  ('cable:CPC', '60000000-0000-0000-0000-000000000010'), ('pince', '60000000-0000-0000-0000-000000000011');
select entree_stock('60000000-0000-0000-0000-000000000010', null, 1000, 200);
select entree_stock('60000000-0000-0000-0000-000000000011', null, 100, 300);
select deplacer_stock('60000000-0000-0000-0000-000000000010', null, null, null, '00000000-0000-0000-0000-000000000010', 300, 'Dotation du jour');
select deplacer_stock('60000000-0000-0000-0000-000000000011', null, null, null, '00000000-0000-0000-0000-000000000010', 5, 'Dotation du jour');
commit;

-- Un membre de l'équipe enregistre le rapport WhatsApp
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000011';
select pg_temp.check((select (r ->> 'deduits')::int = 1 and (r ->> 'a_regulariser')::int = 1 and (r ->> 'non_relies')::int = 1
                             and not (r ->> 'dossier_cree')::boolean
                      from (select enregistrer_rapport('80000000-0000-0000-0000-000000000001',
                        '{"ligne":"0121383143","client":"BOKO HOSSOU","date":"2025-11-09","cable":"CPC","latitude":"6.5074","longitude":"2.3515",
                          "champs":{"Puissance PTO":"-19,84dBM","SN":"48575443583198B8"},
                          "materiel":{"cable":250,"pince":10,"crochet":10,"piton":0}}'::jsonb, 'RACCORDEMENT du 09/11/2025') r) x),
                     'rapport : câble déduit, pinces à régulariser, crochets non reliés');
select pg_temp.check((select statut = 'Réalisé' and realise_le = '2025-11-09' and rapport ->> 'SN' = '48575443583198B8' from raccordements where ligne = '121383143'),
                     'le dossier passe en Réalisé avec les valeurs du rapport');
select pg_temp.check(pg_temp.erreur($$select enregistrer_rapport('80000000-0000-0000-0000-000000000001', '{"ligne":"121383143","date":"2025-11-09"}'::jsonb)$$) like '%déjà enregistré%',
                     'le même rapport n''est pas compté deux fois');
select pg_temp.check((select (enregistrer_rapport('80000000-0000-0000-0000-000000000001', '{"ligne":"0121295189","client":"AISSI VASSLY MATHEO","date":"2025-11-07"}'::jsonb) ->> 'dossier_cree')::boolean),
                     'rapport sans dossier reçu : le dossier est créé');
select signaler_echec((select id from raccordements where ligne = '121328435'), 'Client absent');
select pg_temp.check(pg_temp.echoue($$select regulariser_consommation((select id from consommations_raccordement where statut = 'À régulariser'))$$), 'le membre ne régularise pas le stock');
select pg_temp.check(pg_temp.echoue($$select deduire_consommation((select id from consommations_raccordement where statut = 'À régulariser'))$$), 'la déduction directe n''est pas accessible');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000008';
select pg_temp.check(pg_temp.echoue($$select enregistrer_rapport('80000000-0000-0000-0000-000000000001', '{"ligne":"999"}'::jsonb)$$), 'hors de l''équipe : pas de rapport');
commit;

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select pg_temp.check(quantite_en_stock('60000000-0000-0000-0000-000000000010', null, '00000000-0000-0000-0000-000000000010') = 50, 'il reste 50 m de câble au chef d''équipe');
select pg_temp.check((select chantier_id = '10000000-0000-0000-0000-000000000001' and quantite = -250 from mouvements_stock
                      where article_id = '60000000-0000-0000-0000-000000000010' and type = 'Utilisation'), 'le câble est imputé au chantier de l''équipe');
select pg_temp.check(pg_temp.erreur($$select regulariser_consommation((select id from consommations_raccordement where statut = 'À régulariser'))$$) like '%toujours insuffisant%',
                     'régularisation refusée tant que le stock manque');
select deplacer_stock('60000000-0000-0000-0000-000000000011', null, null, null, '00000000-0000-0000-0000-000000000010', 5, 'Complément');
select pg_temp.check(regulariser_consommation((select id from consommations_raccordement where statut = 'À régulariser')) = 'Déduit', 'régularisation après dotation');
select pg_temp.check(quantite_en_stock('60000000-0000-0000-0000-000000000011', null, '00000000-0000-0000-0000-000000000010') = 0, 'les 10 pinces sont déduites');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
select rouvrir_raccordement((select id from raccordements where ligne = '121328435'));
select pg_temp.check((select statut = 'Affecté' from raccordements where ligne = '121328435'), 'le manager rouvre un dossier en échec');
commit;
\echo 'Tous les tests des raccordements passent.'

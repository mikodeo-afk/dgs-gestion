-- Tests des ventes terrain Celtiis (contrat PVT avec SBIN, Bénin).
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Commercial du Bénin, et un vendeur terrain qui a un compte (technicien du Bénin).
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000060','commercial@dgs.bj','{"nom":"Aïcha Zinsou","pays":"BJ"}'),
 ('00000000-0000-0000-0000-000000000061','22997000002@vendeur.dgs','{"nom":"Sèna Vendeur","pays":"BJ"}');
update profils set actif=true, poste='commercial' where id='00000000-0000-0000-0000-000000000060';
update profils set actif=true, poste='vendeur' where id='00000000-0000-0000-0000-000000000061';

select pg_temp.check((select count(*) from pvt_offres where pays='BJ') = 27, 'la grille de l''annexe 3 est chargée pour le Bénin');
select pg_temp.check((select part_partenaire from pvt_offres where pays='BJ' and code='HOME50') = 2000, 'HOME 50M : 8 000 au vendeur, 2 000 au partenaire');
select pg_temp.check(not exists (select 1 from pvt_offres where pays='ML'), 'pas de grille Celtiis au Mali');

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
insert into pvt_vendeurs (id, nom, numero_celtiis) values ('70000000-0000-0000-0000-000000000001', 'Rodrigue Ahouansou', '0140000001');
insert into pvt_vendeurs (id, nom, profil_id) values ('70000000-0000-0000-0000-000000000002', 'Sèna Vendeur', '00000000-0000-0000-0000-000000000061');
insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, client, ligne)
select '2026-10-01', '2026-10-12', '70000000-0000-0000-0000-000000000001', id, 'Client ' || g, '01970000' || g
  from pvt_offres, generate_series(1, 3) g where code = 'HOME50';
select pg_temp.check((select pays from pvt_ventes limit 1) = 'BJ', 'une vente prend le pays courant');
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne, statut) select '2026-10-01', '2026-10-12', '70000000-0000-0000-0000-000000000001', id, '0197999999', 'Validée' from pvt_offres where code='HOME50'$$) = false,
                     'le commercial (gestion) peut tout enregistrer');
delete from pvt_ventes where ligne = '0197999999';
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne) select '2026-10-01', '2026-10-13', '70000000-0000-0000-0000-000000000001', id, '019700001' from pvt_offres where code='HOME50'$$),
                     'une même ligne n''est pas déclarée deux fois');
commit;

-- Le vendeur qui a un compte déclare ses ventes, ne valide rien, ne voit pas les autres.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select pg_temp.check(not est_global() and (select count(*) from mes_chantiers()) = 0, 'le vendeur terrain n''a pas de vue globale ni de chantier');
select pg_temp.check(a_droit('pvt.declarer') and not a_droit('pvt.voir'), 'le vendeur déclare ses ventes sans voir celles des autres');
insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, client, ligne)
select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000002', id, 'Boutique', '0196000001' from pvt_offres where code='PRO25';
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne) select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000001', id, '0196000002' from pvt_offres where code='PRO25'$$),
                     'un vendeur ne déclare pas pour un autre');
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne, statut) select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000002', id, '0196000003', 'Validée' from pvt_offres where code='PRO25'$$),
                     'un vendeur ne valide pas sa vente');
select pg_temp.check((select count(*) from pvt_ventes) = 1, 'le vendeur ne voit que ses ventes');
select pg_temp.check(pg_temp.echoue($$update pvt_ventes set statut = 'Validée'$$), 'le vendeur ne peut pas passer sa vente en validée');
update pvt_ventes set client = 'Boutique Akpakpa';
select pg_temp.check((select client from pvt_ventes) = 'Boutique Akpakpa', 'il corrige sa vente encore déclarée');
select pg_temp.check(pg_temp.echoue($$select pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"0196000001","offre":"PRO25"}]')$$), 'le vendeur n''importe pas l''extraction');
commit;

-- Le RAF du Bénin voit mais ne gère pas.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000040';
select pg_temp.check((select count(*) from pvt_ventes) = 4, 'le RAF voit toutes les ventes du Bénin');
select pg_temp.check(pg_temp.echoue($$insert into pvt_versements (mois, vendeur_id, type, montant) values ('2026-10-01', '70000000-0000-0000-0000-000000000001', 'Avance', 10000)$$),
                     'le RAF n''enregistre pas les versements');
commit;

-- Extraction SBIN : rapprochement ligne à ligne.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
insert into pvt_versements (mois, vendeur_id, type, montant, verse_le) values ('2026-10-01', '70000000-0000-0000-0000-000000000001', 'Avance', 12000, '2026-10-31');
select pg_temp.check((select r = '{"ajoutees": 1, "validees": 3, "codes_inconnus": ["XYZ"], "offres_inconnues": 1}'::jsonb
                      from pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"019700001","offre":"HOME50","date":"2026-10-14"},
                                                                     {"ligne":"019700002","offre":"home100"},
                                                                     {"ligne":"0196000001","offre":"PRO25"},
                                                                     {"ligne":"0195555555","offre":"FWA"},
                                                                     {"ligne":"0195555556","offre":"XYZ"}]') r),
                     'extraction : 3 ventes validées, 1 ligne SBIN non déclarée ajoutée, 1 offre inconnue signalée');
select pg_temp.check((select o.code from pvt_ventes v join pvt_offres o on o.id = v.offre_id where v.ligne = '019700002') = 'HOME100', 'l''offre retenue est celle de SBIN');
select pg_temp.check((select vendeur_id is null and source = 'Extraction SBIN' from pvt_ventes where ligne = '0195555555'), 'la ligne SBIN non déclarée est à attribuer');
select pg_temp.check((select (r ->> 'validees')::int = 0 and (r ->> 'ajoutees')::int = 0 from pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"019700001","offre":"HOME50"}]') r),
                     'réimporter l''extraction ne double rien');
select pg_temp.check(pvt_rejeter_non_validees('2026-10-01') = 1, 'la vente absente de l''extraction est rejetée');
select pg_temp.check((select extraction_recue_le is not null from pvt_mois where mois = '2026-10-01'), 'la réception de l''extraction est notée');
commit;

-- Rétention : le vendeur met à jour le statut de ses lignes validées en fin de mois.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select pvt_etat_ligne((select id from pvt_ventes where ligne = '0196000001'), 'Active');
select pg_temp.check((select etat_ligne = 'Active' and etat_maj_le is not null from pvt_ventes where ligne = '0196000001'), 'le vendeur met sa ligne à jour');
select pg_temp.check(pg_temp.echoue($$select pvt_etat_ligne((select id from pvt_ventes where ligne = '019700001'), 'Suspendue')$$) , 'pas les lignes d''un autre vendeur');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
select pvt_etat_ligne((select id from pvt_ventes where ligne = '019700001'), 'Suspendue');
select pg_temp.check(pg_temp.echoue($$select pvt_etat_ligne((select id from pvt_ventes where ligne = '019700003'), 'Active')$$), 'une vente rejetée n''a pas de statut de ligne');
commit;

-- Isolement par pays : un compte du Mali ne voit rien.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from pvt_ventes) = 0 and (select count(*) from pvt_offres) = 0, 'le Mali ne voit pas les ventes terrain du Bénin');
commit;

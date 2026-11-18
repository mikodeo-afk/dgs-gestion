-- Tests des ventes terrain Celtiis (contrat PVT avec SBIN, Bénin).
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
create or replace function pg_temp.erreur(sql text) returns text language plpgsql as $$
begin execute sql; return ''; exception when others then return sqlerrm; end $$;

-- Commercial du Bénin, et un vendeur terrain qui a un compte (technicien du Bénin).
insert into auth.users (id,email,raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000060','commercial@dgs.bj','{"nom":"Aïcha Zinsou","pays":"BJ"}'),
 ('00000000-0000-0000-0000-000000000061','22997000002@vendeur.dgs','{"nom":"Sèna Vendeur","pays":"BJ"}');
update profils set actif=true, poste='commercial' where id='00000000-0000-0000-0000-000000000060';
update profils set actif=true, poste='vendeur' where id='00000000-0000-0000-0000-000000000061';

select pg_temp.check((select count(*) from pvt_offres where pays='BJ') = 27, 'la grille de l''annexe 3 est chargée pour le Bénin');
select pg_temp.check((select part_partenaire from pvt_offres where pays='BJ' and code='FTTH_Home_50M') = 2000, 'HOME 50M : 8 000 au vendeur, 2 000 au partenaire');
select pg_temp.check(not exists (select 1 from pvt_offres where pays='ML'), 'pas de grille Celtiis au Mali');

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
insert into pvt_vendeurs (id, nom, numero_celtiis) values ('70000000-0000-0000-0000-000000000001', 'Rodrigue Ahouansou', '0140000001');
insert into pvt_vendeurs (id, nom, profil_id) values ('70000000-0000-0000-0000-000000000002', 'Sèna Vendeur', '00000000-0000-0000-0000-000000000061');
insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, client, ligne)
select '2026-10-01', '2026-10-12', '70000000-0000-0000-0000-000000000001', id, 'Client ' || g, '01970000' || g
  from pvt_offres, generate_series(1, 3) g where code = 'FTTH_Home_50M';
select pg_temp.check((select pays from pvt_ventes limit 1) = 'BJ', 'une vente prend le pays courant');
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne, statut) select '2026-10-01', '2026-10-12', '70000000-0000-0000-0000-000000000001', id, '0197999999', 'Validée' from pvt_offres where code='FTTH_Home_50M'$$) = false,
                     'le commercial (gestion) peut tout enregistrer');
delete from pvt_ventes where ligne = '0197999999';
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne) select '2026-10-01', '2026-10-13', '70000000-0000-0000-0000-000000000001', id, '019700001' from pvt_offres where code='FTTH_Home_50M'$$),
                     'une même ligne n''est pas déclarée deux fois');
commit;

-- Le vendeur qui a un compte déclare ses ventes, ne valide rien, ne voit pas les autres.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000061';
select pg_temp.check(not est_global() and (select count(*) from mes_chantiers()) = 0, 'le vendeur terrain n''a pas de vue globale ni de chantier');
select pg_temp.check(a_droit('pvt.declarer') and not a_droit('pvt.voir'), 'le vendeur déclare ses ventes sans voir celles des autres');
insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, client, ligne)
select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000002', id, 'Boutique', '0196000001' from pvt_offres where code='FTTH_PRO_50M';
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne) select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000001', id, '0196000002' from pvt_offres where code='FTTH_PRO_50M'$$),
                     'un vendeur ne déclare pas pour un autre');
select pg_temp.check(pg_temp.echoue($$insert into pvt_ventes (mois, date_vente, vendeur_id, offre_id, ligne, statut) select '2026-10-01', '2026-10-20', '70000000-0000-0000-0000-000000000002', id, '0196000003', 'Validée' from pvt_offres where code='FTTH_PRO_50M'$$),
                     'un vendeur ne valide pas sa vente');
select pg_temp.check((select count(*) from pvt_ventes) = 1, 'le vendeur ne voit que ses ventes');
select pg_temp.check(pg_temp.echoue($$update pvt_ventes set statut = 'Validée'$$), 'le vendeur ne peut pas passer sa vente en validée');
update pvt_ventes set client = 'Boutique Akpakpa';
select pg_temp.check((select client from pvt_ventes) = 'Boutique Akpakpa', 'il corrige sa vente encore déclarée');
select pg_temp.check(pg_temp.echoue($$select pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"0196000001","offre":"FTTH_PRO_50M"}]')$$), 'le vendeur n''importe pas l''extraction');
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
select pg_temp.check((select r = '{"ajoutees": 1, "validees": 4, "rejetees": 0, "reportees": 0, "vendeurs_crees": 0, "codes_inconnus": ["XYZ"], "offres_inconnues": 1}'::jsonb
                      from pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"019700001","offre":"FTTH_Home_50M","date":"2026-10-14"},
                                                                     {"ligne":"019700002","offre":"ftth_home_100m"},
                                                                     {"ligne":"0196000001","offre":"FTTH_PRO_50M"},
                                                                     {"ligne":"0195555555","offre":"FWA"},
                                                                     {"ligne":"0195555556","offre":"XYZ"}]') r),
                     'extraction : 4 ventes validées dont 1 ligne SBIN non déclarée ajoutée, 1 offre inconnue signalée');
select pg_temp.check((select o.code from pvt_ventes v join pvt_offres o on o.id = v.offre_id where v.ligne = '019700002') = 'FTTH_Home_100M', 'l''offre retenue est celle de SBIN');
select pg_temp.check((select vendeur_id is null and source = 'Extraction SBIN' from pvt_ventes where ligne = '0195555555'), 'la ligne SBIN non déclarée est à attribuer');
select pg_temp.check((select (r ->> 'validees')::int = 0 and (r ->> 'ajoutees')::int = 0 from pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"019700001","offre":"FTTH_Home_50M"}]') r),
                     'réimporter l''extraction ne double rien');
select pg_temp.check(pvt_rejeter_non_validees('2026-10-01') = 1, 'la vente absente de l''extraction est rejetée');
-- Format réel SBIN : login vendeur, paiement reporté, vente non validée, arriéré, état de la ligne.
select pg_temp.check((select r ->> 'vendeurs_crees' = '2' and r ->> 'reportees' = '1' and r ->> 'rejetees' = '1' and r ->> 'validees' = '2'
                      from pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"0121251924","offre":"FTTH_Home_50M","login":"pvt_dgs_alucresse.ftth","statut":"Validée","client":"SELOME"},
                                                                     {"ligne":"121296069","offre":"FIBRE_PRO_MAX_100M","login":"pvt_dgs_alucresse","statut":"Validée","etat":"Active"},
                                                                     {"ligne":"0121250000","offre":"FTTH_Home_50M","login":"pvt_dgs_alucresse.ftth","statut":"Reportée","motif":"ZONE DEPOURVUE","date":"2026-10-20"},
                                                                     {"ligne":"0121250001","offre":"FTTH_Home_50M","login":"pvt_dgs_gadanle.ftth","statut":"Rejetée"}]') r),
                     'extraction SBIN : vendeurs créés d''après son login, ventes validées, reportée et rejetée');
select pg_temp.check((select count(*) from pvt_vendeurs where login_sbin = 'pvt_dgs_alucresse') = 1, 'le même login B2B et B2C (.ftth) désigne un seul vendeur');
select pg_temp.check((select statut = 'Reportée' and motif = 'ZONE DEPOURVUE' and mois = '2026-10-01' from pvt_ventes where ligne = '0121250000'), 'la vente reportée reste ouverte avec son motif');
select pg_temp.check((select etat_ligne from pvt_ventes where ligne = '121296069') = 'Active', 'l''état de la ligne SBIN est repris');
select pg_temp.check((select r ->> 'validees' = '1' from pvt_rapprocher_extraction('2026-11-01', '[{"ligne":"0121250000","offre":"FTTH_Home_50M","login":"pvt_dgs_alucresse.ftth","statut":"Validée"}]') r), 'arriéré : validé');
select pg_temp.check((select statut = 'Validée' and mois = '2026-11-01' and motif is null from pvt_ventes where ligne = '0121250000'),
                     'l''arriéré payé le mois suivant est compté dans ce mois-là');
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

-- Finances : le contrat est rattaché à un projet ; l'extraction définitive devient un PV de réception signé.
update pvt_contrats set chantier_id = '10000000-0000-0000-0000-000000000040' where pays = 'BJ';
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
select pg_temp.check(pg_temp.echoue($$select pvt_extraction_definitive('2026-12-01', '[{"segment":"B2C","designation":"x","quantite":1,"prix":1}]')$$), 'pas d''extraction définitive sans extraction importée');
select pg_temp.check((select r ? 'B2C' and r ? 'B2B' from pvt_extraction_definitive('2026-10-01',
   '[{"segment":"B2C","designation":"Commission Fibre HOME 50M","unite":"vente","quantite":3,"prix":10000},
     {"segment":"B2C","designation":"Primes vendeurs VTM","unite":"forfait","quantite":1,"prix":50000},
     {"segment":"B2B","designation":"Commission Fibre Pro 50M","unite":"vente","quantite":2,"prix":12000}]') r),
   'extraction définitive : un PV par segment');
commit;
select pg_temp.check((select p.statut = 'Signé' and p.type = 'client' and p.montant_ht = 80000 and p.chantier_id = '10000000-0000-0000-0000-000000000040'
                      from pvt_mois m join pv_execution p on p.id = m.pv_b2c_id where m.mois = '2026-10-01'),
                     'PV de réception FTTH signé, sur le projet PVT, 80 000 HT, prêt à facturer');
select pg_temp.check((select count(*) from pv_lignes l join pvt_mois m on l.pv_id = m.pv_b2b_id where m.mois = '2026-10-01') = 1, 'le PV détaille les lignes');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
select pg_temp.check(pg_temp.echoue($$select pvt_rapprocher_extraction('2026-10-01', '[{"ligne":"0129999999","offre":"FTTH_Home_50M"}]')$$), 'mois clôturé : plus d''import');
select pg_temp.check(pg_temp.echoue($$select pvt_extraction_definitive('2026-10-01', '[{"segment":"B2C","designation":"x","quantite":1,"prix":1}]')$$), 'pas deux fois');
select pvt_etat_ligne((select id from pvt_ventes where ligne = '019700002'), 'Active');
select pg_temp.check(true, 'mois clôturé : l''état des lignes se met encore à jour');
insert into pvt_versements (mois, vendeur_id, type, montant, verse_le, mode) values ('2026-10-01', '70000000-0000-0000-0000-000000000001', 'Solde', 30000, '2026-11-20', 'Mobile Money');
commit;
select pg_temp.check((select d.statut = 'Payée' and d.montant = 30000 and d.chantier_id = '10000000-0000-0000-0000-000000000040'
                      from pvt_versements v join depenses d on d.id = v.depense_id where v.montant = 30000),
                     'le versement au vendeur est une dépense payée du projet');
update pv_execution set statut = 'Annulé' where id = (select pv_b2c_id from pvt_mois where mois = '2026-10-01');
select pg_temp.check((select not cloture and pv_b2c_id is null from pvt_mois where mois = '2026-10-01'), 'annuler le PV rouvre le mois');

-- Prévisionnel : le 1er du mois suivant, les ventes déclarées sont figées et l'avance calculée.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000060';
select pg_temp.check(pvt_figer_previsionnel('2026-10-01'), 'prévisionnel d''octobre figé après le 1er novembre');
select pg_temp.check((select avance = round(part * 0.5) and ventes > 0 from pvt_previsionnel where vendeur_id = '70000000-0000-0000-0000-000000000001'), 'avance = 50 % de la part du prévisionnel');
select pvt_figer_previsionnel('2026-10-01');
select pg_temp.check((select count(*) from pvt_previsionnel where mois = '2026-10-01') = (select count(distinct vendeur_id) from pvt_previsionnel where mois = '2026-10-01'), 'figé une seule fois');
select pg_temp.check(not pvt_figer_previsionnel((date_trunc('month', current_date))::date), 'le mois en cours n''est pas encore figé');
commit;

-- Superviseur PVT et contrat de prestation.
insert into auth.users (id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000062','superviseur@dgs.bj','{"nom":"Koffi Superviseur","pays":"BJ"}');
update profils set actif=true, poste='superviseur', contrat='Prestation' where id='00000000-0000-0000-0000-000000000062';
select pg_temp.check((select contrat from profils where id='00000000-0000-0000-0000-000000000062') = 'Prestation', 'contrat de prestation accepté');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000062';
select pg_temp.check(a_droit('pvt.gerer') and a_droit('pointer') and not est_global(), 'le superviseur gère les ventes terrain, pointe, sans vue globale');
select pg_temp.check((select array_agg(x) from mes_chantiers() x) = array['10000000-0000-0000-0000-000000000040'::uuid], 'son projet est le projet PVT');
select pg_temp.check((select count(*) from pvt_ventes) > 0, 'il voit les ventes terrain');
select pg_temp.check(pg_temp.erreur($$select pointer(null, 6.40, 2.40, 400, 'BJ/00000000-0000-0000-0000-000000000062/a.jpg')$$) like '%trop imprécise%',
                     'pointage terrain : la précision GPS reste exigée');
select pg_temp.check(pg_temp.erreur($$select pointer(null, 6.40, 2.40, 10, null)$$) like '%selfie%', 'pointage terrain : selfie obligatoire');
select pg_temp.check((pointer(null, 6.40, 2.40, 10, 'BJ/00000000-0000-0000-0000-000000000062/s.jpg') ->> 'terrain')::boolean,
                     'le superviseur pointe sur le terrain, sans bureau ni rayon');
select pg_temp.check((select terrain and distance_m is null and latitude = 6.40 and controle = 'À contrôler' from presences
                       where profil_id = '00000000-0000-0000-0000-000000000062' and jour = current_date), 'pointage terrain enregistré avec sa position, à contrôler');
commit;

-- Isolement par pays : un compte du Mali ne voit rien.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from pvt_ventes) = 0 and (select count(*) from pvt_offres) = 0, 'le Mali ne voit pas les ventes terrain du Bénin');
commit;

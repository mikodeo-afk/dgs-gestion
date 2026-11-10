-- Tests des finances (à lancer après tests.sql, sur les mêmes données).
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

-- Technicien : demande une dépense sur son chantier
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
insert into depenses (id,chantier_id,objet,montant) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Carburant',150000);
select pg_temp.check(pg_temp.echoue($$insert into depenses (objet,montant) values ('Loyer',600000)$$), 'le technicien ne peut pas imputer aux frais généraux');
select pg_temp.check(pg_temp.echoue($$insert into depenses (chantier_id,objet,montant,statut) values ('10000000-0000-0000-0000-000000000001','x',1000,'Validée')$$), 'une dépense ne peut pas être créée déjà validée');
select pg_temp.check(pg_temp.echoue($$update depenses set statut='Validée'$$) or (select statut from depenses where id='20000000-0000-0000-0000-000000000001')='Demandée', 'le technicien ne peut pas changer le statut directement');
commit;

-- Chef de projet : grosse demande ; ne peut pas valider
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000006';
insert into depenses (id,chantier_id,objet,montant) values ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Câble 48 FO',3600000);
select pg_temp.check(pg_temp.echoue($$select decider_depense('20000000-0000-0000-0000-000000000001', true)$$), 'le chef de projet ne valide pas de dépense');
select pg_temp.check((select count(*) from depenses)=2, 'le chef de projet voit les dépenses de son chantier');
commit;

-- PV client signé (base de la facture)
insert into pv_execution (id,chantier_id,type,tiers,objet,montant_ht,statut,signe_le,initie_par) values ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','client','Client TEL','Acompte 30 %',7800000,'Signé',current_date,'00000000-0000-0000-0000-000000000006');

-- RAF : valide sous le seuil, pas au-dessus ; paie
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select decider_depense('20000000-0000-0000-0000-000000000001', true);
select pg_temp.check((select statut from depenses where id='20000000-0000-0000-0000-000000000001')='Validée', 'le RAF valide 150 000 FCFA');
select pg_temp.check(pg_temp.echoue($$select decider_depense('20000000-0000-0000-0000-000000000002', true)$$), 'le RAF ne valide pas 3 600 000 FCFA');
select payer_depense('20000000-0000-0000-0000-000000000001');
select pg_temp.check((select statut from depenses where id='20000000-0000-0000-0000-000000000001')='Payée', 'le RAF marque la dépense payée');
insert into factures_clients (pv_id,objet,echeance) values ('30000000-0000-0000-0000-000000000001','Acompte 30 %',current_date+15);
select pg_temp.check((select numero from factures_clients) = 'FAC-' || to_char(current_date,'YYYY') || '-001', 'la facture client est numérotée automatiquement');
select encaisser_facture((select id from factures_clients limit 1));
insert into frais_generaux (mois,categorie,libelle,montant) values (date_trunc('month',current_date),'Loyer','Loyer bureau',600000);
insert into factures_fournisseurs (fournisseur,numero,chantier_id,objet,montant_ht) values ('Quincaillerie','Q-1','10000000-0000-0000-0000-000000000001','Gaines',1150000);
select pg_temp.check(pg_temp.echoue($$select decider_facture_fournisseur((select id from factures_fournisseurs limit 1), true)$$), 'on ne valide pas une facture que l''on a saisie soi-même');
select pg_temp.check((select count(*) from frais_generaux_du_mois(current_date)) = 2, 'les frais généraux du mois comptent la saisie et les salaires administratifs');
commit;

-- DO : valide au-dessus du seuil, pas sa propre demande
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select decider_depense('20000000-0000-0000-0000-000000000002', true);
select pg_temp.check((select statut from depenses where id='20000000-0000-0000-0000-000000000002')='Validée', 'le DO valide 3 600 000 FCFA');
insert into depenses (id,chantier_id,objet,montant) values ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','Grue',500000);
select pg_temp.check(pg_temp.echoue($$select decider_depense('20000000-0000-0000-0000-000000000003', true)$$), 'le DO ne valide pas sa propre demande');
select decider_facture_fournisseur((select id from factures_fournisseurs limit 1), true);
select pg_temp.check((select count(*) from rentabilite_chantiers())=2, 'le DO voit la rentabilité de tous les chantiers');
select pg_temp.check((select facture_ht - couts = marge and depenses = 3750000 and factures_fournisseurs = 1150000 and encaisse_ht = 7800000
                      from rentabilite_chantiers() where code='TEL-001'), 'la marge du chantier compte dépenses, factures fournisseurs et main-d''œuvre');
select pg_temp.check((select main_oeuvre > 0 from rentabilite_chantiers() where code='TEL-001'), 'la main-d''œuvre de terrain est imputée au chantier');
commit;

-- Technicien (avec « fin.voir » accordé) : seulement son chantier ; pas les frais généraux
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000010';
select pg_temp.check((select count(*) from rentabilite_chantiers())=1, 'le technicien ne voit que la rentabilité de son chantier');
select pg_temp.check((select count(*) from frais_generaux_du_mois(current_date))=0 and (select count(*) from frais_generaux)=0, 'le technicien ne voit pas les frais généraux');
select pg_temp.check((select count(*) from depenses)=1, 'le technicien ne voit que ses dépenses');
commit;
\echo 'Tous les tests des finances passent.'

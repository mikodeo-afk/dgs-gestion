-- Tests des notifications : celui qui doit valider est prévenu, dans le bon pays.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;
-- Notifications « à valider » encore ouvertes pour un objet, par destinataire.
create or replace function pg_temp.ouverte(p_dest text, p_objet text, p_titre text) returns boolean language sql as $$
  select exists (select 1 from notifications where destinataire_id = ('00000000-0000-0000-0000-0000000000' || p_dest)::uuid
                 and objet = p_objet and type = 'À valider' and traitee_le is null and (titre || ' ' || coalesce(message, '')) like p_titre)
$$;

-- PDG 01, DO 02, RAF 03 (Mali), RLA 21 (Mali), RT 30 (Mali), RAF 40 (Bénin).
update profils set pays_actif = null where id in ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002');

-- 1. Dépense sous le seuil : RAF, PDG et DO sont prévenus ; pas le demandeur, pas le Bénin.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into depenses (chantier_id, objet, montant) values (null, 'Notif : cartouches d''encre', 500000);
commit;
select pg_temp.check(pg_temp.ouverte('03', 'depense', '%cartouches%'), 'dépense ≤ seuil : le RAF est notifié');
select pg_temp.check(pg_temp.ouverte('01', 'depense', '%cartouches%') and pg_temp.ouverte('02', 'depense', '%cartouches%'), 'dépense : le PDG et le DO sont notifiés');
select pg_temp.check(not pg_temp.ouverte('21', 'depense', '%cartouches%'), 'le demandeur n''est pas notifié de sa propre demande');
select pg_temp.check(not pg_temp.ouverte('40', 'depense', '%cartouches%'), 'le RAF du Bénin n''est pas notifié d''une dépense du Mali');

-- 2. Au-delà du seuil : seulement ceux qui valident au-delà.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into depenses (chantier_id, objet, montant) values (null, 'Notif : groupe électrogène', 5000000);
commit;
select pg_temp.check(not pg_temp.ouverte('03', 'depense', '%groupe électrogène%'), 'dépense > seuil : le RAF n''est pas notifié');
select pg_temp.check(pg_temp.ouverte('01', 'depense', '%groupe électrogène%') and pg_temp.ouverte('02', 'depense', '%groupe électrogène%'), 'dépense > seuil : le PDG et le DO sont notifiés');

-- 3. Chacun ne voit que ses notifications ; le compteur ; personne ne les écrit à la main.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select pg_temp.check((select count(*) from notifications where destinataire_id <> auth.uid()) = 0, 'le RAF ne voit que ses notifications');
select pg_temp.check(notifications_non_lues() >= 1, 'le compteur du RAF indique la dépense à valider');
select pg_temp.check(pg_temp.echoue($$insert into notifications (destinataire_id,pays,type,objet,objet_id,titre) values (auth.uid(),'ML','Décision','x','x','x')$$), 'on n''écrit pas de notification à la main');
select pg_temp.check(pg_temp.echoue($$select notifier_valideurs(array[auth.uid()],'ML','x','x','x',null,null,null)$$), 'les fonctions internes ne s''appellent pas depuis l''application');
-- 4. Le RAF valide : la notification sort du compteur de tous ; le demandeur est prévenu.
select decider_depense((select id from depenses where objet = 'Notif : cartouches d''encre'), true);
commit;
select pg_temp.check(not pg_temp.ouverte('03', 'depense', '%cartouches%') and not pg_temp.ouverte('01', 'depense', '%cartouches%'),
                     'dépense validée : la notification sort du compteur du RAF et du PDG');
select pg_temp.check(exists (select 1 from notifications where destinataire_id = '00000000-0000-0000-0000-000000000021' and type = 'Décision'
                     and titre like 'Dépense validée%500 000%'), 'le demandeur est prévenu que sa dépense est validée');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
select pg_temp.check(notifications_non_lues() >= 1, 'le demandeur a une notification non lue');
select marquer_notifications_lues();
select pg_temp.check(notifications_non_lues() = 0, 'tout marquer comme lu remet le compteur à zéro');
commit;

-- 5. Achats : demande → RAF ; bon de commande → DO (pas le PDG par défaut).
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into demandes_achat (chantier_id, objet, montant_estime) values (null, 'Notif : rames de papier', 300000);
commit;
select pg_temp.check(pg_temp.ouverte('03', 'demande_achat', 'Demande d''achat à étudier%rames%'), 'demande d''achat : le RAF est notifié');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select initier_bon_commande((select id from demandes_achat where objet = 'Notif : rames de papier'), 'Papeterie du Fleuve', 250000);
commit;
select pg_temp.check(not pg_temp.ouverte('03', 'demande_achat', 'Demande d''achat à étudier%rames%'), 'bon initié : la demande sort du compteur du RAF');
select pg_temp.check(pg_temp.ouverte('02', 'bon_commande', 'Bon de commande à valider%rames%'), 'bon de commande : le DO est notifié');
select pg_temp.check(not pg_temp.ouverte('01', 'bon_commande', 'Bon de commande à valider%rames%'), 'bon de commande : le PDG (sans le droit) n''est pas notifié');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select decider_bon_commande((select b.id from bons_commande b join demandes_achat d on d.id = b.demande_id where d.objet = 'Notif : rames de papier'), true);
commit;
select pg_temp.check(not pg_temp.ouverte('02', 'bon_commande', 'Bon de commande à valider%rames%'), 'bon validé : sort du compteur du DO');
select pg_temp.check(exists (select 1 from notifications where destinataire_id = '00000000-0000-0000-0000-000000000021' and titre like 'Votre achat est commandé%'),
                     'le demandeur de l''achat est prévenu de la commande');

-- 6. Proforma : le DG et le DO ; après le visa du DG, seul le DO a encore à viser.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000030';
insert into proformas (client, objet, domaine, montant_ht) values ('EDM-SA', 'Notif : poste HTA', 'Énergie', 10000000);
commit;
select pg_temp.check(pg_temp.ouverte('01', 'proforma', 'Proforma à viser%poste HTA%') and pg_temp.ouverte('02', 'proforma', 'Proforma à viser%poste HTA%'), 'proforma : le DG et le DO sont notifiés');
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
select viser_proforma((select id from proformas where objet = 'Notif : poste HTA'), true);
commit;
select pg_temp.check(not pg_temp.ouverte('01', 'proforma', 'Proforma à viser%poste HTA%') and pg_temp.ouverte('02', 'proforma', 'Proforma à viser%poste HTA%'),
                     'après le visa du DG, la proforma reste à viser pour le DO seulement');

-- 7. Ouverture d'un chantier : l'autre dirigeant est notifié.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
insert into chantiers (code, nom, domaine) values ('NOT-001', 'Notif chantier', 'BTP');
commit;
select pg_temp.check(pg_temp.ouverte('01', 'chantier', 'Chantier à ouvrir%NOT-001%') and not pg_temp.ouverte('02', 'chantier', 'Chantier à ouvrir%NOT-001%'),
                     'chantier à ouvrir : le PDG est notifié, pas le DO qui l''a créé');

-- 8. Bénin : le RAF du Bénin et la direction du groupe, pas le RAF du Mali.
insert into depenses (pays, chantier_id, objet, montant, demandeur_id)
values ('BJ', null, 'Notif : carburant Cotonou', 400000, '00000000-0000-0000-0000-000000000041');
select pg_temp.check(pg_temp.ouverte('40', 'depense', '%carburant Cotonou%'), 'Bénin : le RAF du Bénin est notifié');
select pg_temp.check(not pg_temp.ouverte('03', 'depense', '%carburant Cotonou%'), 'Bénin : le RAF du Mali n''est pas notifié');
select pg_temp.check(pg_temp.ouverte('01', 'depense', '%carburant Cotonou%'), 'Bénin : le PDG (accès groupe) est notifié');
select pg_temp.check((select pays from notifications where objet = 'depense' and message like '%carburant Cotonou%' limit 1) = 'BJ', 'la notification porte le pays de l''opération');

-- 9. Appareils : chacun enregistre le sien ; les réglages d'envoi restent secrets.
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
select enregistrer_appareil_push('https://push.exemple/abc', 'cle', 'auth', 'Android');
select pg_temp.check((select count(*) from push_abonnements) = 1, 'le RAF enregistre son téléphone');
select pg_temp.check(pg_temp.echoue($$select enregistrer_appareil_push('http://pas-https', 'cle', 'auth')$$), 'adresse d''abonnement non sécurisée refusée');
select pg_temp.check(pg_temp.echoue($$select * from push_config$$), 'les clés d''envoi ne sont pas lisibles');
commit;
begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
select enregistrer_appareil_push('https://push.exemple/abc', 'cle2', 'auth2', 'Android');
commit;
select pg_temp.check((select profil_id from push_abonnements where endpoint = 'https://push.exemple/abc') = '00000000-0000-0000-0000-000000000002',
                     'un téléphone partagé appartient au dernier qui s''y abonne');

\echo 'Tous les tests des notifications passent.'

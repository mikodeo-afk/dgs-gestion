-- DGS Gestion : notifications des opérations à valider.
-- Dès qu'une opération attend une validation, chaque personne qui a le droit de la valider
-- (dans le pays de l'opération, ou avec l'accès groupe) reçoit une notification : cloche et
-- compteur dans l'application, et notification sur le téléphone ou l'ordinateur si elle l'a
-- activée. Quand l'opération est traitée (par elle ou par un autre valideur), la notification
-- sort du compteur, et l'auteur de l'opération est prévenu de la décision.
--
-- Circuits couverts :
--   dépense demandée            → RAF jusqu'au seuil, PDG / DO (« Valider au-delà ») au-delà
--   facture fournisseur reçue   → même règle (bon à payer)
--   demande d'achat soumise     → RAF (« bc.initier »)
--   bon de commande à valider   → DO (« bc.valider »)
--   proforma à viser            → DG et DO (« pf.valider »), chacun jusqu'à son visa
--   paie soumise                → RAF / PDG / DO (« paie.valider »)
--   chantier à ouvrir           → DG et DO (sauf celui qui l'a créé)
-- Personne n'est notifié pour sa propre opération.

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  destinataire_id uuid not null references public.profils(id) on delete cascade,
  pays            text not null references public.pays(code),
  type            text not null check (type in ('À valider','Décision')),
  objet           text not null,
  objet_id        text not null,
  titre           text not null,
  message         text,
  lien            text,
  auteur_id       uuid references public.profils(id) on delete set null,
  cree_le         timestamptz not null default now(),
  lue_le          timestamptz,
  traitee_le      timestamptz
);
create index on public.notifications (destinataire_id, cree_le desc);
create index on public.notifications (pays, objet, objet_id);

-- Chacun ne voit que ses notifications ; elles ne s'écrivent que par les fonctions ci-dessous.
alter table public.notifications enable row level security;
create policy lecture on public.notifications for select to authenticated using (destinataire_id = auth.uid());

-- Nombre de notifications à traiter (non lues et dont l'opération attend encore).
create or replace function public.notifications_non_lues()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from notifications where destinataire_id = auth.uid() and lue_le is null and traitee_le is null
$$;

create or replace function public.marquer_notification_lue(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update notifications set lue_le = coalesce(lue_le, now()) where id = p_id and destinataire_id = auth.uid()
$$;

create or replace function public.marquer_notifications_lues()
returns void language sql security definer set search_path = public as $$
  update notifications set lue_le = now() where destinataire_id = auth.uid() and lue_le is null
$$;

-- Personnes actives qui peuvent agir dans un pays : celles du pays et celles de l'accès groupe.
create or replace function public.personnes_du_pays(p_pays text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from profils where actif and (pays = p_pays or public.acces_groupe(id))
$$;

-- Montant lisible : 1 500 000.
create or replace function public.montant_txt(p numeric)
returns text language sql immutable as $$
  select replace(to_char(round(coalesce(p, 0)), 'FM999,999,999,999,990'), ',', ' ')
$$;

create or replace function public.nom_de(p_profil uuid)
returns text language sql stable security definer set search_path = public as $$
  select nom from profils where id = p_profil
$$;

-- Envoie une notification « À valider » à chaque destinataire (sauf l'auteur).
create or replace function public.notifier_valideurs(p_destinataires uuid[], p_pays text, p_objet text, p_objet_id text,
                                                     p_titre text, p_message text, p_lien text, p_auteur uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (destinataire_id, pays, type, objet, objet_id, titre, message, lien, auteur_id)
  select distinct d, p_pays, 'À valider', p_objet, p_objet_id, p_titre, p_message, p_lien, p_auteur
  from unnest(p_destinataires) d
  where d is distinct from p_auteur
    and not exists (select 1 from notifications n where n.destinataire_id = d and n.pays = p_pays and n.objet = p_objet
                    and n.objet_id = p_objet_id and n.type = 'À valider' and n.traitee_le is null);
end $$;

-- L'opération a été traitée : les notifications « À valider » sortent du compteur.
-- p_destinataires : seulement ces personnes (proforma : celui qui a visé) ; vide = tout le monde.
create or replace function public.cloturer_notifications(p_pays text, p_objet text, p_objet_id text, p_destinataires uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update notifications set traitee_le = now()
  where pays = p_pays and objet = p_objet and objet_id = p_objet_id and type = 'À valider' and traitee_le is null
    and (p_destinataires is null or destinataire_id = any(p_destinataires))
$$;

-- Prévient l'auteur de l'opération de la décision (sauf s'il l'a prise lui-même).
create or replace function public.notifier_decision(p_destinataire uuid, p_pays text, p_objet text, p_objet_id text,
                                                    p_titre text, p_message text, p_lien text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_destinataire is null or p_destinataire = auth.uid() then return; end if;
  if not exists (select 1 from profils where id = p_destinataire and actif) then return; end if;
  insert into notifications (destinataire_id, pays, type, objet, objet_id, titre, message, lien, auteur_id)
  values (p_destinataire, p_pays, 'Décision', p_objet, p_objet_id, p_titre, p_message, p_lien, auth.uid());
end $$;

-- Qui valide un montant (dépense, facture fournisseur) dans un pays donné.
create or replace function public.valideurs_montant(p_pays text, p_montant numeric)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.personnes_du_pays(p_pays) id
  where public.a_droit('dep.valider_tout', id)
     or (public.a_droit('dep.valider', id) and p_montant <= coalesce(public.parametre('seuil_validation', p_pays), 0))
$$;

create or replace function public.titulaires_droit(p_pays text, p_cle text, p_postes public.poste[] default null)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.personnes_du_pays(p_pays) id
  where public.a_droit(p_cle, id) and (p_postes is null or public.poste_de(id) = any(p_postes))
$$;

-- ---------------------------------------------------------------------------
-- Dépenses
-- ---------------------------------------------------------------------------
create or replace function public.notif_depense()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_imp text;
begin
  select coalesce(code, nom) into v_imp from chantiers where id = new.chantier_id;
  v_imp := coalesce(v_imp, 'frais généraux');
  if new.statut = 'Demandée' and (tg_op = 'INSERT' or old.statut is distinct from 'Demandée') then
    perform notifier_valideurs(valideurs_montant(new.pays, new.montant), new.pays, 'depense', new.id::text,
      'Dépense à valider : ' || montant_txt(new.montant) || ' FCFA',
      coalesce(nom_de(new.demandeur_id), 'Un employé') || ' demande « ' || new.objet || ' » (' || v_imp || ').',
      '/depenses', new.demandeur_id);
  elsif tg_op = 'UPDATE' and old.statut = 'Demandée' and new.statut in ('Validée','Rejetée') then
    perform cloturer_notifications(new.pays, 'depense', new.id::text);
    perform notifier_decision(new.demandeur_id, new.pays, 'depense', new.id::text,
      'Dépense ' || lower(new.statut) || ' : ' || montant_txt(new.montant) || ' FCFA',
      '« ' || new.objet || ' » ' || case when new.statut = 'Validée' then 'a été validée' else 'a été rejetée' end
        || coalesce(' par ' || nom_de(new.valideur_id), '') || '.',
      '/depenses');
  end if;
  return null;
end $$;
create trigger notifications after insert or update of statut on public.depenses
for each row execute function public.notif_depense();

-- ---------------------------------------------------------------------------
-- Factures fournisseurs (bon à payer)
-- ---------------------------------------------------------------------------
create or replace function public.notif_facture_fournisseur()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'Reçue' and (tg_op = 'INSERT' or old.statut is distinct from 'Reçue') then
    perform notifier_valideurs(valideurs_montant(new.pays, new.montant_ht), new.pays, 'facture_fournisseur', new.id::text,
      'Facture fournisseur à valider : ' || montant_txt(new.montant_ht) || ' FCFA HT',
      new.fournisseur || ' n° ' || new.numero || ' : « ' || new.objet || ' ». Bon à payer attendu.',
      '/finances', new.saisie_par);
  elsif tg_op = 'UPDATE' and old.statut = 'Reçue' and new.statut <> 'Reçue' then
    perform cloturer_notifications(new.pays, 'facture_fournisseur', new.id::text);
    if new.statut in ('Validée','Rejetée') then
      perform notifier_decision(new.saisie_par, new.pays, 'facture_fournisseur', new.id::text,
        'Facture ' || new.numero || ' ' || case when new.statut = 'Validée' then ': bon à payer donné' else 'rejetée' end,
        new.fournisseur || ', ' || montant_txt(new.montant_ht) || ' FCFA HT' || coalesce(', par ' || nom_de(new.valideur_id), '') || '.',
        '/finances');
    end if;
  end if;
  return null;
end $$;
create trigger notifications after insert or update of statut on public.factures_fournisseurs
for each row execute function public.notif_facture_fournisseur();

-- ---------------------------------------------------------------------------
-- Demandes d'achat (étude par le RAF) et bons de commande (validation par le DO)
-- ---------------------------------------------------------------------------
create or replace function public.notif_demande_achat()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.statut = 'Soumise' and (tg_op = 'INSERT' or old.statut is distinct from 'Soumise') then
    perform notifier_valideurs(titulaires_droit(new.pays, 'bc.initier'), new.pays, 'demande_achat', new.id::text,
      case when tg_op = 'INSERT' then 'Demande d''achat à étudier : ' else 'Demande d''achat à reprendre (bon rejeté) : ' end || coalesce(new.numero, ''),
      coalesce(nom_de(new.demandeur_id), 'Un employé') || ' : « ' || new.objet || ' »'
        || coalesce(', estimé ' || montant_txt(new.montant_estime) || ' FCFA', '') || '.',
      '/achats', case when tg_op = 'INSERT' then new.demandeur_id else auth.uid() end);
  elsif tg_op = 'UPDATE' and old.statut = 'Soumise' and new.statut <> 'Soumise' then
    perform cloturer_notifications(new.pays, 'demande_achat', new.id::text);
    if new.statut = 'Rejetée' then
      perform notifier_decision(new.demandeur_id, new.pays, 'demande_achat', new.id::text,
        'Demande d''achat ' || coalesce(new.numero, '') || ' rejetée',
        '« ' || new.objet || ' »' || coalesce(' : ' || new.motif_rejet, '') || '.', '/achats');
    end if;
  end if;
  return null;
end $$;
create trigger notifications after insert or update of statut on public.demandes_achat
for each row execute function public.notif_demande_achat();

create or replace function public.notif_bon_commande()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_demandeur uuid;
begin
  if new.statut = 'À valider' and tg_op = 'INSERT' then
    perform notifier_valideurs(titulaires_droit(new.pays, 'bc.valider'), new.pays, 'bon_commande', new.id::text,
      'Bon de commande à valider : ' || coalesce(new.numero, '') || ' (' || montant_txt(new.montant_ttc) || ' FCFA TTC)',
      new.fournisseur || ' : « ' || new.objet || ' », initié par ' || coalesce(nom_de(new.initie_par), 'le RAF') || '.',
      '/achats', new.initie_par);
  elsif tg_op = 'UPDATE' and old.statut = 'À valider' and new.statut <> 'À valider' then
    perform cloturer_notifications(new.pays, 'bon_commande', new.id::text);
    perform notifier_decision(new.initie_par, new.pays, 'bon_commande', new.id::text,
      'Bon de commande ' || coalesce(new.numero, '') || ' ' || lower(new.statut),
      new.fournisseur || ' : « ' || new.objet || ' »' || coalesce(' : ' || new.motif_rejet, '') || '.', '/achats');
    if new.statut = 'Validé' then
      select demandeur_id into v_demandeur from demandes_achat where id = new.demande_id;
      if v_demandeur is distinct from new.initie_par then
        perform notifier_decision(v_demandeur, new.pays, 'bon_commande', new.id::text,
          'Votre achat est commandé : ' || coalesce(new.numero, ''),
          new.fournisseur || ' : « ' || new.objet || ' ». Bon de commande validé.', '/achats');
      end if;
    end if;
  end if;
  return null;
end $$;
create trigger notifications after insert or update of statut on public.bons_commande
for each row execute function public.notif_bon_commande();

-- ---------------------------------------------------------------------------
-- Proformas : deux visas (DG et DO)
-- ---------------------------------------------------------------------------
create or replace function public.notif_proforma()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.statut = 'À viser' then
    perform notifier_valideurs(titulaires_droit(new.pays, 'pf.valider', array['pdg','do']::public.poste[]), new.pays, 'proforma', new.id::text,
      'Proforma à viser : ' || coalesce(new.numero, '') || ' (' || montant_txt(new.montant_ttc) || ' FCFA TTC)',
      new.client || ' : « ' || new.objet || ' », initiée par ' || coalesce(nom_de(new.initie_par), 'le RT') || '.',
      '/soumissions', new.initie_par);
  elsif tg_op = 'UPDATE' then
    if new.statut <> 'À viser' and old.statut = 'À viser' then
      perform cloturer_notifications(new.pays, 'proforma', new.id::text);
      perform notifier_decision(new.initie_par, new.pays, 'proforma', new.id::text,
        'Proforma ' || coalesce(new.numero, '') || ' ' || lower(new.statut),
        new.client || ' : « ' || new.objet || ' »' || coalesce(' : ' || new.motif_rejet, '') || '.', '/soumissions');
    else
      -- Un visa est posé : celui qui a visé n'a plus rien à faire, l'autre dirigeant oui.
      perform cloturer_notifications(new.pays, 'proforma', new.id::text,
        array(select id from profils where (new.visa_dg_par is not null and poste = 'pdg') or (new.visa_do_par is not null and poste = 'do')));
    end if;
  end if;
  return null;
end $$;
create trigger notifications after insert or update of statut, visa_dg_par, visa_do_par on public.proformas
for each row execute function public.notif_proforma();

-- ---------------------------------------------------------------------------
-- Paie du mois
-- ---------------------------------------------------------------------------
create or replace function public.notif_paie()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mois text := to_char(new.mois, 'MM/YYYY');
begin
  if new.statut = 'Soumise' and old.statut is distinct from 'Soumise' then
    perform notifier_valideurs(titulaires_droit(new.pays, 'paie.valider'), new.pays, 'paie', new.mois::text,
      'Paie de ' || v_mois || ' à valider',
      'Soumise par ' || coalesce(nom_de(new.maj_par), 'les RH') || '.', '/rh', new.maj_par);
  elsif old.statut = 'Soumise' and new.statut <> 'Soumise' then
    perform cloturer_notifications(new.pays, 'paie', new.mois::text);
    perform notifier_decision(old.maj_par, new.pays, 'paie', new.mois::text,
      'Paie de ' || v_mois || ' ' || case when new.statut = 'Validée' then 'validée' else 'renvoyée en préparation' end,
      coalesce('Par ' || nom_de(new.maj_par) || '.', ''), '/rh');
  end if;
  return null;
end $$;
create trigger notifications after update of statut on public.paies
for each row execute function public.notif_paie();

-- ---------------------------------------------------------------------------
-- Ouverture d'un chantier (sans bon de commande du client)
-- ---------------------------------------------------------------------------
create or replace function public.notif_chantier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.validation = 'À valider' then
    perform notifier_valideurs(
      array(select id from personnes_du_pays(new.pays) id where poste_de(id) in ('pdg','do')),
      new.pays, 'chantier', new.id::text,
      'Chantier à ouvrir : ' || coalesce(new.code, '') || ' ' || new.nom,
      'Créé par ' || coalesce(nom_de(new.cree_par), 'un employé') || '. À valider, ou ouvert dès le dépôt du bon de commande du client.',
      '/chantiers/' || new.id, new.cree_par);
  elsif tg_op = 'UPDATE' and old.validation = 'À valider' and new.validation = 'Validé' then
    perform cloturer_notifications(new.pays, 'chantier', new.id::text);
    perform notifier_decision(new.cree_par, new.pays, 'chantier', new.id::text,
      'Chantier ouvert : ' || coalesce(new.code, '') || ' ' || new.nom,
      coalesce(new.ouverture, 'Validé') || '.', '/chantiers/' || new.id);
  end if;
  return null;
end $$;
create trigger notifications after insert or update of validation on public.chantiers
for each row execute function public.notif_chantier();

-- ---------------------------------------------------------------------------
-- Notifications sur le téléphone / l'ordinateur (Web Push)
-- ---------------------------------------------------------------------------
-- Appareils sur lesquels chaque employé a activé les notifications.
create table public.push_abonnements (
  id        uuid primary key default gen_random_uuid(),
  profil_id uuid not null references public.profils(id) on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  appareil  text,
  cree_le   timestamptz not null default now()
);
create index on public.push_abonnements (profil_id);
alter table public.push_abonnements enable row level security;
create policy lecture on public.push_abonnements for select to authenticated using (profil_id = auth.uid());
create policy retrait on public.push_abonnements for delete to authenticated using (profil_id = auth.uid());

-- Un appareil appartient à la dernière personne qui s'y est abonnée (téléphone partagé).
create or replace function public.enregistrer_appareil_push(p_endpoint text, p_p256dh text, p_auth text, p_appareil text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.mon_poste() is null then raise exception 'Compte inactif.'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Abonnement invalide.';
  end if;
  delete from push_abonnements where endpoint = p_endpoint;
  insert into push_abonnements (profil_id, endpoint, p256dh, auth, appareil)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_appareil, 200));
end $$;

-- Réglages de l'envoi (clés VAPID, adresse de l'application, secret partagé) : créés
-- automatiquement par l'application à la première activation. Personne ne les lit, sauf le serveur.
create table public.push_config (
  id             int primary key default 1 check (id = 1),
  url            text not null,
  secret         text not null,
  vapid_publique text not null,
  vapid_privee   text not null,
  cree_le        timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on public.push_config from authenticated, anon;

-- À chaque nouvelle notification, l'application est appelée pour l'envoyer sur les appareils
-- du destinataire (extension pg_net de Supabase, appel asynchrone après validation de la transaction).
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net indisponible : les notifications restent dans l''application (pas d''envoi sur les appareils).';
end $$;

create or replace function public.envoyer_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare c push_config;
begin
  select * into c from push_config where id = 1;
  if not found then return null; end if;
  if not exists (select 1 from push_abonnements where profil_id = new.destinataire_id) then return null; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using c.url, jsonb_build_object('id', new.id),
            jsonb_build_object('Content-Type', 'application/json', 'x-dgs-secret', c.secret);
  exception when others then
    null;  -- l'envoi sur l'appareil ne doit jamais bloquer l'opération
  end;
  return null;
end $$;
create trigger envoyer_push after insert on public.notifications
for each row execute function public.envoyer_push();

-- Les fonctions internes ne s'appellent pas depuis l'application.
revoke execute on function public.notifier_valideurs(uuid[], text, text, text, text, text, text, uuid) from public, authenticated, anon;
revoke execute on function public.cloturer_notifications(text, text, text, uuid[]) from public, authenticated, anon;
revoke execute on function public.notifier_decision(uuid, text, text, text, text, text, text) from public, authenticated, anon;

grant select on public.notifications, public.push_abonnements to authenticated;
grant delete on public.push_abonnements to authenticated;
grant execute on function public.notifications_non_lues(), public.marquer_notification_lue(uuid), public.marquer_notifications_lues(),
  public.enregistrer_appareil_push(text, text, text, text) to authenticated;

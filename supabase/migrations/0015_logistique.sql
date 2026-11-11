-- DGS Gestion : logistique.
-- 1. Stock : matériel acheté par DGS ou remis par le client, au dépôt central, sur un chantier ou
--    chez une personne. Entrées, dotations du jour aux équipes, utilisations (imputées à un chantier),
--    retours du matériel non utilisé, transferts et inventaires. Valeur au coût moyen pondéré (CMP),
--    alerte sous le seuil.
-- 2. Matériel de travail et matériel roulant : fiche, affectation (dépôt, chantier, responsable)
--    avec historique, entretiens et réparations, pleins de carburant (véhicules et engins),
--    documents (assurance, visite technique…) avec date de validité.
-- Le stock et le matériel sont tenus par le RLA (droits accordables à d'autres par le DO).
-- Les achats restent imputés aux chantiers par les factures fournisseurs : les utilisations
-- sont un suivi des quantités consommées, pas un second coût dans la rentabilité.

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('stock.gerer', 'Logistique', 'Gérer le stock (entrées, sorties, transferts, inventaires)', 70),
  ('mat.gerer',   'Logistique', 'Gérer le matériel de travail et le matériel roulant', 71)
on conflict do nothing;
insert into public.permissions_poste (poste, cle) values
  ('pdg','stock.gerer'),('do','stock.gerer'),('rla','stock.gerer'),
  ('pdg','mat.gerer'),('do','mat.gerer'),('rla','mat.gerer')
on conflict do nothing;

-- Le personnel de bureau voit toute la logistique ; le terrain, celle de ses chantiers.
create or replace function public.voit_logistique(p_chantier uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select public.est_global() or public.a_droit('stock.gerer') or public.a_droit('mat.gerer')
      or (p_chantier is not null and p_chantier in (select public.mes_chantiers()))
$$;

-- ---------------------------------------------------------------------------
-- Stock
-- Un article est soit acheté par DGS, soit fourni par un client (client_id) : ce dernier est
-- suivi à part, sans valeur pour DGS. Le stock se trouve au dépôt central, sur un chantier,
-- ou chez une personne (dotation du jour à un chef d'équipe, à un technicien…).
-- ---------------------------------------------------------------------------
create table public.articles (
  id           uuid primary key default gen_random_uuid(),
  pays         text references public.pays(code),
  code         text not null check (trim(code) <> ''),
  designation  text not null check (trim(designation) <> ''),
  categorie    text,
  unite        text not null check (trim(unite) <> ''),
  client_id    uuid references public.tiers(id) on delete restrict,       -- vide = acheté par DGS
  seuil_alerte numeric(14,3) not null default 0 check (seuil_alerte >= 0),
  actif        boolean not null default true,
  cree_le      timestamptz not null default now()
);
create unique index articles_code_unique on public.articles (pays, lower(trim(code)));

create table public.mouvements_stock (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  article_id      uuid not null references public.articles(id) on delete restrict,
  type            text not null check (type in ('Entrée','Dotation','Retour','Transfert','Utilisation','Inventaire')),
  lieu_id         uuid references public.chantiers(id) on delete restrict,  -- stock d'un chantier
  detenteur_id    uuid references public.profils(id) on delete restrict,   -- stock détenu par une personne
  quantite        numeric(14,3) not null check (quantite <> 0),             -- + entre, − sort de cet endroit
  prix_unitaire   numeric(14,0) not null default 0 check (prix_unitaire >= 0),
  valeur          numeric(16,0) not null default 0,
  chantier_id     uuid references public.chantiers(id) on delete restrict,  -- chantier où le matériel est utilisé
  bon_commande_id uuid references public.bons_commande(id) on delete set null,
  fournisseur     text,
  motif           text,
  groupe          uuid,                                                     -- les deux lignes d'un déplacement
  le              timestamptz not null default now(),
  saisi_par       uuid references public.profils(id) default auth.uid(),
  check (lieu_id is null or detenteur_id is null)                            -- ni l'un ni l'autre = dépôt central
);
create index on public.mouvements_stock (article_id);
create index on public.mouvements_stock (lieu_id);
create index on public.mouvements_stock (detenteur_id);
create index on public.mouvements_stock (chantier_id);

-- Coût moyen pondéré d'un article (entrées du pays ; 0 pour le matériel fourni par un client).
create or replace function public.cmp_article(p_article uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(round(sum(quantite * prix_unitaire) / nullif(sum(quantite), 0)), 0)
  from mouvements_stock where article_id = p_article and type = 'Entrée'
$$;

create or replace function public.quantite_en_stock(p_article uuid, p_lieu uuid, p_detenteur uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(quantite), 0) from mouvements_stock
  where article_id = p_article and lieu_id is not distinct from p_lieu and detenteur_id is not distinct from p_detenteur
$$;

create or replace function public.lieu_stock(p_lieu uuid, p_detenteur uuid default null)
returns text language sql stable security definer set search_path = public as $$
  select case when p_detenteur is not null then 'chez ' || (select nom from profils where id = p_detenteur)
              when p_lieu is null then 'au dépôt central'
              else 'sur le chantier ' || (select code from chantiers where id = p_lieu) end
$$;

create or replace function public.verifier_lieu(p_lieu uuid, p_detenteur uuid default null)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_lieu is not null and p_detenteur is not null then raise exception 'Choisissez un chantier ou une personne, pas les deux.'; end if;
  if p_lieu is not null and public.pays_de_chantier(p_lieu) is distinct from public.pays_courant() then
    raise exception 'Chantier introuvable.';
  end if;
  if p_detenteur is not null and not exists (select 1 from profils where id = p_detenteur and actif
                                             and (pays = public.pays_courant() or public.acces_groupe(id))) then
    raise exception 'Personne introuvable.';
  end if;
end $$;

create or replace function public.verifier_article(p_article uuid)
returns articles language plpgsql stable security definer set search_path = public as $$
declare a articles;
begin
  select * into a from articles where id = p_article and pays = public.pays_courant();
  if a.id is null then raise exception 'Article introuvable.'; end if;
  return a;
end $$;

-- Entrée en stock : réception d'un achat (avec ou sans bon de commande) ou matériel remis par le client.
create or replace function public.entree_stock(p_article uuid, p_lieu uuid, p_quantite numeric, p_prix numeric,
                                               p_bon_commande uuid default null, p_fournisseur text default null, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a articles; v_prix numeric; v_fournisseur text;
begin
  if not public.a_droit('stock.gerer') then raise exception 'Vous n''avez pas le droit de gérer le stock.'; end if;
  a := public.verifier_article(p_article);
  perform public.verifier_lieu(p_lieu);
  if coalesce(p_quantite, 0) <= 0 then raise exception 'La quantité reçue doit être positive.'; end if;
  if coalesce(p_prix, 0) < 0 then raise exception 'Le prix unitaire ne peut pas être négatif.'; end if;
  if a.client_id is not null then
    if p_bon_commande is not null then raise exception 'Le matériel fourni par le client ne passe pas par un bon de commande.'; end if;
    v_prix := 0;
    v_fournisseur := (select nom from tiers where id = a.client_id);
  else
    v_prix := coalesce(p_prix, 0);
    v_fournisseur := nullif(trim(p_fournisseur), '');
  end if;
  if p_bon_commande is not null and not exists (select 1 from bons_commande b where b.id = p_bon_commande and b.statut = 'Validé'
                                                and public.pays_de_chantier(b.chantier_id) = public.pays_courant()) then
    raise exception 'Seul un bon de commande validé peut être réceptionné.';
  end if;
  insert into mouvements_stock (article_id, type, lieu_id, quantite, prix_unitaire, valeur, bon_commande_id, fournisseur, motif)
  values (p_article, 'Entrée', p_lieu, p_quantite, v_prix, round(p_quantite * v_prix), p_bon_commande, v_fournisseur, nullif(trim(p_motif), ''));
end $$;

-- Déplacement entre deux endroits : dotation (vers une personne), retour (d'une personne vers le dépôt
-- ou un chantier), ou transfert (dépôt ↔ chantier, personne ↔ personne…).
create or replace function public.deplacer_stock(p_article uuid, p_de_lieu uuid, p_de_detenteur uuid,
                                                 p_vers_lieu uuid, p_vers_detenteur uuid, p_quantite numeric, p_motif text default null)
returns text language plpgsql security definer set search_path = public as $$
declare a articles; v_dispo numeric; v_groupe uuid := gen_random_uuid(); v_cmp numeric; v_type text;
begin
  if not public.a_droit('stock.gerer') then raise exception 'Vous n''avez pas le droit de gérer le stock.'; end if;
  a := public.verifier_article(p_article);
  perform public.verifier_lieu(p_de_lieu, p_de_detenteur);
  perform public.verifier_lieu(p_vers_lieu, p_vers_detenteur);
  if p_de_lieu is not distinct from p_vers_lieu and p_de_detenteur is not distinct from p_vers_detenteur then
    raise exception 'Choisissez deux endroits différents.';
  end if;
  if coalesce(p_quantite, 0) <= 0 then raise exception 'La quantité doit être positive.'; end if;
  v_type := case when p_vers_detenteur is not null and p_de_detenteur is null then 'Dotation'
                 when p_de_detenteur is not null and p_vers_detenteur is null then 'Retour'
                 else 'Transfert' end;
  perform pg_advisory_xact_lock(hashtext(p_article::text));
  v_dispo := public.quantite_en_stock(p_article, p_de_lieu, p_de_detenteur);
  if v_dispo < p_quantite then
    raise exception 'Stock insuffisant % : % % disponibles.', public.lieu_stock(p_de_lieu, p_de_detenteur), v_dispo, a.unite;
  end if;
  v_cmp := public.cmp_article(p_article);
  insert into mouvements_stock (article_id, type, lieu_id, detenteur_id, quantite, prix_unitaire, valeur, motif, groupe) values
    (p_article, v_type, p_de_lieu, p_de_detenteur, -p_quantite, v_cmp, -round(p_quantite * v_cmp), nullif(trim(p_motif), ''), v_groupe),
    (p_article, v_type, p_vers_lieu, p_vers_detenteur, p_quantite, v_cmp, round(p_quantite * v_cmp), nullif(trim(p_motif), ''), v_groupe);
  return v_type;
end $$;

-- Utilisation (matériel posé, consommé) : imputée à un chantier. La personne qui détient le matériel
-- déclare elle-même ce qu'elle a utilisé ; le gestionnaire peut le faire pour tout endroit.
create or replace function public.utiliser_stock(p_article uuid, p_lieu uuid, p_detenteur uuid, p_quantite numeric,
                                                 p_chantier uuid, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a articles; v_dispo numeric; v_cmp numeric;
begin
  if not (public.a_droit('stock.gerer') or coalesce(p_detenteur = auth.uid() and p_lieu is null, false)) then
    raise exception 'Vous ne pouvez déclarer que l''utilisation du matériel que vous détenez.';
  end if;
  a := public.verifier_article(p_article);
  perform public.verifier_lieu(p_lieu, p_detenteur);
  perform public.verifier_lieu(p_chantier);
  if coalesce(p_quantite, 0) <= 0 then raise exception 'La quantité utilisée doit être positive.'; end if;
  if p_chantier is null then raise exception 'Indiquez le chantier où le matériel est utilisé.'; end if;
  if p_lieu is not null and p_lieu <> p_chantier then raise exception 'Le stock d''un chantier ne sert qu''à ce chantier : faites un transfert.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_article::text));
  v_dispo := public.quantite_en_stock(p_article, p_lieu, p_detenteur);
  if v_dispo < p_quantite then
    raise exception 'Stock insuffisant % : % % disponibles.', public.lieu_stock(p_lieu, p_detenteur), v_dispo, a.unite;
  end if;
  v_cmp := public.cmp_article(p_article);
  insert into mouvements_stock (article_id, type, lieu_id, detenteur_id, quantite, prix_unitaire, valeur, chantier_id, motif)
  values (p_article, 'Utilisation', p_lieu, p_detenteur, -p_quantite, v_cmp, -round(p_quantite * v_cmp), p_chantier, nullif(trim(p_motif), ''));
end $$;

-- Inventaire : la quantité comptée remplace la quantité théorique (l'écart est tracé).
create or replace function public.inventaire_stock(p_article uuid, p_lieu uuid, p_detenteur uuid, p_compte numeric, p_motif text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_ecart numeric;
begin
  if not public.a_droit('stock.gerer') then raise exception 'Vous n''avez pas le droit de gérer le stock.'; end if;
  perform public.verifier_article(p_article);
  perform public.verifier_lieu(p_lieu, p_detenteur);
  if p_compte is null or p_compte < 0 then raise exception 'Indiquez la quantité comptée.'; end if;
  perform pg_advisory_xact_lock(hashtext(p_article::text));
  v_ecart := p_compte - public.quantite_en_stock(p_article, p_lieu, p_detenteur);
  if v_ecart <> 0 then
    insert into mouvements_stock (article_id, type, lieu_id, detenteur_id, quantite, prix_unitaire, valeur, motif)
    values (p_article, 'Inventaire', p_lieu, p_detenteur, v_ecart, public.cmp_article(p_article), round(v_ecart * public.cmp_article(p_article)),
            coalesce(nullif(trim(p_motif), ''), 'Écart d''inventaire'));
  end if;
  return v_ecart;
end $$;

-- État du stock par article et par endroit (respecte les droits de lecture).
create or replace function public.etat_stock()
returns table (article_id uuid, code text, designation text, categorie text, unite text, client_id uuid, seuil_alerte numeric,
               lieu_id uuid, detenteur_id uuid, quantite numeric, cmp numeric, valeur numeric)
language sql stable set search_path = public as $$
  select a.id, a.code, a.designation, a.categorie, a.unite, a.client_id, a.seuil_alerte, m.lieu_id, m.detenteur_id,
         sum(m.quantite), public.cmp_article(a.id), round(sum(m.quantite) * public.cmp_article(a.id))
  from articles a join mouvements_stock m on m.article_id = a.id
  group by a.id, m.lieu_id, m.detenteur_id
  having sum(m.quantite) <> 0
  order by a.code
$$;

-- Matériel utilisé par chantier.
create or replace function public.consommation_chantier(p_chantier uuid)
returns table (article_id uuid, code text, designation text, unite text, client_id uuid, quantite numeric, valeur numeric)
language sql stable set search_path = public as $$
  select a.id, a.code, a.designation, a.unite, a.client_id, -sum(m.quantite), -sum(m.valeur)
  from mouvements_stock m join articles a on a.id = m.article_id
  where m.type = 'Utilisation' and m.chantier_id = p_chantier
  group by a.id, a.code, a.designation, a.unite, a.client_id
  order by a.code
$$;

-- ---------------------------------------------------------------------------
-- Matériel de travail et matériel roulant
-- ---------------------------------------------------------------------------
create table public.equipements (
  id                 uuid primary key default gen_random_uuid(),
  pays               text references public.pays(code),
  code               text not null check (trim(code) <> ''),          -- n° d'inventaire
  categorie          text not null check (categorie in ('Matériel de travail','Matériel roulant')),
  type               text not null check (trim(type) <> ''),          -- groupe électrogène, pick-up, camion-grue…
  designation        text not null check (trim(designation) <> ''),
  marque             text,
  modele             text,
  numero_serie       text,
  immatriculation    text,
  annee              int check (annee between 1950 and 2100),
  date_acquisition   date,
  valeur_acquisition numeric(14,0) check (valeur_acquisition >= 0),
  compteur           int check (compteur >= 0),                       -- km (véhicules) ou heures (engins)
  unite_compteur     text not null default 'km' check (unite_compteur in ('km','h')),
  etat               text not null default 'Bon' check (etat in ('Bon','À réparer','En panne','Réformé')),
  chantier_id        uuid references public.chantiers(id) on delete restrict,  -- vide = au dépôt / au bureau
  responsable_id     uuid references public.profils(id) on delete set null,     -- conducteur, gardien
  notes              text,
  cree_le            timestamptz not null default now()
);
create unique index equipements_code_unique on public.equipements (pays, lower(trim(code)));
create unique index equipements_immat_unique on public.equipements (pays, upper(replace(immatriculation, ' ', ''))) where immatriculation is not null;

-- Historique des affectations et des changements d'état.
create table public.equipement_affectations (
  id             uuid primary key default gen_random_uuid(),
  pays           text references public.pays(code),
  equipement_id  uuid not null references public.equipements(id) on delete cascade,
  chantier_id    uuid references public.chantiers(id) on delete set null,
  responsable_id uuid references public.profils(id) on delete set null,
  etat           text,
  compteur       int,
  motif          text,
  le             timestamptz not null default now(),
  saisi_par      uuid references public.profils(id) default auth.uid()
);
create index on public.equipement_affectations (equipement_id);

create table public.entretiens (
  id             uuid primary key default gen_random_uuid(),
  pays           text references public.pays(code),
  equipement_id  uuid not null references public.equipements(id) on delete cascade,
  le             date not null default current_date,
  type           text not null check (type in ('Entretien','Réparation','Pneumatiques','Visite technique','Autre')),
  description    text not null check (trim(description) <> ''),
  compteur       int check (compteur >= 0),
  cout           numeric(14,0) not null default 0 check (cout >= 0),
  prestataire    text,
  chantier_id    uuid references public.chantiers(id) on delete set null,
  prochain_le    date,
  prochain_compteur int,
  saisi_par      uuid references public.profils(id) default auth.uid(),
  cree_le        timestamptz not null default now()
);
create index on public.entretiens (equipement_id);

create table public.pleins (
  id             uuid primary key default gen_random_uuid(),
  pays           text references public.pays(code),
  equipement_id  uuid not null references public.equipements(id) on delete cascade,
  le             date not null default current_date,
  litres         numeric(8,2) not null check (litres > 0),
  montant        numeric(14,0) not null check (montant >= 0),
  compteur       int check (compteur >= 0),
  chantier_id    uuid references public.chantiers(id) on delete set null,
  saisi_par      uuid references public.profils(id) default auth.uid(),
  cree_le        timestamptz not null default now()
);
create index on public.pleins (equipement_id);

-- Le pays des lignes rattachées est celui de l'équipement (« a_pays_equipement » passe avant « garde_pays »).
create or replace function public.pays_equipement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select pays into new.pays from equipements where id = new.equipement_id;
  return new;
end $$;
-- Le compteur de l'équipement suit le plus grand relevé saisi.
create or replace function public.maj_compteur()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.compteur is not null then
    update equipements set compteur = greatest(coalesce(compteur, 0), new.compteur) where id = new.equipement_id;
  end if;
  return new;
end $$;

-- Affectation (dépôt, chantier, responsable) et état : tracés dans l'historique.
create or replace function public.affecter_equipement(p_id uuid, p_chantier uuid, p_responsable uuid, p_etat text,
                                                      p_compteur int default null, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare e equipements;
begin
  if not public.a_droit('mat.gerer') then raise exception 'Vous n''avez pas le droit de gérer le matériel.'; end if;
  select * into e from equipements where id = p_id and pays = public.pays_courant() for update;
  if e.id is null then raise exception 'Matériel introuvable.'; end if;
  perform public.verifier_lieu(p_chantier);
  if p_responsable is not null and public.pays_de_profil(p_responsable) is distinct from public.pays_courant()
     and not public.acces_groupe(p_responsable) then
    raise exception 'Responsable introuvable.';
  end if;
  if p_etat is not null and p_etat not in ('Bon','À réparer','En panne','Réformé') then raise exception 'État inconnu.'; end if;
  if coalesce(p_etat, e.etat) = 'Réformé' and p_chantier is not null then raise exception 'Un matériel réformé ne s''affecte plus.'; end if;
  perform set_config('dgs.affectation', 'on', true);
  update equipements set chantier_id = p_chantier, responsable_id = p_responsable, etat = coalesce(p_etat, etat),
         compteur = case when p_compteur is null then compteur else greatest(coalesce(compteur, 0), p_compteur) end
  where id = p_id;
  perform set_config('dgs.affectation', 'off', true);
  insert into equipement_affectations (equipement_id, chantier_id, responsable_id, etat, compteur, motif)
  values (p_id, p_chantier, p_responsable, coalesce(p_etat, e.etat), p_compteur, nullif(trim(p_motif), ''));
end $$;

-- Affectation et état ne changent que par la fonction ci-dessus (pour garder l'historique).
create or replace function public.garde_affectation()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or current_setting('dgs.affectation', true) = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.chantier_id is not null or new.responsable_id is not null or new.etat <> 'Bon' then
      raise exception 'Créez le matériel au dépôt, puis affectez-le.';
    end if;
  elsif (new.chantier_id, new.responsable_id, new.etat) is distinct from (old.chantier_id, old.responsable_id, old.etat) then
    raise exception 'Utilisez « Affecter / changer l''état » pour garder l''historique.';
  end if;
  return new;
end $$;
create trigger garde_affectation before insert or update on public.equipements
for each row execute function public.garde_affectation();

-- Documents du matériel (assurance, visite technique…) : dans les justificatifs, avec leur date de validité.
alter table public.justificatifs drop constraint justificatifs_objet_check,
  add constraint justificatifs_objet_check check (objet in ('pv','bon_commande','facture_client','facture_fournisseur','proforma','depense','tiers','bc_client','equipement'));

create or replace function public.peut_justifier(p_objet text)
returns boolean language sql stable security definer set search_path = public as $$
  select case p_objet
    when 'pv' then public.a_droit('pv.initier') or public.a_droit('doc.annuler')
    when 'bon_commande' then public.a_droit('bc.initier') or public.a_droit('bc.valider')
    when 'facture_client' then public.a_droit('fc.emettre')
    when 'facture_fournisseur' then public.a_droit('ff.enregistrer')
    when 'proforma' then public.a_droit('pf.initier') or public.a_droit('pf.valider')
    when 'depense' then public.a_droit('dep.demander') or public.a_droit('dep.payer')
    when 'tiers' then public.a_droit('tiers.gerer')
    when 'bc_client' then public.a_droit('chantier.creer')
    when 'equipement' then public.a_droit('mat.gerer')
    else false end
$$;

create or replace function public.controle_document_equipement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.objet = 'equipement' then
    if coalesce(trim(new.type_document), '') = '' then raise exception 'Précisez le type de document.'; end if;
    if new.type_document in ('Assurance','Visite technique','Vignette / taxe','Autorisation de transport') and new.valide_jusquau is null then
      raise exception 'Indiquez jusqu''à quand ce document est valable.';
    end if;
  end if;
  return new;
end $$;
create trigger controle_document_equipement before insert on public.justificatifs
for each row execute function public.controle_document_equipement();

drop policy lecture on public.justificatifs;
create policy lecture on public.justificatifs for select to authenticated
  using (public.peut_justifier(objet) or public.a_droit('fin.voir') or (objet = 'tiers' and public.voit_tiers())
         or (objet = 'equipement' and public.est_global()));

-- Alertes : stock sous le seuil, documents expirés ou expirant sous 30 jours, entretiens dus.
create or replace function public.alertes_logistique()
returns table (genre text, objet_id uuid, libelle text, detail text, echeance date)
language sql stable set search_path = public as $$
  select 'Stock', a.id, a.code || ' · ' || a.designation,
         'Reste ' || trim(to_char(coalesce(sum(m.quantite), 0), 'FM999G999G990D###')) || ' ' || a.unite || ' (seuil ' || trim(to_char(a.seuil_alerte, 'FM999G999G990D###')) || ')',
         null::date
  from articles a left join mouvements_stock m on m.article_id = a.id
  where a.actif and a.seuil_alerte > 0
  group by a.id having coalesce(sum(m.quantite), 0) <= a.seuil_alerte
  union all
  select 'Document', e.id, e.code || ' · ' || e.designation, d.type_document, d.fin
  from equipements e
  join lateral (select type_document, max(valide_jusquau) as fin from justificatifs
                where objet = 'equipement' and objet_id = e.id and valide_jusquau is not null group by type_document) d on true
  where e.etat <> 'Réformé' and d.fin < current_date + 30
  union all
  select 'Entretien', e.id, e.code || ' · ' || e.designation,
         case when n.prochain_compteur is not null and e.compteur >= n.prochain_compteur
              then 'Entretien dû à ' || n.prochain_compteur || ' ' || e.unite_compteur
              else 'Entretien prévu' end,
         n.prochain_le
  from equipements e
  join lateral (select prochain_le, prochain_compteur from entretiens where equipement_id = e.id order by le desc, cree_le desc limit 1) n on true
  where e.etat <> 'Réformé'
    and ((n.prochain_le is not null and n.prochain_le < current_date + 15)
         or (n.prochain_compteur is not null and e.compteur >= n.prochain_compteur - 500))
  order by 1, 5 nulls first
$$;

-- ---------------------------------------------------------------------------
-- Pays, droits d'accès
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['articles','mouvements_stock','equipements','equipement_affectations','entretiens','pleins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create trigger garde_pays before insert or update on public.%I for each row execute function public.garde_pays()', t);
    execute format('create policy pays on public.%I as restrictive for all to authenticated using (pays = public.pays_courant()) with check (pays = public.pays_courant())', t);
  end loop;
  foreach t in array array['equipement_affectations','entretiens','pleins'] loop
    execute format('create trigger a_pays_equipement before insert or update on public.%I for each row execute function public.pays_equipement()', t);
  end loop;
  foreach t in array array['entretiens','pleins'] loop
    execute format('create trigger maj_compteur after insert on public.%I for each row execute function public.maj_compteur()', t);
  end loop;
end $$;

create policy lecture on public.articles for select to authenticated using (true);
create policy gestion on public.articles for insert to authenticated with check (public.a_droit('stock.gerer'));
create policy modification on public.articles for update to authenticated using (public.a_droit('stock.gerer')) with check (public.a_droit('stock.gerer'));

-- Les mouvements ne s'écrivent que par les fonctions (contrôle du stock disponible).
create policy lecture on public.mouvements_stock for select to authenticated
  using (public.voit_logistique() or lieu_id in (select public.mes_chantiers()) or chantier_id in (select public.mes_chantiers())
         or detenteur_id in (select public.equipe_de(auth.uid())));

create policy lecture on public.equipements for select to authenticated
  using (public.voit_logistique(chantier_id) or responsable_id = auth.uid());
create policy creation on public.equipements for insert to authenticated with check (public.a_droit('mat.gerer'));
create policy modification on public.equipements for update to authenticated using (public.a_droit('mat.gerer')) with check (public.a_droit('mat.gerer'));

create policy lecture on public.equipement_affectations for select to authenticated
  using (exists (select 1 from equipements e where e.id = equipement_id));

create policy lecture on public.entretiens for select to authenticated
  using (exists (select 1 from equipements e where e.id = equipement_id));
create policy saisie on public.entretiens for insert to authenticated with check (public.a_droit('mat.gerer'));

-- Les pleins : par le gestionnaire du matériel, ou par le conducteur responsable du véhicule.
create policy lecture on public.pleins for select to authenticated
  using (exists (select 1 from equipements e where e.id = equipement_id));
create policy saisie on public.pleins for insert to authenticated
  with check (public.a_droit('mat.gerer')
              or exists (select 1 from equipements e where e.id = equipement_id and e.responsable_id = auth.uid()));

grant select on public.articles, public.mouvements_stock, public.equipements, public.equipement_affectations,
                public.entretiens, public.pleins to authenticated;
grant insert, update on public.articles, public.equipements to authenticated;
grant insert on public.entretiens, public.pleins to authenticated;
grant execute on all functions in schema public to authenticated;

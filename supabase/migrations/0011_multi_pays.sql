-- DGS Gestion : une seule application pour tous les pays.
-- Chaque pays est indépendant : ses chantiers, ses finances, son personnel, sa paie, ses achats.
-- À la connexion, l'agent choisit son pays ; ses identifiants ne fonctionnent que dans le pays
-- où son compte a été créé. Le PDG et le DO ont l'accès groupe (tous les pays) ; ils peuvent
-- l'accorder à qui ils jugent nécessaire.
-- Les données existantes sont rattachées au Mali.

-- ---------------------------------------------------------------------------
-- Pays
-- ---------------------------------------------------------------------------
create table public.pays (
  code   text primary key check (code ~ '^[A-Z]{2}$'),
  nom    text not null unique,
  ville  text,
  devise text not null default 'FCFA',
  ordre  int not null default 0
);
insert into public.pays (code, nom, ville, ordre) values
  ('ML', 'Mali',  'Bamako',  1),
  ('BJ', 'Bénin', 'Cotonou', 2);

alter table public.pays enable row level security;
-- La liste des pays est lue par l'écran de connexion, avant toute session.
create policy lecture on public.pays for select to anon, authenticated using (true);
grant select on public.pays to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Profils : pays d'origine, accès groupe, pays en cours
-- ---------------------------------------------------------------------------
alter table public.profils
  add column pays         text references public.pays(code),
  add column acces_groupe boolean not null default false,
  add column pays_actif   text references public.pays(code);
update public.profils set pays = 'ML';
alter table public.profils alter column pays set not null;
create index on public.profils (pays);

create or replace function public.acces_groupe(p_profil uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select actif and (poste in ('pdg','do') or acces_groupe) from profils where id = p_profil), false)
$$;

-- Pays dans lequel l'utilisateur connecté travaille en ce moment.
create or replace function public.pays_courant()
returns text language sql stable security definer set search_path = public as $$
  select case when p.pays_actif is not null and public.acces_groupe(p.id) then p.pays_actif else p.pays end
  from profils p where p.id = auth.uid()
$$;

create or replace function public.pays_par_defaut()
returns text language sql stable security definer set search_path = public as $$
  select code from pays order by ordre, code limit 1
$$;

create or replace function public.pays_de_profil(p_profil uuid)
returns text language sql stable security definer set search_path = public as $$
  select pays from profils where id = p_profil
$$;

-- Choix du pays à la connexion (et changement de pays pour l'accès groupe).
create or replace function public.choisir_pays(p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare p profils;
begin
  if not exists (select 1 from pays where code = p_code) then raise exception 'Pays inconnu.'; end if;
  select * into p from profils where id = auth.uid();
  if not found or not p.actif then raise exception 'Compte inactif.'; end if;
  if p.pays <> p_code and not public.acces_groupe(p.id) then
    raise exception 'Ces identifiants ne sont pas valables pour ce pays.';
  end if;
  update profils set pays_actif = case when p.pays = p_code then null else p_code end where id = p.id;
  return p_code;
end $$;

-- Le PDG et le DO accordent ou retirent l'accès groupe.
create or replace function public.definir_acces_groupe(p_profil uuid, p_oui boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(public.mon_poste()::text, '') not in ('pdg','do') then
    raise exception 'Seuls le PDG et le DO accordent l''accès groupe.';
  end if;
  if public.poste_de(p_profil) in ('pdg','do') and not p_oui then
    raise exception 'Le PDG et le DO gardent toujours l''accès groupe.';
  end if;
  update profils set acces_groupe = p_oui, pays_actif = case when p_oui then pays_actif end where id = p_profil;
  if not found then raise exception 'Employé introuvable.'; end if;
end $$;

-- Le pays d'origine d'un compte ne change pas ; l'accès groupe passe par definir_acces_groupe.
create or replace function public.controle_profil_pays()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if new.pays is distinct from old.pays then
    raise exception 'Le pays d''un compte ne peut pas être changé : créez un compte dans l''autre pays.';
  end if;
  if new.acces_groupe is distinct from old.acces_groupe and coalesce(public.mon_poste()::text, '') not in ('pdg','do') then
    raise exception 'Seuls le PDG et le DO accordent l''accès groupe.';
  end if;
  return new;
end $$;
create trigger controle_profil_pays before update on public.profils
for each row execute function public.controle_profil_pays();

-- Un nouveau compte appartient au pays indiqué à sa création (sinon le premier pays).
create or replace function public.creer_profil()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_premier boolean; v_pays text;
begin
  select not exists (select 1 from profils) into v_premier;
  select code into v_pays from pays where code = new.raw_user_meta_data->>'pays';
  insert into profils (id, nom, email, poste, actif, contrat, pays)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'nom',''), split_part(new.email,'@',1)),
          new.email,
          case when v_premier then 'pdg'::poste else 'tech'::poste end,
          v_premier,
          case when v_premier then 'Mandataire' else 'CDD' end,
          coalesce(v_pays, public.pays_par_defaut()));
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Colonne « pays » sur les données de chaque filiale
-- ---------------------------------------------------------------------------
-- Remplit le pays à l'insertion et interdit d'écrire dans un autre pays que le sien,
-- y compris au travers des fonctions (validations, paiements…).
create or replace function public.garde_pays()
returns trigger language plpgsql security definer set search_path = public as $$
declare v text := public.pays_courant();
begin
  if tg_op = 'INSERT' then
    if new.pays is null then new.pays := coalesce(v, public.pays_par_defaut()); end if;
    if auth.uid() is not null and new.pays is distinct from v then
      raise exception 'Cette donnée appartient à un autre pays.';
    end if;
  else
    if new.pays is distinct from old.pays then raise exception 'Le pays d''une donnée ne peut pas être changé.'; end if;
    if auth.uid() is not null and old.pays is distinct from v then
      raise exception 'Cette donnée appartient à un autre pays.';
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['chantiers','journal','parametres','depenses','factures_clients','factures_fournisseurs',
                           'frais_generaux','paies','lignes_paie','demandes_achat','bons_commande','proformas','pv_execution']
  loop
    execute format('alter table public.%I add column pays text references public.pays(code)', t);
    execute format('update public.%I set pays = ''ML''', t);
    execute format('alter table public.%I alter column pays set not null', t);
    execute format('create index on public.%I (pays)', t);
    execute format('create trigger garde_pays before insert or update on public.%I for each row execute function public.garde_pays()', t);
    execute format('create policy pays on public.%I as restrictive for all to authenticated using (pays = public.pays_courant()) with check (pays = public.pays_courant())', t);
  end loop;
end $$;

create or replace function public.pays_de_chantier(p_chantier uuid)
returns text language sql stable security definer set search_path = public as $$
  select pays from chantiers where id = p_chantier
$$;

-- Tables rattachées à un chantier ou à une personne : même cloisonnement, par le parent.
create policy pays on public.taches as restrictive for all to authenticated
  using (public.pays_de_chantier(chantier_id) = public.pays_courant()) with check (public.pays_de_chantier(chantier_id) = public.pays_courant());
create policy pays on public.chantiers_finance as restrictive for all to authenticated
  using (public.pays_de_chantier(chantier_id) = public.pays_courant()) with check (public.pays_de_chantier(chantier_id) = public.pays_courant());
create policy pays on public.presences as restrictive for all to authenticated
  using (public.pays_de_profil(profil_id) = public.pays_courant()) with check (public.pays_de_profil(profil_id) = public.pays_courant());
create policy pays on public.remunerations as restrictive for all to authenticated
  using (public.pays_de_profil(profil_id) = public.pays_courant()) with check (public.pays_de_profil(profil_id) = public.pays_courant());
-- Les membres de l'accès groupe apparaissent dans chaque pays (direction du groupe).
create policy pays on public.profils as restrictive for all to authenticated
  using (pays = public.pays_courant() or public.acces_groupe(id) or id = auth.uid())
  with check (pays = public.pays_courant() or public.acces_groupe(id) or id = auth.uid());
create policy pays on public.droits_personne as restrictive for all to authenticated
  using (public.pays_de_profil(profil_id) = public.pays_courant() or public.acces_groupe(profil_id))
  with check (public.pays_de_profil(profil_id) = public.pays_courant() or public.acces_groupe(profil_id));

-- Numéros et codes uniques par pays (chaque filiale a sa propre numérotation).
alter table public.chantiers             drop constraint chantiers_code_key,                     add unique (pays, code);
alter table public.factures_clients      drop constraint factures_clients_numero_key,            add unique (pays, numero);
alter table public.factures_fournisseurs drop constraint factures_fournisseurs_fournisseur_numero_key, add unique (pays, fournisseur, numero);
alter table public.demandes_achat        drop constraint demandes_achat_numero_key,              add unique (pays, numero);
alter table public.bons_commande         drop constraint bons_commande_numero_key,               add unique (pays, numero);
alter table public.proformas             drop constraint proformas_numero_key,                   add unique (pays, numero);
alter table public.pv_execution          drop constraint pv_execution_numero_key,                add unique (pays, numero);

create or replace function public.numeroter_facture()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_annee text := to_char(new.date_emission, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext('factures_clients_' || new.pays || v_annee));
  select count(*) + 1 into v_n from factures_clients where pays = new.pays and numero like 'FAC-' || v_annee || '-%';
  new.numero := 'FAC-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  new.taux_tva := public.parametre('tva', new.pays);
  return new;
end $$;

create or replace function public.numeroter_achat()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pref text := case tg_table_name when 'demandes_achat' then 'DA' else 'BC' end;
        v_annee text := to_char(current_date, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || new.pays || v_annee));
  execute format('select count(*) + 1 from public.%I where pays = $2 and numero like $1', tg_table_name)
    into v_n using v_pref || '-' || v_annee || '-%', new.pays;
  new.numero := v_pref || '-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  return new;
end $$;

create or replace function public.numeroter_document()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pref text := case tg_table_name when 'proformas' then 'PF' else 'PV' end;
        v_annee text := to_char(current_date, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || new.pays || v_annee));
  execute format('select count(*) + 1 from public.%I where pays = $2 and numero like $1', tg_table_name)
    into v_n using v_pref || '-' || v_annee || '-%', new.pays;
  new.numero := v_pref || '-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Paramètres par pays (TVA, seuil de validation, retenue sociale…)
-- ---------------------------------------------------------------------------
alter table public.parametres drop constraint parametres_pkey, add primary key (pays, cle);
insert into public.parametres (pays, cle, valeur, libelle)
select 'BJ', cle, valeur, libelle from public.parametres where pays = 'ML';
update public.parametres set libelle = 'Retenue CNSS part salariale (%) — taux à confirmer' where pays = 'BJ' and cle = 'inps_salarie';

drop function if exists public.parametre(text);
create or replace function public.parametre(p_cle text, p_pays text default null)
returns numeric language sql stable security definer set search_path = public as $$
  select valeur from parametres where cle = p_cle and pays = coalesce(p_pays, public.pays_courant(), public.pays_par_defaut())
$$;

-- ---------------------------------------------------------------------------
-- Paie : un circuit par pays et par mois
-- ---------------------------------------------------------------------------
drop policy preparation on public.lignes_paie;
alter table public.lignes_paie drop constraint lignes_paie_mois_fkey;
alter table public.lignes_paie drop constraint lignes_paie_pkey;
alter table public.paies drop constraint paies_pkey, add primary key (pays, mois);
alter table public.lignes_paie add primary key (pays, mois, profil_id),
  add foreign key (pays, mois) references public.paies(pays, mois) on delete cascade;
create policy preparation on public.lignes_paie for all to authenticated
  using (public.a_droit('paie.preparer') and exists (select 1 from paies p where p.pays = lignes_paie.pays and p.mois = lignes_paie.mois and p.statut = 'En préparation'))
  with check (public.a_droit('paie.preparer') and exists (select 1 from paies p where p.pays = lignes_paie.pays and p.mois = lignes_paie.mois and p.statut = 'En préparation'));

create or replace function public.ouvrir_paie(p_mois date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('paie.preparer') then raise exception 'Vous n''avez pas le droit de préparer la paie.'; end if;
  insert into paies (mois, pays) values (date_trunc('month', p_mois)::date, public.pays_courant()) on conflict do nothing;
end $$;

create or replace function public.avancer_paie(p_mois date, p_statut text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actuel text; v_pays text := public.pays_courant();
begin
  select statut into v_actuel from paies where pays = v_pays and mois = date_trunc('month', p_mois)::date for update;
  if not found then raise exception 'Cette paie n''existe pas encore.'; end if;
  if (v_actuel = 'En préparation' and p_statut = 'Soumise' and public.a_droit('paie.preparer'))
     or (v_actuel = 'Soumise' and p_statut in ('Validée','En préparation') and public.a_droit('paie.valider'))
     or (v_actuel = 'Validée' and p_statut = 'Payée' and public.a_droit('paie.payer')) then
    update paies set statut = p_statut, maj_par = auth.uid(), maj_le = now() where pays = v_pays and mois = date_trunc('month', p_mois)::date;
  else
    raise exception 'Étape impossible : la paie est « % » et votre profil ne permet pas de la passer à « % ».', v_actuel, p_statut;
  end if;
end $$;

create or replace function public.bulletins(p_mois date)
returns table (profil_id uuid, nom text, poste public.poste, base numeric, primes numeric, absences int,
               retenue_absences numeric, brut numeric, inps numeric, avances numeric, net numeric)
language sql stable security definer set search_path = public as $$
  with m as (select date_trunc('month', p_mois)::date d),
  b as (
    select p.id, p.nom, p.poste, r.salaire_base base,
      coalesce(l.primes, 0) primes, coalesce(l.avances, 0) avances,
      (select count(*)::int from presences x, m where x.profil_id = p.id and x.statut = 'A'
         and x.jour >= m.d and x.jour < (m.d + interval '1 month')) abs
    from profils p join remunerations r on r.profil_id = p.id
    cross join m left join lignes_paie l on l.profil_id = p.id and l.mois = m.d and l.pays = p.pays
    where p.actif and r.salaire_base > 0 and p.pays = public.pays_courant()
      and (public.voit_paie() or p.id = auth.uid())
  ),
  c as (
    select *, round(base / public.parametre('jours_ouvres_mois') * abs) ret from b
  )
  select id, nom, poste, base, primes, abs, ret, greatest(base + primes - ret, 0),
         round(greatest(base + primes - ret, 0) * public.parametre('inps_salarie') / 100), avances,
         greatest(base + primes - ret, 0) - round(greatest(base + primes - ret, 0) * public.parametre('inps_salarie') / 100) - avances
  from c order by nom
$$;

-- ---------------------------------------------------------------------------
-- Périmètres et calculs limités au pays en cours
-- ---------------------------------------------------------------------------
create or replace function public.mes_chantiers()
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_poste public.poste := public.mon_poste(); v_pays text := public.pays_courant();
begin
  if v_poste is null then return; end if;
  if v_poste not in ('cp','ce','tech') then
    return query select id from chantiers where pays = v_pays;
  elsif v_poste = 'cp' then
    return query select id from chantiers where chef_projet_id = auth.uid() and pays = v_pays
                 union select t.chantier_id from taches t join chantiers c on c.id = t.chantier_id
                       where c.pays = v_pays and t.assigne_id in (select public.equipe_de(auth.uid()));
  else
    return query select distinct t.chantier_id from taches t join chantiers c on c.id = t.chantier_id
                 where c.pays = v_pays and t.assigne_id in (select public.equipe_de(auth.uid()));
  end if;
end $$;

create or replace function public.avancement_chantiers()
returns table (chantier_id uuid, avancement numeric, nb_taches int, nb_retard int)
language sql stable security definer set search_path = public as $$
  select c.id,
         coalesce(round(avg(t.avancement), 0), 0),
         count(t.id)::int,
         count(t.id) filter (where t.avancement < 100 and t.echeance < current_date)::int
  from chantiers c left join taches t on t.chantier_id = c.id
  where public.mon_poste() is not null and c.pays = public.pays_courant()
  group by c.id
$$;

create or replace function public.main_oeuvre_mensuelle(p_chantier uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(r.salaire_base / nullif((select count(*) from public.chantiers_de(p.id)), 0)), 0)
  from profils p join remunerations r on r.profil_id = p.id
  where p.actif and not public.poste_administratif(p.poste)
    and p.pays = public.pays_de_chantier(p_chantier)
    and p_chantier in (select public.chantiers_de(p.id))
$$;

create or replace function public.frais_generaux_du_mois(p_mois date)
returns table (source text, categorie text, libelle text, montant numeric)
language sql stable security definer set search_path = public as $$
  select * from (
    select 'Saisie'::text, categorie, libelle, montant from frais_generaux
      where pays = public.pays_courant() and mois = date_trunc('month', p_mois)::date
    union all
    select 'Dépense', 'Divers', objet, montant from depenses
      where pays = public.pays_courant() and chantier_id is null and statut in ('Validée','Payée')
        and date_trunc('month', date_depense) = date_trunc('month', p_mois)
    union all
    select 'Facture ' || numero, fournisseur, objet, montant_ht from factures_fournisseurs
      where pays = public.pays_courant() and chantier_id is null and statut in ('Validée','Payée')
        and date_trunc('month', date_reception) = date_trunc('month', p_mois)
    union all
    select 'Paie', 'Salaires', 'Salaires du personnel administratif (direction, RAF, RH, comptabilité…)',
      coalesce(sum(r.salaire_base), 0)
      from profils p join remunerations r on r.profil_id = p.id
      where p.actif and public.poste_administratif(p.poste) and p.pays = public.pays_courant()
  ) x
  where public.a_droit('fg.voir') or public.a_droit('fg.saisir')
$$;

create or replace function public.peut_saisir_presence(p_profil uuid, p_jour date)
returns boolean language sql stable security definer set search_path = public as $$
  select public.a_droit('pres.saisir')
     and public.pays_de_profil(p_profil) = public.pays_courant()
     and (public.est_global() or (p_jour = current_date and p_profil in (select public.equipe_de(auth.uid()))))
$$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

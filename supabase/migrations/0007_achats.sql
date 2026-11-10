-- DGS Bamako Gestion : circuit des achats.
-- 1. Le RLA initie une demande d'achat selon les besoins de chaque projet.
-- 2. Le RAF étudie la demande et initie le bon de commande (ou rejette la demande).
-- 3. Le bon de commande est validé uniquement par le Directeur des Opérations
--    (droit « bc.valider », que le DO peut accorder à quelqu'un d'autre s'il le décide).

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('da.demander', 'Achats', 'Initier une demande d''achat pour un projet', 24),
  ('bc.initier',  'Achats', 'Étudier les demandes d''achat et initier les bons de commande', 25),
  ('bc.valider',  'Achats', 'Valider les bons de commande', 26)
on conflict do nothing;

insert into public.permissions_poste (poste, cle) values
  ('rla', 'da.demander'),
  ('raf', 'bc.initier'),
  ('do',  'bc.valider')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Demandes d'achat (toujours rattachées à un projet)
-- ---------------------------------------------------------------------------
create table public.demandes_achat (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  chantier_id   uuid not null references public.chantiers(id) on delete restrict,
  objet         text not null,
  details       text,
  montant_estime numeric(14,0) check (montant_estime > 0),
  besoin_le     date,
  statut        text not null default 'Soumise' check (statut in ('Soumise','Commandée','Rejetée')),
  motif_rejet   text,
  demandeur_id  uuid not null references public.profils(id) default auth.uid(),
  traite_par    uuid references public.profils(id),
  traite_le     timestamptz,
  cree_le       timestamptz not null default now()
);
create index on public.demandes_achat (chantier_id);

-- ---------------------------------------------------------------------------
-- Bons de commande (initiés par le RAF à partir d'une demande)
-- ---------------------------------------------------------------------------
create table public.bons_commande (
  id            uuid primary key default gen_random_uuid(),
  numero        text unique,
  demande_id    uuid not null references public.demandes_achat(id) on delete restrict,
  chantier_id   uuid not null references public.chantiers(id) on delete restrict,
  fournisseur   text not null,
  objet         text not null,
  montant_ht    numeric(14,0) not null check (montant_ht > 0),
  taux_tva      numeric(5,2) not null default 18 check (taux_tva >= 0 and taux_tva <= 100),
  montant_tva   numeric(14,0) generated always as (round(montant_ht * taux_tva / 100)) stored,
  montant_ttc   numeric(14,0) generated always as (montant_ht + round(montant_ht * taux_tva / 100)) stored,
  livraison_le  date,
  statut        text not null default 'À valider' check (statut in ('À valider','Validé','Rejeté')),
  motif_rejet   text,
  initie_par    uuid not null references public.profils(id) default auth.uid(),
  valide_par    uuid references public.profils(id),
  valide_le     timestamptz,
  cree_le       timestamptz not null default now()
);
create index on public.bons_commande (demande_id);
-- Une demande n'a qu'un seul bon de commande en cours (hors bons rejetés).
create unique index bons_commande_un_actif on public.bons_commande (demande_id) where statut <> 'Rejeté';

-- Numérotation DA-AAAA-NNN et BC-AAAA-NNN.
create or replace function public.numeroter_achat()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_pref text := case tg_table_name when 'demandes_achat' then 'DA' else 'BC' end;
        v_annee text := to_char(current_date, 'YYYY'); v_n int;
begin
  perform pg_advisory_xact_lock(hashtext(tg_table_name || v_annee));
  execute format('select count(*) + 1 from public.%I where numero like $1', tg_table_name)
    into v_n using v_pref || '-' || v_annee || '-%';
  new.numero := v_pref || '-' || v_annee || '-' || lpad(v_n::text, 3, '0');
  return new;
end $$;
create trigger numeroter before insert on public.demandes_achat for each row execute function public.numeroter_achat();
create trigger numeroter before insert on public.bons_commande  for each row execute function public.numeroter_achat();

-- ---------------------------------------------------------------------------
-- Règles d'accès
-- ---------------------------------------------------------------------------
create or replace function public.voit_achats(p_chantier uuid, p_demandeur uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_demandeur = auth.uid()
      or public.a_droit('bc.initier') or public.a_droit('bc.valider')
      or ((public.a_droit('da.demander') or public.a_droit('fin.voir')) and p_chantier in (select public.mes_chantiers()))
$$;

alter table public.demandes_achat enable row level security;
alter table public.bons_commande  enable row level security;
create policy lecture on public.demandes_achat for select to authenticated
  using (public.voit_achats(chantier_id, demandeur_id));
create policy lecture on public.bons_commande for select to authenticated
  using (public.voit_achats(chantier_id, (select d.demandeur_id from public.demandes_achat d where d.id = demande_id)));
-- Seule la création d'une demande passe par la table ; tout le reste passe par les fonctions ci-dessous.
create policy creation on public.demandes_achat for insert to authenticated
  with check (public.a_droit('da.demander') and demandeur_id = auth.uid() and statut = 'Soumise'
              and traite_par is null and chantier_id in (select public.mes_chantiers()));

-- Le RAF rejette une demande (avec motif).
create or replace function public.rejeter_demande_achat(p_id uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.a_droit('bc.initier') then raise exception 'Vous n''avez pas le droit d''étudier les demandes d''achat.'; end if;
  if coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du rejet.'; end if;
  update demandes_achat set statut = 'Rejetée', motif_rejet = trim(p_motif), traite_par = auth.uid(), traite_le = now()
  where id = p_id and statut = 'Soumise';
  if not found then raise exception 'Seule une demande en attente peut être rejetée.'; end if;
end $$;

-- Le RAF initie le bon de commande à partir d'une demande.
create or replace function public.initier_bon_commande(p_demande uuid, p_fournisseur text, p_montant_ht numeric,
                                                      p_taux_tva numeric default 18, p_livraison date default null)
returns text language plpgsql security definer set search_path = public as $$
declare d demandes_achat; v_num text;
begin
  if not public.a_droit('bc.initier') then raise exception 'Vous n''avez pas le droit d''initier un bon de commande.'; end if;
  select * into d from demandes_achat where id = p_demande for update;
  if not found then raise exception 'Demande d''achat introuvable.'; end if;
  if d.statut <> 'Soumise' then raise exception 'Cette demande a déjà été traitée.'; end if;
  insert into bons_commande (demande_id, chantier_id, fournisseur, objet, montant_ht, taux_tva, livraison_le)
  values (d.id, d.chantier_id, trim(p_fournisseur), d.objet, p_montant_ht, coalesce(p_taux_tva, 18), p_livraison)
  returning numero into v_num;
  update demandes_achat set statut = 'Commandée', traite_par = auth.uid(), traite_le = now() where id = d.id;
  return v_num;
end $$;

-- Le DO valide ou rejette le bon de commande. Un bon rejeté renvoie la demande au RAF.
create or replace function public.decider_bon_commande(p_id uuid, p_accepte boolean, p_motif text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b bons_commande;
begin
  if not public.a_droit('bc.valider') then raise exception 'Seul le Directeur des Opérations valide les bons de commande.'; end if;
  select * into b from bons_commande where id = p_id for update;
  if not found then raise exception 'Bon de commande introuvable.'; end if;
  if b.statut <> 'À valider' then raise exception 'Ce bon de commande a déjà été traité.'; end if;
  if b.initie_par = auth.uid() then raise exception 'Vous ne pouvez pas valider un bon de commande que vous avez initié.'; end if;
  if not p_accepte and coalesce(trim(p_motif), '') = '' then raise exception 'Indiquez le motif du rejet.'; end if;
  update bons_commande set statut = case when p_accepte then 'Validé' else 'Rejeté' end,
         motif_rejet = case when p_accepte then null else trim(p_motif) end,
         valide_par = auth.uid(), valide_le = now()
  where id = p_id;
  if not p_accepte then
    update demandes_achat set statut = 'Soumise', traite_par = null, traite_le = null where id = b.demande_id;
  end if;
end $$;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

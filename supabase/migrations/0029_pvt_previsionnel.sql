-- Ventes terrain : prévisionnel des avances.
-- Le 1er du mois, les ventes du mois précédent déclarées par les commerciaux deviennent le
-- prévisionnel : il est figé (les validations, rejets ou arriérés SBIN qui arrivent ensuite ne le
-- changent plus) et l'avance de chaque vendeur = taux du contrat (50 %) de sa part sur ce prévisionnel.

create table public.pvt_previsionnel (
  id          uuid primary key default gen_random_uuid(),
  pays        text references public.pays(code),
  mois        date not null check (extract(day from mois) = 1),
  vendeur_id  uuid not null references public.pvt_vendeurs(id) on delete restrict,
  ventes      int not null,
  part        numeric(14,0) not null,
  taux        numeric(5,2) not null,
  avance      numeric(14,0) not null,
  fige_le     timestamptz not null default now()
);
create unique index pvt_previsionnel_unique on public.pvt_previsionnel (pays, mois, vendeur_id);

alter table public.pvt_previsionnel enable row level security;
create trigger garde_pays before insert or update on public.pvt_previsionnel for each row execute function public.garde_pays();
create policy pays on public.pvt_previsionnel as restrictive for all to authenticated
  using (pays = public.pays_courant()) with check (pays = public.pays_courant());
create policy lecture on public.pvt_previsionnel for select to authenticated
  using (public.a_droit('pvt.voir') or vendeur_id in (select public.mes_vendeurs()));
grant select on public.pvt_previsionnel to authenticated;

-- Fige le prévisionnel d'un mois (à partir du 1er du mois suivant, une seule fois).
-- Appelée à l'ouverture de la page : rien à programmer. Renvoie true s'il est figé.
create or replace function public.pvt_figer_previsionnel(p_mois date)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_pays text := public.pays_courant(); v_taux numeric;
begin
  if not (public.a_droit('pvt.voir') or public.a_droit('pvt.saisir') or public.a_droit('pvt.gerer') or public.a_droit('pvt.declarer')) then
    return false;
  end if;
  if extract(day from p_mois) <> 1 or current_date < (p_mois + interval '1 month')::date then return false; end if;
  if exists (select 1 from pvt_previsionnel where pays = v_pays and mois = p_mois) then return true; end if;
  perform pg_advisory_xact_lock(hashtext('pvt_previsionnel' || v_pays || p_mois));
  if exists (select 1 from pvt_previsionnel where pays = v_pays and mois = p_mois) then return true; end if;
  select coalesce(taux_avance, 50) into v_taux from pvt_contrats where pays = v_pays;
  v_taux := coalesce(v_taux, 50);
  insert into pvt_previsionnel (pays, mois, vendeur_id, ventes, part, taux, avance)
  select v_pays, p_mois, v.vendeur_id, count(*), sum(o.part_vendeur), v_taux, round(sum(o.part_vendeur) * v_taux / 100)
    from pvt_ventes v join pvt_offres o on o.id = v.offre_id
   where v.pays = v_pays and v.source = 'Déclaration' and v.vendeur_id is not null
     and v.date_vente >= p_mois and v.date_vente < (p_mois + interval '1 month')::date
     and v.statut <> 'Rejetée'
   group by v.vendeur_id;
  return true;
end $$;
grant execute on function public.pvt_figer_previsionnel(date) to authenticated;

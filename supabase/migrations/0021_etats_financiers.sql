-- DGS Gestion : états financiers annuels (SYSCOHADA révisé, système normal).
-- L'application calcule le bilan, le compte de résultat et le tableau des flux de trésorerie
-- à partir de ses données ; ce qu'elle ne suit pas (capital, trésorerie au 31/12, emprunts,
-- immobilisations hors application…) est saisi à la clôture. L'agent IA rédige les notes annexes.
-- Une fois arrêtés, les états sont figés (copie conservée) et servent de colonne N-1 l'année suivante.

create table public.clotures_exercice (
  id          uuid primary key default gen_random_uuid(),
  pays        text references public.pays(code),
  annee       int not null check (annee between 2000 and 2100),
  saisies     jsonb not null default '{}'::jsonb,
  notes       jsonb,
  etats       jsonb,
  statut      text not null default 'Brouillon' check (statut in ('Brouillon','Arrêté')),
  maj_par     uuid references public.profils(id) default auth.uid(),
  maj_le      timestamptz not null default now(),
  arrete_par  uuid references public.profils(id),
  arrete_le   timestamptz,
  unique (pays, annee)
);
create trigger garde_pays before insert or update on public.clotures_exercice
for each row execute function public.garde_pays();

-- Des états arrêtés ne changent plus, sauf pour les rouvrir (retour en brouillon).
create or replace function public.controle_cloture()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.statut = 'Arrêté' and new.statut = 'Arrêté' then
    raise exception 'Ces états financiers sont arrêtés : rouvrez-les avant de les modifier.';
  end if;
  if new.statut = 'Arrêté' and (tg_op = 'INSERT' or old.statut <> 'Arrêté') then
    if new.etats is null then raise exception 'Calculez les états avant de les arrêter.'; end if;
    new.arrete_par := auth.uid(); new.arrete_le := now();
  elsif new.statut = 'Brouillon' then
    new.arrete_par := null; new.arrete_le := null;
  end if;
  new.maj_par := auth.uid(); new.maj_le := now();
  return new;
end $$;
create trigger controle_cloture before insert or update on public.clotures_exercice
for each row execute function public.controle_cloture();

alter table public.clotures_exercice enable row level security;
create policy pays on public.clotures_exercice as restrictive for all to authenticated
  using (pays = public.pays_courant()) with check (pays = public.pays_courant());
create policy lecture on public.clotures_exercice for select to authenticated
  using (public.a_droit('fisc.voir') or public.a_droit('fisc.declarer'));
create policy saisie on public.clotures_exercice for insert to authenticated
  with check (public.a_droit('fisc.declarer'));
create policy mise_a_jour on public.clotures_exercice for update to authenticated
  using (public.a_droit('fisc.declarer')) with check (public.a_droit('fisc.declarer'));
grant select, insert, update on public.clotures_exercice to authenticated;

-- Données d'inventaire pour la clôture : valeur du stock de DGS (hors matériel fourni par les clients)
-- au début et à la fin de l'exercice, et matériel immobilisé. Lisible avec le droit fiscal,
-- même sans accès à la logistique.
create or replace function public.donnees_cloture(p_annee int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_pays text := public.pays_courant();
begin
  if not (public.a_droit('fisc.voir') or public.a_droit('fisc.declarer')) then
    raise exception 'Vous n''avez pas accès aux états financiers.';
  end if;
  return jsonb_build_object(
    'stock_debut', (select coalesce(sum(m.valeur), 0) from mouvements_stock m join articles a on a.id = m.article_id
                    where a.client_id is null and m.pays = v_pays and m.le < make_date(p_annee, 1, 1)),
    'stock_fin',   (select coalesce(sum(m.valeur), 0) from mouvements_stock m join articles a on a.id = m.article_id
                    where a.client_id is null and m.pays = v_pays and m.le < make_date(p_annee + 1, 1, 1)),
    'equipements', (select coalesce(jsonb_agg(jsonb_build_object(
                      'code', e.code, 'designation', e.designation, 'categorie', e.categorie, 'etat', e.etat,
                      'date_acquisition', e.date_acquisition, 'valeur_acquisition', e.valeur_acquisition) order by e.code), '[]'::jsonb)
                    from equipements e where e.pays = v_pays)
  );
end $$;
grant execute on function public.donnees_cloture(int) to authenticated;

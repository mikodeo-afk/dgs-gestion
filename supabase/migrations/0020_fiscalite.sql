-- DGS Gestion : agent comptable fiscal (Bénin d'abord, autres pays ensuite).
-- 1. Deux droits : voir le calendrier fiscal et l'agent comptable ; enregistrer les déclarations faites.
-- 2. Paramètres fiscaux et sociaux du Bénin (CGI 2026, CNSS), réglables dans Paramètres.
-- 3. Employés déclarés : chaque salarié est marqué déclaré (CNSS et impôts) ou non, avec son numéro CNSS.
-- 4. Masse salariale fiscale du mois (lue par l'agent, même sans le droit « Voir les salaires »).
-- 5. Registre des déclarations : ce qui a été déclaré, payé, quand, par qui, avec la référence de quittance.

insert into public.permissions (cle, groupe, libelle, ordre) values
  ('fisc.voir',     'Finances', 'Voir le calendrier fiscal et utiliser l''agent comptable', 37),
  ('fisc.declarer', 'Finances', 'Enregistrer les déclarations fiscales et sociales (déclarée, payée)', 38)
on conflict do nothing;
insert into public.permissions_poste (poste, cle) values
  ('pdg','fisc.voir'),('do','fisc.voir'),('raf','fisc.voir'),('compta','fisc.voir'),
  ('pdg','fisc.declarer'),('do','fisc.declarer'),('raf','fisc.declarer'),('compta','fisc.declarer')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Paramètres fiscaux du Bénin
-- ---------------------------------------------------------------------------
insert into public.parametres (pays, cle, valeur, libelle)
select 'BJ', v.cle, v.valeur, v.libelle from (values
  ('vps',                 4,    'Versement patronal sur salaires (%), à payer le 10 du mois suivant'),
  ('cnss_patronal',       15.4, 'Cotisations CNSS employeur hors risques professionnels (%) : prestations familiales 9 + pensions 6,4'),
  ('cnss_risque_pro',     1,    'Risques professionnels CNSS (%) : de 1 à 4 selon le taux notifié par la CNSS'),
  ('is_taux',             30,   'Impôt sur les sociétés (%)'),
  ('is_minimum',          1,    'Minimum de perception de l''IS (% du chiffre d''affaires) : 1 en général, 3 pour le BTP selon le CGI, à confirmer avec le comptable'),
  ('is_annee_precedente', 0,    'IS dû au titre de l''année précédente (FCFA) : base des 4 acomptes de l''année'),
  ('patente_annuelle',    0,    'Montant de la patente de l''année (FCFA), d''après l''avis d''imposition'),
  ('cnss_mensuelle',      0,    'CNSS déclarée chaque mois (1) ou chaque trimestre (0, employeurs de moins de 20 salariés)')
) as v(cle, valeur, libelle)
where exists (select 1 from public.pays where code = 'BJ')
on conflict do nothing;
update public.parametres set libelle = 'Retenue CNSS part salariale (%) : pensions 3,6'
where pays = 'BJ' and cle = 'inps_salarie';

alter table public.parametres drop constraint parametres_valeur_check;
alter table public.parametres add constraint parametres_valeur_check check (valeur >= 0 and
  (cle not in ('tva','aib','inps_salarie','vps','cnss_patronal','cnss_risque_pro','is_taux','is_minimum') or valeur <= 100)
  and (cle <> 'cnss_mensuelle' or valeur in (0, 1)));

-- ---------------------------------------------------------------------------
-- Employés déclarés (CNSS et impôts)
-- ---------------------------------------------------------------------------
alter table public.remunerations
  add column declare_cnss boolean not null default true,
  add column numero_cnss  text;

-- Salaires du mois pour les déclarations : brut, retenue sociale, statut déclaré.
-- Même calcul que les bulletins (salaire de base + primes − absences non justifiées).
create or replace function public.masse_salariale_fiscale(p_mois date)
returns table (profil_id uuid, nom text, poste public.poste, contrat text, brut numeric, cnss_salarie numeric,
               declare_cnss boolean, numero_cnss text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.a_droit('fisc.voir') or public.a_droit('fisc.declarer')) then
    raise exception 'Vous n''avez pas accès au calendrier fiscal.';
  end if;
  return query
  with m as (select date_trunc('month', p_mois)::date d),
  b as (
    select p.id, p.nom, p.poste, p.contrat, r.salaire_base base, r.declare_cnss dc, r.numero_cnss nc,
      coalesce(l.primes, 0) primes,
      (select count(*)::int from presences x, m where x.profil_id = p.id and x.statut = 'A'
         and x.jour >= m.d and x.jour < (m.d + interval '1 month')) abs
    from profils p join remunerations r on r.profil_id = p.id
    cross join m left join lignes_paie l on l.profil_id = p.id and l.mois = m.d and l.pays = p.pays
    where p.actif and r.salaire_base > 0 and p.pays = public.pays_courant()
      and p.date_embauche < m.d + interval '1 month'
  ),
  c as (select *, greatest(base + primes - round(base / public.parametre('jours_ouvres_mois') * abs), 0) brut_calc from b)
  select c.id, c.nom, c.poste, c.contrat, c.brut_calc,
         round(c.brut_calc * coalesce(public.parametre('inps_salarie'), 0) / 100), c.dc, c.nc
  from c order by c.nom;
end $$;
grant execute on function public.masse_salariale_fiscale(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Registre des déclarations
-- ---------------------------------------------------------------------------
create table public.declarations_fiscales (
  id              uuid primary key default gen_random_uuid(),
  pays            text references public.pays(code),
  obligation      text not null check (obligation ~ '^[A-Z_]+$'),
  periode         text not null,
  echeance        date not null,
  montant_calcule numeric(14,0) not null default 0,
  montant_declare numeric(14,0) not null default 0 check (montant_declare >= 0),
  statut          text not null default 'Déclarée' check (statut in ('Déclarée','Payée')),
  reference       text,
  note            text,
  detail          jsonb not null default '{}'::jsonb,
  declare_par     uuid references public.profils(id) default auth.uid(),
  declare_le      timestamptz not null default now(),
  paye_par        uuid references public.profils(id),
  paye_le         timestamptz,
  unique (pays, obligation, periode)
);
create trigger garde_pays before insert or update on public.declarations_fiscales
for each row execute function public.garde_pays();

alter table public.declarations_fiscales enable row level security;
create policy pays on public.declarations_fiscales as restrictive for all to authenticated
  using (pays = public.pays_courant()) with check (pays = public.pays_courant());
create policy lecture on public.declarations_fiscales for select to authenticated
  using (public.a_droit('fisc.voir') or public.a_droit('fisc.declarer'));
create policy saisie on public.declarations_fiscales for insert to authenticated
  with check (public.a_droit('fisc.declarer'));
create policy mise_a_jour on public.declarations_fiscales for update to authenticated
  using (public.a_droit('fisc.declarer')) with check (public.a_droit('fisc.declarer'));
create policy suppression on public.declarations_fiscales for delete to authenticated
  using (public.a_droit('fisc.declarer'));
grant select, insert, update, delete on public.declarations_fiscales to authenticated;

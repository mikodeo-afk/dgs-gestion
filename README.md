# DGS Bamako Gestion

Application de gestion de DGS Bamako (D General Solutions) : chantiers et tâches, dépenses, finances, personnel, et droits par poste et par personne, du technicien au PDG.

Chaque employé a son propre compte. Les droits sont vérifiés **dans la base de données** (Row Level Security de Supabase) : même en contournant l'écran, un employé ne peut ni voir ni modifier ce que son poste ne permet pas.

## Contenu actuel (étape 1, fondations)

- Connexion par e-mail et mot de passe ; comptes créés par les RH.
- 10 postes : PDG, Directeur des Opérations, RAF, RH, Comptable, Responsable commercial, Responsable Logistique et Achats (RLA), Chef de projet, Chef d'équipe, Technicien.
- Le PDG et le Directeur des Opérations ont le même niveau d'accès et peuvent accorder ou retirer chacune des 23 actions à n'importe quel employé. Ils gardent toujours la gestion des droits.
- Chantiers (code automatique, coordonnées et rayon de pointage), tâches et avancement.
- Tout le monde voit l'avancement global des chantiers ; le détail dépend du périmètre (chef de projet : ses chantiers ; chef d'équipe : son équipe ; technicien : ses tâches).
- Personnel : création des comptes, responsable, contrat, salaire (visible seulement avec le droit « Voir les salaires »).
- Journal d'activité.
- Dépenses imputées à un chantier ou aux frais généraux, avec circuit de validation : jusqu'à 2 000 000 FCFA le RAF valide, au-delà le PDG ou le DO ; personne ne valide sa propre demande ; le comptable ou le RAF paie.
- Factures clients (numéro automatique, TVA 18 %, encaissement, retards) et factures fournisseurs (bon à payer, paiement).
- Rentabilité par projet : facturé − (dépenses + factures fournisseurs + main-d'œuvre de terrain).
- Frais généraux mois par mois : saisies, dépenses et factures hors projet, salaires du personnel administratif.

- Présences : saisie par les RH (tout jour) ou par le chef d'équipe (son équipe, le jour même), tableau du mois.
- Paie mensuelle : les RH préparent (primes, avances), le RAF, le PDG ou le DO valide, le comptable paie ; retenue d'absence et INPS calculées ; chacun voit son bulletin.
- Contrats et congés : fins de contrat à moins de 60 jours, congés acquis (2,5 j/mois).

À venir : l'application mobile (pointage par reconnaissance faciale dans le rayon du chantier, géolocalisation), l'impôt sur salaire (ITS) et les pièces jointes (photos de justificatifs).

## Mise en service

1. **Supabase** : créer un projet (région la plus proche : Europe de l'Ouest). Dans *SQL Editor*, exécuter, dans l'ordre, le contenu de chaque fichier de `supabase/migrations/` (`0001` à `0005`, chaque fichier séparément et dans l'ordre : `0005` a besoin que `0004` soit déjà enregistré).
2. **Vercel** : importer ce dépôt GitHub, puis renseigner les variables d'environnement (voir `.env.example`) :
   - `NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase > Project Settings > API) ;
   - `SUPABASE_SERVICE_ROLE_KEY` (même page ; clé secrète, uniquement sur le serveur).
3. **Premier compte** : dans Supabase > Authentication > Users, *Add user* avec l'e-mail du PDG. Le tout premier compte devient automatiquement PDG.
4. **Fermer les inscriptions publiques** : Supabase > Authentication > Sign In / Providers > désactiver *Allow new users to sign up*. Les autres comptes sont ensuite créés depuis l'onglet Personnel. (Même si une inscription passait, le compte resterait inactif et sans droits.)

## Développement

```bash
npm install
cp .env.example .env.local   # puis remplir les valeurs
npm run dev                  # http://localhost:3000
npm run typecheck
npm run test:db              # tests des droits sur un PostgreSQL local (psql requis)
```

Les tests de droits (`supabase/tests/tests.sql`) vérifient, poste par poste, ce que chacun peut voir et faire.

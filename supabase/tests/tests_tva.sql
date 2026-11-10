-- Tests des montants HT, TVA et TTC des factures.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_STOP 1
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function pg_temp.echoue(sql text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return true; end $$;

select pg_temp.check((select bool_and(montant_tva = round(montant_ht * 0.18) and montant_ttc = montant_ht + montant_tva) from factures_clients),
  'chaque facture client affiche une TVA à 18 % et un TTC = HT + TVA');
select pg_temp.check((select montant_tva = 2304000 and montant_ttc = 15104000 from factures_clients where montant_ht = 12800000),
  'facture client de 12 800 000 HT : TVA 2 304 000, TTC 15 104 000');

begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000021';
insert into factures_fournisseurs (fournisseur,numero,objet,montant_ht,taux_tva) values ('Bailleur','L-11','Loyer exonéré',500000,0);
commit;
select pg_temp.check((select montant_tva = 0 and montant_ttc = 500000 from factures_fournisseurs where numero = 'L-11'), 'une facture fournisseur exonérée a une TVA nulle');
select pg_temp.check((select montant_tva = 756000 and montant_ttc = 4956000 from factures_fournisseurs where numero = 'F-118'), 'une facture fournisseur à 18 % : TVA et TTC calculés');
select pg_temp.check(pg_temp.echoue($$update factures_fournisseurs set montant_ttc = 1 where numero = 'F-118'$$), 'le TTC ne peut pas être modifié à la main');
select pg_temp.check((select factures_fournisseurs = 1150000 from rentabilite_chantiers() where code = (select code from chantiers where id = '10000000-0000-0000-0000-000000000001')),
  'la rentabilité reste calculée hors taxes');
\echo 'Tous les tests de TVA passent.'

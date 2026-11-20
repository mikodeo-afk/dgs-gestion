import { exigerSession } from "@/lib/session";
import { POSTES, VOIT_TIERS } from "@/lib/types";
import Nav from "./Nav";
import Installer from "@/components/Installer";
import FondPhotos from "@/components/FondPhotos";
import { changerPays } from "./pays-actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await exigerSession();
  const terrain = s.profil.poste === "tech";
  const vendeur = s.profil.poste === "vendeur";
  const liens = vendeur ? [
    { href: "/pvt", libelle: "Mes ventes" },
    { href: "/personnel", libelle: "Ma fiche" },
  ] : [
    { href: "/", libelle: "Tableau de bord" },
    { href: "/chantiers", libelle: "Chantiers" },
    { href: "/raccordements", libelle: "Raccordements" },
  ];
  if (vendeur) { /* menu réduit */ } else {
  if (s.peut("pointer")) liens.splice(1, 0, { href: "/pointage", libelle: "Je pointe" });
  if (s.peut("tache.maj") || s.peut("tache.creer")) liens.push({ href: "/taches", libelle: terrain ? "Mes tâches" : "Tâches" });
  if (s.peut("dep.demander") || s.peut("dep.valider") || s.peut("dep.valider_tout") || s.peut("dep.payer") || (s.global && s.peut("fin.voir")))
    liens.push({ href: "/depenses", libelle: "Dépenses" });
  if (s.peut("pv.initier") || s.peut("fin.voir") || s.peut("fc.emettre") || s.peut("ff.enregistrer"))
    liens.push({ href: "/pv", libelle: "PV d'exécution" });
  if (s.peut("pf.initier") || s.peut("pf.valider") || s.peut("fc.emettre") || (s.global && s.peut("fin.voir")))
    liens.push({ href: "/soumissions", libelle: "Soumissions" });
  if (s.peut("da.demander") || s.peut("bc.initier") || s.peut("bc.valider") || s.peut("fin.voir"))
    liens.push({ href: "/achats", libelle: "Achats" });
  if (VOIT_TIERS.some((d) => s.peut(d)))
    liens.push({ href: "/tiers", libelle: "Clients et fournisseurs" });
  liens.push({ href: "/stock", libelle: terrain ? "Mon matériel" : "Stock" });
  liens.push({ href: "/materiel", libelle: "Matériel" });
  if (s.peut("fin.voir")) liens.push({ href: "/finances", libelle: "Finances" });
  if (s.peut("fisc.voir") || s.peut("fisc.declarer")) liens.push({ href: "/fiscalite", libelle: "Agent comptable" });
  liens.push({ href: "/rh", libelle: terrain ? "Mon espace RH" : "Ressources humaines" });
  liens.push({ href: "/personnel", libelle: terrain ? "Ma fiche" : "Personnel" });
  liens.push({ href: "/droits", libelle: s.peut("droits.gerer") ? "Rôles et droits" : "Mes droits" });
  if (s.peut("pvt.voir") || s.peut("pvt.saisir") || s.peut("pvt.gerer")) liens.splice(3, 0, { href: "/pvt", libelle: "Ventes terrain" });
  if (s.peut("param.gerer")) liens.push({ href: "/parametres", libelle: "Paramètres" });
  }

  return (
    <>
      <FondPhotos variante="app" />
      <header className="top">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-dgs.png" alt="DGS" />
          {s.pays.nom} <small>Gestion des activités{s.pays.ville ? ` · ${s.pays.ville}` : ""}</small>
        </div>
        <div className="who">
          {s.groupe && s.tousPays.length > 1 && (
            <form action={changerPays} className="statusline">
              <label htmlFor="pays-groupe" className="moi">Accès groupe</label>
              <select id="pays-groupe" name="pays" className="btn sm" defaultValue={s.pays.code}>
                {s.tousPays.map((p) => <option key={p.code} value={p.code}>{p.nom}</option>)}
              </select>
              <button className="btn sm" type="submit">Changer de pays</button>
            </form>
          )}
          <span className="moi">
            {s.profil.nom} · {POSTES[s.profil.poste].court}
          </span>
          <form action="/deconnexion" method="post">
            <button className="btn sm" type="submit">
              Se déconnecter
            </button>
          </form>
        </div>
      </header>
      <div className="wrap">
        <Nav
          liens={liens}
          pied={
            <>
              <b>{s.profil.nom}</b>
              <br />
              {POSTES[s.profil.poste].nom}
            </>
          }
        />
        <main>
          <div className="inner"><Installer />{children}</div>
        </main>
      </div>
    </>
  );
}

import { exigerSession } from "@/lib/session";
import { POSTES } from "@/lib/types";
import Nav from "./Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await exigerSession();
  const terrain = s.profil.poste === "tech";
  const liens = [
    { href: "/", libelle: "Tableau de bord" },
    { href: "/chantiers", libelle: "Chantiers" },
  ];
  if (s.peut("tache.maj") || s.peut("tache.creer")) liens.push({ href: "/taches", libelle: terrain ? "Mes tâches" : "Tâches" });
  if (s.peut("dep.demander") || s.peut("dep.valider") || s.peut("dep.valider_tout") || s.peut("dep.payer") || (s.global && s.peut("fin.voir")))
    liens.push({ href: "/depenses", libelle: "Dépenses" });
  if (s.peut("fin.voir")) liens.push({ href: "/finances", libelle: "Finances" });
  liens.push({ href: "/rh", libelle: terrain ? "Mon espace RH" : "Ressources humaines" });
  liens.push({ href: "/personnel", libelle: terrain ? "Ma fiche" : "Personnel" });
  liens.push({ href: "/droits", libelle: s.peut("droits.gerer") ? "Rôles et droits" : "Mes droits" });

  return (
    <>
      <header className="top">
        <div className="brand">
          DGS Bamako <small>Gestion des activités</small>
        </div>
        <div className="who">
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
          <div className="inner">{children}</div>
        </main>
      </div>
    </>
  );
}

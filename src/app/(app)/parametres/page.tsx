import { redirect } from "next/navigation";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import FormParametre from "./FormParametre";
import FormIdentite from "./FormIdentite";
import type { Identite } from "@/lib/types";

const ORDRE = ["tva", "aib", "seuil_validation", "inps_salarie", "jours_ouvres_mois"];
const NOM: Record<string, string> = {
  tva: "TVA", aib: "AIB par défaut", seuil_validation: "Seuil de validation",
  inps_salarie: "Retenue sociale salariale", jours_ouvres_mois: "Jours ouvrés par mois",
};
const unite = (cle: string) => (cle === "seuil_validation" ? "FCFA" : cle === "jours_ouvres_mois" ? "jours" : "%");

export default async function Parametres() {
  const s = await exigerSession();
  if (!s.peut("param.gerer")) redirect("/");
  const supabase = await supabaseServeur();
  const [{ data }, { data: profils }, { data: ident }] = await Promise.all([
    supabase.from("parametres").select("*"),
    supabase.from("profils").select("id,nom"),
    supabase.from("pays").select("*").eq("code", s.pays.code).maybeSingle(),
  ]);
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const liste = (data ?? []).sort((a, b) => (ORDRE.indexOf(a.cle) + 99) % 99 - (ORDRE.indexOf(b.cle) + 99) % 99);

  return (
    <>
      <div className="head">
        <div>
          <h1>Paramètres · {s.pays.nom}</h1>
          <p className="sub">Ces réglages ne concernent que {s.pays.nom}. Chaque pays a les siens. Une modification s&apos;applique aux nouvelles pièces : les factures déjà émises gardent leurs taux.</p>
        </div>
      </div>
      <section className="panel">
        <h2>Identité légale de DGS {s.pays.nom}</h2>
        <p className="note">Ces mentions figurent en en-tête de chaque facture de {s.pays.nom}.</p>
        {ident && <FormIdentite id={ident as Identite} />}
      </section>
      <section className="panel">
        <h2>Taux et seuils</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Paramètre</th><th className="num">Valeur actuelle</th><th>Modifier</th><th>Dernière modification</th></tr></thead>
            <tbody>
              {liste.map((p) => (
                <tr key={p.cle}>
                  <td><b>{NOM[p.cle] ?? p.cle}</b><br /><span className="note">{p.libelle}</span></td>
                  <td className="num">{unite(p.cle) === "FCFA" ? fcfa(p.valeur) : Number(p.valeur)} {unite(p.cle)}</td>
                  <td><FormParametre cle={p.cle} valeur={Number(p.valeur)} unite={unite(p.cle)} /></td>
                  <td className="note">{p.modifie_le ? `${dateFr(p.modifie_le)} par ${noms.get(p.modifie_par) ?? "—"}` : "Valeur d'origine"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          AIB : acompte sur impôt assis sur les bénéfices, calculé sur le montant HT. Sur nos factures, c&apos;est le client qui le retient ;
          sur les factures fournisseurs, c&apos;est DGS. Le taux par défaut est proposé sur chaque facture et peut y être changé
          (non applicable, 1 %, 3 % ou 5 %). Mettez 0 si l&apos;AIB ne s&apos;applique pas dans ce pays.
        </p>
      </section>
    </>
  );
}

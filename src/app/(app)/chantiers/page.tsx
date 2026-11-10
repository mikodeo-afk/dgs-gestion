import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { fcfa } from "@/lib/format";
import type { Chantier } from "@/lib/types";
import { Barre, Pastille, Verrou } from "@/components/ui";
import FormChantier from "./FormChantier";

export default async function Chantiers() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: chantiers }, { data: av }, { data: fin }, { data: profils }, { data: taches }] = await Promise.all([
    supabase.from("chantiers").select("*").order("code"),
    supabase.rpc("avancement_chantiers"),
    supabase.from("chantiers_finance").select("*"),
    supabase.from("profils").select("id,nom,poste").eq("actif", true),
    supabase.from("taches").select("chantier_id"),
  ]);
  const avm = new Map(((av ?? []) as { chantier_id: string; avancement: number }[]).map((a) => [a.chantier_id, Number(a.avancement)]));
  const finm = new Map((fin ?? []).map((x) => [x.chantier_id, x]));
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const perim = new Set((taches ?? []).map((t) => t.chantier_id));
  const liste = ((chantiers ?? []) as Chantier[]).filter((c) => s.global || c.chef_projet_id === s.profil.id || perim.has(c.id));
  const voitFin = s.peut("fin.voir");

  return (
    <>
      <div className="head">
        <div>
          <h1>Chantiers</h1>
          <p className="sub">{s.global ? "Tous les chantiers de la filiale." : "Les chantiers sur lesquels vous intervenez."}</p>
        </div>
      </div>
      {s.peut("chantier.creer") ? (
        <FormChantier chefs={(profils ?? []).filter((p) => p.poste === "cp")} />
      ) : (
        <Verrou titre="Création de chantier non autorisée">Votre profil ne permet pas d&apos;ouvrir un nouveau chantier.</Verrou>
      )}
      <section className="panel">
        <div className="tbl">
          <table>
            <thead>
              <tr>
                <th>Chantier</th><th>Domaine</th><th>Chef de projet</th><th>Avancement</th>
                {voitFin && <th className="num">Marché HT</th>}
                {voitFin && <th className="num">Budget</th>}
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {liste.map((c) => {
                const f = finm.get(c.id);
                return (
                  <tr key={c.id}>
                    <td><span className="code">{c.code}</span><br /><Link href={`/chantiers/${c.id}`}>{c.nom}</Link><br /><span className="note">{[c.lieu, c.client].filter(Boolean).join(" · ")}</span></td>
                    <td><span className="dom">{c.domaine}</span></td>
                    <td>{c.chef_projet_id ? noms.get(c.chef_projet_id) : "—"}</td>
                    <td style={{ minWidth: 150 }}><Barre valeur={avm.get(c.id) ?? 0} /></td>
                    {voitFin && <td className="num">{f ? fcfa(f.montant_marche) : "—"}</td>}
                    {voitFin && <td className="num">{f ? fcfa(f.budget_depenses) : "—"}</td>}
                    <td><Pastille texte={c.statut} /></td>
                  </tr>
                );
              })}
              {!liste.length && <tr><td colSpan={7} className="note">Aucun chantier dans votre périmètre.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

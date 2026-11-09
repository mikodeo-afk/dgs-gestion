import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Pastille } from "@/components/ui";
import FormDepense from "./FormDepense";
import { deciderDepense, payerDepense } from "./actions";

const TON: Record<string, "ok" | "warn" | "bad"> = { Validée: "ok", Payée: "ok", Demandée: "warn", Rejetée: "bad" };

export default async function Depenses() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: depenses }, { data: chantiers }, { data: profils }, { data: seuil }, { data: mes }] = await Promise.all([
    supabase.from("depenses").select("*").order("date_depense", { ascending: false }).order("cree_le", { ascending: false }),
    supabase.from("chantiers").select("id,code,nom,chef_projet_id").order("code"),
    supabase.from("profils").select("id,nom"),
    supabase.rpc("parametre", { p_cle: "seuil_validation" }),
    supabase.rpc("mes_chantiers"),
  ]);
  const S = Number(seuil ?? 2000000);
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));
  const perim = new Set(((mes ?? []) as unknown as string[]).map((x) => (typeof x === "string" ? x : Object.values(x)[0] as string)));
  const imputables = (chantiers ?? []).filter((c) => s.global || perim.has(c.id));
  const peutValider = (m: number) => s.peut("dep.valider_tout") || (s.peut("dep.valider") && m <= S);
  const liste = depenses ?? [];
  const aValider = liste.filter((d) => d.statut === "Demandée" && d.demandeur_id !== s.profil.id && peutValider(Number(d.montant)));

  return (
    <>
      <div className="head">
        <div>
          <h1>Dépenses</h1>
          <p className="sub">{s.global ? "Les dépenses de la filiale." : s.profil.poste === "cp" ? "Les dépenses de vos chantiers et de votre équipe." : "Vos demandes de dépenses."}</p>
        </div>
        {aValider.length > 0 && <Pastille texte={`${aValider.length} à valider par vous`} ton="warn" />}
      </div>
      {s.peut("dep.demander") && (
        <FormDepense chantiers={imputables} fraisGeneraux={s.peut("fg.saisir")} libelle={s.profil.poste === "compta" ? "Enregistrer la dépense" : "Envoyer la demande"} />
      )}
      <p className="note">
        Chaque dépense est imputée à un chantier, sauf les frais généraux de fonctionnement. Jusqu&apos;à {fcfa(S)} FCFA, le RAF peut valider ; au-delà, seuls le PDG et le
        Directeur des Opérations valident. Personne ne valide sa propre demande. Le comptable ou le RAF marque ensuite la dépense payée.
      </p>
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>Objet</th><th>Imputation</th><th>Demandeur</th><th className="num">Montant FCFA</th><th>Statut</th><th>Action</th></tr></thead>
            <tbody>
              {liste.map((d) => {
                const m = Number(d.montant);
                const decide = d.statut === "Demandée" && d.demandeur_id !== s.profil.id && peutValider(m);
                return (
                  <tr key={d.id}>
                    <td>{d.objet}<br /><span className="code">{dateFr(d.date_depense)}</span></td>
                    <td>{d.chantier_id ? <span className="code">{codes.get(d.chantier_id)}</span> : <span className="dom">Frais généraux</span>}</td>
                    <td>{noms.get(d.demandeur_id)}</td>
                    <td className="num">{fcfa(m)}</td>
                    <td><Pastille texte={d.statut} ton={TON[d.statut]} />{d.valideur_id && <><br /><span className="note">par {noms.get(d.valideur_id)}</span></>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {decide && (
                        <span className="statusline">
                          <form action={deciderDepense}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="objet" value={d.objet} /><input type="hidden" name="accepte" value="1" /><button className="btn sm ok">Valider</button></form>
                          <form action={deciderDepense}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="objet" value={d.objet} /><input type="hidden" name="accepte" value="0" /><button className="btn sm bad">Rejeter</button></form>
                        </span>
                      )}
                      {d.statut === "Validée" && s.peut("dep.payer") && (
                        <form action={payerDepense}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="objet" value={d.objet} /><button className="btn sm">Marquer payée</button></form>
                      )}
                      {d.statut === "Demandée" && !decide && s.peut("dep.valider") && m > S && <span className="note">Au-dessus du seuil : PDG ou DO</span>}
                    </td>
                  </tr>
                );
              })}
              {!liste.length && <tr><td colSpan={6} className="note">Aucune dépense pour le moment.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

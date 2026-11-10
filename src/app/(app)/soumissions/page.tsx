import { redirect } from "next/navigation";
import Justificatifs from "@/components/Justificatifs";
import { documentsPar } from "@/lib/justificatifs";

import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import { FormProforma, VisaProforma } from "./Formulaires";
import { resultatProforma } from "./actions";

const TON: Record<string, "ok" | "warn" | "bad"> = { "À viser": "warn", Validée: "ok", Gagnée: "ok", Rejetée: "bad", Perdue: "bad" };

export default async function Soumissions() {
  const s = await exigerSession();
  const suit = s.peut("pf.initier") || s.peut("pf.valider") || s.peut("fc.emettre");
  if (!suit && !(s.global && s.peut("fin.voir"))) redirect("/");
  const supabase = await supabaseServeur();
  const [{ data }, { data: profils }] = await Promise.all([
    supabase.from("proformas").select("*").order("cree_le", { ascending: false }),
    supabase.from("profils").select("id,nom"),
  ]);
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const docsPf = await documentsPar("proforma");
  const liste = data ?? [];
  const monVisa = (f: (typeof liste)[number]) =>
    f.statut === "À viser" && s.peut("pf.valider") &&
    ((s.profil.poste === "pdg" && !f.visa_dg_par) || (s.profil.poste === "do" && !f.visa_do_par));
  const somme = (st: string[]) => liste.filter((f) => st.includes(f.statut)).reduce((a, f) => a + Number(f.montant_ht), 0);
  const gagnees = liste.filter((f) => f.statut === "Gagnée").length, perdues = liste.filter((f) => f.statut === "Perdue").length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Soumissions</h1>
          <p className="sub">Le Responsable technique initie la proforma ; elle est étudiée et validée par le DG et par le DO (deux visas).</p>
        </div>
        {liste.filter(monVisa).length > 0 && <Pastille texte={`${liste.filter(monVisa).length} proforma(s) à viser`} ton="warn" />}
      </div>
      {s.peut("pf.initier") && <FormProforma />}
      <div className="kpis">
        <Kpi libelle="En attente de visa (HT)" valeur={fcfa(somme(["À viser"]))} unite="FCFA" />
        <Kpi libelle="Validées, en compétition (HT)" valeur={fcfa(somme(["Validée"]))} unite="FCFA" />
        <Kpi libelle="Gagnées (HT)" valeur={fcfa(somme(["Gagnée"]))} unite="FCFA" ton="pos" />
        <Kpi libelle="Taux de réussite" valeur={gagnees + perdues ? `${Math.round((100 * gagnees) / (gagnees + perdues))} %` : "—"} />
      </div>
      <section className="panel">
        <div className="tbl">
          <table>
            <thead><tr><th>Proforma</th><th>Client</th><th className="num">Dépôt</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th>Visa DG</th><th>Visa DO</th><th>Statut</th><th>Document signé</th><th>Action</th></tr></thead>
            <tbody>
              {liste.map((f) => (
                <tr key={f.id}>
                  <td><span className="code">{f.numero}</span> <span className="dom">{f.domaine}</span><br />{f.objet}<br /><span className="note">par {noms.get(f.initie_par)}</span></td>
                  <td>{f.client}</td>
                  <td className="num">{f.date_limite ? dateFr(f.date_limite) : "—"}</td>
                  <td className="num">{fcfa(f.montant_ht)}</td>
                  <td className="num">{fcfa(f.montant_tva)}</td>
                  <td className="num"><b>{fcfa(f.montant_ttc)}</b></td>
                  <td>{f.visa_dg_par ? <Pastille texte={`Visé ${dateFr(f.visa_dg_le.slice(0, 10))}`} ton="ok" /> : <span className="note">en attente</span>}</td>
                  <td>{f.visa_do_par ? <Pastille texte={`Visé ${dateFr(f.visa_do_le.slice(0, 10))}`} ton="ok" /> : <span className="note">en attente</span>}</td>
                  <td><Pastille texte={f.statut} ton={TON[f.statut]} />{f.motif_rejet && <><br /><span className="note">{f.motif_rejet}</span></>}</td>
                  <td>{f.statut !== "À viser" && f.statut !== "Rejetée" && <Justificatifs compact objet="proforma" objetId={f.id} numero={f.numero} pays={s.pays.code} fichiers={docsPf(f.id)} peutDeposer={s.peut("pf.initier") || s.peut("pf.valider")} page="/soumissions" />}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {monVisa(f) && <VisaProforma id={f.id} numero={f.numero} />}
                    {f.statut === "Validée" && suit && (
                      <span className="statusline">
                        <form action={resultatProforma}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><input type="hidden" name="gagnee" value="1" /><button className="btn sm ok">Gagnée</button></form>
                        <form action={resultatProforma}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="numero" value={f.numero} /><input type="hidden" name="gagnee" value="0" /><button className="btn sm bad">Perdue</button></form>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!liste.length && <tr><td colSpan={11} className="note">Aucune proforma.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { dateFr, fcfa } from "@/lib/format";
import { Kpi, Pastille } from "@/components/ui";
import Justificatifs from "@/components/Justificatifs";
import { documentsPar } from "@/lib/justificatifs";
import { DecisionBon, EtudeDemande, FormDemandeAchat } from "./Formulaires";

const TON: Record<string, "ok" | "warn" | "bad"> = { Soumise: "warn", Commandée: "ok", Rejetée: "bad", "À valider": "warn", Validé: "ok", Rejeté: "bad" };

export default async function Achats() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const [{ data: demandes }, { data: bons }, { data: chantiers }, { data: profils }, { data: mes }] = await Promise.all([
    supabase.from("demandes_achat").select("*").order("cree_le", { ascending: false }),
    supabase.from("bons_commande").select("*").order("cree_le", { ascending: false }),
    supabase.from("chantiers").select("id,code,nom").order("code"),
    supabase.from("profils").select("id,nom"),
    supabase.rpc("mes_chantiers"),
  ]);
  const noms = new Map((profils ?? []).map((p) => [p.id, p.nom]));
  const docsBc = await documentsPar("bon_commande");
  const deposeBc = s.peut("bc.initier") || s.peut("bc.valider");
  const codes = new Map((chantiers ?? []).map((c) => [c.id, c.code]));
  const perim = new Set(((mes ?? []) as unknown as string[]).map((x) => (typeof x === "string" ? x : Object.values(x)[0] as string)));
  const projets = (chantiers ?? []).filter((c) => s.global || perim.has(c.id));
  const da = demandes ?? [];
  const bc = bons ?? [];
  const aEtudier = da.filter((d) => d.statut === "Soumise").length;
  const aValider = bc.filter((b) => b.statut === "À valider").length;
  const engage = bc.filter((b) => b.statut === "Validé").reduce((a, b) => a + Number(b.montant_ttc), 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Achats</h1>
          <p className="sub">Le RLA initie les demandes selon les besoins de chaque projet, le RAF les étudie et initie les bons de commande, le Directeur des Opérations les valide.</p>
        </div>
        {s.peut("bc.initier") && aEtudier > 0 && <Pastille texte={`${aEtudier} demande(s) à étudier`} ton="warn" />}
        {s.peut("bc.valider") && aValider > 0 && <Pastille texte={`${aValider} bon(s) à valider`} ton="warn" />}
      </div>
      {s.peut("da.demander") && <FormDemandeAchat chantiers={projets} />}

      <section className="panel">
        <h2>Demandes d&apos;achat</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Demande</th><th>Projet</th><th>Initiée par</th><th className="num">Coût estimé</th><th className="num">Nécessaire le</th><th>Statut</th><th>Action</th></tr></thead>
            <tbody>
              {da.map((d) => (
                <tr key={d.id}>
                  <td><span className="code">{d.numero}</span><br />{d.objet}{d.details && <><br /><span className="note">{d.details}</span></>}</td>
                  <td className="code">{codes.get(d.chantier_id)}</td>
                  <td>{noms.get(d.demandeur_id)}<br /><span className="note">{dateFr(d.cree_le.slice(0, 10))}</span></td>
                  <td className="num">{d.montant_estime ? fcfa(d.montant_estime) : "—"}</td>
                  <td className="num">{d.besoin_le ? dateFr(d.besoin_le) : "—"}</td>
                  <td><Pastille texte={d.statut === "Soumise" ? "À étudier (RAF)" : d.statut} ton={TON[d.statut]} />{d.motif_rejet && <><br /><span className="note">{d.motif_rejet}</span></>}</td>
                  <td>{d.statut === "Soumise" && s.peut("bc.initier") && <EtudeDemande id={d.id} numero={d.numero} />}</td>
                </tr>
              ))}
              {!da.length && <tr><td colSpan={7} className="note">Aucune demande d&apos;achat.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="kpis"><Kpi libelle="Engagé (bons de commande validés)" valeur={fcfa(engage)} unite="FCFA TTC" /></div>

      <section className="panel">
        <h2>Bons de commande</h2>
        <div className="tbl">
          <table>
            <thead><tr><th>Bon</th><th>Projet</th><th>Fournisseur</th><th className="num">Montant HT</th><th className="num">TVA</th><th className="num">Montant TTC</th><th>Initié par</th><th>Statut</th><th>Bon signé</th><th>Action</th></tr></thead>
            <tbody>
              {bc.map((b) => (
                <tr key={b.id}>
                  <td><span className="code">{b.numero}</span><br />{b.objet}{b.livraison_le && <><br /><span className="note">Livraison {dateFr(b.livraison_le)}</span></>}</td>
                  <td className="code">{codes.get(b.chantier_id)}</td>
                  <td>{b.fournisseur}</td>
                  <td className="num">{fcfa(b.montant_ht)}</td>
                  <td className="num">{fcfa(b.montant_tva)}<br /><span className="note">{Number(b.taux_tva) ? `${Number(b.taux_tva)} %` : "Exonéré"}</span></td>
                  <td className="num"><b>{fcfa(b.montant_ttc)}</b></td>
                  <td>{noms.get(b.initie_par)}</td>
                  <td><Pastille texte={b.statut === "À valider" ? "À valider (DO)" : b.statut} ton={TON[b.statut]} />{b.valide_par && <><br /><span className="note">par {noms.get(b.valide_par)}</span></>}{b.motif_rejet && <><br /><span className="note">{b.motif_rejet}</span></>}</td>
                  <td>{(b.statut === "Validé" || docsBc(b.id).length > 0) && <Justificatifs compact objet="bon_commande" objetId={b.id} numero={b.numero} pays={s.pays.code} fichiers={docsBc(b.id)} peutDeposer={deposeBc && b.statut === "Validé"} page="/achats" />}</td>
                  <td>{b.statut === "À valider" && s.peut("bc.valider") && b.initie_par !== s.profil.id && <DecisionBon id={b.id} numero={b.numero} />}</td>
                </tr>
              ))}
              {!bc.length && <tr><td colSpan={10} className="note">Aucun bon de commande.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

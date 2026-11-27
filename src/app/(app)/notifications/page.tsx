import Link from "next/link";
import { exigerSession } from "@/lib/session";
import { supabaseServeur } from "@/lib/supabase/server";
import { Pastille } from "@/components/ui";
import ActiverNotifications from "@/components/ActiverNotifications";
import { toutMarquerLu } from "./actions";

type Notif = {
  id: string; pays: string; type: string; titre: string; message: string | null;
  cree_le: string; lue_le: string | null; traitee_le: string | null;
};

const quand = (d: string) =>
  new Date(d).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Bamako" });

export default async function Notifications() {
  const s = await exigerSession();
  const supabase = await supabaseServeur();
  const { data } = await supabase.from("notifications").select("id,pays,type,titre,message,cree_le,lue_le,traitee_le")
    .order("cree_le", { ascending: false }).limit(100);
  const liste = (data ?? []) as Notif[];
  const nomPays = new Map(s.tousPays.map((p) => [p.code, p.nom]));
  const aTraiter = liste.filter((n) => n.type === "À valider" && !n.traitee_le);
  const nonLues = liste.filter((n) => !n.lue_le && !n.traitee_le).length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Notifications</h1>
          <p className="sub">Les opérations qui attendent votre validation, et les décisions sur vos demandes.</p>
        </div>
        {nonLues > 0 && (
          <form action={toutMarquerLu}><button className="btn sm" type="submit">Tout marquer comme lu</button></form>
        )}
      </div>
      <ActiverNotifications />
      {aTraiter.length > 0 && <Pastille texte={`${aTraiter.length} opération${aTraiter.length > 1 ? "s" : ""} à valider par vous`} ton="warn" />}
      <section className="panel">
        {liste.length === 0 ? (
          <p className="note">Aucune notification pour le moment.</p>
        ) : (
          <ul className="notifs">
            {liste.map((n) => {
              const ouverte = n.type === "À valider" && !n.traitee_le;
              return (
                <li key={n.id} className={!n.lue_le && !n.traitee_le ? "nouvelle" : ""}>
                  <Link href={`/notifications/ouvrir/${n.id}`} prefetch={false}>
                    <span className="t">
                      {n.titre}
                      {s.tousPays.length > 1 && n.pays !== s.pays.code && <span className="dom"> · {nomPays.get(n.pays) ?? n.pays}</span>}
                    </span>
                    {n.message && <span className="m">{n.message}</span>}
                    <span className="q">
                      {quand(n.cree_le)}
                      {" · "}
                      {ouverte ? <Pastille texte="À valider" ton="warn" /> : n.type === "À valider" ? <Pastille texte="Traitée" ton="ok" /> : <Pastille texte="Information" ton="info" />}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

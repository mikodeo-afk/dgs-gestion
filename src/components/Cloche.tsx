"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { compteurNotifications } from "@/app/(app)/notifications/actions";

/** Cloche de l'en-tête : nombre d'opérations à valider et de décisions non lues. */
export default function Cloche({ initial }: { initial: number }) {
  const [n, setN] = useState(initial);
  const chemin = usePathname();

  useEffect(() => {
    let actif = true;
    const maj = () => compteurNotifications().then((v) => { if (actif) setN(v); }).catch(() => {});
    maj();
    const t = setInterval(() => { if (document.visibilityState === "visible") maj(); }, 60000);
    const vu = () => { if (document.visibilityState === "visible") maj(); };
    document.addEventListener("visibilitychange", vu);
    return () => { actif = false; clearInterval(t); document.removeEventListener("visibilitychange", vu); };
  }, [chemin]);

  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (n > 0) nav.setAppBadge?.(n).catch(() => {});
    else nav.clearAppBadge?.().catch(() => {});
  }, [n]);

  return (
    <Link href="/notifications" className="cloche" title="Notifications" aria-label={n > 0 ? `Notifications : ${n} à traiter` : "Notifications"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && <b>{n > 99 ? "99+" : n}</b>}
    </Link>
  );
}

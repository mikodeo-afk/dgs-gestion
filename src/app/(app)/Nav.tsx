"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function Nav({ liens, pied }: { liens: { href: string; libelle: string }[]; pied: React.ReactNode }) {
  const chemin = usePathname();
  return (
    <nav aria-label="Sections">
      {liens.map((l) => {
        const actif = l.href === "/" ? chemin === "/" : chemin.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={actif ? "page" : undefined}>
            {l.libelle}
          </Link>
        );
      })}
      <div className="scope">{pied}</div>
    </nav>
  );
}

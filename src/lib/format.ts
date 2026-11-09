export const fcfa = (n: number | null | undefined) =>
  new Intl.NumberFormat("fr-FR").format(Math.round(Number(n ?? 0))).replace(/ | /g, " ");

export const dateFr = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

export const heureFr = (d: string) =>
  new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Bamako" });

export const aujourdhui = () => new Date().toISOString().slice(0, 10);

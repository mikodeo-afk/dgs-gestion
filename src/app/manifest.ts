import type { MetadataRoute } from "next";

/** Permet d'installer l'application sur l'écran d'accueil du téléphone. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DGS Gestion",
    short_name: "DGS Gestion",
    description: "Chantiers, raccordements, pointage et personnel des filiales DGS.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#01014c",
    theme_color: "#01014c",
    lang: "fr",
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icone-masquable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

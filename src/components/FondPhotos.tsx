// Fond animé : photos DGS. Connexion = photo du siège avec un léger zoom lent ; pages = photos des équipes en fondu enchaîné.
const PHOTOS = [1, 2, 3, 4, 5].map((n) => `/fonds/dgs-${n}.webp`);

export default function FondPhotos({ variante }: { variante: "connexion" | "app" }) {
  if (variante === "connexion")
    return (
      <div className="fond fond-connexion" aria-hidden="true">
        <div className="siege" style={{ backgroundImage: "url(/fonds/siege-clair.webp)" }} />
      </div>
    );
  return (
    <div className="fond fond-app" aria-hidden="true">
      {PHOTOS.map((src, i) => (
        <div key={src} style={{ backgroundImage: `url(${src})`, animationDelay: `${i * 7}s` }} />
      ))}
    </div>
  );
}

// Fond animé : photos des équipes et installations DGS en fondu enchaîné, avec un léger zoom.
const PHOTOS = [1, 2, 3, 4, 5].map((n) => `/fonds/dgs-${n}.webp`);

export default function FondPhotos({ variante }: { variante: "connexion" | "app" }) {
  return (
    <div className={`fond fond-${variante}`} aria-hidden="true">
      {PHOTOS.map((src, i) => (
        <div key={src} style={{ backgroundImage: `url(${src})`, animationDelay: `${i * 7}s` }} />
      ))}
    </div>
  );
}

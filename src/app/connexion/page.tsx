import Formulaire from "./Formulaire";

export default async function Connexion({ searchParams }: { searchParams: Promise<{ inactif?: string }> }) {
  const { inactif } = await searchParams;
  return (
    <main className="login">
      <Formulaire inactif={inactif === "1"} />
    </main>
  );
}

import { majAvancement } from "./actions";

/** Mise à jour de l'avancement d'une tâche, par pas de 5 %. */
export default function Avancement({ id, valeur }: { id: string; valeur: number }) {
  return (
    <form className="ligne" action={majAvancement}>
      <input type="hidden" name="id" value={id} />
      <select name="avancement" defaultValue={String(valeur - (valeur % 5))} aria-label="Avancement">
        {Array.from({ length: 21 }, (_, i) => i * 5).map((v) => <option key={v} value={v}>{v} %</option>)}
      </select>
      <button className="btn sm" type="submit">Enregistrer</button>
    </form>
  );
}

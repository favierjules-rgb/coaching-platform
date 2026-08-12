import type { PlannedMeal } from "@/types";

export function PlannedMealCard({ meal }: { meal: PlannedMeal }) {
  return (
    <div className="flex flex-col gap-2 border border-border bg-card p-5">
      <span className="font-heading text-xs font-semibold uppercase tracking-widest text-primary">
        {meal.slot}
      </span>
      <span className="text-sm font-medium leading-snug text-foreground">
        {meal.name}
      </span>

      {/*
        La mise en page du coach est une DONNÉE. Une ligne vide de `items`
        (name et quantity vides) est la respiration qu'il a voulue entre deux
        groupes : elle se rend comme un espace, jamais comme une puce vide.
        `whitespace-pre-wrap` préserve en plus les espaces internes d'un
        libellé. Aucun `<br>` en base, aucun `dangerouslySetInnerHTML`.
        La clé est l'index : deux respirations ont le même contenu, et le nom
        n'est plus unique dès qu'un libellé se répète.
      */}
      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {meal.items.map((item, index) => {
          const respiration = !item.name && !item.quantity;
          if (respiration) {
            return <li key={index} aria-hidden="true" className="h-3" />;
          }
          return (
            <li key={index} className="whitespace-pre-wrap">
              {item.quantity ? `${item.name} — ${item.quantity}` : item.name}
            </li>
          );
        })}
      </ul>

      <span className="text-xs text-muted-foreground">
        {meal.macros.calories} kcal · {meal.macros.protein}g prot. ·{" "}
        {meal.macros.carbs}g gluc. · {meal.macros.fat}g lip.
      </span>

      {meal.coachNotes && (
        <p className="mt-1 border-t border-border pt-2 text-xs italic leading-relaxed text-muted-foreground">
          {meal.coachNotes}
        </p>
      )}
    </div>
  );
}

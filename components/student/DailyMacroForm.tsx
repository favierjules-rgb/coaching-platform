"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle } from "lucide-react";

import type { ActualDailyIntake, NutritionDay } from "@/types";

interface DailyMacroFormProps {
  day: NutritionDay;
  studentId: string;
  planId: string;
  onValidate: (actual: ActualDailyIntake) => void;
}

export function DailyMacroForm({
  day,
  studentId,
  planId,
  onValidate,
}: DailyMacroFormProps) {
  const [calories, setCalories] = useState(
    day.actual ? String(day.actual.macros.calories) : "",
  );
  const [protein, setProtein] = useState(
    day.actual ? String(day.actual.macros.protein) : "",
  );
  const [carbs, setCarbs] = useState(
    day.actual ? String(day.actual.macros.carbs) : "",
  );
  const [fat, setFat] = useState(day.actual ? String(day.actual.macros.fat) : "");
  const [comment, setComment] = useState(day.actual?.comment ?? "");
  const [hunger, setHunger] = useState(day.actual?.hunger ?? "");
  const [energy, setEnergy] = useState(day.actual?.energy ?? "");
  const [digestion, setDigestion] = useState(day.actual?.digestion ?? "");
  const [justValidated, setJustValidated] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const actual: ActualDailyIntake = {
      studentId,
      planId,
      dayId: day.id,
      macros: {
        calories: Number(calories) || 0,
        protein: Number(protein) || 0,
        carbs: Number(carbs) || 0,
        fat: Number(fat) || 0,
      },
      comment,
      hunger,
      energy,
      digestion,
      validatedAt: new Date().toISOString(),
    };

    // Donnée mockée pour l'instant : mise à jour de l'état local uniquement,
    // aucun envoi réel n'est effectué.
    onValidate(actual);
    setJustValidated(true);
  }

  return (
    <div className="border border-border bg-card p-6">
      {justValidated && (
        <div className="mb-5 flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle size={18} />
          Journée validée, le calcul hebdomadaire a été mis à jour.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor={`${day.id}-calories`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Calories réelles (kcal)
            </label>
            <input
              id={`${day.id}-calories`}
              type="number"
              min={0}
              value={calories}
              onChange={(event) => setCalories(event.target.value)}
              placeholder={`Objectif : ${day.target.calories}`}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor={`${day.id}-protein`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Protéines réelles (g)
            </label>
            <input
              id={`${day.id}-protein`}
              type="number"
              min={0}
              value={protein}
              onChange={(event) => setProtein(event.target.value)}
              placeholder={`Objectif : ${day.target.protein}`}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor={`${day.id}-carbs`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Glucides réels (g)
            </label>
            <input
              id={`${day.id}-carbs`}
              type="number"
              min={0}
              value={carbs}
              onChange={(event) => setCarbs(event.target.value)}
              placeholder={`Objectif : ${day.target.carbs}`}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor={`${day.id}-fat`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Lipides réels (g)
            </label>
            <input
              id={`${day.id}-fat`}
              type="number"
              min={0}
              value={fat}
              onChange={(event) => setFat(event.target.value)}
              placeholder={`Objectif : ${day.target.fat}`}
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor={`${day.id}-comment`}
            className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
          >
            Commentaire de la journée (optionnel)
          </label>
          <textarea
            id={`${day.id}-comment`}
            rows={2}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Comment s'est passée ton alimentation aujourd'hui ?"
            className="w-full resize-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor={`${day.id}-hunger`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Faim
            </label>
            <input
              id={`${day.id}-hunger`}
              value={hunger}
              onChange={(event) => setHunger(event.target.value)}
              placeholder="Ex : faible le soir"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor={`${day.id}-energy`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Énergie
            </label>
            <input
              id={`${day.id}-energy`}
              value={energy}
              onChange={(event) => setEnergy(event.target.value)}
              placeholder="Ex : bonne énergie"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label
              htmlFor={`${day.id}-digestion`}
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Digestion
            </label>
            <input
              id={`${day.id}-digestion`}
              value={digestion}
              onChange={(event) => setDigestion(event.target.value)}
              placeholder="Ex : normale"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>
        </div>

        <button
          type="submit"
          className="mt-2 bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        >
          Valider la journée
        </button>
      </form>
    </div>
  );
}

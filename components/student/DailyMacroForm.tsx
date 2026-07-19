"use client";

import { useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle } from "lucide-react";

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
  const [error, setError] = useState<string | null>(null);
  const [pendingZeroConfirm, setPendingZeroConfirm] = useState(false);

  function resetSubmitState() {
    setError(null);
    setPendingZeroConfirm(false);
  }

  function finalizeValidation() {
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

    // Donnée mockée pour l'instant : mise à jour de l'état local (+
    // localStorage via le hook partagé) uniquement, aucun envoi réel n'est
    // effectué.
    onValidate(actual);
    setJustValidated(true);
    setPendingZeroConfirm(false);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      calories.trim() === "" ||
      protein.trim() === "" ||
      carbs.trim() === "" ||
      fat.trim() === ""
    ) {
      setError(
        "Renseigne tes calories, protéines, glucides et lipides avant de valider la journée.",
      );
      setPendingZeroConfirm(false);
      return;
    }
    setError(null);

    if (Number(calories) === 0) {
      setPendingZeroConfirm(true);
      return;
    }

    finalizeValidation();
  }

  return (
    <div className="border border-border bg-card p-6">
      {justValidated && (
        <div className="mb-5 flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle size={18} />
          Journée validée, le calcul hebdomadaire a été mis à jour.
        </div>
      )}

      {error && (
        <div className="mb-5 flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <AlertTriangle size={18} className="flex-shrink-0" />
          {error}
        </div>
      )}

      {pendingZeroConfirm && (
        <div className="mb-5 flex flex-col gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <span>
              Tu as indiqué 0 kcal pour cette journée. Si c&apos;est
              volontaire (jeûne, journée non suivie...), confirme pour
              valider quand même.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={finalizeValidation}
              className="border border-amber-500/60 px-4 py-2 text-xs uppercase tracking-widest text-amber-400 transition-colors hover:bg-amber-500/20"
            >
              Confirmer 0 kcal
            </button>
            <button
              type="button"
              onClick={() => setPendingZeroConfirm(false)}
              className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
            >
              Annuler
            </button>
          </div>
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
              onChange={(event) => {
                setCalories(event.target.value);
                resetSubmitState();
              }}
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
              onChange={(event) => {
                setProtein(event.target.value);
                resetSubmitState();
              }}
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
              onChange={(event) => {
                setCarbs(event.target.value);
                resetSubmitState();
              }}
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
              onChange={(event) => {
                setFat(event.target.value);
                resetSubmitState();
              }}
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
          className="mt-2 bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Valider la journée
        </button>
      </form>
    </div>
  );
}

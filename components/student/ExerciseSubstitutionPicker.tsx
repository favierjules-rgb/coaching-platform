"use client";

import { useState } from "react";
import { Repeat2, Undo2 } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { listExerciseSubstitutes } from "@/lib/supabase/exercise-substitutes";
import type { ExerciseSubstituteOption } from "@/types";

/**
 * « EXERCICE INDISPONIBLE » — le choix d'un remplaçant par l'élève.
 *
 * CE QUI CHANGE, ET CE QUI NE CHANGE PAS. Seuls le NOM et la VIDÉO changent
 * à l'écran. Séries, répétitions, RPE cible, repos, tempo : la structure
 * prescrite reste exactement la même — c'est toute la logique demandée, et
 * c'est pour cela que ce composant ne touche jamais l'état des séries.
 *
 * CHARGEMENT PARESSEUX. La liste n'est demandée qu'au premier clic, et une
 * seule fois par exercice. Une séance de dix exercices ne déclenche donc
 * aucune requête tant que l'élève ne clique pas.
 *
 * `chargerRemplacants` est INJECTABLE : le vrai chargement passe par la RPC
 * `list_exercise_substitutes`, mais les tests fournissent leur propre
 * fonction et n'ont besoin ni de réseau ni de Supabase.
 */

export type ChargeurRemplacants = (exerciseLibraryId: string) => Promise<ExerciseSubstituteOption[]>;

const chargeurParDefaut: ChargeurRemplacants = async (exerciseLibraryId) => {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return [];
  return listExerciseSubstitutes(supabase, exerciseLibraryId);
};

interface ExerciseSubstitutionPickerProps {
  /** Fiche de banque de l'exercice PRESCRIT — `null` pour un exercice en texte libre. */
  libraryExerciseId: string | null;
  /** Remplaçant actuellement retenu, ou `null`. */
  substitute: ExerciseSubstituteOption | null;
  onChoose: (option: ExerciseSubstituteOption) => void;
  onReset: () => void;
  chargerRemplacants?: ChargeurRemplacants;
}

export function ExerciseSubstitutionPicker({
  libraryExerciseId,
  substitute,
  onChoose,
  onReset,
  chargerRemplacants = chargeurParDefaut,
}: ExerciseSubstitutionPickerProps) {
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [options, setOptions] = useState<ExerciseSubstituteOption[] | null>(null);

  // Un exercice hors banque n'a pas de pattern, donc aucun remplaçant
  // possible. On le DIT, au lieu de proposer un bouton qui ne mènerait
  // nulle part.
  if (!libraryExerciseId) {
    return (
      <p className="mt-3 text-xs leading-snug text-muted-foreground/70">
        Aucun remplacement possible pour cet exercice : préviens ton coach si la machine est prise.
      </p>
    );
  }

  async function ouvrir() {
    setOuvert(true);
    if (options !== null || chargement) return;
    setChargement(true);
    try {
      setOptions(await chargerRemplacants(libraryExerciseId as string));
    } catch {
      setOptions([]);
    } finally {
      setChargement(false);
    }
  }

  if (substitute) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-panel border border-primary/40 bg-primary/5 px-3 py-2">
        <Repeat2 size={14} className="flex-shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 text-xs leading-snug text-foreground">
          Même structure — séries, répétitions et RPE cible ne bougent pas. Ton coach verra le
          remplacement dans ton retour.
        </span>
        <button
          type="button"
          onClick={() => {
            onReset();
            setOuvert(false);
          }}
          className="pressable ml-auto flex min-h-11 items-center gap-1.5 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Undo2 size={12} aria-hidden="true" />
          Annuler le remplacement
        </button>
      </div>
    );
  }

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => void ouvrir()}
        className="pressable mt-3 flex min-h-11 items-center gap-2 rounded-control border border-border px-3 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Repeat2 size={13} aria-hidden="true" />
        Exercice indisponible
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-panel border border-border bg-surface-soft/40 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-semibold tracking-tight text-foreground">
          Choisis un remplaçant
        </span>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="pressable min-h-11 rounded-control px-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Fermer
        </button>
      </div>

      {chargement ? (
        <p className="text-xs text-muted-foreground">Recherche des remplaçants…</p>
      ) : options && options.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                onClick={() => {
                  onChoose(option);
                  setOuvert(false);
                }}
                className="pressable flex min-h-11 w-full flex-wrap items-center justify-between gap-2 rounded-control border border-border bg-background px-3 py-2 text-left transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className="min-w-0 text-sm text-foreground">{option.name}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {[option.equipment, option.level].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-snug text-muted-foreground">
          Aucun remplaçant enregistré pour ce mouvement. Fais au mieux et signale-le dans le
          commentaire de l&apos;exercice.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { CheckCircle2, CircleAlert } from "lucide-react";

import {
  LIBELLES_VERIFICATION,
  etatDeVerification,
  type EtatVerification,
} from "@/lib/verification-programme";

/**
 * LA PASTILLE « À JOUR / À VÉRIFIER » — un pense-bête, pas un état produit.
 *
 * ⚠️ ELLE NE MODIFIE RIEN D'AUTRE QU'ELLE-MÊME. Pas le programme, pas les
 * séances, pas la progression de l'élève, pas les notifications. Le seul effet
 * d'un clic est une ligne dans `program_review_flags` — et la couleur de cette
 * pastille jusqu'au lundi suivant.
 *
 * ⚠️ L'ÉTAT EST DÉRIVÉ, JAMAIS STOCKÉ. Ce composant ne garde pas « à jour » en
 * mémoire : il compare la semaine validée à celle d'aujourd'hui, à chaque
 * rendu. Le retour automatique à « À vérifier » le lundi n'a donc rien à
 * déclencher — voir lib/verification-programme.ts.
 */
export function PilluleVerification({
  semaineValidee,
  aujourdhui,
  semaineCourante,
  onBasculer,
}: {
  /** La clé de semaine stockée (`verified_week`), ou `null` si jamais validé. */
  readonly semaineValidee: string | null;
  /** La date du jour, en ISO — injectée pour rester testable sans horloge. */
  readonly aujourdhui: string;
  /** La clé de semaine à écrire quand le coach valide. */
  readonly semaineCourante: string | null;
  readonly onBasculer: (versEtat: EtatVerification) => void | Promise<void>;
}) {
  const [enCours, setEnCours] = useState(false);
  const etat = etatDeVerification({ verifieePourLaSemaine: semaineValidee, aujourdhui });
  const aJour = etat === "a-jour";

  async function basculer() {
    if (enCours || semaineCourante === null) return;
    setEnCours(true);
    try {
      await onBasculer(aJour ? "a-verifier" : "a-jour");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void basculer()}
      disabled={enCours || semaineCourante === null}
      // ⚠️ LE LIBELLÉ ACCESSIBLE DIT L'ÉTAT ET L'ACTION, jamais la couleur.
      aria-pressed={aJour}
      aria-label={
        aJour
          ? "Programme marqué à jour pour cette semaine — cliquer pour repasser à vérifier"
          : "Programme à vérifier — cliquer pour le marquer à jour pour cette semaine"
      }
      title={
        aJour
          ? "À jour pour cette semaine. Repassera automatiquement à « À vérifier » lundi."
          : "Marquer comme vérifié pour cette semaine."
      }
      className={
        aJour
          ? "pressable inline-flex items-center gap-1 rounded-full border border-success/50 bg-success/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-success transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40 disabled:opacity-50"
          : "pressable inline-flex items-center gap-1 rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-warning transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40 disabled:opacity-50"
      }
    >
      {aJour ? <CheckCircle2 size={11} /> : <CircleAlert size={11} />}
      {LIBELLES_VERIFICATION[etat]}
    </button>
  );
}

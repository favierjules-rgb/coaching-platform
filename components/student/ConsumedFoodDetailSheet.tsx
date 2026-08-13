"use client";

import { useState } from "react";
import { AlertTriangle, Trash2, X } from "lucide-react";

import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  CONSUMED_UNIT_LABELS_FR,
  type ConsumedEntry,
  type ConsumedUnit,
  entryKcal,
} from "@/lib/nutrition/consumed";

/**
 * LE DÉTAIL D'UN ALIMENT CONSOMMÉ — corriger la quantité, ou supprimer.
 *
 * Ouvert par un appui sur la barre compacte. Feuille ancrée en bas sur
 * téléphone (le pouce y arrive), boîte centrée à partir de `sm`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN NE CALCULE PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Les P/G/L affichés sont l'INSTANTANÉ que le serveur a figé. Quand l'élève
 * corrige 120 g → 150 g, cet écran n'extrapole RIEN : il envoie la nouvelle
 * quantité, le serveur recharge la source et réécrit l'instantané, et les
 * valeurs affichées viennent de la relecture. Un aperçu calculé côté
 * navigateur donnerait, le temps d'un aller-retour, un chiffre qui n'est pas
 * celui qui sera enregistré.
 *
 * L'unité n'est PAS modifiable ici. Passer de « pièce » à « g » change la
 * façon dont le serveur convertit, et `modifier_quantite_entree` refuse une
 * unité incompatible : proposer un choix qui se fait refuser une fois sur deux
 * serait une fausse liberté. On corrige la quantité ; pour changer d'unité, on
 * supprime et on resaisit.
 */
export function ConsumedFoodDetailSheet({
  entrée,
  enCours,
  erreur,
  onFermer,
  onCorriger,
  onSupprimer,
}: {
  entrée: ConsumedEntry;
  enCours: boolean;
  erreur: string | null;
  onFermer: () => void;
  onCorriger: (quantité: number, unité: ConsumedUnit) => Promise<boolean>;
  onSupprimer: () => Promise<boolean>;
}) {
  const [quantité, setQuantité] = useState(String(entrée.quantity));
  const [confirmeSuppression, setConfirmeSuppression] = useState(false);

  // La feuille reste montée quand la relecture serveur ramène une nouvelle
  // quantité : le champ doit suivre, sinon il garderait la valeur d'avant la
  // correction.
  //
  // Le motif recommandé par React pour « un état dérivé d'une prop » est
  // l'AJUSTEMENT PENDANT LE RENDU, pas un effet : il n'y a ni écran
  // intermédiaire ni rendu en cascade, et la valeur affichée est bonne dès la
  // première peinture. On mémorise la source pour ne réinitialiser que quand
  // elle change vraiment — sinon la frappe de l'élève serait écrasée à chaque
  // rendu.
  const [source, setSource] = useState(`${entrée.id}:${entrée.quantity}`);
  if (source !== `${entrée.id}:${entrée.quantity}`) {
    setSource(`${entrée.id}:${entrée.quantity}`);
    setQuantité(String(entrée.quantity));
  }

  const valeur = Number(quantité.replace(",", "."));
  const quantitéValide = Number.isFinite(valeur) && valeur > 0;
  const modifiée = quantitéValide && valeur !== entrée.quantity;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Modifier ${entrée.label}`}
      className="modal-overlay-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
    >
      <div className="modal-content-scale-in max-h-[90vh] w-full overflow-y-auto rounded-t-card border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-soft sm:max-w-md sm:rounded-card sm:pb-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-heading text-base font-bold uppercase text-foreground">
              {entrée.label}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {entrée.sourceType === "free" ? "Aliment renseigné manuellement" : "Aliment du catalogue"}
            </p>
          </div>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>

        {erreur && (
          <div className="mb-4 flex items-start gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <span>{erreur}</span>
          </div>
        )}

        {/* L'instantané, tel qu'il est ENREGISTRÉ. */}
        <dl className="mb-4 grid grid-cols-4 gap-2 rounded-panel border border-border bg-surface-soft/40 p-3 text-center">
          {[
            { c: "kcal", v: formatIntegerFr(entryKcal(entrée)) },
            { c: "P", v: `${formatDecimalFr(entrée.proteinG, 1)}${NBSP}g` },
            { c: "G", v: `${formatDecimalFr(entrée.carbG, 1)}${NBSP}g` },
            { c: "L", v: `${formatDecimalFr(entrée.fatG, 1)}${NBSP}g` },
          ].map((m) => (
            <div key={m.c}>
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.c}</dt>
              <dd className="mt-0.5 text-sm font-bold tabular-nums text-foreground">{m.v}</dd>
            </div>
          ))}
        </dl>

        <label
          htmlFor="consumed-quantite"
          className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
        >
          Quantité ({CONSUMED_UNIT_LABELS_FR[entrée.unit]})
        </label>
        <div className="flex gap-2">
          <input
            id="consumed-quantite"
            // `inputMode="decimal"` ouvre le pavé numérique décimal sur iPhone.
            // `type="text"` plutôt que `number` : le champ nombre de Safari
            // refuse la virgule, que tout le monde tape en français.
            type="text"
            inputMode="decimal"
            value={quantité}
            onChange={(e) => setQuantité(e.target.value)}
            className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none"
          />
          <span className="flex min-h-[48px] flex-shrink-0 items-center rounded-control border border-border bg-surface-soft px-4 text-sm text-muted-foreground">
            {CONSUMED_UNIT_LABELS_FR[entrée.unit]}
          </span>
        </div>
        {!quantitéValide && quantité.trim() !== "" && (
          <p className="mt-2 text-xs text-destructive">La quantité doit être un nombre positif.</p>
        )}

        <button
          type="button"
          onClick={() => void onCorriger(valeur, entrée.unit)}
          disabled={!modifiée || enCours}
          className="pressable mt-4 min-h-[48px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
        >
          {enCours ? "Enregistrement…" : "Enregistrer la quantité"}
        </button>

        {/* Suppression en DEUX temps : la barre se vise au pouce, et un appui
            accidentel ne doit pas effacer une saisie. */}
        {confirmeSuppression ? (
          <div className="mt-3 rounded-panel border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm text-foreground">Supprimer « {entrée.label} » de ce repas ?</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void onSupprimer()}
                disabled={enCours}
                className="pressable min-h-[44px] flex-1 rounded-control bg-destructive py-2 text-xs font-bold uppercase tracking-widest text-destructive-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {enCours ? "Suppression…" : "Supprimer"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmeSuppression(false)}
                disabled={enCours}
                className="pressable min-h-[44px] flex-1 rounded-control border border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmeSuppression(true)}
            disabled={enCours}
            className="pressable mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive/60 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 size={14} />
            Supprimer cet aliment
          </button>
        )}
      </div>
    </div>
  );
}

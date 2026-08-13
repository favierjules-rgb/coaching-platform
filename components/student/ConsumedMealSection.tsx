"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, UtensilsCrossed } from "lucide-react";

import { AddFoodSheet } from "@/components/student/AddFoodSheet";
import { ConsumedFoodBar } from "@/components/student/ConsumedFoodBar";
import { ConsumedFoodDetailSheet } from "@/components/student/ConsumedFoodDetailSheet";
import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  type ConsumedMeal,
  type ConsumedUnit,
  TOTAUX_VIDES,
  remainingForTarget,
  totalsForMeal,
} from "@/lib/nutrition/consumed";

/**
 * « CE QUE J'AI MANGÉ » — le bloc de CONSOMMATION d'un repas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PRESCRIPTION ET CONSOMMATION NE SE MÉLANGENT JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Ce composant ne rend RIEN de ce que le coach a écrit : ni titre de repas, ni
 * texte alimentaire, ni notes. Il vit SOUS la prescription, derrière un
 * séparateur et un intitulé explicite. Un élève qui n'utilise pas le suivi
 * retrouve son plan exactement comme avant — ce bloc se réduit alors à une
 * seule ligne : le bouton d'ajout.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE CONTENEUR NAÎT DU PREMIER ACTE RÉEL
 * ────────────────────────────────────────────────────────────────────────────
 * `repas` vaut `null` tant qu'aucun aliment n'a été saisi : afficher la page
 * n'écrit rien en base (§6 de l'énoncé). C'est le clic sur « Ajouter un
 * aliment » qui appelle `ouvrir_repas_prescrit`, et lui seul.
 */
export function ConsumedMealSection({
  repas,
  titre,
  cibleFigée,
  enCours,
  erreur,
  onOuvrirConteneur,
  onAjouterCatalogue,
  onAjouterManuel,
  onCorriger,
  onSupprimerAliment,
  onEffacerErreur,
}: {
  /** `null` quand rien n'a encore été consommé pour ce repas. */
  repas: ConsumedMeal | null;
  titre: string;
  /** Vrai pour un repas prescrit : on affiche alors CONSOMMÉ *et* RESTANT. */
  cibleFigée: boolean;
  enCours: boolean;
  erreur: string | null;
  /** Obtient ou crée le conteneur. Rend son identifiant, ou `null` en échec. */
  onOuvrirConteneur: () => Promise<string | null>;
  onAjouterCatalogue: (
    consumedMealId: string,
    foodId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  onAjouterManuel: (
    consumedMealId: string,
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    p: number,
    g: number,
    l: number,
  ) => Promise<boolean>;
  onCorriger: (entryId: string, quantité: number, unité: ConsumedUnit) => Promise<boolean>;
  onSupprimerAliment: (entryId: string) => Promise<boolean>;
  onEffacerErreur: () => void;
}) {
  const [ajoutOuvert, setAjoutOuvert] = useState(false);
  const [conteneurCible, setConteneurCible] = useState<string | null>(null);
  const [entréeOuverte, setEntréeOuverte] = useState<string | null>(null);
  const [ouverture, setOuverture] = useState(false);

  const entrées = repas?.entries ?? [];
  const consommé = repas ? totalsForMeal(repas) : TOTAUX_VIDES;
  const restant = cibleFigée ? remainingForTarget(repas?.target ?? null, consommé) : null;
  const détail = entrées.find((e) => e.id === entréeOuverte) ?? null;

  /**
   * Ouvre la feuille d'ajout — en créant le conteneur AVANT, s'il n'existe pas.
   *
   * L'ordre compte : sans conteneur, la RPC d'ajout n'aurait rien à viser.
   * Et si l'ouverture échoue, la feuille ne s'ouvre pas du tout, plutôt que de
   * laisser l'élève remplir un formulaire qui ne pourra pas s'enregistrer.
   */
  async function ouvrirAjout() {
    if (ouverture || enCours) return;
    onEffacerErreur();
    if (repas) {
      setConteneurCible(repas.id);
      setAjoutOuvert(true);
      return;
    }
    setOuverture(true);
    const id = await onOuvrirConteneur();
    setOuverture(false);
    if (id) {
      setConteneurCible(id);
      setAjoutOuvert(true);
    }
  }

  return (
    <div className="mt-3 border-t border-dashed border-border pt-3">
      <div className="flex items-center justify-between gap-2">
        <h5 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          <UtensilsCrossed size={12} aria-hidden="true" />
          Ce que j&apos;ai mangé
        </h5>
        {entrées.length > 0 && (
          <span className="text-xs font-bold tabular-nums text-foreground">
            {formatIntegerFr(consommé.kcal)}
            {NBSP}kcal
          </span>
        )}
      </div>

      {entrées.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {entrées.map((entrée) => (
            <li key={entrée.id}>
              <ConsumedFoodBar
                entrée={entrée}
                désactivé={enCours}
                onOuvrir={() => {
                  onEffacerErreur();
                  setEntréeOuverte(entrée.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {entrées.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
          <span>
            Consommé : P{NBSP}
            {formatDecimalFr(consommé.proteinG, 1)}
            {NBSP}g · G{NBSP}
            {formatDecimalFr(consommé.carbG, 1)}
            {NBSP}g · L{NBSP}
            {formatDecimalFr(consommé.fatG, 1)}
            {NBSP}g
          </span>
          {restant && (
            <span className={restant.kcal < 0 ? "font-semibold text-destructive" : ""}>
              Restant : {formatIntegerFr(restant.kcal)}
              {NBSP}kcal
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void ouvrirAjout()}
        disabled={enCours || ouverture}
        className="pressable mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-dashed border-border text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Plus size={14} />
        {ouverture ? "Ouverture…" : "Ajouter un aliment"}
      </button>

      {erreur && !ajoutOuvert && !détail && (
        <p className="mt-2 rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {erreur}
        </p>
      )}

      {ajoutOuvert && conteneurCible && (
        <AddFoodSheet
          titreRepas={titre}
          enCours={enCours}
          erreur={erreur}
          onFermer={() => {
            setAjoutOuvert(false);
            onEffacerErreur();
          }}
          onAjouterCatalogue={async (foodId, quantité, unité) => {
            const ok = await onAjouterCatalogue(conteneurCible, foodId, quantité, unité);
            if (ok) setAjoutOuvert(false);
            return ok;
          }}
          onAjouterManuel={async (libellé, quantité, unité, p, g, l) => {
            const ok = await onAjouterManuel(conteneurCible, libellé, quantité, unité, p, g, l);
            if (ok) setAjoutOuvert(false);
            return ok;
          }}
        />
      )}

      {détail && (
        <ConsumedFoodDetailSheet
          entrée={détail}
          enCours={enCours}
          erreur={erreur}
          onFermer={() => {
            setEntréeOuverte(null);
            onEffacerErreur();
          }}
          onCorriger={async (quantité, unité) => {
            const ok = await onCorriger(détail.id, quantité, unité);
            if (ok) setEntréeOuverte(null);
            return ok;
          }}
          onSupprimer={async () => {
            const ok = await onSupprimerAliment(détail.id);
            if (ok) setEntréeOuverte(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}

/**
 * UN REPAS LIBRE — Collation, Restaurant, Post-entraînement…
 *
 * Il n'affiche AUCUNE cible : il n'en a pas, et la contrainte
 * `consumed_meals_student_has_no_target` interdit qu'il en porte une. Seul le
 * TOTAL consommé apparaît.
 *
 * Renommable et supprimable, contrairement à un repas prescrit. Deux
 * collations du même nom le même jour sont deux lignes distinctes : la clé
 * React est l'identifiant, jamais le libellé.
 */
export function StudentMealCard({
  repas,
  enCours,
  erreur,
  onRenommer,
  onSupprimerRepas,
  onAjouterCatalogue,
  onAjouterManuel,
  onCorriger,
  onSupprimerAliment,
  onEffacerErreur,
}: {
  repas: ConsumedMeal;
  enCours: boolean;
  erreur: string | null;
  onRenommer: (libellé: string) => Promise<boolean>;
  onSupprimerRepas: () => Promise<boolean>;
  onAjouterCatalogue: (
    consumedMealId: string,
    foodId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  onAjouterManuel: (
    consumedMealId: string,
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    p: number,
    g: number,
    l: number,
  ) => Promise<boolean>;
  onCorriger: (entryId: string, quantité: number, unité: ConsumedUnit) => Promise<boolean>;
  onSupprimerAliment: (entryId: string) => Promise<boolean>;
  onEffacerErreur: () => void;
}) {
  const [renomme, setRenomme] = useState(false);
  const [libellé, setLibellé] = useState(repas.label);
  const [confirmeSuppression, setConfirmeSuppression] = useState(false);

  return (
    <article className="rounded-panel border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {renomme ? (
          <div className="flex w-full gap-2">
            <input
              type="text"
              value={libellé}
              onChange={(e) => setLibellé(e.target.value)}
              aria-label="Nom du repas"
              className="min-h-[44px] w-full rounded-control border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={async () => {
                if (await onRenommer(libellé.trim())) setRenomme(false);
              }}
              disabled={enCours || libellé.trim() === ""}
              aria-label="Valider le nom"
              className="pressable flex min-h-[44px] w-11 flex-shrink-0 items-center justify-center rounded-control bg-primary text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40"
            >
              <Check size={16} />
            </button>
          </div>
        ) : (
          <>
            <h4 className="text-sm font-bold uppercase tracking-wide text-foreground">
              {repas.label}
            </h4>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setLibellé(repas.label);
                  setRenomme(true);
                }}
                disabled={enCours}
                aria-label={`Renommer ${repas.label}`}
                className="pressable flex h-9 w-9 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => setConfirmeSuppression(true)}
                disabled={enCours}
                aria-label={`Supprimer ${repas.label}`}
                className="pressable flex h-9 w-9 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:opacity-40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </>
        )}
      </div>

      <p className="mt-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        Repas ajouté par toi · aucun objectif coach
      </p>

      {confirmeSuppression && (
        <div className="mt-3 rounded-panel border border-destructive/40 bg-destructive/5 p-3">
          {/* FORMULATION FIXE, quel que soit le nombre d'aliments. La version
              dynamique disait « et les 0 aliment qu'il contient ? » sur un
              repas vide, et imposait une pluralisation qui se collait aux mots
              au rendu. « tout son contenu » couvre les trois cas — zéro, un,
              plusieurs — sans compter ni accorder quoi que ce soit. */}
          <p className="text-sm text-foreground">
            Supprimer «&nbsp;{repas.label}&nbsp;» et tout son contenu&nbsp;?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void onSupprimerRepas()}
              disabled={enCours}
              className="pressable min-h-[44px] flex-1 rounded-control bg-destructive py-2 text-xs font-bold uppercase tracking-widest text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {enCours ? "Suppression…" : "Supprimer"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmeSuppression(false)}
              disabled={enCours}
              className="pressable min-h-[44px] flex-1 rounded-control border border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <ConsumedMealSection
        repas={repas}
        titre={repas.label}
        cibleFigée={false}
        enCours={enCours}
        erreur={erreur}
        onOuvrirConteneur={async () => repas.id}
        onAjouterCatalogue={onAjouterCatalogue}
        onAjouterManuel={onAjouterManuel}
        onCorriger={onCorriger}
        onSupprimerAliment={onSupprimerAliment}
        onEffacerErreur={onEffacerErreur}
      />
    </article>
  );
}

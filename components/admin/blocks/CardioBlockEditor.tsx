"use client";

import { useState } from "react";

import { CardioBlockRow } from "@/components/admin/ProgramBuilder";
import { Field } from "@/components/admin/AdminFormFields";
import type { AdminCardioBlock, CardioTrainingBlock } from "@/types";

/**
 * Éditeur d'un bloc cardio (Lot 4.2). RÉUTILISE le formulaire cardio existant
 * (`CardioBlockRow` → `CardioSegmentRow`) sans réimplémenter les prescriptions ;
 * la carte (`TrainingBlockCard`) fournissant déjà titre, numéro et actions, on
 * masque le chrome interne via `showBlockChrome={false}`.
 *
 * Adapte UNIQUEMENT le contrat d'entrée/sortie entre le bloc canonique
 * (`CardioTrainingBlock` — prescriptions) et la forme historique du formulaire
 * (`AdminCardioBlock` — segments). Toute modification produit un NOUVEAU bloc
 * immuable ; l'objet source n'est jamais muté ; id / catégorie / position /
 * couleur sont préservés.
 */
export function CardioBlockEditor({
  block,
  onChange,
}: {
  block: CardioTrainingBlock;
  onChange: (next: CardioTrainingBlock) => void;
}) {
  // Aide à la rédaction (aperçu vitesse/allure) — jamais persistée, comme dans
  // l'éditeur legacy.
  const [referenceVmaKmh, setReferenceVmaKmh] = useState(15);

  const adminBlock: AdminCardioBlock = {
    id: block.id,
    order: block.position,
    title: block.title ?? "",
    cardioType: block.cardioType,
    machineType: block.machineType,
    segments: block.prescriptions,
  };

  function handleChange(updated: AdminCardioBlock) {
    onChange({
      ...block,
      cardioType: updated.cardioType,
      machineType: updated.machineType,
      // Les segments du formulaire SONT les prescriptions canoniques (même type).
      prescriptions: updated.segments,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="w-40">
          <Field
            label="VMA réf. aperçu (km/h)"
            type="number"
            step="0.1"
            value={String(referenceVmaKmh)}
            onChange={(v) => setReferenceVmaKmh(Number(v) || 0)}
          />
        </div>
      </div>
      <CardioBlockRow block={adminBlock} referenceVmaKmh={referenceVmaKmh} onChange={handleChange} showBlockChrome={false} />
    </div>
  );
}

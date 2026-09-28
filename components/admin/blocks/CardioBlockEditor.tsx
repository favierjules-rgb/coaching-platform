"use client";

import { useState } from "react";

import { CardioBlockRow } from "@/components/admin/cardio/CardioBlockRow";
import { Field } from "@/components/admin/AdminFormFields";
import type { ReferencesAthlete, ReglagesZones } from "@/lib/zones-physiologiques";
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
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ `sport` ET `rounds` TRAVERSENT CET ADAPTATEUR — ILS DISPARAISSAIENT
 * ════════════════════════════════════════════════════════════════════════
 * Ces deux champs ont été ajoutés au bloc canonique (migration 20260930100000)
 * sans être recopiés ici : ouvrir un bloc cardio dans le builder et toucher
 * n'importe quel champ EFFAÇAIT son sport et son nombre de séries, sans que rien
 * ne le signale. `sport` commande toute la conversion physiologique (%VMA course
 * ≠ %VMA natation) : le perdre ne dégrade pas l'affichage, il rend la séance
 * inconvertible. L'adaptateur porte donc les deux champs dans les DEUX sens.
 *
 * ⚠️ LES RÉFÉRENCES DE L'ATHLÈTE SONT OPTIONNELLES, ET C'EST VOULU. Dans le
 * builder de PROGRAMME il n'y a pas d'athlète : aucune référence n'existe, et le
 * champ « VMA réf. aperçu » sert d'aide à la rédaction — jamais persistée. Dans
 * le calendrier d'UN athlète, ses vraies références sont transmises et ce champ
 * d'aide disparaît : afficher les deux laisserait croire que la valeur saisie à
 * la main influence ce que l'élève verra.
 */
export function CardioBlockEditor({
  block,
  onChange,
  references,
  reglagesZones,
}: {
  block: CardioTrainingBlock;
  onChange: (next: CardioTrainingBlock) => void;
  /** Références de l'athlète — absentes dans le builder de programme. */
  references?: ReferencesAthlete;
  reglagesZones?: ReglagesZones;
}) {
  // Aide à la rédaction (aperçu vitesse/allure) — jamais persistée, comme dans
  // l'éditeur legacy. Sans objet dès que les vraies références sont fournies.
  const [referenceVmaKmh, setReferenceVmaKmh] = useState(15);
  const avecReferencesReelles = references !== undefined;

  const adminBlock: AdminCardioBlock = {
    id: block.id,
    order: block.position,
    title: block.title ?? "",
    cardioType: block.cardioType,
    machineType: block.machineType,
    sport: block.sport,
    rounds: block.rounds,
    segments: block.prescriptions,
  };

  function handleChange(updated: AdminCardioBlock) {
    onChange({
      ...block,
      cardioType: updated.cardioType,
      machineType: updated.machineType,
      sport: updated.sport,

      rounds: updated.rounds,
      // Les segments du formulaire SONT les prescriptions canoniques (même type).
      prescriptions: updated.segments,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {!avecReferencesReelles && (
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
      )}
      <CardioBlockRow
        block={adminBlock}
        referenceVmaKmh={referenceVmaKmh}
        references={references}
        reglagesZones={reglagesZones}
        onChange={handleChange}
        showBlockChrome={false}
      />
    </div>
  );
}

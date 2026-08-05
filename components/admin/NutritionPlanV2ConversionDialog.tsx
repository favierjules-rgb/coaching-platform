"use client";

import { Modal } from "@/components/admin/Modal";
import { CONVERSION_CONFIRMATION_MESSAGE_FR } from "@/lib/nutrition/plan-v2-conversion";

/**
 * Confirmation AVANT d'ouvrir le constructeur v2 sur un plan v1.
 *
 * Cette modale n'écrit RIEN. « Continuer » ouvre simplement le constructeur
 * avec un préremplissage local ; la conversion réelle du plan n'a lieu qu'au
 * premier enregistrement par `save_nutrition_plan_v2`.
 */
export function NutritionPlanV2ConversionDialog({
  planName,
  onCancel,
  onContinue,
}: {
  readonly planName: string;
  readonly onCancel: () => void;
  readonly onContinue: () => void;
}) {
  return (
    <Modal title="Activer la répartition avancée" onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{CONVERSION_CONFIRMATION_MESSAGE_FR}</p>
        <p className="text-xs text-muted-foreground">
          Plan concerné : <span className="text-foreground">{planName}</span>. Rien n&apos;est
          enregistré tant que tu n&apos;as pas cliqué sur Enregistrer dans le constructeur.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            className="pressable min-h-[44px] flex-1 rounded-control border border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="pressable min-h-[44px] flex-1 rounded-control border border-primary bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Continuer vers le constructeur
          </button>
        </div>
      </div>
    </Modal>
  );
}

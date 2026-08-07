"use client";

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";

import { Modal } from "@/components/admin/Modal";
import { DELETE_ACTION_LABEL_FR, matchesExactName } from "@/lib/nutrition/lifecycle";

/**
 * LES ACTIONS DE CYCLE DE VIE — barre d'actions, zone dangereuse, modale de
 * confirmation.
 *
 * TROIS PIÈCES, UN SEUL FICHIER : elles ne s'emploient jamais séparément, et
 * les garder ensemble évite qu'un écran archive avec une modale et qu'un
 * autre supprime sans.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA HIÉRARCHIE VISUELLE EST LE PROPOS
 * ─────────────────────────────────────────────────────────────────────────
 * « Archiver » est l'action normale : elle vit dans la barre, avec les
 * autres, en gris. « Supprimer définitivement » vit AILLEURS — dans une
 * section à part, sous un titre qui annonce le danger, après une phrase qui
 * dit ce qui va disparaître. On ne peut pas la cliquer par inadvertance en
 * visant sa voisine, parce qu'elle n'a pas de voisine.
 *
 * LA MODALE NE FAIT PAS QUE DEMANDER. Elle montre le nom exact, le nombre de
 * dépendances détectées, et — quand la suppression est refusée — le motif
 * précis plutôt qu'un bouton grisé sans explication. Quand elle est permise,
 * il faut RECOPIER le nom : le geste doit coûter une seconde d'attention.
 *
 * ELLE NE DÉCIDE RIEN. `blockedReason` est calculé par la base et le sera de
 * nouveau, dans la transaction, au moment du clic. Cacher un bouton n'a
 * jamais protégé quoi que ce soit.
 *
 * ACCESSIBILITÉ ET MOUVEMENT : la modale réutilisée (`components/admin/
 * Modal.tsx`) porte déjà `role="dialog"`, le piège de focus, la fermeture par
 * Échap et la restauration du focus. Aucune animation n'est ajoutée : une
 * confirmation destructrice n'a rien à gagner à être jolie, et tout à perdre
 * à être lente.
 */

// ────────────────────────────────────────────────────────────────────────────
// La barre d'actions
// ────────────────────────────────────────────────────────────────────────────

export interface LifecycleActionSpec {
  readonly key: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly onRun: () => void | Promise<void>;
  readonly disabled?: boolean;
  /** Raison affichée au survol quand l'action est indisponible. */
  readonly title?: string;
}

export function LifecycleActionBar({
  actions,
  busy = false,
  className = "",
}: {
  readonly actions: readonly LifecycleActionSpec[];
  readonly busy?: boolean;
  readonly className?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          disabled={busy || action.disabled === true}
          title={action.title}
          onClick={() => void action.onRun()}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {action.icon}
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// La zone dangereuse
// ────────────────────────────────────────────────────────────────────────────

export function DangerZone({
  title = "Zone dangereuse",
  description,
  children,
}: {
  readonly title?: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="zone-dangereuse"
      className="rounded-card border border-destructive/40 bg-destructive/5 p-4 sm:p-6"
    >
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle size={16} className="flex-shrink-0 text-destructive" />
        <h2
          id="zone-dangereuse"
          className="font-heading text-base font-bold uppercase text-destructive"
        >
          {title}
        </h2>
      </div>
      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

/** Le déclencheur — jamais rendu comme action principale. */
export function DeleteTriggerButton({
  onOpen,
  disabled = false,
  title,
}: {
  readonly onOpen: () => void;
  readonly disabled?: boolean;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      title={title}
      className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-destructive/50 bg-destructive/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
    >
      <Trash2 size={14} />
      {DELETE_ACTION_LABEL_FR}
    </button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// La confirmation d'une action qui retire quelque chose à un élève
// ────────────────────────────────────────────────────────────────────────────

/**
 * Une confirmation SIMPLE — pas de saisie, juste un arrêt.
 *
 * POURQUOI ELLE EXISTE. Ramener en brouillon un plan actuellement assigné le
 * fait disparaître de l'espace de l'élève : plus d'objectifs, plus de semaine,
 * plus de recettes. C'est un effet parfaitement légitime — un brouillon n'est
 * visible de personne, c'est la règle — mais il se produit ailleurs que là où
 * on a cliqué, et sur l'écran de quelqu'un d'autre.
 *
 * On ne l'interdit pas : on le NOMME, avec l'élève concerné, avant qu'il ait
 * lieu. La différence entre un geste subi et un geste choisi tient à cette
 * phrase.
 *
 * Elle ne protège RIEN au sens de la sécurité, et ne prétend pas le faire :
 * c'est une action du coach sur son propre contenu. Elle protège l'attention.
 */
export function ConfirmActionModal({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  busy = false,
}: {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
  readonly busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-foreground">{message}</p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onConfirm()}
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Annuler
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// La modale de confirmation de suppression
// ────────────────────────────────────────────────────────────────────────────

export interface DependencyCount {
  readonly label: string;
  readonly count: number;
}

export function DeleteConfirmationModal({
  resourceName,
  resourceKind,
  dependencies,
  blockedReason,
  sideEffect = null,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  readonly resourceName: string;
  /** « ce plan alimentaire », « cette recette » — utilisé dans les phrases. */
  readonly resourceKind: string;
  readonly dependencies: readonly DependencyCount[];
  /** `null` = la suppression est permise. Sinon, le motif PRÉCIS, en français. */
  readonly blockedReason: string | null;
  /**
   * Ce que la suppression emportera EN PLUS de la ressource elle-même —
   * « 2 journées de suivi seront également supprimées ».
   *
   * Affiché uniquement quand la suppression est PERMISE : sur une suppression
   * refusée, l'utilisateur a besoin du motif, pas d'un inventaire de ce qui
   * ne partira pas.
   */
  readonly sideEffect?: string | null;
  readonly deleting: boolean;
  readonly error: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void | Promise<void>;
}) {
  const [saisie, setSaisie] = useState("");
  const champId = useId();
  const aideId = useId();
  const bloqué = blockedReason !== null;
  const nomCorrect = matchesExactName(saisie, resourceName);

  return (
    <Modal title={`Supprimer définitivement ${resourceKind} ?`} onClose={onCancel}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-bold">{resourceName}</span>
        </p>

        <p className="text-sm leading-relaxed text-muted-foreground">
          Cette action est <span className="font-bold text-destructive">irréversible</span>. Aucune
          restauration n&apos;est possible ensuite. L&apos;archivage, lui, conserve tout et reste
          annulable.
        </p>

        {/* Ce que le SERVEUR a compté. Pas une estimation de l'écran. */}
        <dl className="flex flex-col gap-1 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm">
          {dependencies.map((dep) => (
            <div key={dep.label} className="flex items-center justify-between gap-4">
              <dt className="text-muted-foreground">{dep.label}</dt>
              <dd className="font-bold text-foreground">{dep.count}</dd>
            </div>
          ))}
        </dl>

        {bloqué ? (
          // On NOMME l'obstacle. Un bouton grisé sans explication oblige à
          // deviner, puis à réessayer au hasard.
          <p
            className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-warning"
            role="alert"
          >
            {blockedReason}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* CE QUI PART AUSSI. Dit avant le clic, à la même taille que le
                reste : une perte annoncée en petit est une perte cachée. */}
            {sideEffect && (
              <p
                className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm leading-relaxed text-warning"
                role="status"
              >
                {sideEffect}
              </p>
            )}
            <div>
            <label htmlFor={champId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
              Recopie le nom exact pour confirmer
            </label>
            <input
              id={champId}
              type="text"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              aria-describedby={aideId}
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-control border border-border bg-card px-4 py-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            />
            <p id={aideId} className="mt-2 text-xs text-muted-foreground">
              Attendu : <span className="font-bold text-foreground">{resourceName}</span>
            </p>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {!bloqué && (
            <button
              type="button"
              disabled={!nomCorrect || deleting}
              onClick={() => void onConfirm()}
              className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-destructive bg-destructive px-4 py-2 text-xs font-bold uppercase tracking-widest text-destructive-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <Trash2 size={14} />
              {deleting ? "Suppression…" : DELETE_ACTION_LABEL_FR}
            </button>
          )}
          <button
            type="button"
            onClick={onCancel}
            className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {bloqué ? "Fermer" : "Annuler"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

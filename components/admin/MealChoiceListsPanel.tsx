"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Plus, RefreshCw, X } from "lucide-react";

import { useFoodLists } from "@/hooks/useFoodLists";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { lireSnapshotDeListe, type SnapshotDeListe } from "@/lib/supabase/food-lists";
import type { MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";
import { ColorKeyDot } from "@/components/ui/ColorKeyDot";

/**
 * N1.3 — LES CHOIX ALIMENTAIRES D'UN REPAS, CÔTÉ COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'AJOUTER UNE LISTE VEUT DIRE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ ON NE POSE PAS UN LIEN, ON PREND UNE PHOTO. Au clic, la liste est lue et
 * son libellé comme ses aliments sont FIGÉS dans l'état du formulaire. À
 * partir de cet instant, plus rien ne relie l'occurrence au modèle : ajouter
 * « Thon » à la bibliothèque demain ne l'ajoutera pas à ce repas.
 *
 * ⚠️ RIEN N'EST ÉCRIT ICI. Tout part au « Enregistrer » du plan, dans la même
 * transaction que le repas lui-même — donc « repas sauvegardé, snapshot
 * manquant » n'existe pas. C'est aussi ce qui rend un ajout annulable, et ce
 * qui permet à une duplication de jour d'emporter les occurrences avec elle.
 *
 * ⚠️ AUCUN RÔLE NUTRITIONNEL, AUCUNE QUANTITÉ, AUCUNE MACRO. Une occurrence
 * porte un nom que le coach écrit pour être compris, et des identités. « Choix
 * de ta protéine » est une phrase, pas une catégorie que le moteur lira.
 *
 * Le constructeur reste COMPACT : on affiche le libellé et un compte, jamais
 * les six ou neuf aliments en permanence. « Voir les aliments » les déplie.
 */
export function MealChoiceListsPanel({
  occurrences,
  onAjouter,
  onRemplacer,
  onRetirer,
  onDeplacer,
}: {
  readonly occurrences: readonly MealChoiceSlot[];
  readonly onAjouter: (snapshot: SnapshotDeListe) => void;
  readonly onRemplacer: (slotId: string, snapshot: SnapshotDeListe) => void;
  readonly onRetirer: (slotId: string) => void;
  readonly onDeplacer: (slotId: string, direction: -1 | 1) => void;
}) {
  // `null` = fermé ; `"ajout"` = on ajoute ; sinon on REMPLACE cette occurrence.
  const [selecteur, setSelecteur] = useState<string | null>(null);

  const choisir = useCallback(
    (snapshot: SnapshotDeListe) => {
      if (selecteur === "ajout") onAjouter(snapshot);
      else if (selecteur) onRemplacer(selecteur, snapshot);
      setSelecteur(null);
    },
    [selecteur, onAjouter, onRemplacer],
  );

  return (
    <section className="mt-3 flex min-w-0 flex-col gap-2 rounded-control border border-border/70 p-3">
      <h4 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        Choix alimentaires
      </h4>

      {occurrences.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Aucune liste. Ce repas reste libre — les listes sont une aide, pas une obligation.
        </p>
      ) : (
        <ol className="flex min-w-0 flex-col gap-1">
          {occurrences.map((occurrence, index) => (
            <LigneOccurrence
              key={occurrence.id}
              occurrence={occurrence}
              index={index}
              total={occurrences.length}
              onMonter={() => onDeplacer(occurrence.id, -1)}
              onDescendre={() => onDeplacer(occurrence.id, 1)}
              onRemplacer={() => setSelecteur(occurrence.id)}
              onRetirer={() => onRetirer(occurrence.id)}
            />
          ))}
        </ol>
      )}

      <button
        type="button"
        onClick={() => setSelecteur("ajout")}
        className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-dashed border-border py-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus size={14} />
        Ajouter une liste
      </button>

      {selecteur && (
        <SelecteurDeListe
          remplacement={selecteur !== "ajout"}
          onChoisir={choisir}
          onFermer={() => setSelecteur(null)}
        />
      )}
    </section>
  );
}

/**
 * Une occurrence dans le constructeur : son libellé, son compte, ses actions.
 * Les aliments ne sont dépliés que sur demande — un repas à cinq listes
 * deviendrait illisible s'il affichait quarante lignes en permanence.
 */
function LigneOccurrence({
  occurrence,
  index,
  total,
  onMonter,
  onDescendre,
  onRemplacer,
  onRetirer,
}: {
  readonly occurrence: MealChoiceSlot;
  readonly index: number;
  readonly total: number;
  readonly onMonter: () => void;
  readonly onDescendre: () => void;
  readonly onRemplacer: () => void;
  readonly onRetirer: () => void;
}) {
  const [deplie, setDeplie] = useState(false);

  return (
    <li className="flex min-w-0 flex-col rounded-control border border-border px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="w-5 flex-shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {index + 1}.
        </span>
        {/* ⚠️ N1.6A — LA COULEUR SNAPSHOTÉE DE L'OCCURRENCE, en pastille. Elle
            vient du repas, PAS de la bibliothèque : repeindre la liste ensuite
            ne repeint pas cette occurrence. */}
        <ColorKeyDot colorKey={occurrence.colorKey} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-foreground">{occurrence.label}</span>
          <span className="text-[11px] text-muted-foreground">
            {occurrence.options.length} aliment{occurrence.options.length > 1 ? "s" : ""}
          </span>
        </span>
        <span className="flex flex-shrink-0 flex-wrap items-center gap-1">
          <BoutonIcone onClick={onMonter} disabled={index === 0} libelle={`Monter ${occurrence.label}`}>
            <ArrowUp size={14} />
          </BoutonIcone>
          <BoutonIcone
            onClick={onDescendre}
            disabled={index === total - 1}
            libelle={`Descendre ${occurrence.label}`}
          >
            <ArrowDown size={14} />
          </BoutonIcone>
          <BoutonIcone onClick={onRemplacer} disabled={false} libelle={`Remplacer ${occurrence.label}`}>
            <RefreshCw size={14} />
          </BoutonIcone>
          <BoutonIcone onClick={onRetirer} disabled={false} libelle={`Retirer ${occurrence.label}`} danger>
            <X size={14} />
          </BoutonIcone>
        </span>
      </div>

      <button
        type="button"
        onClick={() => setDeplie(!deplie)}
        aria-expanded={deplie}
        className="mt-1 flex min-h-[44px] items-center gap-1 self-start text-[11px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <ChevronDown size={12} className={deplie ? "rotate-180" : undefined} />
        Voir les aliments
      </button>
      {deplie && (
        // ⚠️ LE NOM AFFICHÉ EST HYDRATÉ, PAS SNAPSHOTÉ. Il a été retrouvé à la
        // lecture du plan, à partir de l'identité figée — en DEUX requêtes pour
        // toute la semaine, jamais une par option. Ce que le repas garde, c'est
        // l'identité ; le nom n'est que la façon de la montrer.
        //
        // ⚠️ ET SANS NOM, ON NE MENT PAS. Une identité dont la source a disparu
        // affiche « Aliment indisponible » : le plan reste ouvrable, et le
        // coach voit exactement où regarder.
        <ul className="mt-1 flex flex-col gap-0.5 pl-6">
          {occurrence.options.map((option, rang) => (
            <li key={`${option.type}-${option.id}`} className="truncate text-[11px] text-muted-foreground">
              {rang + 1}. {option.displayName ?? "Aliment indisponible"}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Le sélecteur : UNIQUEMENT les listes actives du coach connecté.
 *
 * ⚠️ Les archivées ne sont pas proposées — mais une occurrence déjà posée à
 * partir d'une liste archivée continue de vivre : son snapshot ne dépend pas
 * du statut du modèle.
 */
function SelecteurDeListe({
  remplacement,
  onChoisir,
  onFermer,
}: {
  readonly remplacement: boolean;
  readonly onChoisir: (snapshot: SnapshotDeListe) => void;
  readonly onFermer: () => void;
}) {
  const { listes, chargement, erreur } = useFoodLists();
  const [occupe, setOccupe] = useState<string | null>(null);
  const [echec, setEchec] = useState<string | null>(null);

  const prendre = useCallback(
    async (listId: string, nbAliments: number) => {
      // ⚠️ UNE LISTE VIDE NE PEUT PAS DEVENIR UNE OCCURRENCE : l'élève aurait
      // un choix sans option, donc un repas impossible à planifier. La base le
      // refuse aussi (OCCURRENCE_SANS_OPTION) — on le dit ici plutôt que de
      // laisser l'enregistrement échouer beaucoup plus tard.
      if (nbAliments === 0) {
        setEchec("Cette liste est vide : remplis-la avant de l'ajouter à un repas.");
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setEchec("Connexion indisponible.");
        return;
      }
      setEchec(null);
      setOccupe(listId);
      try {
        const snapshot = await lireSnapshotDeListe(supabase, listId);
        if (!snapshot || snapshot.options.length === 0) {
          setEchec("Cette liste n'a pas pu être lue.");
          return;
        }
        onChoisir(snapshot);
      } catch {
        setEchec("Cette liste n'a pas pu être lue.");
      } finally {
        setOccupe(null);
      }
    },
    [onChoisir],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={remplacement ? "Remplacer la liste" : "Ajouter une liste"}
      className="modal-overlay-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
    >
      <div className="flex max-h-[80vh] w-full min-w-0 max-w-md flex-col gap-3 overflow-y-auto rounded-panel border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-xs font-bold uppercase tracking-widest text-foreground">
            {remplacement ? "Remplacer la liste" : "Ajouter une liste"}
          </h5>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="pressable flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={16} />
          </button>
        </div>

        {echec && (
          <p className="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
            {echec}
          </p>
        )}

        {chargement ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : erreur ? (
          <p className="rounded-control border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            {erreur}
          </p>
        ) : listes.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">Aucune liste créée.</p>
            <Link
              href="/admin/nutrition/listes"
              className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Plus size={14} />
              Créer une liste
            </Link>
          </div>
        ) : (
          <ul className="flex min-w-0 flex-col gap-1">
            {listes.map((liste) => (
              <li key={liste.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => void prendre(liste.id, liste.nbAliments)}
                  disabled={occupe !== null}
                  className="pressable flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {/* La couleur VIVANTE de la bibliothèque : c'est celle
                        qu'on s'apprête à figer dans le repas. */}
                    <ColorKeyDot colorKey={liste.colorKey} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-foreground">{liste.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {liste.nbAliments} aliment{liste.nbAliments > 1 ? "s" : ""}
                    </span>
                  </span>
                  {occupe === liste.id && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BoutonIcone({
  onClick,
  disabled,
  libelle,
  danger = false,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly libelle: string;
  readonly danger?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={libelle}
      className={`pressable flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        danger
          ? "text-muted-foreground hover:border-destructive hover:text-destructive"
          : "text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

"use client";

import { useRef } from "react";

import {
  CATEGORIES_DU_PROFIL,
  idDeLOnglet,
  idDuPanneau,
  type CategorieProfil,
} from "@/lib/student-profile-sections";

/**
 * LA BARRE D'ONGLETS DE LA FICHE ÉLÈVE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT PAS
 * ════════════════════════════════════════════════════════════════════════
 * Elle ne fait QUE choisir l'onglet visible. Elle ne lit aucune donnée, ne monte
 * aucune section, n'appelle aucun hook métier : la page garde ses 34 hooks et
 * tous ses gestionnaires, exactement où ils étaient.
 *
 * ⚠️ ELLE NE DÉMONTE RIEN. Les six panneaux restent montés en permanence et les
 * panneaux inactifs sont seulement MASQUÉS (attribut `hidden`). C'est la
 * décision structurante du chantier : six composants enfants lisent Supabase à
 * leur montée (`RappelsEleveSection`, `CoachNutritionHistory`,
 * `ProfilPhysiologiqueSection`, `NutritionWeekSummaryCard`,
 * `StudentSubscriptionSection`, `ProgramStartDateField`). Les monter à
 * l'ouverture de leur onglet déplacerait l'instant de ces requêtes — un
 * changement de comportement, alors que ce chantier ne doit RANGER que
 * l'affichage.
 *
 * ⚠️ UN SEUL BALISAGE POUR LES DEUX TAILLES D'ÉCRAN. La même barre défile
 * horizontalement sur mobile (`overflow-x-auto`, accrochage `snap-start`) et
 * tient sur une ligne à partir de `sm`. Dupliquer le balisage en deux versions
 * cachées ferait exister deux fois les mêmes boutons dans l'arbre
 * d'accessibilité — même raison que `NutritionDayTabs`.
 *
 * ⚠️ LE DÉBORD N'EST PAS DÉCORATIF. Le conteneur de défilement est le `<main>`
 * d'`AdminShell`, qui porte `p-6 lg:p-10` : sans `-mx-6 px-6` (et son équivalent
 * `lg`) ni fond opaque, le contenu défilerait visiblement le long des bords de la
 * barre collée.
 *
 * ACCESSIBILITÉ — motif « tabs » du WAI-ARIA :
 *   - `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` ;
 *   - un SEUL onglet dans l'ordre de tabulation, flèches ← → et Origine / Fin ;
 *   - `aria-label` « Sections de la fiche élève », DISTINCT du tablist interne du
 *     Profil physiologique (« Sports ») : deux listes homonymes sur un même écran
 *     seraient indiscernables à la voix.
 */
export function StudentProfileTabs({
  selected,
  onSelect,
}: {
  readonly selected: CategorieProfil;
  readonly onSelect: (categorie: CategorieProfil) => void;
}) {
  const refs = useRef<Partial<Record<CategorieProfil, HTMLButtonElement | null>>>({});

  function déplacer(index: number) {
    const cible = CATEGORIES_DU_PROFIL[(index + CATEGORIES_DU_PROFIL.length) % CATEGORIES_DU_PROFIL.length].cle;
    onSelect(cible);
    refs.current[cible]?.focus();
  }

  function auClavier(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      déplacer(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      déplacer(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      déplacer(0);
    } else if (event.key === "End") {
      event.preventDefault();
      déplacer(CATEGORIES_DU_PROFIL.length - 1);
    }
  }

  return (
    <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border bg-background px-6 pt-1 lg:-mx-10 lg:px-10">
      <div
        role="tablist"
        aria-label="Sections de la fiche élève"
        aria-orientation="horizontal"
        className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-3 sm:mx-0 sm:snap-none sm:flex-wrap sm:overflow-visible sm:px-0"
      >
        {CATEGORIES_DU_PROFIL.map(({ cle, libelle }, index) => {
          const actif = cle === selected;
          return (
            <button
              key={cle}
              ref={(el) => {
                refs.current[cle] = el;
              }}
              type="button"
              role="tab"
              id={idDeLOnglet(cle)}
              aria-selected={actif}
              aria-controls={idDuPanneau(cle)}
              tabIndex={actif ? 0 : -1}
              onClick={() => onSelect(cle)}
              onKeyDown={(event) => auClavier(event, index)}
              className={`pressable flex min-h-[44px] shrink-0 snap-start items-center justify-center rounded-control border px-4 py-2 text-[11px] font-bold uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                actif
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              {libelle}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Le panneau d'un onglet.
 *
 * ⚠️ `hidden`, PAS UN RENDU CONDITIONNEL. `{actif && <…>}` démonterait les
 * sections de l'onglet fermé, et avec elles les lectures Supabase de leurs
 * composants enfants. L'attribut `hidden` laisse tout monté, sort le panneau de
 * l'arbre d'accessibilité, et ne change que ce qui est visible.
 *
 * ⚠️ AUCUN GRAPHIQUE N'EN SOUFFRE : les tracés de cette fiche sont des SVG à
 * `viewBox`, jamais mesurés au montage. Un composant qui se mesurerait lui-même
 * (ResizeObserver, `getBoundingClientRect`) lirait 0 dans un panneau masqué — il
 * faudrait alors le remonter à l'ouverture, et ce serait un autre chantier.
 */
export function StudentProfilePanel({
  categorie,
  selected,
  children,
}: {
  readonly categorie: CategorieProfil;
  readonly selected: CategorieProfil;
  readonly children?: React.ReactNode;
}) {
  return (
    <div
      id={idDuPanneau(categorie)}
      role="tabpanel"
      aria-labelledby={idDeLOnglet(categorie)}
      hidden={categorie !== selected}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

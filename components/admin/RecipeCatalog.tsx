"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChefHat } from "lucide-react";

import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { InvalidRecipe } from "@/lib/supabase/nutrition-recipes";
import {
  RECIPE_SLOT_KEYS,
  RECIPE_STATUSES,
  RECIPE_TAG_KINDS,
  type RecipeSlotKey,
  type RecipeStatus,
  type RecipeTagKind,
  type RecipeWithTags,
} from "@/lib/nutrition/recipe-rows";
import {
  RECIPE_SLOT_LABELS_FR,
  RECIPE_STATUS_LABELS_FR,
  RECIPE_TAG_KIND_LABELS_FR,
  describeSlot,
  describeTag,
} from "@/lib/nutrition/recipe-labels";

/**
 * Catalogue des recettes — administration.
 *
 * TRI DÉTERMINISTE : nom (locale française), puis identifiant en départage.
 * Deux affichages du même catalogue donnent le même ordre, toujours.
 *
 * Le filtrage est PUR (`filterCatalog`, exportée et testée sans rendu) : le
 * composant ne fait que l'appeler.
 *
 * Aucune lecture élève n'est ajoutée : cette page est réservée au staff, comme
 * toute l'administration.
 */

export type StatusFilter = "tous" | RecipeStatus;
export type SlotFilter = "tous" | "generic" | RecipeSlotKey;
export type TagFilter = "tous" | RecipeTagKind;

export interface CatalogFilters {
  readonly query: string;
  readonly status: StatusFilter;
  readonly slot: SlotFilter;
  readonly tagKind: TagFilter;
}

/** Nombre d'ingrédients et étiquettes affichés pour une ligne du catalogue. */
export interface CatalogRow {
  readonly record: RecipeWithTags;
  readonly ingredientCount: number;
  readonly mainTags: readonly string[];
}

function normaliser(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Filtre + trie le catalogue. Fonction PURE et déterministe : aucune mutation
 * de l'entrée, ordre stable.
 */
export function filterCatalog(
  recipes: readonly RecipeWithTags[],
  filters: CatalogFilters,
): readonly RecipeWithTags[] {
  const requête = normaliser(filters.query.trim());
  return [...recipes]
    .filter((r) => {
      if (requête !== "" && !normaliser(`${r.recipe.name} ${r.description ?? ""}`).includes(requête)) return false;
      if (filters.status !== "tous" && r.status !== filters.status) return false;
      if (filters.slot === "generic" && r.slotKey !== null) return false;
      if (filters.slot !== "tous" && filters.slot !== "generic" && r.slotKey !== filters.slot) return false;
      if (filters.tagKind !== "tous" && !r.tags.some((t) => t.kind === filters.tagKind)) return false;
      return true;
    })
    .sort((a, b) => {
      const parNom = a.recipe.name.localeCompare(b.recipe.name, "fr");
      return parNom !== 0 ? parNom : a.recipe.id.localeCompare(b.recipe.id);
    });
}

/** Date de modification, en français. « — » si la base n'en rend aucune. */
export function formatUpdatedAt(valeur: string | null): string {
  if (!valeur) return "—";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function statusTone(status: RecipeStatus): "green" | "amber" | "muted" {
  if (status === "active") return "green";
  if (status === "draft") return "amber";
  return "muted";
}

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  ...RECIPE_STATUSES.map((s) => ({ value: s as StatusFilter, label: RECIPE_STATUS_LABELS_FR[s] })),
];
const SLOT_FILTERS: { value: SlotFilter; label: string }[] = [
  { value: "tous", label: "Tous créneaux" },
  { value: "generic", label: "Génériques" },
  ...RECIPE_SLOT_KEYS.map((s) => ({ value: s as SlotFilter, label: RECIPE_SLOT_LABELS_FR[s] })),
];
const TAG_FILTERS: { value: TagFilter; label: string }[] = [
  { value: "tous", label: "Toutes étiquettes" },
  ...RECIPE_TAG_KINDS.map((k) => ({ value: k as TagFilter, label: RECIPE_TAG_KIND_LABELS_FR[k] })),
];

export function RecipeCatalog({
  recipes,
  invalid,
  loading,
  error,
  /**
   * `null` = exploitable, sinon un code de blocage, par identifiant de
   * recette. Verdict LOCAL, miroir des règles de la base — jamais sa réponse :
   * l'arbitre de l'activation reste `nutrition_recipe_blocking_issue`, dans la
   * transaction de sauvegarde.
   */
  blockingByRecipe,
}: {
  recipes: readonly RecipeWithTags[];
  invalid: readonly InvalidRecipe[];
  loading: boolean;
  error: string | null;
  blockingByRecipe?: Readonly<Record<string, string | null>>;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("tous");
  const [slot, setSlot] = useState<SlotFilter>("tous");
  const [tagKind, setTagKind] = useState<TagFilter>("tous");

  const filtrées = useMemo(
    () => filterCatalog(recipes, { query, status, slot, tagKind }),
    [recipes, query, status, slot, tagKind],
  );

  if (loading) {
    return <p className="text-sm text-muted-foreground">Chargement du catalogue…</p>;
  }

  if (error) {
    return (
      <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher une recette..." />
        <FilterButtons options={STATUS_FILTERS} active={status} onChange={setStatus} />
        <FilterButtons options={SLOT_FILTERS} active={slot} onChange={setSlot} />
        <FilterButtons options={TAG_FILTERS} active={tagKind} onChange={setTagKind} />
      </div>

      {invalid.length > 0 && (
        <div className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
          <p className="mb-1 flex items-center gap-2 font-bold uppercase tracking-widest">
            <AlertTriangle size={16} />
            {invalid.length} recette{invalid.length > 1 ? "s" : ""} illisible{invalid.length > 1 ? "s" : ""}
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {invalid.map((r) => (
              <li key={r.recipeId}>
                {r.name || r.recipeId} — {r.code}
              </li>
            ))}
          </ul>
        </div>
      )}

      {recipes.length === 0 ? (
        <div className="rounded-card border border-border bg-card p-8 text-center">
          <ChefHat size={28} className="mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Aucune recette pour le moment. Crée la première, ou importe les recettes de démonstration.
          </p>
        </div>
      ) : filtrées.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ChefHat size={16} />
          Aucune recette ne correspond à ces filtres.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {filtrées.map((r) => {
            const blocage = blockingByRecipe?.[r.recipe.id] ?? null;
            const étiquettes = r.tags.slice(0, 3);
            return (
              <Link
                key={r.recipe.id}
                href={`/admin/nutrition/recettes/${r.recipe.id}`}
                className="flex flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-soft transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-heading text-base font-bold uppercase text-foreground">
                      {r.recipe.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">{describeSlot(r.slotKey)}</p>
                  </div>
                  <StatusBadge label={RECIPE_STATUS_LABELS_FR[r.status]} tone={statusTone(r.status)} />
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    {r.recipe.ingredients.length} ingrédient{r.recipe.ingredients.length > 1 ? "s" : ""}
                  </span>
                  <span>Modifiée le {formatUpdatedAt(r.updatedAt)}</span>
                  <span>
                    {blocage === null ? (
                      <span className="text-success">Exploitable</span>
                    ) : (
                      <span className="text-warning">À compléter</span>
                    )}
                  </span>
                </div>

                {étiquettes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {étiquettes.map((t) => (
                      <span
                        key={`${t.kind}-${t.value}`}
                        className="rounded-full border border-border bg-surface-soft/50 px-3 py-1 text-xs text-muted-foreground"
                      >
                        {describeTag(t.kind, t.value)}
                      </span>
                    ))}
                    {r.tags.length > étiquettes.length && (
                      <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                        +{r.tags.length - étiquettes.length}
                      </span>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

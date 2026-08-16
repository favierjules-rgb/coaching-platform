"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type CatalogFood,
  type ProduitLocal,
  searchCachedProducts,
  searchCatalogFoods,
} from "@/lib/supabase/consumed-meals";
import type { CibleAliment } from "@/lib/supabase/food-lists";

/**
 * N1.2 — CHERCHER UN ALIMENT RÉEL, CÔTÉ COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE MÊME MOTEUR QUE L'ÉLÈVE, PAS UN SECOND
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ `searchCatalogFoods` et `searchCachedProducts` sont les fonctions d'A3/A5,
 * appelées telles quelles. Écrire ici une seconde recherche donnerait deux
 * classements, deux seuils de déclenchement et deux façons de dédoublonner —
 * et le coach ne verrait pas les mêmes aliments que son élève.
 *
 * Ce qui n'est PAS repris d'`AddFoodSheet` : le scanner, les favoris, les
 * récents et la saisie manuelle. Ils appartiennent au journal de l'élève ; ici
 * il n'y a qu'à choisir une identité.
 *
 * ⚠️ AUCUNE SAISIE LIBRE. Ce composant ne rend jamais un nom : il rend une
 * `CibleAliment`, c'est-à-dire un identifiant de `food_catalog` ou de
 * `food_products`. C'est ce qui rend structurellement impossible qu'un aliment
 * texte entre dans une liste.
 */
export function FoodSearchPicker({
  onChoisir,
  dejaPresents,
  occupe = false,
}: {
  readonly onChoisir: (cible: CibleAliment) => void | Promise<void>;
  /** Les identités déjà dans la liste — affichées comme telles, pas masquées. */
  readonly dejaPresents: ReadonlySet<string>;
  readonly occupe?: boolean;
}) {
  const [terme, setTerme] = useState("");
  const [aliments, setAliments] = useState<readonly CatalogFood[]>([]);
  const [produits, setProduits] = useState<readonly ProduitLocal[]>([]);
  const [cherche, setCherche] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const requête = useRef(0);

  const chercher = useCallback(async (valeur: string) => {
    // ⚠️ COMPTEUR DE REQUÊTES, comme partout : une réponse lente arrivée après
    // une frappe plus récente ne doit pas réécrire l'écran.
    const numéro = ++requête.current;
    if (valeur.trim().length < 2) {
      setAliments([]);
      setProduits([]);
      setCherche(false);
      setErreur(null);
      return;
    }
    setCherche(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreur("Connexion indisponible.");
      setCherche(false);
      return;
    }
    try {
      const [trouvésAliments, trouvésProduits] = await Promise.all([
        searchCatalogFoods(supabase, valeur),
        searchCachedProducts(supabase, valeur),
      ]);
      if (requête.current !== numéro) return;
      setAliments(trouvésAliments);
      setProduits(trouvésProduits);
      setErreur(null);
    } catch {
      if (requête.current !== numéro) return;
      setErreur("La recherche n'a pas abouti.");
    } finally {
      if (requête.current === numéro) setCherche(false);
    }
  }, []);

  useEffect(() => {
    // Anti-rebond de 250 ms, la même valeur que l'écran élève.
    const minuterie = setTimeout(() => void chercher(terme), 250);
    return () => clearTimeout(minuterie);
  }, [terme, chercher]);

  const trop_court = terme.trim().length > 0 && terme.trim().length < 2;
  const aucun = terme.trim().length >= 2 && !cherche && aliments.length === 0 && produits.length === 0;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Rechercher un aliment
        </span>
        <span className="relative flex min-w-0 items-center">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={terme}
            onChange={(e) => setTerme(e.target.value)}
            placeholder="poulet, riz, yaourt…"
            className="min-h-[44px] w-full min-w-0 rounded-control border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {cherche && (
            <Loader2 size={16} className="absolute right-3 animate-spin text-muted-foreground" />
          )}
        </span>
      </label>

      {erreur && (
        <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
          {erreur}
        </p>
      )}

      {trop_court && (
        <p className="text-sm text-muted-foreground">Deux lettres au minimum.</p>
      )}

      {aucun && (
        <p className="text-sm text-muted-foreground">
          Aucun aliment ne correspond à « {terme.trim()} ».
        </p>
      )}

      {(aliments.length > 0 || produits.length > 0) && (
        <ul className="flex min-w-0 flex-col gap-1">
          {aliments.map((a) => (
            <LigneResultat
              key={`aliment-${a.id}`}
              nom={a.name}
              detail={`${a.proteinPer100} P · ${a.carbPer100} G · ${a.fatPer100} L pour 100 ${a.nutritionUnit}`}
              present={dejaPresents.has(`aliment:${a.id}`)}
              occupe={occupe}
              onChoisir={() => onChoisir({ type: "aliment", id: a.id })}
            />
          ))}
          {produits.map((p) => (
            <LigneResultat
              key={`produit-${p.id}`}
              nom={p.brand ? `${p.brand} — ${p.name}` : p.name}
              detail={`${p.proteinPer100} P · ${p.carbPer100} G · ${p.fatPer100} L pour 100 ${p.nutritionUnit}`}
              present={dejaPresents.has(`produit:${p.id}`)}
              occupe={occupe}
              onChoisir={() => onChoisir({ type: "produit", id: p.id })}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Un résultat. Déjà présent : le bouton reste VISIBLE mais inactif, et le dit.
 * Le retirer de la liste laisserait le coach chercher un aliment qui n'apparaît
 * plus, sans savoir pourquoi.
 */
function LigneResultat({
  nom,
  detail,
  present,
  occupe,
  onChoisir,
}: {
  readonly nom: string;
  readonly detail: string;
  readonly present: boolean;
  readonly occupe: boolean;
  readonly onChoisir: () => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={onChoisir}
        disabled={present || occupe}
        className="pressable flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 rounded-control border border-border px-3 py-2 text-left transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm text-foreground">{nom}</span>
          <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {present ? "Déjà dans la liste" : <Plus size={16} className="text-primary" />}
        </span>
      </button>
    </li>
  );
}

/** La clé d'identité utilisée par l'écran pour repérer un doublon. */
export function cleIdentite(cible: CibleAliment): string {
  return `${cible.type}:${cible.id}`;
}

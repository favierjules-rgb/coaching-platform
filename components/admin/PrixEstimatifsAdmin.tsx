"use client";

import { useCallback, useMemo, useState } from "react";

import { FoodSearchPicker } from "@/components/admin/FoodSearchPicker";
import { NBSP } from "@/lib/nutrition/basis-points";
import { formaterMontant, type UnitePrix } from "@/lib/nutrition/budget-courses";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CibleAliment } from "@/lib/supabase/food-lists";
import { publierPrix } from "@/lib/supabase/prix-courses";
import { centsDepuisSaisie } from "@/components/student/BlocBudget";

/**
 * COURSES C3 — L'ADMINISTRATION DES PRIX ESTIMATIFS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SANS CET ÉCRAN, C3 NE SERT À RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun prix n'existe dans le projet, et aucune source externe n'en fournit :
 * Open Food Facts ne renvoie pas de prix, et le contrat `OFF_FIELDS` n'en
 * demande aucun. Sans un endroit pour les saisir, l'écran budget de l'élève
 * afficherait éternellement « 0 / 20 articles estimés ».
 *
 * ⚠️ AUCUN CATALOGUE N'EST REFAIT ICI. `FoodSearchPicker` est le composant N1.2,
 * qui cherche déjà dans `food_catalog` ET `food_products` et rend une
 * `CibleAliment` — c'est-à-dire l'identité XOR exacte dont un prix a besoin.
 * En écrire un second donnerait deux classements et deux façons de
 * dédoublonner.
 *
 * ⚠️ ET AUCUN PRIX N'EST DEVINÉ. Ni depuis Internet, ni depuis un nom, ni
 * depuis une moyenne. Ce que l'admin saisit est ce qui est stocké : deux
 * nombres lus sur une étiquette, « 249 centimes pour 1 000 g ».
 */
export function PrixEstimatifsAdmin() {
  const [cible, setCible] = useState<CibleAliment | null>(null);
  const [prixTexte, setPrixTexte] = useState("");
  const [quantiteTexte, setQuantiteTexte] = useState("");
  const [unite, setUnite] = useState<UnitePrix>("g");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ton: "ok" | "ko"; texte: string } | null>(null);

  const cents = useMemo(() => centsDepuisSaisie(prixTexte), [prixTexte]);
  const quantite = useMemo(() => {
    const t = quantiteTexte.trim().replace(",", ".");
    if (t === "") return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [quantiteTexte]);

  const valide = cible !== null && cents !== null && quantite !== null;

  const enregistrer = useCallback(async () => {
    if (!valide || cible === null || cents === null || quantite === null) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setMessage({ ton: "ko", texte: "Connexion indisponible." });
      return;
    }
    setEnCours(true);
    setMessage(null);
    try {
      const reussi = await publierPrix(supabase, {
        catalogFoodId: cible.type === "aliment" ? cible.id : null,
        productId: cible.type === "produit" ? cible.id : null,
        priceCents: cents,
        quantite,
        unite,
      });
      if (reussi) {
        setMessage({
          ton: "ok",
          texte: `Prix enregistré : ${formaterMontant(cents)} pour ${quantite}${NBSP}${unite}.`,
        });
        setPrixTexte("");
        setQuantiteTexte("");
        setCible(null);
      } else {
        // ⚠️ ON NE DIT PAS « erreur inconnue ». Le refus le plus probable est la
        // policy `is_admin()` : le dire fait gagner dix minutes.
        setMessage({
          ton: "ko",
          texte: "Enregistrement refusé. Seul un administrateur peut publier un prix.",
        });
      }
    } finally {
      setEnCours(false);
    }
  }, [valide, cible, cents, quantite, unite]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">PRIX ESTIMATIFS</h1>
        <p className="text-sm text-muted-foreground">
          Un ordre de grandeur par aliment, utilisé pour estimer le coût des listes de courses.
          Aucun magasin, aucune promotion&nbsp;: ces notions arriveront plus tard.
        </p>
      </header>

      {/* ── 1. L'IDENTITÉ ────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">1. Choisis l&apos;aliment ou le produit</h2>
        {cible === null ? (
          <FoodSearchPicker onChoisir={(c) => setCible(c)} dejaPresents={new Set()} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 rounded-panel border border-border bg-muted/40 px-3 py-2">
            <span className="text-sm">
              {cible.type === "aliment" ? "Aliment" : "Produit"}
              {NBSP}·{NBSP}
              <code className="text-xs">{cible.id.slice(0, 8)}</code>
            </span>
            <button
              type="button"
              onClick={() => setCible(null)}
              className="min-h-11 rounded-pill border border-border px-3 text-xs transition hover:bg-muted"
            >
              Changer
            </button>
          </div>
        )}
      </section>

      {/* ── 2. LE PRIX ET SA QUANTITÉ DE RÉFÉRENCE ───────────────────────── */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">2. Le prix, et ce qu&apos;il achète</h2>

        {/* ⚠️ DEUX NOMBRES, PAS UN PRIX AU GRAMME. « 2,49 € » et « 1000 g »
            sont ce qu'un humain lit sur une étiquette ; « 0,00249 €/g » est un
            flottant qui perd sa précision et ne dit plus d'où il vient. */}
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">Prix</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={prixTexte}
                onChange={(e) => setPrixTexte(e.target.value)}
                placeholder="2,49"
                aria-label="Prix en euros"
                className="min-h-11 w-28 rounded-panel border border-border bg-background px-3 py-2 text-sm tabular-nums"
              />
              <span className="text-sm text-muted-foreground">€</span>
            </div>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">Pour</span>
            <input
              type="text"
              inputMode="decimal"
              value={quantiteTexte}
              onChange={(e) => setQuantiteTexte(e.target.value)}
              placeholder="1000"
              aria-label="Quantité de référence"
              className="min-h-11 w-28 rounded-panel border border-border bg-background px-3 py-2 text-sm tabular-nums"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-muted-foreground">Unité</span>
            <select
              value={unite}
              onChange={(e) => setUnite(e.target.value as UnitePrix)}
              aria-label="Unité"
              className="min-h-11 rounded-panel border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="piece">pièce</option>
            </select>
          </label>
        </div>

        {/* ⚠️ AUCUNE CONVERSION, MÊME POUR AIDER. Un prix « au kilo » se saisit
            « 2,49 € pour 1000 g » : la donnée métier reste en grammes. */}
        <p className="text-xs text-muted-foreground">
          Un prix au kilo se saisit «&nbsp;pour 1000&nbsp;g&nbsp;», un prix au litre «&nbsp;pour
          1000&nbsp;ml&nbsp;». Les unités ne sont jamais converties.
        </p>

        {valide && (
          <p className="text-sm text-muted-foreground" role="status">
            Sera enregistré&nbsp;: <strong>{formaterMontant(cents)}</strong> pour {quantite}
            {NBSP}
            {unite}.
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void enregistrer()}
          disabled={!valide || enCours}
          className="min-h-11 rounded-pill bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
        >
          {enCours ? "Enregistrement…" : "Enregistrer ce prix"}
        </button>
      </div>

      {message !== null && (
        <p
          className={`text-sm ${message.ton === "ok" ? "text-success" : "text-destructive"}`}
          role={message.ton === "ok" ? "status" : "alert"}
        >
          {message.texte}
        </p>
      )}

      {/* ⚠️ LE REMPLACEMENT EST DIT, PAS SUBI. Publier un prix archive le
          précédent : l'index unique partiel n'admet qu'un seul prix ACTIF par
          (identité, unité). L'ancien reste lisible en base. */}
      <p className="text-xs text-muted-foreground">
        Enregistrer un prix remplace le précédent pour cette identité et cette unité. L&apos;ancien
        est archivé, jamais supprimé.
      </p>
    </div>
  );
}

import { NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/validate";
import { uuidSchema } from "@/lib/api/schemas/common";
import { z } from "zod";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { lireObservationsPrix } from "@/lib/open-prices/observations";
import {
  type EntreeLigne,
  budgetObserve,
  comparerAuBudget,
} from "@/lib/nutrition/budget-observe";
import { cleIdentite, gtinsParIdentite } from "@/lib/nutrition/prix-observes";
import { etatPrixObserves } from "@/lib/nutrition/prix-observes";
import { scenariosAchat } from "@/lib/nutrition/conditionnements";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { OBSERVED_PRICES } from "@/lib/security/rules";
import { lireConditionnements } from "@/lib/supabase/conditionnements";
import {
  lireGtinsDeLaListe,
  lireOpLocationIdDuMagasinChoisi,
} from "@/lib/supabase/prix-observes";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.6 — POST /api/student/shopping-list/observed-prices
 *
 * Le MINIMUM OBSERVÉ d'une liste de courses, dans le magasin que l'élève a
 * choisi. Lecture seule, de bout en bout.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LE NAVIGATEUR DÉSIGNE, IL NE DÉCRIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Le corps ne porte qu'un identifiant de liste. Ni quantités, ni unités, ni
 * code-barres : le serveur relit tout sous la RLS de l'élève. Sans cela, un
 * navigateur pourrait annoncer « j'ai besoin de 3 g » et obtenir un minimum
 * ridicule, ou désigner les code-barres d'un autre aliment.
 *
 * ⚠️ POURQUOI UNE ROUTE ET PAS UN HOOK QUI LIRAIT DIRECTEMENT. Open Prices
 * s'interroge depuis le SERVEUR — `lib/open-prices/observations.ts` est marqué
 * `server-only`, et l'en-tête `User-Agent` exigé par l'amont n'a rien à faire
 * dans un bundle client.
 *
 * ⚠️ UN SEUL LOT AMONT POUR TOUTE LA LISTE, ET C'EST DÉLIBÉRÉ. Interroger
 * Open Prices ligne par ligne multiplierait les allers-retours vers un service
 * bénévole ; le filtre porte de toute façon sur `location_id` + une liste de
 * code-barres, donc un appel groupé répond à la même question.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE : `tronque` et `ignores` sont GLOBAUX à la lecture, et
 * ils sont donc reportés sur CHAQUE ligne. C'est grossier, et c'est grossier
 * DANS LE BON SENS : un doute quelque part devient un doute partout, jamais
 * l'inverse. Découper la troncature lot par lot serait plus fin ; ce serait
 * aussi plus de code pour rendre certaines lignes MOINS prudentes.
 *
 * ⚠️ AUCUNE ÉCRITURE, AUCUN APPEL OPEN FOOD FACTS. Le conditionnement vient de
 * `food_products`, déjà persisté depuis le lot A3.
 */

const corpsSchema = z.object({ listId: uuidSchema }).strict();

interface LigneBrute {
  readonly id: string;
  readonly source: string;
  readonly catalog_food_id: string | null;
  readonly product_id: string | null;
  readonly quantity: number | string | null;
  readonly unit: string | null;
}

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, corpsSchema);
  if (!parsed.success) return parsed.response;

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentification requise." }, { status: 401 });

  const { data: eleve } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!eleve) return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  const studentId = (eleve as { id: string }).id;

  const quota = await consumeRateLimit(
    rateLimitKey([OBSERVED_PRICES.name, user.id]),
    OBSERVED_PRICES,
  );
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de calculs de prix. Réessaie dans une minute.");
  }

  // ── 1. LA LISTE, SOUS LA RLS DE L'ÉLÈVE ───────────────────────────────────
  // ⚠️ `student_id` EST FILTRÉ EN PLUS DE LA POLICY. La RLS est le rempart ;
  // ce filtre est la ceinture, et il rend la requête lisible sans elle.
  const { data: brutes, error } = await supabase
    .from("shopping_list_items")
    .select("id, source, catalog_food_id, product_id, quantity, unit")
    .eq("list_id", parsed.data.listId)
    .eq("student_id", studentId);
  if (error) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const lignes = (Array.isArray(brutes) ? brutes : []) as unknown as readonly LigneBrute[];

  /**
   * ⚠️ LE PÉRIMÈTRE EST CELUI DE L'ÉCRAN, PAS CELUI DES IDENTITÉS.
   *
   * `lignesAAfficher` (C2) rend les lignes PLAN bien formées PUIS les lignes
   * MANUELLES, cochées comprises, et C3 compte exactement cet ensemble dans
   * `articlesTotal`. C4.6 reprend ce périmètre : sans quoi une liste de trois
   * articles dont un manuel afficherait « 2 / 2 articles chiffrés » — un taux
   * de couverture flatteur, et faux.
   *
   * La seule exclusion est celle que l'écran fait déjà : une ligne PLAN sans
   * identité, sans quantité ou sans unité n'est pas affichée à l'élève
   * (`cleDeLignePersistee` rend `null`, la boucle passe). Elle ne doit donc pas
   * entrer dans un dénominateur que l'élève ne peut pas vérifier des yeux.
   * La contrainte `shopping_list_items_plan_check` la rend déjà impossible ;
   * on la refuse quand même, parce qu'une fonction ne se protège pas avec un
   * CHECK situé ailleurs.
   */
  const visibles = lignes.filter((l) => {
    if (l.source === "manual") return true;
    if (l.source !== "plan") return false;
    const cibles = (l.catalog_food_id !== null ? 1 : 0) + (l.product_id !== null ? 1 : 0);
    return cibles === 1 && l.quantity !== null && l.unit !== null;
  });
  const duPlan = visibles.filter((l) => l.source === "plan");

  // ── 2. LE MAGASIN ─────────────────────────────────────────────────────────
  const opLocationId = await lireOpLocationIdDuMagasinChoisi(supabase, studentId);

  // ── 3. LES CODE-BARRES DE CHAQUE IDENTITÉ ─────────────────────────────────
  const catalogFoodIds = [
    ...new Set(duPlan.map((l) => l.catalog_food_id).filter((v): v is string => v !== null)),
  ];
  const productIds = [
    ...new Set(duPlan.map((l) => l.product_id).filter((v): v is string => v !== null)),
  ];
  const gtinsLus = await lireGtinsDeLaListe(supabase, { catalogFoodIds, productIds });
  if (!gtinsLus.ok) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const parIdentite = gtinsParIdentite({
    produitsDirects: gtinsLus.produitsDirects,
    produitsRelies: gtinsLus.produitsRelies,
  });
  const gtinsDeLigne = (l: LigneBrute): readonly string[] => {
    if (l.catalog_food_id !== null) {
      return parIdentite.get(cleIdentite("catalog_food", l.catalog_food_id)) ?? [];
    }
    if (l.product_id !== null) {
      return parIdentite.get(cleIdentite("product", l.product_id)) ?? [];
    }
    return [];
  };

  const tousLesGtins = [...new Set(duPlan.flatMap(gtinsDeLigne))];

  // ── 4. LES CONDITIONNEMENTS ET LES RELEVÉS ────────────────────────────────
  const conditionnements = await lireConditionnements(supabase, tousLesGtins);
  if (!conditionnements.ok) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  let lecture: Awaited<ReturnType<typeof lireObservationsPrix>> | null = null;
  if (opLocationId !== null && tousLesGtins.length > 0) {
    try {
      lecture = await lireObservationsPrix({ gtins: tousLesGtins, opLocationId });
    } catch (erreur) {
      if (estOffNonConfigure(erreur)) {
        console.error(`[PrixObserves] ${erreur.message}`);
        return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
      }
      throw erreur;
    }
  }

  // ── 5. UNE ENTRÉE PAR LIGNE ───────────────────────────────────────────────
  const entrees: EntreeLigne[] = visibles.map((l): EntreeLigne => {
    // ⚠️ UNE LIGNE MANUELLE NE DÉCLENCHE AUCUNE LECTURE ET N'EN ATTEND AUCUNE.
    // Elle traverse la chaîne pour être COMPTÉE, et ressort avec sa raison.
    // ⚠️ ET SON `estimated_price_cents` N'EST MÊME PAS LU : il n'est pas dans
    // le `select` ci-dessus, et c'est délibéré — un prix C3 ne doit pas
    // pouvoir se faufiler dans un minimum OBSERVÉ.
    if (l.source === "manual") {
      return {
        ligneId: l.id,
        origine: "manuel",
        etat: "aucun_produit_relie",
        tronque: false,
        ignores: 0,
        raisonIndisponible: null,
        scenarios: [],
      };
    }
    const gtins = gtinsDeLigne(l);
    const observationsDeLaLigne = (lecture?.observations ?? []).filter((o) =>
      gtins.includes(o.gtin),
    );
    const resultat = etatPrixObserves({
      opLocationId,
      gtins,
      lecture:
        lecture === null
          ? null
          : { ...lecture, observations: observationsDeLaLigne },
    });
    const scenarios = scenariosAchat({
      besoin: { quantite: l.quantity, unite: l.unit },
      observations: resultat.observations,
      conditionnements: conditionnements.parGtin,
    });
    return {
      ligneId: l.id,
      origine: "plan",
      etat: resultat.etat,
      tronque: resultat.tronque,
      ignores: resultat.ignores,
      raisonIndisponible: resultat.raison,
      scenarios,
    };
  });

  // ── 6. LE BUDGET ──────────────────────────────────────────────────────────
  const { data: liste } = await supabase
    .from("shopping_lists")
    .select("budget_cents")
    .eq("id", parsed.data.listId)
    .eq("student_id", studentId)
    .maybeSingle();
  const budgetCents =
    liste !== null && typeof (liste as { budget_cents?: unknown }).budget_cents === "number"
      ? ((liste as { budget_cents: number }).budget_cents)
      : null;

  const budget = budgetObserve(entrees);
  return NextResponse.json({
    budget,
    comparaison: comparerAuBudget(budget, budgetCents),
    magasinChoisi: opLocationId !== null,
  });
}

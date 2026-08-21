import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api/authz";
import { OFF_ATTRIBUTION, estOffErreur } from "@/lib/open-food-facts/contrat";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { chercherProduitsParCodeCiqual } from "@/lib/open-food-facts/recherche-ciqual";
import { lireApercusPrix } from "@/lib/open-prices/apercu";
import {
  MESSAGE_REFUS,
  codeCiqualEstValide,
  etatRapprochement,
} from "@/lib/nutrition/pont-retail";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { FOOD_BRIDGE_SEARCH } from "@/lib/security/rules";
import {
  lireAlimentDuPont,
  lireProduitsRapproches,
  lireRevue,
} from "@/lib/supabase/pont-retail";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.1 — GET /api/admin/food-bridge/candidates?catalogFoodId=<uuid>
 *
 * Les candidats produits d'un aliment générique, trouvés PAR SON CODE CIQUAL.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CETTE ROUTE NE RENVOIE AUCUN PRIX À AFFICHER DANS UN TOTAL
 * ────────────────────────────────────────────────────────────────────────────
 * Elle rend, par candidat, un APERÇU : « combien de relevés, à quelle date, et
 * combien viennent d'une étiquette de rayon ». C'est une aide à la décision de
 * curation, pas une estimation. Aucun montant ne traverse.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE N'EST PAS UN PROXY
 * ────────────────────────────────────────────────────────────────────────────
 * Le client envoie UN identifiant d'aliment, et rien d'autre : ni code Ciqual,
 * ni `page_size`, ni `fields`, ni URL. Le code Ciqual est LU EN BASE depuis
 * `food_catalog.source_ref`, jamais reçu du navigateur — sans quoi un
 * administrateur pourrait interroger Open Food Facts à sa guise à travers
 * SETH, et le quota partagé du serveur avec.
 */

interface CandidatDTO {
  gtin: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  netQuantity: number | null;
  netUnit: "g" | "ml" | null;
  nutritionUnit: "g" | "ml";
  proteinPer100: number;
  carbPer100: number;
  fatPer100: number;
  /** Aperçu Open Prices — informatif. `null` si la lecture a échoué. */
  prix: {
    statut: "connu" | "aucun" | "indetermine";
    nombre: number;
    nombreCommunity: number;
    observeLe: string | null;
  } | null;
  dejaRapproche: boolean;
}

export async function GET(request: Request) {
  const catalogFoodId = new URL(request.url).searchParams.get("catalogFoodId")?.trim() ?? "";
  if (catalogFoodId === "") {
    return NextResponse.json({ error: "Aliment non précisé." }, { status: 400 });
  }

  // ⚠️ ADMIN, PAS STAFF. Le pont produit est une donnée GLOBALE, partagée par
  // tous les élèves de tous les coachs — même doctrine que les prix en C3.
  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const quota = await consumeRateLimit(
    rateLimitKey([FOOD_BRIDGE_SEARCH.name, acces.user.id]),
    FOOD_BRIDGE_SEARCH,
  );
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans une minute.");
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const aliment = await lireAlimentDuPont(supabase, catalogFoodId);
  if (!aliment) {
    return NextResponse.json({ error: "Aliment introuvable." }, { status: 404 });
  }

  const [produitsLies, revue] = await Promise.all([
    lireProduitsRapproches(supabase, catalogFoodId),
    lireRevue(supabase, catalogFoodId),
  ]);
  const etat = etatRapprochement(catalogFoodId, produitsLies, revue);

  // ⚠️ PAS DE CODE CIQUAL EXPLOITABLE ⇒ ZÉRO CANDIDAT, ET AUCUN APPEL SORTANT.
  // Il n'existe AUCUN repli par nom, ni ici ni ailleurs. Chercher « beurre » en
  // texte ramènerait du beurre de cacahuète, du beurre de karité et des gâteaux
  // au beurre — et le rapprochement porterait le prix de l'un sur l'autre.
  if (aliment.codeCiqual === null || !codeCiqualEstValide(aliment.codeCiqual)) {
    return NextResponse.json({
      aliment: { id: aliment.id, name: aliment.name, codeCiqual: aliment.codeCiqual },
      etat,
      revue,
      produitsLies: produitsLies.map((p) => ({ gtin: p.gtin, name: p.productName })),
      candidats: [] as CandidatDTO[],
      nonImportables: [],
      totalOff: 0,
      sansCodeCiqual: true,
      attribution: OFF_ATTRIBUTION,
    });
  }

  try {
    const resultat = await chercherProduitsParCodeCiqual(aliment.codeCiqual);

    // Les aperçus de prix, en lots de 7 au plus — garde-fou du §9.
    const apercus = await lireApercusPrix(resultat.importables.map((c) => c.gtin));
    const gtinsLies = new Set(produitsLies.map((p) => p.gtin));

    const candidats: CandidatDTO[] = resultat.importables.map(({ gtin, produit }) => {
      const apercu = apercus.apercus.get(gtin);
      return {
        gtin,
        name: produit.productName,
        brand: produit.brand,
        imageUrl: produit.imageUrl,
        netQuantity: produit.netQuantity,
        netUnit: produit.netUnit,
        nutritionUnit: produit.nutritionUnit,
        proteinPer100: produit.proteinPer100,
        carbPer100: produit.carbPer100,
        fatPer100: produit.fatPer100,
        // ⚠️ `ok: false` ⇒ `null`, PAS un aperçu à zéro. Une panne de lecture
        // n'est pas « aucun prix » : l'écran doit dire « indisponible ».
        prix:
          apercus.ok && apercu
            ? {
                statut: apercu.statut,
                nombre: apercu.nombre,
                nombreCommunity: apercu.nombreCommunity,
                observeLe: apercu.observeLe,
              }
            : null,
        dejaRapproche: gtinsLies.has(gtin),
      };
    });

    return NextResponse.json({
      aliment: { id: aliment.id, name: aliment.name, codeCiqual: aliment.codeCiqual },
      etat,
      revue,
      produitsLies: produitsLies.map((p) => ({ gtin: p.gtin, name: p.productName })),
      candidats,
      // ⚠️ RENDUS, PAS MASQUÉS. Un candidat réel que `food_products` ne peut pas
      // accueillir doit se voir, avec sa raison : sinon l'administrateur croit
      // à un bug de recherche et cherche ailleurs.
      nonImportables: resultat.nonImportables.map((n) => ({
        gtin: n.gtin,
        name: n.nom,
        raison: MESSAGE_REFUS[n.refus],
      })),
      totalOff: resultat.totalOff,
      ...(apercus.ok ? {} : { prixIndisponibles: true }),
      attribution: OFF_ATTRIBUTION,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[OpenFoodFacts] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    if (estOffErreur(erreur)) {
      return NextResponse.json(
        { error: "La recherche de candidats a échoué.", code: erreur.code },
        { status: erreur.code === "OFF_RATE_LIMITED" ? 429 : 503 },
      );
    }
    console.error("[PontRetail] échec inattendu de la recherche de candidats", erreur);
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}

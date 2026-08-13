import { NextResponse } from "next/server";

import {
  OFF_ATTRIBUTION,
  type OffErreurCode,
  estOffErreur,
} from "@/lib/open-food-facts/contrat";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import {
  RECHERCHE_Q_MAX,
  RECHERCHE_Q_MIN,
  RECHERCHE_RESULTATS_MAX,
  chercherProduitsParTexte,
  lireRequete,
} from "@/lib/open-food-facts/recherche";
import { resoudreRechercheProduits } from "@/lib/open-food-facts/resolution";
import {
  consumeRateLimit,
  rateLimitKey,
  refusDeLimite,
} from "@/lib/security/rate-limit";
import {
  FOOD_PRODUCT_SEARCH_EXTERNAL,
  FOOD_PRODUCT_SEARCH_LOCAL,
} from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  enregistrerProduitsDeRecherche,
  lireProduitsParGtins,
  rechercherProduitsLocaux,
} from "@/lib/supabase/food-products";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * RECHERCHE TEXTE DE PRODUITS — LA COUCHE SERVEUR SETH.
 * (ALIMENTS A3, PHASE 4)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX MODES, ET UN SEUL DÉCLENCHE UN APPEL SORTANT
 * ────────────────────────────────────────────────────────────────────────────
 *   GET /api/food-products/search?q=skyr
 *       → recherche LOCALE seule. Aucun appel sortant, jamais. C'est ce que
 *         l'écran appellera au fil de la frappe, s'il le fait.
 *
 *   GET /api/food-products/search?q=skyr&external=true
 *       → recherche locale PUIS, au plus, UNE requête externe. C'est ce que
 *         l'écran appellera sur un bouton « Rechercher les produits », et rien
 *         d'autre.
 *
 * Le paramètre est explicite parce que la distinction est structurelle : Open
 * Food Facts limite les recherches à 10 par minute et par IP — celle du
 * serveur, partagée par tous les élèves — et bannit les récidivistes. Une
 * recherche au fil de la frappe ferait bannir SETH entier au premier élève qui
 * tape « chocolat » lettre par lettre. La documentation d'OFF le dit
 * elle-même : « don't use it for a search-as-you-type feature ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE N'EST PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Un proxy. Le client envoie UN texte, et rien d'autre : ni `page_size`, ni
 * `fields`, ni `index_id`, ni URL. Tous les paramètres d'Open Food Facts sont
 * des constantes de `lib/open-food-facts/recherche.ts`, et le texte est
 * échappé avant d'entrer dans une requête Lucene. Un client ne peut donc pas
 * se servir de SETH pour interroger OFF à sa guise.
 *
 * Elle ne rend jamais `source_payload` non plus : le DTO est construit champ
 * par champ, et un ajout de colonne en base ne peut pas fuir par accident.
 */

/** Erreur métier → code HTTP, comme sur la route de lookup. */
const STATUT_PAR_CODE: Record<OffErreurCode, number> = {
  INVALID_GTIN: 400,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_NUTRITION_INCOMPLETE: 422,
  OFF_RATE_LIMITED: 429,
  OFF_UNAVAILABLE: 503,
  OFF_INVALID_RESPONSE: 502,
};

const MESSAGE_REQUETE: Record<"vide" | "trop_courte" | "trop_longue", string> = {
  vide: "Saisis un nom de produit ou une marque.",
  trop_courte: `Il faut au moins ${RECHERCHE_Q_MIN} caractères pour chercher.`,
  trop_longue: `La recherche est limitée à ${RECHERCHE_Q_MAX} caractères.`,
};

/**
 * Le DTO rendu au navigateur. Écrit à la main, champ par champ — jamais un
 * `...produit` qui laisserait passer ce qu'on ajoutera demain.
 */
interface ProduitDTO {
  id: string;
  gtin: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  proteinPer100: number;
  carbPer100: number;
  fatPer100: number;
  /** Dérivé 4/4/9 par SETH — jamais l'énergie publiée par la source. */
  kcalPer100: number;
  nutritionUnit: "g" | "ml";
  stale: boolean;
  source: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const lecture = lireRequete(url.searchParams.get("q"));
  if (!lecture.ok) {
    return NextResponse.json(
      { error: MESSAGE_REQUETE[lecture.raison], code: `QUERY_${lecture.raison.toUpperCase()}` },
      { status: 400 },
    );
  }
  const q = lecture.q;

  // Seul `true` littéral active l'externe. Tout le reste — absent, « 1 »,
  // « oui », « TRUE » — reste local : un mode qui coûte un appel réseau ne
  // s'active pas par une valeur approchante.
  const avecExterne = url.searchParams.get("external") === "true";

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // Authentification AVANT tout : sans elle, cette route serait un moyen
  // gratuit de faire consommer le quota OFF du serveur.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  // Quota par UTILISATEUR, avec le limiteur déjà en place dans le projet
  // (Upstash en production, mémoire ailleurs). Rien de neuf n'est installé.
  const regle = avecExterne ? FOOD_PRODUCT_SEARCH_EXTERNAL : FOOD_PRODUCT_SEARCH_LOCAL;
  const quota = await consumeRateLimit(rateLimitKey([regle.name, user.id]), regle);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans une minute.");
  }

  const maintenant = new Date();

  // Le client admin n'est requis QUE pour écrire le cache, donc uniquement en
  // mode externe. En mode local, son absence ne doit rien empêcher.
  const admin = avecExterne ? createSupabaseAdminClient() : null;
  if (avecExterne && !admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // Construite ICI plutôt qu'avec un `!` dans l'appel : le mode local n'a pas
  // de client admin, et n'écrit rien — la fonction inerte le dit mieux qu'une
  // assertion qui promettrait une valeur qu'on sait absente.
  const ecrireLot = admin
    ? (produits: Parameters<typeof enregistrerProduitsDeRecherche>[1],
       connues: Parameters<typeof enregistrerProduitsDeRecherche>[2]) =>
        enregistrerProduitsDeRecherche(admin, produits, connues, maintenant)
    : async () => ({ ecrits: [] as never[] });

  try {
    const resolution = await resoudreRechercheProduits(q, avecExterne, {
      chercherLocal: (texte) =>
        rechercherProduitsLocaux(supabase, texte, RECHERCHE_RESULTATS_MAX, maintenant),
      chercherExterne: (texte) => chercherProduitsParTexte(texte),
      lireConnues: (gtins) => lireProduitsParGtins(supabase, gtins, maintenant),
      ecrireLot,
    });

    const produits: ProduitDTO[] = resolution.produits
      .slice(0, RECHERCHE_RESULTATS_MAX)
      .map((p) => ({
        id: p.id,
        gtin: p.gtin,
        name: p.productName,
        brand: p.brand,
        imageUrl: p.imageUrl,
        proteinPer100: p.proteinPer100,
        carbPer100: p.carbPer100,
        fatPer100: p.fatPer100,
        kcalPer100: p.kcalPer100,
        nutritionUnit: p.nutritionUnit,
        stale: p.stale,
        source: p.source,
      }));

    return NextResponse.json({
      query: q,
      products: produits,
      source: resolution.source,
      // Champ OPTIONNEL : présent seulement quand il y a quelque chose à dire.
      ...(resolution.externalUnavailable ? { externalUnavailable: true } : {}),
      // Attribution ODbL, rendue avec la donnée pour que l'écran de la phase 5
      // n'ait pas à la reconstituer — et ne puisse pas l'oublier.
      attribution: OFF_ATTRIBUTION,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      // Notre faute, pas celle d'OFF. Le détail reste au journal serveur.
      console.error(`[OpenFoodFacts] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    if (estOffErreur(erreur)) {
      // Ne devrait pas arriver — `resoudreRechercheProduits` absorbe les
      // pannes externes pour préserver les résultats locaux. On traduit
      // quand même, plutôt que de rendre une 500 muette.
      return NextResponse.json(
        { error: "La recherche externe a échoué.", code: erreur.code },
        { status: STATUT_PAR_CODE[erreur.code] },
      );
    }
    console.error("[OpenFoodFacts] échec inattendu de la recherche", erreur);
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}

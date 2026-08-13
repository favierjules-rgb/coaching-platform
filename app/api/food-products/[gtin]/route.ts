import { NextResponse } from "next/server";
import { z } from "zod";

import { parseParams } from "@/lib/api/validate";
import {
  OFF_ATTRIBUTION,
  type OffErreurCode,
  estOffErreur,
} from "@/lib/open-food-facts/contrat";
import { chercherProduitParGtin, estOffNonConfigure } from "@/lib/open-food-facts/client";
import { resoudreProduitParGtin } from "@/lib/open-food-facts/resolution";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enregistrerProduit, lireProduitEnCache } from "@/lib/supabase/food-products";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * LOOKUP D'UN PRODUIT PAR CODE-BARRES — LA COUCHE SERVEUR SETH.
 * (ALIMENTS A3, PHASE 3)
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE EST
 * ────────────────────────────────────────────────────────────────────────────
 * Le SEUL point de l'application par lequel Open Food Facts est joignable. Le
 * navigateur envoie un code-barres et reçoit un DTO SETH ; il ne connaît ni
 * l'URL d'OFF, ni sa version d'API, ni son schéma, ni ses codes HTTP.
 *
 * Cette indirection a un coût — une route de plus — et une raison : la
 * recherche TEXTE d'Open Food Facts n'existe pas en v3 et devra passer par
 * Search-a-licious, une API sans SLA appelée à changer. Le jour où elle
 * arrivera, elle arrivera ICI. L'interface, elle, ne bougera pas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE N'EST PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Un proxy ouvert. L'authentification est exigée avant tout appel sortant :
 * sans elle, n'importe qui pourrait faire consommer notre quota OFF — 15
 * requêtes/minute par IP, dépassement répété = bannissement de l'IP du
 * serveur, c'est-à-dire panne pour TOUS les élèves à la fois.
 *
 * Elle n'écrit RIEN dans le journal alimentaire non plus : elle renseigne, et
 * la consommation reste l'affaire de la RPC `ajouter_aliment_produit`.
 */

const gtinParamSchema = z
  .object({
    // Forme seulement, et volontairement large : la règle exacte vit dans
    // `exigerGtin` (contrat.ts), en un seul endroit. Ce schéma ne fait que
    // barrer l'évidence — un segment d'URL qui n'est pas une suite de chiffres
    // n'a aucune chance d'être un code-barres.
    gtin: z.string().regex(/^[0-9]{6,20}$/, { message: "Doit être une suite de chiffres." }),
  })
  .strict();

/** Erreur métier → code HTTP. Traduction faite ICI, une fois. */
const STATUT_PAR_CODE: Record<OffErreurCode, number> = {
  INVALID_GTIN: 400,
  PRODUCT_NOT_FOUND: 404,
  PRODUCT_NUTRITION_INCOMPLETE: 422,
  OFF_RATE_LIMITED: 429,
  OFF_UNAVAILABLE: 503,
  OFF_INVALID_RESPONSE: 502,
};

/**
 * Messages destinés à l'élève. Ils disent quoi FAIRE, pas ce qui a cassé :
 * « Open Food Facts a rendu 503 » n'apprend rien à quelqu'un debout dans un
 * rayon de supermarché.
 */
const MESSAGE_PAR_CODE: Record<OffErreurCode, string> = {
  INVALID_GTIN: "Ce code-barres n'a pas un format valide.",
  PRODUCT_NOT_FOUND:
    "Ce produit n'est pas dans Open Food Facts. Tu peux le saisir à la main avec les valeurs de l'emballage.",
  PRODUCT_NUTRITION_INCOMPLETE:
    "Ce produit existe, mais ses valeurs nutritionnelles ne sont pas renseignées. Saisis-les à la main depuis l'emballage.",
  OFF_RATE_LIMITED: "Trop de recherches à la suite. Réessaie dans une minute.",
  OFF_UNAVAILABLE: "Open Food Facts est momentanément injoignable. Réessaie dans un instant.",
  OFF_INVALID_RESPONSE: "Réponse inattendue d'Open Food Facts. Réessaie dans un instant.",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ gtin: string }> },
) {
  const parsed = parseParams(await params, gtinParamSchema);
  if (!parsed.success) return parsed.response;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // Authentification AVANT le moindre appel sortant. Voir plus haut : le
  // quota OFF est par IP, et l'IP est celle du serveur.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    // Sans droit d'écriture, le cache ne pourrait pas être alimenté : chaque
    // scan repartirait sur le réseau et brûlerait le quota. On refuse plutôt
    // que de fonctionner à moitié, silencieusement.
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // Une seule lecture d'horloge pour toute la requête : cache lu, fraîcheur
  // évaluée et fiche écrite se réfèrent à la MÊME date. Deux appels à
  // `new Date()` séparés par un aller-retour réseau peuvent tomber de part et
  // d'autre d'une frontière de TTL.
  const maintenant = new Date();

  try {
    const produit = await resoudreProduitParGtin(parsed.data.gtin, {
      lireCache: (gtin) => lireProduitEnCache(supabase, gtin, maintenant),
      interrogerOff: async (gtin) => {
        const seth = await chercherProduitParGtin(gtin);
        // Le brut conservé pour l'audit est le DTO SETH lui-même : la réponse
        // OFF complète n'est pas re-téléchargée pour la stocker, et les champs
        // demandés sont déjà restreints. Ce qui compte est de pouvoir
        // reconstituer ce qui a été lu, pas de garder une copie du web.
        return { produit: seth, brut: seth };
      },
      ecrireCache: (produitSeth, brut) =>
        enregistrerProduit(admin, produitSeth, brut, maintenant),
    });

    return NextResponse.json({
      produit,
      // Attribution ODbL, rendue avec la donnée pour que l'écran n'ait pas à
      // la reconstituer — et qu'elle ne puisse pas être oubliée.
      attribution: OFF_ATTRIBUTION,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      // Notre faute, pas celle d'OFF : ce n'est donc AUCUN des six codes
      // métier. Le détail reste dans le journal serveur ; le client reçoit une
      // indisponibilité, sans le nom de la variable manquante.
      console.error(`[OpenFoodFacts] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    if (estOffErreur(erreur)) {
      return NextResponse.json(
        { error: MESSAGE_PAR_CODE[erreur.code], code: erreur.code },
        { status: STATUT_PAR_CODE[erreur.code] },
      );
    }
    console.error("[OpenFoodFacts] échec inattendu du lookup", erreur);
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}

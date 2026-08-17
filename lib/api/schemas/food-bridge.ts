import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";
import { STATUTS_REVUE } from "@/lib/nutrition/pont-retail";

/**
 * COURSES C4.1 — les corps de requête du pont produit.
 *
 * ⚠️ AUCUN NOM DE COLONNE NE TRAVERSE. Ces schémas n'acceptent que des
 * identifiants et un statut fermé : la route écrit ensuite `food_id`,
 * `match_status` et `match_score` en dur, et rien d'autre. Un corps de requête
 * ne peut donc pas nommer une colonne, encore moins `protein_per_100`.
 *
 * ⚠️ ET AUCUN MONTANT N'EXISTE ICI. Il n'y a pas de champ `price`, `prix` ni
 * `cents` — l'absence est le contrat : depuis le pivot, un prix alimentaire ne
 * se saisit plus, il s'observe chez Open Prices.
 */

/**
 * La forme d'un code-barres, reprise de `food_products_gtin_forme` :
 * GTIN-8, GTIN-12, GTIN-13, GTIN-14. La clé de contrôle n'est délibérément pas
 * vérifiée — Open Food Facts contient de vrais produits dont le code imprimé ne
 * la respecte pas, et les refuser rendrait un produit RÉEL non rapprochable.
 */
const gtinSchema = z
  .string()
  .regex(/^([0-9]{8}|[0-9]{12,14})$/, { message: "Code-barres de forme invalide." });

/**
 * Plafond de lot volontairement bas : une décision de curation porte sur
 * quelques produits, pas sur une page entière. Il borne aussi le nombre de
 * lignes qu'un seul appel peut écrire dans le cache global.
 */
export const MATCH_GTINS_MAX = 10;

export const matchBodySchema = z
  .object({
    catalogFoodId: uuidSchema,
    gtins: z.array(gtinSchema).min(1).max(MATCH_GTINS_MAX),
  })
  .strict();

export const detachBodySchema = z
  .object({
    gtin: gtinSchema,
  })
  .strict();

export const reviewBodySchema = z
  .object({
    catalogFoodId: uuidSchema,
    // ⚠️ `matched` n'est pas dans `STATUTS_REVUE`, donc pas ici non plus. Le
    // rapprochement se dérive de `food_products.food_id` ; il ne se déclare pas.
    status: z.enum(STATUTS_REVUE),
    note: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();

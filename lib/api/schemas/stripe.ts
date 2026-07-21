import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";

/**
 * POST /api/stripe/create-checkout-session
 * templateId/planKey restent optionnels ici : la regle "un eleve ne
 * choisit jamais sa formule" est une regle metier verifiee dans la route
 * elle-meme, pas une contrainte de forme/format.
 */
export const createCheckoutSessionBodySchema = z
  .object({
    studentId: uuidSchema,
    templateId: uuidSchema.optional(),
    planKey: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** POST /api/stripe/create-customer-portal-session */
export const createCustomerPortalSessionBodySchema = z
  .object({
    studentId: uuidSchema,
  })
  .strict();

/**
 * POST /api/public/programs/[programId]/checkout et
 * /api/public/programs/[programId]/claim (chantier module Programmation,
 * étape 6) — formulaire public anonyme, aucun studentId : l'identité vient
 * entièrement de ce body (résolu/dédupliqué par email côté serveur, voir
 * lib/supabase/public-program-provisioning.ts).
 *
 * `cgvAccepted` (chantier conformité juridique/RGPD, lot technique — juillet
 * 2026) : `z.literal(true)` plutôt qu'un simple boolean — un boolean
 * accepterait `false` comme valeur de forme valide, alors que seule `true`
 * doit pouvoir passer la validation ; la case n'est jamais précochée côté
 * formulaire (PublicProgramPurchaseForm.tsx), donc omettre le champ ou
 * envoyer `false` doit être rejeté ici, pas seulement désactivé côté UI.
 */
export const publicProgramAccessBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email({ message: "Adresse email invalide." }).max(254),
    cgvAccepted: z.literal(true, { message: "Tu dois accepter les conditions générales de vente pour continuer." }),
  })
  .strict();

/**
 * GET /api/public/programs/checkout-status?session_id=cs_... (chantier
 * api-zod-validation) — l'id de session Stripe Checkout suit toujours le
 * prefixe documente `cs_`, longueur bornee par principe plutot qu'un simple
 * controle de presence.
 */
export const checkoutStatusQuerySchema = z
  .object({
    session_id: z
      .string()
      .trim()
      .min(1, { message: "session_id manquant." })
      .max(500)
      .regex(/^cs_[A-Za-z0-9_]+$/, { message: "session_id invalide." }),
  })
  .strict();

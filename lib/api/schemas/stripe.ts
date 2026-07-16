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
 */
export const publicProgramAccessBodySchema = z
  .object({
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.string().trim().email({ message: "Adresse email invalide." }).max(254),
  })
  .strict();

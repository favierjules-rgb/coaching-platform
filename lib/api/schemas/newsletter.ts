import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";

/** POST /api/newsletter/subscribe */
export const newsletterSubscribeBodySchema = z
  .object({
    email: z.string().trim().min(3).max(254).email({ message: "Adresse email invalide." }),
    consent: z.literal(true, { message: "Le consentement est requis pour s'inscrire." }),
    source: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

/** POST /api/newsletter/unsubscribe */
export const newsletterUnsubscribeBodySchema = z
  .object({
    token: z.string().min(10, { message: "Lien de desinscription invalide." }).max(4096),
  })
  .strict();

/** POST /api/newsletter/preference */
export const newsletterPreferenceBodySchema = z
  .object({
    subscribed: z.boolean(),
  })
  .strict();

/** POST /api/admin/newsletter/resync */
export const newsletterResyncBodySchema = z
  .object({
    id: uuidSchema,
  })
  .strict();

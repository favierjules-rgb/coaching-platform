import { z } from "zod";

/**
 * POST /api/brevo/webhook
 * Brevo est un tiers : sa charge utile n'est pas garantie stable/exhaustive
 * (nouveaux champs ajoutes sans notice). Ce schema valide/assainit les
 * champs connus (types, longueurs) mais reste `.passthrough()` plutot que
 * `.strict()` -- un champ Brevo inconnu ne doit jamais faire echouer tout
 * le webhook (Brevo reessaierait indefiniment). Les evenements qui ne
 * matchent pas ce schema sont ignores individuellement (voir route.ts),
 * jamais toute la requete rejetee en 400.
 */
export const brevoWebhookEventSchema = z
  .object({
    event: z.string().max(100).optional(),
    email: z.string().trim().max(254).optional(),
    date: z.string().max(100).optional(),
    ts: z.number().optional(),
    reason: z.string().max(2000).optional(),
  })
  .passthrough();

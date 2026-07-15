import { z } from "zod";

const BILLING_INTERVALS = ["monthly", "quarterly", "yearly", "one_time"] as const;

const amountCentsSchema = z
  .number()
  .int({ message: "Le montant doit etre un nombre entier de centimes." })
  .positive({ message: "Le montant doit etre superieur a 0." })
  .max(100_000_000, { message: "Montant invraisemblable (max 1 000 000 par formule)." });

const durationMonthsSchema = z
  .number()
  .int()
  .positive()
  .max(120, { message: "Duree maximale : 120 mois." })
  .nullable();

const currencySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z]{3}$/, { message: "Code devise ISO 4217 attendu (ex : eur, usd)." })
  .transform((v) => v.toLowerCase());

/** POST /api/admin/subscription-templates */
export const createSubscriptionTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    amountCents: amountCentsSchema,
    currency: currencySchema.optional(),
    billingInterval: z.enum(BILLING_INTERVALS),
    durationMonths: durationMonthsSchema.optional(),
  })
  .strict();

/** PATCH /api/admin/subscription-templates/[id] -- tous les champs sont optionnels. */
export const updateSubscriptionTemplateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    amountCents: amountCentsSchema.optional(),
    durationMonths: durationMonthsSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

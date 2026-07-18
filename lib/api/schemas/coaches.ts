import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";

/** POST /api/admin/coaches — création réelle d'un collaborateur admin/coach (voir lib/supabase/coach-account-provisioning.ts). */
export const createCoachBodySchema = z
  .object({
    firstName: z.string().trim().min(1, "Le prénom est requis.").max(100),
    lastName: z.string().trim().min(1, "Le nom est requis.").max(100),
    email: z.string().trim().min(1, "L'email est requis.").email("Email invalide."),
    role: z.enum(["admin", "assistant"]),
    speciality: z.string().trim().max(200).default(""),
  })
  .strict();

/** Params de route `[coachId]` (ex : DELETE /api/admin/coaches/[coachId]). */
export const coachIdParamSchema = z.object({ coachId: uuidSchema }).strict();

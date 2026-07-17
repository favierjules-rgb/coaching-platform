import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";

/** POST /api/admin/students — création réelle d'un élève "coaching" (voir lib/supabase/coach-student-provisioning.ts). */
export const createStudentBodySchema = z
  .object({
    firstName: z.string().trim().min(1, "Le prénom est requis.").max(100),
    lastName: z.string().trim().min(1, "Le nom est requis.").max(100),
    email: z.string().trim().min(1, "L'email est requis.").email("Email invalide."),
    phone: z.string().trim().max(30).default(""),
    age: z.number().int().min(0).max(150).default(0),
    heightCm: z.number().min(0).max(300).default(0),
    currentWeightKg: z.number().min(0).max(500).default(0),
    goal: z.string().trim().max(500).default(""),
    level: z.string().trim().max(50).default(""),
    trainingFrequencyPerWeek: z.number().int().min(0).max(14).default(0),
    trainingLocation: z.string().trim().max(50).default(""),
    foodPreferences: z.string().trim().max(200).default(""),
    intolerances: z.array(z.string().trim().max(100)).max(50).default([]),
    injuries: z.string().trim().max(1000).default(""),
    coachNotes: z.string().trim().max(2000).default(""),
  })
  .strict();

/** Params de route `[studentId]` (ex : DELETE /api/admin/students/[studentId]). */
export const studentIdParamSchema = z.object({ studentId: uuidSchema }).strict();

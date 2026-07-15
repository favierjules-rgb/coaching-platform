import { z } from "zod";

import { uuidSchema } from "@/lib/api/schemas/common";

/** POST /api/email/appointment-notification */
export const appointmentNotificationBodySchema = z
  .object({
    appointmentId: uuidSchema,
  })
  .strict();

/** POST /api/email/content-assigned */
export const contentAssignedBodySchema = z
  .object({
    studentId: uuidSchema,
    contentType: z.enum(["programme", "nutrition", "document"]),
    contentId: uuidSchema,
  })
  .strict();

/** POST /api/email/subscription-assigned */
export const subscriptionAssignedBodySchema = z
  .object({
    studentId: uuidSchema,
  })
  .strict();

/** POST /api/email/welcome */
export const welcomeEmailBodySchema = z
  .object({
    studentId: uuidSchema,
  })
  .strict();

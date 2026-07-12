import type { ReactNode } from "react";

import { requireActiveStudentAccess } from "@/lib/supabase/guards";

/** Contenu payant (chantier "supabase-stripe-access-control") — voir lib/supabase/guards.ts. */
export default async function NutritionLayout({ children }: { children: ReactNode }) {
  await requireActiveStudentAccess();
  return <>{children}</>;
}

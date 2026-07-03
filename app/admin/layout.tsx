import type { ReactNode } from "react";

import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrCoach } from "@/lib/supabase/guards";

export default async function AdminAreaLayout({ children }: { children: ReactNode }) {
  await requireAdminOrCoach();
  return <AdminShell>{children}</AdminShell>;
}

import type { ReactNode } from "react";

import { StudentShell } from "@/components/student/StudentShell";
import { requireStudent } from "@/lib/supabase/guards";

export default async function StudentAreaLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudent();
  return <StudentShell>{children}</StudentShell>;
}

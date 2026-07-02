import type { ReactNode } from "react";

import { AccessRestricted } from "@/components/student/AccessRestricted";
import { StudentShell } from "@/components/student/StudentShell";
import { currentUserRole } from "@/data/session";

export default function StudentAreaLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (currentUserRole !== "student") {
    return <AccessRestricted />;
  }

  return <StudentShell>{children}</StudentShell>;
}

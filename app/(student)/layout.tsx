import type { ReactNode } from "react";

import { SynchronisationOffline } from "@/components/pwa/SynchronisationOffline";
import { StudentShell } from "@/components/student/StudentShell";
import { requireStudent } from "@/lib/supabase/guards";

export default async function StudentAreaLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudent();
  return (
    <StudentShell>
      {/*
        Premier des quatre déclencheurs de synchronisation : ouvrir
        l'application suffit à envoyer ce qui attend. Ne rend rien.
      */}
      <SynchronisationOffline />
      {children}
    </StudentShell>
  );
}

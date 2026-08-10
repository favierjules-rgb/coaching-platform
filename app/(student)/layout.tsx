import type { ReactNode } from "react";

import { PreparationCoquille } from "@/components/pwa/PreparationCoquille";
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
      {/*
        Dit au service worker quelle page élève est ouverte, pour qu'il en
        garde la coquille. Sans ce message, il n'apprend RIEN d'une session
        de navigation client. Ne rend rien.
      */}
      <PreparationCoquille />
      {children}
    </StudentShell>
  );
}

import type { ReactNode } from "react";

import { GuideDemonstration } from "@/components/guide/GuideDemonstration";
import { GuideEspace } from "@/components/guide/GuideEspace";
import { PreparationCoquille } from "@/components/pwa/PreparationCoquille";
import { SynchronisationOffline } from "@/components/pwa/SynchronisationOffline";
import { SessionRappelPushProvider } from "@/components/student/SessionRappelPushProvider";
import { StudentShell } from "@/components/student/StudentShell";
import { requireStudent } from "@/lib/supabase/guards";

export default async function StudentAreaLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireStudent();
  return (
    /*
      MÉMOIRE DE SESSION DU RAPPEL PUSH.

      ⚠️ ICI, ET PAS DANS LA PAGE. Ce layout n'est pas remonté quand on passe
      du tableau de bord à la nutrition : seuls les `children` changent. Un
      « Plus tard » enregistré ici survit donc aux changements de route, et
      disparaît au rechargement — c'est-à-dire à la réouverture réelle de
      l'application. Le provider ne tient qu'un booléen : il ne crée aucune
      instance de `useNotificationsPush`.
    */
    <SessionRappelPushProvider>
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
      {/*
        Proposition de visite de l'espace courant. Monté UNE fois ici plutôt
        que page par page : il lit la route et ne rend rien là où aucune
        visite n'est définie.
      */}
      <GuideEspace />
      {/* Ne rend rien hors visite guidée : voir l'en-tête du composant. */}
      <GuideDemonstration />
      {children}
    </StudentShell>
    </SessionRappelPushProvider>
  );
}

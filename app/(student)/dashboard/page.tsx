import { DashboardContent } from "@/components/student/DashboardContent";
import { RappelPushAutonome } from "@/components/student/RappelPushAutonome";
import {
  activeMealPlan,
  activeProgram,
  bodyMeasurements,
  coachNotifications,
  customMeasurements,
  progressPhotos,
  recentDocuments,
  student,
  upcomingSession,
  weightHistory,
} from "@/data/student";

export default function DashboardPage() {
  return (
    <>
      {/* ⚠️ LE RAPPEL PUSH DÈS L'ARRIVÉE, ET PLUS SEULEMENT DANS « PROFIL ».
          Il n'était monté que par `NotificationsSection`, sur l'onglet où l'on
          va le moins souvent : un élève qui ne l'ouvrait jamais ne voyait
          jamais la demande, et ne recevait donc plus rien.

          Monté AVANT le contenu, il ne dépend d'aucune des sorties anticipées
          du tableau de bord — mais il ne s'affiche de toute façon qu'une fois
          l'état Push connu, jamais par-dessus un écran de chargement. */}
      <RappelPushAutonome />
      <DashboardContent
        studentId={student.id}
        seed={{
          profile: student,
          weightHistory,
          measurements: bodyMeasurements,
          customMeasurements,
          measurementHistory: [],
          photos: progressPhotos,
        }}
        activeProgram={activeProgram}
        upcomingSession={upcomingSession}
        activeMealPlan={activeMealPlan}
        coachNotifications={coachNotifications}
        recentDocuments={recentDocuments}
      />
    </>
  );
}

import { DashboardContent } from "@/components/student/DashboardContent";
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
  );
}

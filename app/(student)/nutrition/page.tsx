import { Apple } from "lucide-react";

import { PageComingSoon } from "@/components/student/PageComingSoon";

export default function NutritionPage() {
  return (
    <PageComingSoon
      icon={Apple}
      title="Nutrition"
      description="Le détail de tes plans alimentaires (repas, macros, notes du coach) arrive dans une prochaine étape."
    />
  );
}

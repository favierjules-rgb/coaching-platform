import { User } from "lucide-react";

import { PageComingSoon } from "@/components/student/PageComingSoon";

export default function ProfilPage() {
  return (
    <PageComingSoon
      icon={User}
      title="Profil"
      description="Tes informations personnelles, mensurations, préférences et photos de progression arrivent dans une prochaine étape."
    />
  );
}

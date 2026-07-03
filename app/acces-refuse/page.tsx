import type { Metadata } from "next";

import { AccessDenied } from "@/components/auth/AccessDenied";

export const metadata: Metadata = {
  title: "Accès refusé — Seth Préparation Physique",
};

export default function AccesRefusePage() {
  return <AccessDenied />;
}

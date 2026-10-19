import type { Metadata } from "next";

import { AccessUnavailableContent } from "@/components/shared/AccessUnavailableContent";

export const metadata: Metadata = {
  title: "Accès momentanément indisponible — Seth Préparation Physique",
};

export default function AccesIndisponiblePage() {
  return <AccessUnavailableContent />;
}

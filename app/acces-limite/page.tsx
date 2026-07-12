import type { Metadata } from "next";

import { AccessLimitedContent } from "@/components/shared/AccessLimitedContent";

export const metadata: Metadata = {
  title: "Accès limité — Seth Préparation Physique",
};

export default function AccesLimitePage() {
  return <AccessLimitedContent />;
}

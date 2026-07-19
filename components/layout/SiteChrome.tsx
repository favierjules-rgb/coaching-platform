"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";

const PRIVATE_PREFIXES = [
  "/dashboard",
  "/entrainement",
  "/nutrition",
  "/documents",
  "/profil",
  "/rendez-vous",
  "/progression",
  "/paiement",
  "/admin",
  "/connexion",
  "/inscription",
  "/acces-refuse",
  "/acces-limite",
  // Écrans autonomes (Logo centré + carte, sans nav marketing) oubliés de
  // cette liste (audit design juillet 2026, Lot 1) : ils recevaient à tort
  // le Header/Footer marketing en plus de leur propre layout, avec un
  // recouvrement visuel confirmé sur /onboarding (le Header fixe passe
  // par-dessus le contenu) et une nav vers des ancres inexistantes.
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
  "/onboarding",
  "/newsletter/desinscription",
];

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPrivateArea = PRIVATE_PREFIXES.some((prefix) =>
    pathname?.startsWith(prefix),
  );

  if (isPrivateArea) {
    return <>{children}</>;
  }

  return (
    <>
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </>
  );
}

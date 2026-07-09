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

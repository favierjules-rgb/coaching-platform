"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
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

  useEffect(() => {
    // Correctif chantier /programmes (juillet 2026, ancres du menu) :
    // Next.js App Router ne scrolle pas fiablement vers l'ancre présente
    // dans l'URL lors d'un premier chargement de document (accès direct à
    // /#methode, /#transformations, /#newsletter, ou lien <a> classique
    // depuis une autre page comme /programmes — constaté en test, pas
    // seulement une hypothèse). On gère donc ce scroll explicitement : au
    // montage et à chaque changement de route, puis à chaque `hashchange`
    // (y compris un clic sur une ancre déjà sur la page). `scroll-mt-24`
    // sur les sections (Method.tsx, Transformations.tsx, Newsletter.tsx)
    // gère le décalage sous le header fixe automatiquement via
    // `scrollIntoView`. Fluide uniquement si prefers-reduced-motion ne le
    // désactive pas.
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash) {
        return;
      }
      const target = document.getElementById(hash.slice(1));
      if (!target) {
        return;
      }
      const reduceMotion = !window.matchMedia("(prefers-reduced-motion: no-preference)").matches;
      target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    };

    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, [pathname]);

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

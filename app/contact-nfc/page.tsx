import type { Metadata } from "next";
import Image from "next/image";
import type { CSSProperties } from "react";

import { BoutonSmsHts } from "@/components/contact-nfc/BoutonSmsHts";
import { JAUNE_HTS, LOGO_HTS, URL_CANONIQUE_CONTACT_NFC } from "@/lib/contact-nfc/config";

export const metadata: Metadata = {
  title: "HTS — Contacter nos coachs",
  description: "Envoie un SMS à un coach HTS : il te rappelle pour faire le point sur ta situation.",
  // Page ouverte par une puce NFC, absente de la navigation : elle ne doit
  // pas remonter dans un moteur de recherche.
  robots: { index: false, follow: false },
  alternates: { canonical: URL_CANONIQUE_CONTACT_NFC },
};

/**
 * PAGE DE CONTACT HTS — ouverte par la puce NFC de l'accueil de la salle.
 *
 * ⚠️ STATIQUE PAR CONSTRUCTION. Elle ne lit ni en-tête, ni cookie, ni
 * paramètre d'URL. Le tour de rôle Jules / Yoann est demandé APRÈS
 * chargement par le bouton (`/api/contact-nfc/tour`) : la page elle-même
 * reste servie depuis le cache, et un accès direct (sans la puce) affiche
 * exactement la même page.
 *
 * ⚠️ AUCUN FORMULAIRE, AUCUNE DONNÉE PERSONNELLE. Le numéro du visiteur
 * n'est ni demandé ni reçu : c'est sa propre application SMS qui l'utilise
 * comme expéditeur, hors du site.
 *
 * ⚠️ AUTONOME. Le Header et le Footer du site Seth sont écartés via
 * `PRIVATE_PREFIXES` (`components/layout/SiteChrome.tsx`), qui ne pose alors
 * pas de `<main>` : la page pose le sien.
 *
 * Le jaune HTS est exposé en variable CSS locale (`--hts-jaune`) sur cette
 * page seulement : les couleurs globales du site ne changent pas.
 */
export default function ContactNfcPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-10"
      style={{ "--hts-jaune": JAUNE_HTS } as CSSProperties}
    >
      <div className="flex w-full max-w-sm flex-col gap-6">
        <header className="flex flex-col items-center gap-4 text-center">
          <Image
            src={LOGO_HTS.src}
            width={LOGO_HTS.largeur}
            height={LOGO_HTS.hauteur}
            alt="HTS"
            priority
            sizes="144px"
            className="h-36 w-36 drop-shadow-[0_0_28px_rgba(253,201,1,0.28)]"
          />
          <h1 className="font-heading text-3xl font-extrabold uppercase leading-tight text-foreground">
            Contacter nos coachs
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            Envoie un SMS à l&apos;un de nos coachs : il te rappelle pour faire le point sur ta situation.
          </p>
        </header>

        <BoutonSmsHts />

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Le coach verra ton numéro pour pouvoir te rappeler.
        </p>
      </div>
    </main>
  );
}

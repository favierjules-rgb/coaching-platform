import type { Metadata } from "next";

import { DoubleStar } from "@/components/ui/DoubleStar";

export const metadata: Metadata = {
  title: "Hors ligne — Seth Préparation Physique",
  // Cette page ne doit jamais remonter dans un moteur de recherche : elle
  // n'existe que pour être servie par le service worker.
  robots: { index: false, follow: false },
};

/**
 * LA PAGE HORS LIGNE.
 *
 * Elle est mise en cache par le service worker à son installation, et
 * servie à la place de N'IMPORTE QUELLE page quand le réseau ne répond pas.
 * Elle a donc trois contraintes que les autres pages n'ont pas.
 *
 * 1. AUCUNE DONNÉE. Elle est rendue une fois, sur le serveur, au moment de
 *    l'installation du service worker — c'est-à-dire potentiellement des
 *    semaines avant d'être affichée, et éventuellement à un autre élève sur
 *    le même téléphone. Tout ce qu'elle afficherait de personnel serait
 *    faux, et pas seulement périmé.
 *
 * 2. AUCUN JAVASCRIPT NÉCESSAIRE. « Réessayer » est un LIEN, pas un bouton :
 *    un bouton demanderait que l'hydratation React ait réussi, donc que les
 *    fichiers JS soient eux aussi en cache. Un lien fonctionne même si tout
 *    le reste a échoué. Le lien pointe sur /connexion, qui est l'écran de
 *    lancement de l'application : réessayer, c'est relancer.
 *
 * 3. AUCUNE IMAGE DISTANTE. L'emblème est du SVG inline (`DoubleStar`),
 *    présent dans le HTML lui-même. Une balise <img> pointerait sur un
 *    fichier qui, hors ligne, ne serait pas là.
 *
 * Le Header et le Footer marketing sont écartés via `PRIVATE_PREFIXES` dans
 * `components/layout/SiteChrome.tsx` : ils sont pleins de liens qui, hors
 * ligne, ne mènent nulle part.
 */
export default function HorsLignePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <DoubleStar className="mb-8 h-16 w-auto text-primary" />

      <h1 className="mb-3 font-heading text-2xl font-extrabold uppercase text-foreground">
        Pas de connexion
      </h1>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        Ton espace a besoin d&apos;internet pour afficher tes séances et tes
        données à jour. Rien n&apos;est perdu : reconnecte-toi au réseau et
        relance.
      </p>

      <a
        href="/connexion"
        className="mt-8 inline-flex items-center justify-center rounded-panel bg-primary px-6 py-3 font-heading text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Réessayer
      </a>
    </div>
  );
}

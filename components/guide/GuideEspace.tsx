"use client";

import { Compass, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

import { GuideDecouverte } from "@/components/guide/GuideDecouverte";
import { espaceDejaVu, espaceGuidePour, marquerEspaceVu } from "@/lib/guide-categories";

/**
 * PROPOSITION DE VISITE À L'ENTRÉE D'UN ESPACE.
 *
 * Monté UNE SEULE FOIS par shell (élève et staff), ce composant regarde la
 * route courante et propose la visite correspondante quand il y en a une.
 *
 * ⚠️ UNE BANNIÈRE, PAS UNE MODALE. Ouvrir d'office le parcours en arrivant sur
 * une page prendrait l'écran au moment où l'utilisateur vient justement
 * chercher quelque chose — et sur mobile, masquerait la page avant qu'il
 * l'ait vue. La proposition est donc une ligne discrète, refusable d'un clic,
 * qui ne revient plus une fois la visite faite ou écartée.
 *
 * ⚠️ RIEN N'EST MODIFIÉ DANS LA VISITE DES MENUS. `GuideDecouverte` est
 * réutilisé sans changement : il reçoit des étapes et les joue. Les deux
 * parcours ont leurs propres clés de mémorisation et s'ignorent.
 */
export function GuideEspace() {
  const pathname = usePathname();
  const [ouvert, setOuvert] = useState(false);
  const [ecarte, setEcarte] = useState(false);

  const espace = espaceGuidePour(pathname);

  /*
   * `localStorage` est une source extérieure à React : `useSyncExternalStore`
   * est l'outil prévu. Le lire pendant le rendu divergerait à l'hydratation,
   * et le lire dans un effet pour poser un état est ce que la règle
   * `set-state-in-effect` interdit. L'instantané serveur dit « déjà vu » pour
   * qu'aucune bannière ne clignote avant l'hydratation.
   */
  const lire = useCallback(
    () => (espace && espaceDejaVu(window.localStorage, espace.id) ? "1" : "0"),
    [espace],
  );
  const abonner = useCallback((auChangement: () => void) => {
    window.addEventListener("storage", auChangement);
    return () => window.removeEventListener("storage", auChangement);
  }, []);
  const dejaVu = useSyncExternalStore(abonner, lire, () => "1") === "1";

  if (!espace) return null;

  const fermer = () => {
    marquerEspaceVu(typeof window === "undefined" ? null : window.localStorage, espace.id);
    setOuvert(false);
    setEcarte(true);
  };

  if (ouvert) {
    return <GuideDecouverte etapes={espace.etapes} libelleParcours={espace.titre} onFermer={fermer} />;
  }

  // Déjà vue ou écartée : plus aucune proposition. La visite reste relançable
  // depuis « Visite guidée » dans la navigation.
  if (dejaVu || ecarte) return null;

  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-3 rounded-card border border-border bg-card px-4 py-3"
      role="region"
      aria-label={`Visite guidée de ${espace.titre}`}
    >
      <Compass size={18} className="shrink-0 text-primary" aria-hidden />
      <p className="flex-1 text-sm text-foreground">
        Première fois ici ? Découvrez {espace.titre} en quelques étapes.
      </p>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="pressable inline-flex min-h-[44px] items-center rounded-control bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Lancer la visite
      </button>
      <button
        type="button"
        onClick={fermer}
        aria-label="Ne plus proposer cette visite"
        className="pressable inline-flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <X size={18} />
      </button>
    </div>
  );
}

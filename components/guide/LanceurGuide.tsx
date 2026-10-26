"use client";

import { Compass } from "lucide-react";
import { useCallback, useState, useSyncExternalStore } from "react";

import { GuideDecouverte } from "@/components/guide/GuideDecouverte";
import { useStaffContext } from "@/hooks/useStaffContext";
import { useSupabaseAccessType } from "@/hooks/useSupabaseAccessType";
import { droitsNavigationDepuisContexte } from "@/lib/admin-shell-nav";
import { etapesEleveVisibles, etapesStaffVisibles, guideDejaVu } from "@/lib/guide-decouverte";

/**
 * POINT D'ENTRÉE PERMANENT DE LA VISITE GUIDÉE.
 *
 * ⚠️ LA VISITE NE S'OUVRE JAMAIS TOUTE SEULE, ET C'EST UNE DÉCISION. Un
 * parcours qui démarre d'autorité à la première connexion prend l'écran au
 * moment précis où l'utilisateur veut faire autre chose — et sur mobile, il
 * masque l'interface avant qu'on ait pu la voir. La découverte est donc
 * PROPOSÉE : le bouton vit en permanence dans le pied de la navigation, et
 * tant que la visite n'a pas été faite il porte une pastille discrète. Rien
 * n'est bloqué, rien n'est imposé, et la visite reste relançable à vie.
 *
 * ⚠️ LES ÉTAPES SONT CALCULÉES À L'OUVERTURE, PAS AU MONTAGE. Les droits
 * arrivent de façon asynchrone ; les figer au montage donnerait le parcours
 * du « chargement en cours » même une fois les droits connus.
 */
export function LanceurGuide({
  espace,
  compact = false,
}: {
  readonly espace: "staff" | "eleve";
  /** Pied de sidebar : icône seule, libellé en infobulle. */
  readonly compact?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [visiteFaite, setVisiteFaite] = useState(false);

  const staff = useStaffContext();
  const accessType = useSupabaseAccessType();

  /*
   * ⚠️ `useSyncExternalStore` PLUTÔT QU'UN `useEffect` QUI POSE L'ÉTAT.
   * `localStorage` n'existe pas au rendu serveur : le lire pendant le rendu
   * provoquerait une divergence d'hydratation, et le lire dans un effet pour
   * appeler `setState` est précisément ce que la règle `set-state-in-effect`
   * interdit. C'est l'outil prévu pour une source extérieure à React : un
   * instantané côté client, un instantané côté serveur, et React se charge du
   * reste.
   */
  const lireStockage = useCallback(() => (guideDejaVu(window.localStorage) ? "1" : "0"), []);
  /* On écoute `storage` : terminer la visite dans un autre onglet y retire
     aussi la pastille. L'abonnement est retiré au démontage. */
  const abonner = useCallback((auChangement: () => void) => {
    window.addEventListener("storage", auChangement);
    return () => window.removeEventListener("storage", auChangement);
  }, []);
  const dejaVuStocke = useSyncExternalStore(abonner, lireStockage, () => "1") === "1";
  // Terminer la visite dans cet onglet retire la pastille sans relire le stockage.
  const dejaVu = dejaVuStocke || visiteFaite;

  const etapes =
    espace === "staff"
      ? etapesStaffVisibles(droitsNavigationDepuisContexte(staff))
      : etapesEleveVisibles(accessType);

  // Un parcours vide n'a rien à montrer : on n'affiche pas un bouton inerte.
  if (etapes.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        title="Découvrir l'application"
        aria-label={dejaVu ? "Relancer la visite guidée" : "Découvrir l'application — visite guidée"}
        className={`pressable relative flex min-h-[44px] items-center gap-3 rounded-control text-sm text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          compact ? "w-11 justify-center" : "w-full px-4"
        }`}
      >
        <Compass size={18} aria-hidden />
        {compact ? null : <span className="flex-1 text-left">Visite guidée</span>}
        {/* Pastille « jamais fait » : doublée d'un libellé lisible par un
            lecteur d'écran — l'information n'est jamais portée par la seule
            couleur ni par la seule forme. */}
        {dejaVu ? null : (
          <>
            <span aria-hidden className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary" />
            <span className="sr-only">Visite non encore effectuée</span>
          </>
        )}
      </button>

      {ouvert ? (
        <GuideDecouverte
          etapes={etapes}
          libelleParcours={espace === "staff" ? "votre espace coach" : "votre espace"}
          onFermer={() => {
            setOuvert(false);
            setVisiteFaite(true);
          }}
        />
      ) : null}
    </>
  );
}

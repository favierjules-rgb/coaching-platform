"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Link2Off, TriangleAlert } from "lucide-react";

import { Loader } from "@/components/ui/Loader";

/**
 * C5.1 — LA CARTE « CONNECTER NOLIO » DU PROFIL.
 *
 * ⚠️ CE COMPOSANT NE VOIT AUCUN JETON, ET N'EN A AUCUN MOYEN. Il interroge
 * `/api/nolio/etat`, qui lit la vue `nolio_connexion_etat` — laquelle ne
 * SÉLECTIONNE ni `access_token` ni `refresh_token`. Trois barrières
 * indépendantes séparent donc ce fichier des jetons : le privilège absent en
 * base, la vue, et la forme de la route.
 *
 * ⚠️ IL N'IMPORTE RIEN DE `lib/nolio/`. Ces modules portent
 * `import "server-only"` : un import ici FERAIT ÉCHOUER LE BUILD. C'est
 * volontairement la seule façon de parler à Nolio depuis le navigateur —
 * passer par les routes.
 *
 * ⚠️ LA CONNEXION SE FAIT PAR UNE NAVIGATION, PAS PAR `fetch`. OAuth exige que
 * l'élève VOIE la page de consentement de Nolio ; un `fetch` recevrait une
 * redirection cross-origin qu'il ne pourrait pas suivre.
 */

type Etat =
  | { readonly phase: "chargement" }
  | { readonly phase: "absent" }
  | { readonly phase: "connecte"; readonly depuis: string | null; readonly statut: string }
  | { readonly phase: "erreur" };

/** Les mots-clés que le callback pose dans l'URL. Aucun ne porte de donnée. */
const MESSAGES: Readonly<Record<string, string>> = {
  connecte: "Ton compte Nolio est connecté.",
  "etat-invalide": "La connexion a expiré ou a été interrompue. Relance-la depuis cette page.",
  "code-absent": "Nolio n'a pas renvoyé d'autorisation. Réessaie.",
  "code-invalide": "Cette autorisation n'est plus valable. Relance la connexion.",
  "deja-liee": "Ce compte Nolio est déjà relié à un autre élève.",
  echec: "La connexion à Nolio a échoué. Réessaie dans un instant.",
};

/**
 * Lit l'état auprès de la route, et le RETOURNE au lieu de le poser.
 *
 * ⚠️ SÉPARER LA LECTURE DE L'ÉCRITURE N'EST PAS UNE COQUETTERIE. Un effet qui
 * appelle une fonction posant elle-même l'état déclenche une cascade de
 * rendus — et la règle `react-hooks/set-state-in-effect` du dépôt la refuse.
 * En rendant l'état, chaque appelant le pose depuis SA continuation de
 * promesse, c'est-à-dire depuis un rappel de système externe : le seul endroit
 * où un `setState` est légitime.
 */
async function lireEtat(): Promise<Etat> {
  try {
    const reponse = await fetch("/api/nolio/etat", { cache: "no-store" });
    if (!reponse.ok) return { phase: "erreur" };
    const donnees = (await reponse.json()) as {
      connecte?: boolean;
      connectedAt?: string | null;
      status?: string | null;
    };
    return donnees.connecte
      ? {
          phase: "connecte",
          depuis: donnees.connectedAt ?? null,
          statut: donnees.status ?? "active",
        }
      : { phase: "absent" };
  } catch {
    return { phase: "erreur" };
  }
}

/**
 * Le mot-clé posé par le callback, lu UNE FOIS à l'initialisation.
 *
 * ⚠️ PAS DANS UN EFFET. Le poser depuis un effet serait un `setState`
 * synchrone, donc un second rendu immédiat ; le lire à l'initialisation le
 * fait exister dès le premier. Le garde `typeof window` rend la fonction sûre
 * au rendu serveur, où il n'y a pas d'URL de navigateur.
 */
function messageInitial(): string | null {
  if (typeof window === "undefined") return null;
  const resultat = new URLSearchParams(window.location.search).get("nolio");
  if (!resultat) return null;
  return MESSAGES[resultat] ?? MESSAGES.echec;
}

export function NolioConnexionCard() {
  const [etat, setEtat] = useState<Etat>({ phase: "chargement" });
  const [message, setMessage] = useState<string | null>(messageInitial);
  const [enCours, setEnCours] = useState(false);

  const relire = useCallback(async () => {
    setEtat(await lireEtat());
  }, []);

  useEffect(() => {
    // ⚠️ `annule` ÉVITE UN `setState` APRÈS DÉMONTAGE. L'élève peut quitter le
    // profil pendant la requête ; sans ce garde, React avertirait à juste titre.
    let annule = false;
    void lireEtat().then((suivant) => {
      if (!annule) setEtat(suivant);
    });

    // ⚠️ LE MOT-CLÉ EST RETIRÉ DE L'URL APRÈS LECTURE, et c'est bien le travail
    // d'un effet : synchroniser un système externe — ici l'historique du
    // navigateur — avec l'état que React vient d'adopter. Sans cela, un
    // rechargement rejouerait le message « connecté » indéfiniment, et le
    // partage du lien transporterait un résultat qui n'a plus de sens.
    const parametres = new URLSearchParams(window.location.search);
    if (parametres.has("nolio")) {
      parametres.delete("nolio");
      const reste = parametres.toString();
      window.history.replaceState(null, "", window.location.pathname + (reste ? `?${reste}` : ""));
    }

    return () => {
      annule = true;
    };
  }, []);

  const deconnecter = useCallback(async () => {
    setEnCours(true);
    setMessage(null);
    try {
      const reponse = await fetch("/api/nolio/disconnect", { method: "POST" });
      setMessage(
        reponse.ok
          ? "Ton compte Nolio a été déconnecté."
          : "La déconnexion a échoué. Réessaie dans un instant.",
      );
      await relire();
    } catch {
      setMessage("La déconnexion a échoué. Vérifie ta connexion.");
    } finally {
      setEnCours(false);
    }
  }, [relire]);

  if (etat.phase === "chargement") {
    return <Loader libelle="Chargement de ta connexion Nolio…" variante="ligne" />;
  }

  const connecte = etat.phase === "connecte";
  const revoquee = etat.phase === "connecte" && etat.statut !== "active";

  return (
    <div className="rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-3 flex items-center gap-3">
        {connecte ? (
          <Link2 size={18} className="text-primary" aria-hidden="true" />
        ) : (
          <Link2Off size={18} className="text-muted-foreground" aria-hidden="true" />
        )}
        <h3 className="font-heading text-sm font-extrabold uppercase tracking-widest text-foreground">
          Nolio
        </h3>
      </div>

      <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
        {connecte
          ? "Ton compte Nolio est relié à Sethcoaching."
          : "Relie ton compte Nolio pour préparer la synchronisation de tes entraînements."}
      </p>

      {connecte && etat.depuis && (
        <p className="mb-4 text-xs text-muted-foreground">
          Connecté depuis le{" "}
          {new Date(etat.depuis).toLocaleDateString("fr-FR", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })}
          .
        </p>
      )}

      {revoquee && (
        <p className="mb-4 flex items-start gap-2 rounded-control border border-border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <TriangleAlert size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          <span>
            L&apos;autorisation n&apos;est plus valable. Déconnecte puis reconnecte ton compte.
          </span>
        </p>
      )}

      {etat.phase === "erreur" && (
        <p className="mb-4 text-xs text-muted-foreground">
          L&apos;état de ta connexion n&apos;a pas pu être lu.
        </p>
      )}

      {message && (
        <p
          role="status"
          className="mb-4 rounded-control border border-border bg-background px-3 py-2 text-xs leading-relaxed text-foreground"
        >
          {message}
        </p>
      )}

      {connecte ? (
        <button
          type="button"
          onClick={() => void deconnecter()}
          disabled={enCours}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {enCours ? "Déconnexion…" : "Déconnecter Nolio"}
        </button>
      ) : (
        /* ⚠️ UN LIEN, PAS UN `fetch`. Voir l'en-tête : le consentement OAuth
           doit être VU par l'élève, donc c'est une vraie navigation. */
        <a
          href="/api/nolio/connect"
          className="pressable inline-flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Connecter Nolio
        </a>
      )}
    </div>
  );
}

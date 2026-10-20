"use client";

import { useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

import { RappelNotificationsPush } from "@/components/student/RappelNotificationsPush";
import { useNotificationsPush } from "@/hooks/useNotificationsPush";
import { activationPossible, doitProposerRappel } from "@/lib/push/etat";

/**
 * LE BLOC « NOTIFICATIONS » DU PROFIL ÉLÈVE, ET LE RAPPEL QUI L'ACCOMPAGNE.
 *
 * Un seul geste possible à la fois, et une phrase qui dit pourquoi. Aucune
 * demande de permission au chargement : voir `useNotificationsPush`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LE RAPPEL EST MONTÉ ICI, ET PAS DANS `ProfilPageContent`
 * ════════════════════════════════════════════════════════════════════════
 * Pour qu'il n'y ait QU'UNE instance de `useNotificationsPush`. Deux appels
 * — un pour le bloc, un pour la fenêtre — produiraient deux états
 * indépendants, deux interrogations du serveur, et la possibilité qu'ils se
 * contredisent : la fenêtre disant « réactive » pendant que le bloc dit
 * « actif ». Ici, les deux lisent le même état par construction ; il n'y a
 * rien à synchroniser.
 *
 * Deuxième raison, mesurée par `profil-push-render` (PROFILPUSH2) : rien du
 * Push ne doit être lu avant que le profil soit rendu. `ProfilPageContent`
 * monte ce composant APRÈS toutes ses sorties anticipées, et ne lit aucun
 * état Push. Déplacer le hook dans la page lui redonnerait un droit de veto
 * sur l'affichage du profil — exactement la régression du 10/08/2026.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ LA FENÊTRE NE PEUT PAS S'OUVRIR EN BOUCLE : ELLE N'EST PAS « OUVERTE »
 * ════════════════════════════════════════════════════════════════════════
 * Son affichage est DÉRIVÉ de l'état, pas stocké : `doitProposerRappel(etat,
 * false, ferme)` est évalué à chaque rendu. Il n'existe donc aucun cycle
 * « ouvrir / fermer » à boucler, et aucun `setState` dans un effet pour le
 * synchroniser — la première version en avait deux, dont un que le linter
 * refusait à juste titre.
 *
 * Trois conséquences, toutes gratuites :
 *   · l'état est recalculé à chaque revalidation (retour sur l'onglet, fin
 *     d'activation) sans jamais rouvrir ce que l'élève a fermé ;
 *   · une activation réussie fait passer l'état à `active`, et la fenêtre
 *     disparaît d'elle-même — sans effet de fermeture à écrire ;
 *   · « Plus tard » n'a qu'un seul `setState` à poser.
 *
 * `ferme` vit DANS le composant, donc dans la visite : revenir sur /profil
 * remonte la section, `ferme` repart à `false`, et le rappel peut
 * réapparaître tant que les notifications restent inactives. Rien n'est écrit
 * dans `localStorage` — un verrou persistant le ferait taire définitivement
 * au premier « Plus tard », ce que le cahier des charges interdit.
 */
export function NotificationsSection() {
  const { etat, message, enCours, activer, desactiver } = useNotificationsPush();
  const [ferme, setFerme] = useState(false);

  /*
   * ⚠️ DÉRIVÉ, PAS STOCKÉ — et c'est ce qui rend la boucle impossible.
   *
   * Le deuxième argument est `false` à dessein : le « déjà proposé » d'une
   * première version servait à ne pas rouvrir une fenêtre fermée, ce que
   * `ferme` fait déjà, et sans effet. La fonction garde ce paramètre pour un
   * appelant qui STOCKERAIT l'ouverture.
   *
   * Une activation réussie fait passer `etat` à `active` — après relecture de
   * `/api/push/status`, jamais sur la foi du clic — et la fenêtre disparaît
   * d'elle-même, puisque `doitProposerRappel` rend `false` sur `active`.
   */
  const rappelAffiche = doitProposerRappel(etat, false, ferme);


  if (etat === "chargement") {
    return null;
  }

  return (
    <>
      {rappelAffiche ? (
        <RappelNotificationsPush
          etat={etat}
          message={message}
          enCours={enCours}
          onReactiver={() => void activer()}
          // ⚠️ FERMER NE DÉSACTIVE RIEN : aucune préférence écrite, aucun
          // abonnement retiré, aucun appel réseau. Deux `setState`, c'est tout.
          onFermer={() => setFerme(true)}
        />
      ) : null}

      <div className="rounded-card border border-border bg-card p-6 shadow-soft">
        <div className="mb-3 flex items-center gap-3">
          {etat === "active" ? (
            <Bell size={18} className="text-primary" aria-hidden="true" />
          ) : (
            <BellOff size={18} className="text-muted-foreground" aria-hidden="true" />
          )}
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">Notifications</h2>
        </div>

        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
          {etat === "active"
            ? "Cet appareil recevra les rappels de ton coach, même application fermée."
            : etat === "refuse"
              ? "Les notifications ont été refusées pour ce site. Pour les rétablir : Réglages → Notifications → SETH."
              : etat === "non_supporte"
                ? "Cet appareil ne gère pas les notifications. Sur iPhone, ajoute d'abord SETH à ton écran d'accueil."
                : etat === "a_reactiver"
                  ? /* ⚠️ L'ÉTAT QUI MANQUAIT. Permission accordée, mais aucun
                       abonnement valide côté serveur : rien n'arrive, et le
                       bloc affichait pourtant « activé » avant ce lot. */
                    "Les notifications ne sont plus opérationnelles sur cet appareil. Réactive-les pour continuer à recevoir tes rappels."
                  : etat === "erreur"
                    ? (message ?? "Quelque chose n'a pas fonctionné.")
                    : "Reçois les rappels de ton coach — poids, retour de séance, séance du jour. Tu peux les couper quand tu veux."}
        </p>

        {/* Le message de résultat d'une activation réussie, là où l'élève
            regarde après la fermeture de la fenêtre. */}
        {etat === "active" && message ? (
          <p className="mb-4 text-sm text-success" role="status">
            {message}
          </p>
        ) : null}

        {activationPossible(etat) ? (
          <button
            type="button"
            onClick={() => void activer()}
            disabled={enCours}
            className="pressable flex min-h-11 items-center justify-center gap-2 rounded-control border border-primary px-5 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            {etat === "a_reactiver" ? "Réactiver les notifications" : "Activer les notifications"}
          </button>
        ) : null}

        {etat === "active" ? (
          <button
            type="button"
            onClick={() => void desactiver()}
            disabled={enCours}
            className="pressable flex min-h-11 items-center justify-center gap-2 rounded-control border border-border px-5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enCours ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
            Désactiver sur cet appareil
          </button>
        ) : null}
      </div>
    </>
  );
}

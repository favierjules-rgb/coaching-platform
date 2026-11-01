"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import {
  SESSION_RAPPEL_INITIALE,
  reporterRappel,
  type SessionRappelPush,
} from "@/lib/push/rappel-session";

/**
 * LA MÉMOIRE DE SESSION DU RAPPEL PUSH — MONTÉE PAR LE LAYOUT ÉLÈVE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI DANS LE LAYOUT, ET NULLE PART AILLEURS
 * ════════════════════════════════════════════════════════════════════════
 * C'est la durée de vie qui fait tout le travail. Le layout `(student)` n'est
 * PAS remonté quand on passe du tableau de bord à la nutrition : seuls les
 * `children` changent. Un état posé ici survit donc aux changements de route
 * côté client — et disparaît au rechargement de la page, c'est-à-dire à la
 * réouverture réelle de l'application.
 *
 * Posé dans la page, il serait perdu à la première navigation : c'est le
 * défaut qu'on corrige. Écrit dans `localStorage`, il survivrait pour
 * toujours : « Plus tard » deviendrait « plus jamais ».
 *
 * ⚠️ AUCUN HOOK PUSH ICI. Ce contexte ne tient qu'un booléen. La règle « une
 * seule instance de `useNotificationsPush` par page », que `NotificationsSection`
 * documente depuis sa création, reste intacte : ce provider n'en crée aucune,
 * et il peut donc coexister avec le profil sans rien dédoubler.
 *
 * ⚠️ IL N'ÉCRIT RIEN ET NE TOUCHE À RIEN. Ni Supabase, ni stockage, ni
 * requête. Reporter un rappel ne modifie jamais l'état RÉEL des notifications.
 */

interface ValeurSessionRappel {
  readonly session: SessionRappelPush;
  readonly reporter: () => void;
}

/*
 * ⚠️ UNE VALEUR PAR DÉFAUT UTILISABLE, PAS `undefined`. Un consommateur monté
 * hors du provider — un test de rendu, une page sortie de l'arbre élève — doit
 * se comporter comme une session neuve plutôt que lever une exception : le
 * rappel Push n'est pas une fonctionnalité pour laquelle il vaut mieux planter
 * que s'afficher.
 */
const Contexte = createContext<ValeurSessionRappel>({
  session: SESSION_RAPPEL_INITIALE,
  reporter: () => {},
});

export function SessionRappelPushProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionRappelPush>(SESSION_RAPPEL_INITIALE);

  /* `reporterRappel` rend le MÊME objet si le report est déjà enregistré :
     un second « Plus tard » ne provoque donc aucun rendu inutile. */
  const reporter = useCallback(() => setSession((precedente) => reporterRappel(precedente)), []);

  const valeur = useMemo(() => ({ session, reporter }), [session, reporter]);

  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

export function useSessionRappelPush(): ValeurSessionRappel {
  return useContext(Contexte);
}

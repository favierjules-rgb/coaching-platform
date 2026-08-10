import "server-only";

import webpush from "web-push";

import { configurationVapid } from "@/lib/push/vapid";
import type { AbonnementPush } from "@/lib/push/abonnement";
import { DESTINATION_PAR_DEFAUT, estDestinationInterne } from "@/lib/push/destinations";

/**
 * L'ENVOI WEB PUSH — ET CE QU'ON FAIT DE CHAQUE ÉCHEC.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN ÉCHEC N'EST PAS L'AUTRE
 * ════════════════════════════════════════════════════════════════════════
 * Le service push (Apple, Google, Mozilla) répond par un statut, et ce
 * statut dit quoi faire :
 *
 *   404 / 410  l'abonnement n'existe plus — l'élève a désinstallé, réinitialisé,
 *              ou le service l'a expiré. On DÉSACTIVE cet abonnement-là, et
 *              lui seul : les autres appareils du même élève continuent.
 *   413        charge trop grosse — c'est notre faute, pas la sienne.
 *   429 / 5xx  passager. L'abonnement reste valide.
 *   autre      on n'invente pas : `echouee`, avec le code, et on regarde.
 *
 * Ne jamais supprimer un abonnement sur un 500 : ce serait effacer un
 * appareil vivant à cause d'une panne d'en face.
 */

export interface ContenuNotification {
  titre: string;
  corps: string;
  /** Chemin INTERNE. Toute autre valeur est ramenée au défaut. */
  destination?: string;
  /** Regroupe les notifications d'un même sujet sur l'appareil. */
  etiquette?: string;
}

export type SuiteAEchec = "aucune" | "desactiver";

export interface ResultatEnvoi {
  endpoint: string;
  statut: "envoyee" | "echouee";
  codeErreur: string | null;
  suite: SuiteAEchec;
}

/** Injectable pour les tests : le vrai transport est `web-push`. */
export type TransportPush = (
  abonnement: AbonnementPush,
  charge: string,
  configuration: { vapidDetails: { subject: string; publicKey: string; privateKey: string } },
) => Promise<unknown>;

const transportReel: TransportPush = (abonnement, charge, configuration) =>
  webpush.sendNotification(
    {
      endpoint: abonnement.endpoint,
      keys: { p256dh: abonnement.p256dh, auth: abonnement.auth },
    },
    charge,
    { ...configuration, TTL: 60 * 60 * 12 },
  );

/** Le statut HTTP porté par une erreur `web-push`, s'il y en a un. */
function statutDe(erreur: unknown): number | null {
  const e = erreur as { statusCode?: unknown; status?: unknown };
  if (typeof e?.statusCode === "number") return e.statusCode;
  if (typeof e?.status === "number") return e.status;
  return null;
}

export function suiteADonner(statut: number | null): SuiteAEchec {
  // 404 : l'endpoint n'existe plus. 410 : il a été révoqué.
  return statut === 404 || statut === 410 ? "desactiver" : "aucune";
}

/**
 * La charge utile réellement transmise.
 *
 * Elle est MINIMALE et non personnelle : un titre, un texte, un chemin. Elle
 * transite par un service tiers (Apple, Google) : rien qui ne puisse
 * s'afficher sur un écran verrouillé n'a sa place ici.
 */
export function composerCharge(contenu: ContenuNotification): string {
  return JSON.stringify({
    titre: contenu.titre,
    corps: contenu.corps,
    destination: estDestinationInterne(contenu.destination)
      ? contenu.destination
      : DESTINATION_PAR_DEFAUT,
    ...(contenu.etiquette ? { etiquette: contenu.etiquette } : {}),
  });
}

/**
 * Envoie à une liste d'abonnements. Un échec n'interrompt jamais les
 * suivants : chaque appareil a son propre verdict.
 */
export async function envoyerNotifications(
  abonnements: AbonnementPush[],
  contenu: ContenuNotification,
  options: { transport?: TransportPush } = {},
): Promise<ResultatEnvoi[]> {
  const vapid = configurationVapid();
  if (!vapid) {
    return abonnements.map((a) => ({
      endpoint: a.endpoint,
      statut: "echouee" as const,
      codeErreur: "vapid_absent",
      suite: "aucune" as const,
    }));
  }

  const transport = options.transport ?? transportReel;
  const charge = composerCharge(contenu);
  const configuration = {
    vapidDetails: {
      subject: vapid.sujet,
      publicKey: vapid.cliquePublique,
      privateKey: vapid.clePrivee,
    },
  };

  const resultats: ResultatEnvoi[] = [];
  for (const abonnement of abonnements) {
    try {
      await transport(abonnement, charge, configuration);
      resultats.push({ endpoint: abonnement.endpoint, statut: "envoyee", codeErreur: null, suite: "aucune" });
    } catch (erreur) {
      const statut = statutDe(erreur);
      resultats.push({
        endpoint: abonnement.endpoint,
        statut: "echouee",
        // Le STATUT, jamais le message : un message d'erreur de `web-push`
        // peut contenir l'endpoint complet, donc un identifiant d'appareil.
        codeErreur: statut !== null ? String(statut) : "inconnue",
        suite: suiteADonner(statut),
      });
    }
  }
  return resultats;
}

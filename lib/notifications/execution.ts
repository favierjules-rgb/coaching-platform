import "server-only";

import { desactiverAbonnement } from "@/lib/push/depot-abonnements";
import { envoyerNotifications } from "@/lib/push/envoyer";
import {
  appareilsJoignables,
  comptesVises,
  conclureEnvoi,
  ouvrirEnvoi,
  ouvrirOccurrence,
  reserverOccurrence,
  terminerOccurrence,
  type Campagne,
  type StatutOccurrence,
} from "@/lib/notifications/depot";

/**
 * TRAITER UNE ÉCHÉANCE — LE MÊME CHEMIN POUR « MAINTENANT » ET POUR LE CRON.
 *
 * Un envoi immédiat et un envoi programmé ne diffèrent que par l'instant où
 * on les déclenche. Leur donner deux implémentations, c'était garantir que
 * l'une des deux finirait par diverger sur l'idempotence ou sur la
 * désactivation d'un appareil mort. Il n'y en a donc qu'une, ici.
 */

export interface BilanEcheance {
  /** `null` quand l'occurrence appartenait déjà à quelqu'un d'autre. */
  occurrenceId: string | null;
  appareilsCibles: number;
  envoyes: number;
  echoues: number;
  statut: StatutOccurrence | null;
}

export async function traiterEcheance(
  admin: unknown,
  campagne: Campagne,
  echeance: string,
): Promise<BilanEcheance> {
  const vide: BilanEcheance = {
    occurrenceId: null, appareilsCibles: 0, envoyes: 0, echoues: 0, statut: null,
  };

  const occurrence = await ouvrirOccurrence(admin, campagne.id, echeance);
  if (!occurrence) return vide;

  // La réservation EST le verrou : `update … where status = 'en_attente'`.
  // Perdre la course n'est pas une erreur — quelqu'un d'autre s'en occupe.
  if (!(await reserverOccurrence(admin, occurrence.id))) return vide;

  const comptes = await comptesVises(admin, campagne);
  const appareils = await appareilsJoignables(admin, comptes);

  if (appareils.length === 0) {
    // Personne de joignable est un FAIT, pas une panne : l'occurrence est
    // close normalement, et l'historique dira « 0 appareil ».
    await terminerOccurrence(admin, occurrence.id, "envoyee");
    return { occurrenceId: occurrence.id, appareilsCibles: 0, envoyes: 0, echoues: 0, statut: "envoyee" };
  }

  // Les envois sont OUVERTS avant le push : c'est cette ligne `en_cours` qui
  // permettra de dire « interrompue » si le serveur tombe juste après.
  const ouverts: { envoiId: string; appareil: (typeof appareils)[number] }[] = [];
  for (const appareil of appareils) {
    const envoiId = await ouvrirEnvoi(admin, occurrence.id, appareil.userId, appareil.id);
    // `null` : cet appareil a déjà sa ligne pour cette occurrence. Le conflit
    // unique a fait son travail, on ne le sert pas une seconde fois.
    if (envoiId) ouverts.push({ envoiId, appareil });
  }

  const resultats = await envoyerNotifications(
    ouverts.map((o) => o.appareil),
    {
      titre: campagne.titre,
      corps: campagne.corps,
      destination: campagne.destination,
      etiquette: campagne.id,
    },
  );

  let envoyes = 0;
  let echoues = 0;
  for (const resultat of resultats) {
    const ouvert = ouverts.find((o) => o.appareil.endpoint === resultat.endpoint);
    if (!ouvert) continue;
    if (resultat.statut === "envoyee") {
      envoyes += 1;
      await conclureEnvoi(admin, ouvert.envoiId, "envoyee", null);
    } else {
      echoues += 1;
      await conclureEnvoi(admin, ouvert.envoiId, "echouee", resultat.codeErreur);
      // 404/410 : cet appareil n'existe plus. LUI SEUL est désactivé — la
      // panne d'un iPad n'a jamais empêché un iPhone de recevoir.
      if (resultat.suite === "desactiver") {
        await desactiverAbonnement(admin, resultat.endpoint, resultat.codeErreur ?? "inconnue");
      }
    }
  }

  const statut: StatutOccurrence = echoues === 0 ? "envoyee" : envoyes === 0 ? "echouee" : "partielle";
  await terminerOccurrence(admin, occurrence.id, statut);

  return {
    occurrenceId: occurrence.id,
    appareilsCibles: ouverts.length,
    envoyes,
    echoues,
    statut,
  };
}

/** Le statut de campagne que porte le résultat d'une occurrence. */
export function statutCampagneDepuisOccurrence(
  statut: StatutOccurrence | null,
): "envoyee" | "partielle" | "echouee" {
  if (statut === "partielle") return "partielle";
  if (statut === "echouee") return "echouee";
  return "envoyee";
}

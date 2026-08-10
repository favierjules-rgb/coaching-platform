"use client";

import { useSynchronisation } from "@/hooks/useSynchronisation";

/**
 * LE DÉCLENCHEUR DE DÉMARRAGE.
 *
 * Monté dans le layout de l'espace élève, ce composant ne rend RIEN : il
 * existe pour que l'ouverture de l'application tente d'envoyer ce qui
 * attend.
 *
 * C'est le scénario du redémarrage, et c'est celui qui compte le plus :
 * séance validée dans une salle sans réseau, application tuée, réseau
 * revenu le lendemain. Sans ce montage, l'élève devrait rouvrir LA séance
 * concernée pour que son retour parte — c'est-à-dire deviner qu'il y a
 * quelque chose à faire.
 *
 * Les trois autres déclencheurs (`online`, retour au premier plan, et
 * l'ouverture de la séance elle-même) sont posés ailleurs ; le verrou par
 * compte de `synchroniser()` fait que leur simultanéité ne produit qu'un
 * seul envoi.
 */
export function SynchronisationOffline() {
  useSynchronisation();
  return null;
}

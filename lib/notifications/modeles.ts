/**
 * LES QUATRE MODÈLES DU COMPOSER.
 *
 * Un modèle ne fait qu'une chose : PRÉ-REMPLIR. Il n'est pas stocké avec la
 * campagne, il n'impose aucune destination, et tout reste modifiable après
 * l'avoir choisi. C'est pour cela qu'aucune colonne ne lui correspond en
 * base — l'ajouter donnerait l'illusion d'un lien qui n'existe pas.
 */

import { DESTINATION_PAR_DEFAUT } from "@/lib/push/destinations";

export interface ModeleNotification {
  cle: "poids" | "retour_seance" | "entrainement" | "libre";
  libelle: string;
  titre: string;
  corps: string;
  destination: string;
}

export const MODELES: ModeleNotification[] = [
  {
    cle: "poids",
    libelle: "Poids",
    titre: "Ton poids de la semaine",
    corps: "Pense à renseigner ton poids de la semaine.",
    destination: "/profil",
  },
  {
    cle: "retour_seance",
    libelle: "Retour séance",
    titre: "Retour de séance",
    corps: "N'oublie pas de compléter ton retour de séance.",
    destination: "/entrainement",
  },
  {
    cle: "entrainement",
    libelle: "Entraînement",
    titre: "Séance du jour",
    corps: "Ta séance du jour t'attend.",
    destination: "/entrainement",
  },
  {
    cle: "libre",
    libelle: "Libre",
    titre: "",
    corps: "",
    destination: DESTINATION_PAR_DEFAUT,
  },
];

export function modele(cle: string): ModeleNotification | null {
  return MODELES.find((m) => m.cle === cle) ?? null;
}

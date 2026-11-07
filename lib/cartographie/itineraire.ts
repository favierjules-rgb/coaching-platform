import type { Point } from "@/lib/cartographie/vue-magasins";

/**
 * CARTOGRAPHIE — OUVRIR UN ITINÉRAIRE DANS L'APPLICATION DE SON CHOIX.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ NOUS NE TRANSMETTONS AUCUN POINT DE DÉPART, ET C'EST UN GAIN
 * ════════════════════════════════════════════════════════════════════════════
 * L'ancien lien portait la position de l'élève comme origine. Les trois
 * applications savent la déterminer elles-mêmes, sur l'appareil, bien mieux
 * que nous — et ne rien envoyer veut dire que ni Google, ni Waze, ni Apple
 * n'apprennent d'où part cet élève. Nous ne leur donnons que la DESTINATION,
 * c'est-à-dire l'adresse d'un commerce : une information publique.
 *
 * Conséquence directe : ouvrir un itinéraire ne demande JAMAIS la
 * géolocalisation. Un élève qui a refusé la localisation et cherché par ville
 * peut quand même se faire guider.
 *
 * ⚠️ UNE SEULE DESTINATION PART, CHEZ UN SEUL FOURNISSEUR. L'élève choisit,
 * et c'est son choix seul qui reçoit les coordonnées — pas les trois.
 *
 * ⚠️ AUCUN SCHÉMA PRIVÉ (`waze://`, `comgooglemaps://`). Un schéma privé ne
 * mène nulle part quand l'application n'est pas installée : l'onglet reste
 * blanc, sans message, et l'élève croit que le bouton est cassé. Les trois URL
 * ci-dessous sont les liens universels officiels : elles ouvrent
 * l'application si elle est là, et sa version web sinon.
 *
 * Module FEUILLE : ni React, ni DOM, ni réseau. Fonctions PURES.
 */

export type FournisseurItineraire = "google" | "waze" | "apple";

export interface Fournisseur {
  readonly id: FournisseurItineraire;
  readonly nom: string;
  /**
   * La couleur de la marque, pour la pastille du sélecteur.
   *
   * ⚠️ UNE COULEUR, PAS UN LOGO REDESSINÉ. Retracer à la main le repère de
   * Google Maps ou l'icône de Waze donnerait une approximation — c'est-à-dire
   * exactement le logo déformé que l'on veut éviter. La couleur de la marque
   * et son nom écrit en toutes lettres suffisent à reconnaître l'application,
   * sans contrefaire son emblème. Poser les vrais logos demanderait de
   * récupérer les fichiers officiels de chaque marque et d'en respecter les
   * conditions d'usage : c'est une décision, pas un détail d'intégration.
   */
  readonly couleur: string;
}

/** Les trois applications proposées, dans leur ordre de référence. */
export const FOURNISSEURS: readonly Fournisseur[] = [
  { id: "google", nom: "Google Maps", couleur: "#1a73e8" },
  { id: "waze", nom: "Waze", couleur: "#33ccff" },
  { id: "apple", nom: "Plans", couleur: "#34c759" },
];

/**
 * ⚠️ SIX DÉCIMALES, ET PAS DAVANTAGE. C'est une précision d'environ onze
 * centimètres : largement au-delà de ce qu'une devanture de magasin exige, et
 * cela évite d'envoyer les dix-sept chiffres d'un flottant, qui donnent une
 * fausse impression d'exactitude.
 */
function coordonnee(valeur: number): string {
  return valeur.toFixed(6);
}

function destination(vers: Point): string {
  return `${coordonnee(vers.lat)},${coordonnee(vers.lon)}`;
}

/**
 * L'URL universelle d'un fournisseur vers un commerce.
 *
 * ⚠️ CONSTRUITE AVEC `URL` ET `URLSearchParams`, jamais par concaténation. La
 * virgule des coordonnées ressort encodée (`%2C`) — les trois services la
 * décodent, et c'est le prix d'un encodage qui ne peut pas se tromper.
 *
 * ⚠️ UNE COORDONNÉE ABERRANTE NE PRODUIT PAS D'URL. Mieux vaut un bouton
 * absent qu'un bouton qui envoie au milieu de l'Atlantique.
 */
export function urlDuFournisseur(id: FournisseurItineraire, vers: Point): string | null {
  if (!Number.isFinite(vers.lat) || !Number.isFinite(vers.lon)) return null;
  if (Math.abs(vers.lat) > 90 || Math.abs(vers.lon) > 180) return null;

  const cible = destination(vers);

  switch (id) {
    case "google": {
      const url = new URL("https://www.google.com/maps/dir/");
      url.searchParams.set("api", "1");
      url.searchParams.set("destination", cible);
      url.searchParams.set("travelmode", "driving");
      return url.href;
    }
    case "waze": {
      const url = new URL("https://waze.com/ul");
      url.searchParams.set("ll", cible);
      url.searchParams.set("navigate", "yes");
      url.searchParams.set("zoom", "17");
      return url.href;
    }
    case "apple": {
      const url = new URL("https://maps.apple.com/");
      url.searchParams.set("daddr", cible);
      url.searchParams.set("dirflg", "d");
      return url.href;
    }
  }
}

/**
 * Les trois applications, celle de la plateforme en premier.
 *
 * ⚠️ « PRIVILÉGIER » VEUT DIRE PROPOSER EN PREMIER, PAS DÉCIDER À LA PLACE.
 * Sur iPhone, Plans est installé d'office et c'est souvent le bon choix ; sur
 * Android, c'est Google Maps. Mais beaucoup de gens préfèrent Waze partout, et
 * l'ordre n'enlève rien : les trois restent offertes, et aucune n'est
 * présélectionnée.
 *
 * ⚠️ LE RENIFLAGE SE LIMITE À CE QU'IL SAIT FAIRE. On ne cherche pas à deviner
 * quelle application est INSTALLÉE — le navigateur ne le dit pas, et prétendre
 * le savoir conduirait à masquer un choix valable.
 */
export function fournisseursOrdonnes(agent: string | undefined): readonly Fournisseur[] {
  const pomme = /iPhone|iPad|iPod|Macintosh/i.test(agent ?? "");
  if (!pomme) return FOURNISSEURS;
  const [apple] = FOURNISSEURS.filter((f) => f.id === "apple");
  return apple === undefined ? FOURNISSEURS : [apple, ...FOURNISSEURS.filter((f) => f.id !== "apple")];
}

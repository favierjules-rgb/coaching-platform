/**
 * LA GÉOMÉTRIE DU LOADER — relevée dans `brand/loading.json`, pas inventée.
 *
 * ════════════════════════════════════════════════════════════════════════
 * D'OÙ VIENNENT CES NOMBRES
 * ════════════════════════════════════════════════════════════════════════
 * Du fichier Lottie fourni par la marque, mesuré et non redessiné. Le
 * fichier reste dans `brand/` comme source d'autorité, exactement comme
 * `brand/logo/approved/` l'est pour les logos, et
 * `scripts/tests/loader-marque.mts` RELIT ce fichier pour vérifier que les
 * valeurs ci-dessous lui correspondent toujours. Une géométrie recopiée à la
 * main finit par diverger de son original ; celle-ci ne le peut pas sans
 * faire rougir un test.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LE FICHIER FAIT RÉELLEMENT — ET QUI N'EST PAS CE QU'ON CROIT
 * ════════════════════════════════════════════════════════════════════════
 * Il n'y a NI rotation NI déformation de tracé. Ce sont 120 disques
 * strictement immobiles, sur cinq anneaux concentriques. Ce qui bouge, c'est
 * leur couleur et leur échelle, qui pulsent ensemble, anneau par anneau, avec
 * un décalage constant de l'extérieur vers le centre.
 *
 * C'est précisément pour cette raison que la reconstruction en CSS est
 * FIDÈLE et non approchée : il n'y avait rien à interpoler. Un player Lottie
 * (≈ 150 Ko de JSON plus un moteur de rendu) aurait chargé une bibliothèque
 * pour faire clignoter des ronds — et il l'aurait fait APRÈS le premier
 * rendu, c'est-à-dire après le moment que le loader est censé couvrir, et
 * pas du tout hors ligne.
 *
 * ⚠️ UNE RÈGLE DE COMPOSITION À NE PAS CASSER : l'écart entre deux points
 * voisins vaut 78,54 unités sur LES CINQ anneaux (2πr/n est constant, car le
 * nombre de points croît comme le rayon). Seul le DIAMÈTRE des points grandit
 * vers l'extérieur. Ajouter un anneau sans respecter cette règle se verrait
 * immédiatement.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS DENSITÉS, PARCE QU'UN LOADER DE 16 PX N'EST PAS UN LOADER DE 128 PX
 * ════════════════════════════════════════════════════════════════════════
 * L'animation d'origine est dessinée pour un canevas de 1080 px. Rendue à
 * 40 px — la taille du loader pleine page avant ce chantier — chacun de ses
 * 120 points mesure moins de 2,2 px : une bouillie grise, pas un motif.
 *
 * On ne rétrécit donc pas le dessin, on en réduit la DENSITÉ : moins
 * d'anneaux, points proportionnellement plus gros, même règle d'écart
 * constant, même tempo. Le motif reste reconnaissable à chaque taille au lieu
 * de se dissoudre.
 */

/** Un anneau : ses points, son rayon, l'angle du premier point, et le
 *  diamètre de chacun — mesurés un par un, car ils ne sont PAS identiques
 *  dans le fichier d'origine (placement à la main : 46,8 à 66,0 sur le
 *  dernier anneau). */
export interface AnneauDeChargement {
  readonly points: number;
  readonly rayon: number;
  /** Angle du premier point, en degrés. Les suivants sont à `360 / points`
   *  d'intervalle — vérifié à 0,0005° près sur les cinq anneaux. */
  readonly phase: number;
  /** Un diamètre par point, dans l'ordre des angles croissants. Une seule
   *  valeur signifie « tous les points de cet anneau ont ce diamètre ». */
  readonly diametres: readonly number[];
}

export interface DensiteDeChargement {
  /** Côté du carré `viewBox`. Le centre est toujours au milieu. */
  readonly boite: number;
  readonly anneaux: readonly AnneauDeChargement[];
}

/** Durée d'un tour complet : 91 images à 30 i/s. Le cycle contient DEUX
 *  pulsations, soit un battement toutes les ~1,52 s. */
export const CYCLE_MS = 3033;

/** Avance d'un anneau sur le suivant vers le centre : 3,913 images à 30 i/s.
 *  C'est ce décalage qui fait la vague. */
export const DECALAGE_ANNEAU_MS = 130.4;

/**
 * L'ORIGINAL, intact : cinq anneaux, 120 points, canevas de 1080.
 * Réservé à la variante `plein`, où la place existe.
 */
export const DENSITE_COMPLETE: DensiteDeChargement = {
  boite: 1080,
  anneaux: [
      { points: 8, rayon: 100, phase: 27.198, diametres: [37.36, 39.99, 37.36, 39.99, 37.36, 39.99, 37.36, 39.99] },
      { points: 16, rayon: 200, phase: 4.698, diametres: [47.84, 42.69, 36.61, 45.7, 47.84, 42.69, 36.61, 45.7, 47.84, 42.69, 36.61, 45.7, 47.84, 42.69, 36.61, 45.7] },
      { points: 24, rayon: 300, phase: 12.198, diametres: [52.78, 48.03, 40.0, 45.39, 51.41, 53.94, 52.78, 48.03, 40.0, 45.39, 51.41, 53.94, 52.78, 48.03, 40.0, 45.39, 51.41, 53.94, 52.78, 48.03, 40.0, 45.39, 51.41, 53.94] },
      { points: 32, rayon: 400, phase: 4.698, diametres: [59.8, 57.69, 53.37, 46.99, 45.76, 52.45, 57.13, 59.61, 59.8, 57.69, 53.37, 46.99, 45.76, 52.45, 57.13, 59.61, 59.8, 57.69, 53.37, 46.99, 45.76, 52.45, 57.13, 59.61, 59.8, 57.69, 53.37, 46.99, 45.76, 52.45, 57.13, 59.61] },
      { points: 40, rayon: 500, phase: 0.198, diametres: [66.0, 65.15, 62.7, 58.7, 53.26, 46.83, 53.53, 58.91, 62.84, 65.22, 66.0, 65.15, 62.7, 58.7, 53.26, 46.83, 53.53, 58.91, 62.84, 65.22, 66.0, 65.15, 62.7, 58.7, 53.26, 46.83, 53.53, 58.91, 62.84, 65.22, 66.0, 65.15, 62.7, 58.7, 53.26, 46.83, 53.53, 58.91, 62.84, 65.22] },
  ],
};

/**
 * DEUX ANNEAUX, pour les attentes de section (`ligne`).
 *
 * Ce n'est pas un recadrage des deux anneaux intérieurs : réduits à 40 px,
 * leurs points feraient 1,4 px. Les proportions sont redessinées pour que le
 * point reste lisible, en conservant la règle du fichier — écart constant
 * entre points voisins (16,49 unités sur les deux anneaux) et diamètre qui
 * croît vers l'extérieur. Les phases sont celles des anneaux 1 et 2
 * d'origine, pour retrouver la même orientation.
 *
 * Diamètres uniformes ici : l'irrégularité du fichier d'origine (quelques
 * dixièmes d'unité) est invisible à cette taille et ne serait que du bruit.
 */
export const DENSITE_REDUITE: DensiteDeChargement = {
  boite: 100,
  anneaux: [
    { points: 8, rayon: 21, phase: 27.198, diametres: [11] },
    { points: 16, rayon: 42, phase: 4.698, diametres: [13] },
  ],
};

/**
 * UN SEUL ANNEAU, pour les attentes en ligne de texte (`inline`, 1 em).
 *
 * À 16 px, même deux anneaux ne tiennent pas : il faut 3 px par point pour
 * qu'un point soit un point. Huit points sur un seul anneau y parviennent —
 * c'est le plus petit état où le motif dit encore ce qu'il est.
 */
export const DENSITE_MINIMALE: DensiteDeChargement = {
  boite: 100,
  anneaux: [{ points: 8, rayon: 38, phase: 27.198, diametres: [22] }],
};

/** Le disque `i` d'un anneau, en coordonnées du `viewBox`. */
export interface DisqueDeChargement {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/**
 * Déplie un anneau en disques. Les angles sont DÉRIVÉS de `phase` et du
 * nombre de points, jamais stockés : c'est la régularité mesurée dans le
 * fichier, et la stocker ouvrirait la porte à une liste incohérente.
 */
export function disquesDeLAnneau(
  anneau: AnneauDeChargement,
  boite: number,
): DisqueDeChargement[] {
  const centre = boite / 2;
  const pas = 360 / anneau.points;
  return Array.from({ length: anneau.points }, (_, i) => {
    const angle = ((anneau.phase + i * pas) * Math.PI) / 180;
    const diametre = anneau.diametres[i] ?? anneau.diametres[0];
    return {
      cx: Number((centre + anneau.rayon * Math.cos(angle)).toFixed(2)),
      cy: Number((centre + anneau.rayon * Math.sin(angle)).toFixed(2)),
      r: Number((diametre / 2).toFixed(2)),
    };
  });
}

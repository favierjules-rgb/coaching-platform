/**
 * F5 — LE CALQUE D'ANNOTATIONS : le modèle, et rien d'autre.
 *
 * Ce module ne dessine pas, ne parle ni au DOM ni au réseau. Il définit ce
 * qu'EST une annotation, ce qui est acceptable, et ce qui est visible à un
 * instant donné — le tout testable sans navigateur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LES ANNOTATIONS NE SONT PAS GRAVÉES DANS LA VIDÉO
 * ────────────────────────────────────────────────────────────────────────
 * Aucun transcodage n'a lieu dans le navigateur (règle tenue depuis F4). Le
 * calque est donc une liste de TRACÉS HORODATÉS, stockée à côté du fichier
 * et rejouée par-dessus lui à la lecture.
 *
 * Ce choix a trois conséquences qu'il vaut mieux connaître :
 *   • il est NON DESTRUCTIF — le coach peut corriger un tracé après coup,
 *     sans réenvoyer la vidéo ;
 *   • il est LÉGER — quelques centaines d'octets, pas un second fichier ;
 *   • il n'est PAS INFALSIFIABLE au sens d'un pixel gravé : quelqu'un qui
 *     récupère l'URL signée voit la vidéo sans le calque. Pour un conseil
 *     d'entraînement, c'est sans conséquence ; il fallait le dire.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LES COORDONNÉES SONT NORMALISÉES, JAMAIS EN PIXELS
 * ────────────────────────────────────────────────────────────────────────
 * `x` et `y` vivent entre 0 et 1, relativement au cadre de la vidéo. Le coach
 * annote sur un écran de bureau, l'élève regarde sur un téléphone : des
 * pixels feraient tomber la flèche à côté. Le rayon d'un cercle et la taille
 * d'un texte sont normalisés sur la LARGEUR — une seule dimension de
 * référence, sinon un cercle deviendrait une ellipse au changement de ratio.
 */

/** Miroir exact du CHECK `coach_reply_video_annotations_ok` (200 tracés). */
export const ANNOTATIONS_MAX = 200;

/** Un trait libre est une polyligne : au-delà, c'est du gribouillage stocké. */
export const ANNOTATION_POINTS_MAX = 240;

/** Une étiquette, pas un paragraphe. */
export const ANNOTATION_TEXTE_MAX = 80;

/** Durée par défaut d'un tracé posé sans réglage : le temps de le voir. */
export const ANNOTATION_DUREE_DEFAUT = 3;

/**
 * Instant et durée maximaux d'un tracé, en secondes.
 *
 * Miroir de la durée maximale d'une réponse vidéo : un tracé qui apparaît à
 * la troisième minute d'une vidéo qui en dure deux ne désigne rien. La borne
 * est ici plutôt que dans `coach-reply-video.ts` parce que c'est la BASE qui
 * la refuse, et que ce module est le miroir applicatif de ce CHECK.
 */
export const ANNOTATION_INSTANT_MAX = 120;

/**
 * Budget de taille du calque sérialisé, en caractères.
 *
 * ─── POURQUOI IL EXISTE, ET POURQUOI IL EST PLUS PETIT QU'EN BASE ─────────
 * Compter les tracés ne borne pas la charge utile : deux cents traits libres
 * de deux cent quarante points chacun pèsent plus d'un mégaoctet, et
 * passeraient le plafond de 200 sans broncher. Un calque n'est pas un dépôt
 * de données ; il lui faut une borne en OCTETS, pas seulement en objets.
 *
 * La base refuse au-delà de 256 Ko. Ce budget-ci est délibérément PLUS
 * SERRÉ : c'est ce qui garantit que l'éditeur s'arrête AVANT que la base ne
 * refuse. Le coach lit « tu as atteint le maximum » au moment où il dessine,
 * jamais « l'enregistrement a échoué » après vingt minutes de travail.
 */
export const ANNOTATIONS_OCTETS_MAX = 200_000;

/** Miroir du vocabulaire accepté par la base. */
export const OUTILS_ANNOTATION = ["fleche", "cercle", "trait", "texte"] as const;
export type OutilAnnotation = (typeof OUTILS_ANNOTATION)[number];

/**
 * Palette du calque. Volontairement RESTREINTE et lisible sur une image
 * quelconque : un tracé doit se voir sur un fond clair comme sur un fond
 * sombre. Le blanc et le noir sont là pour le contraste, l'ambre pour
 * l'attention — pas pour décorer.
 */
export const COULEURS_ANNOTATION = ["#ffffff", "#111111", "#f59e0b"] as const;
export type CouleurAnnotation = (typeof COULEURS_ANNOTATION)[number];

export interface PointNormalise {
  /** 0 = bord gauche, 1 = bord droit. */
  x: number;
  /** 0 = haut, 1 = bas. */
  y: number;
}

interface AnnotationCommune {
  id: string;
  /** Instant d'apparition, en secondes depuis le début de la vidéo. */
  debut: number;
  /** Durée d'affichage, en secondes. Toujours > 0. */
  duree: number;
  couleur: CouleurAnnotation;
}

export type Annotation =
  | (AnnotationCommune & { type: "fleche"; de: PointNormalise; a: PointNormalise })
  | (AnnotationCommune & { type: "cercle"; centre: PointNormalise; rayon: number })
  | (AnnotationCommune & { type: "trait"; points: PointNormalise[] })
  | (AnnotationCommune & { type: "texte"; position: PointNormalise; contenu: string });

/* ════════════════════════════════════════════════════════════════════════
 * LECTURE — on ne fait jamais confiance à ce qui vient de la base
 * ════════════════════════════════════════════════════════════════════════ */

const borner = (valeur: number, min: number, max: number) =>
  Math.min(max, Math.max(min, valeur));

function estNombreFini(valeur: unknown): valeur is number {
  return typeof valeur === "number" && Number.isFinite(valeur);
}

function lirePoint(brut: unknown): PointNormalise | null {
  if (typeof brut !== "object" || brut === null) return null;
  const { x, y } = brut as { x?: unknown; y?: unknown };
  if (!estNombreFini(x) || !estNombreFini(y)) return null;
  // On BORNE plutôt que de refuser : un point à 1.02 vient d'un geste qui a
  // dépassé le cadre, pas d'une attaque. Le refuser ferait disparaître un
  // tracé entier pour un pixel.
  return { x: borner(x, 0, 1), y: borner(y, 0, 1) };
}

function lireCouleur(brut: unknown): CouleurAnnotation {
  return (COULEURS_ANNOTATION as readonly string[]).includes(brut as string)
    ? (brut as CouleurAnnotation)
    : COULEURS_ANNOTATION[0];
}

/**
 * Traduit ce que porte la colonne `jsonb` en calque utilisable.
 *
 * Ne lève JAMAIS et ne rend jamais un tracé à moitié valide : une entrée
 * illisible est ÉCARTÉE, le reste est conservé. Même principe que
 * `parseExerciseSubstitutes` — un calque abîmé ne doit pas faire disparaître
 * la vidéo, ni afficher une flèche pointant nulle part.
 */
export function parseAnnotations(brut: unknown): Annotation[] {
  if (!Array.isArray(brut)) return [];
  const calque: Annotation[] = [];

  for (const entree of brut.slice(0, ANNOTATIONS_MAX)) {
    if (typeof entree !== "object" || entree === null) continue;
    const objet = entree as Record<string, unknown>;
    const type = objet.type;
    if (!(OUTILS_ANNOTATION as readonly unknown[]).includes(type)) continue;
    if (!estNombreFini(objet.debut) || !estNombreFini(objet.duree)) continue;
    if (objet.duree <= 0 || objet.debut < 0) continue;
    // Mêmes bornes que le CHECK en base : un tracé hors de ces limites serait
    // accepté ici puis REFUSÉ à l'enregistrement suivant. On l'écarte à la
    // lecture, comme n'importe quelle entrée que le lecteur ne sait pas
    // rejouer.
    if (objet.debut > ANNOTATION_INSTANT_MAX || objet.duree > ANNOTATION_INSTANT_MAX) continue;

    const commun = {
      id: typeof objet.id === "string" && objet.id ? objet.id : `a-${calque.length}`,
      debut: objet.debut,
      duree: objet.duree,
      couleur: lireCouleur(objet.couleur),
    };

    if (type === "fleche") {
      const de = lirePoint(objet.de);
      const a = lirePoint(objet.a);
      if (de && a) calque.push({ ...commun, type, de, a });
      continue;
    }
    if (type === "cercle") {
      const centre = lirePoint(objet.centre);
      if (centre && estNombreFini(objet.rayon) && objet.rayon > 0) {
        calque.push({ ...commun, type, centre, rayon: borner(objet.rayon, 0.01, 1) });
      }
      continue;
    }
    if (type === "trait") {
      const points = Array.isArray(objet.points)
        ? objet.points.slice(0, ANNOTATION_POINTS_MAX).map(lirePoint).filter((p): p is PointNormalise => p !== null)
        : [];
      // Un trait d'un seul point ne se dessine pas.
      if (points.length >= 2) calque.push({ ...commun, type, points });
      continue;
    }
    const position = lirePoint(objet.position);
    const contenu = typeof objet.contenu === "string" ? objet.contenu.trim().slice(0, ANNOTATION_TEXTE_MAX) : "";
    if (position && contenu) calque.push({ ...commun, type: "texte", position, contenu });
  }

  return calque;
}

/**
 * Ce qui part en base. On ne renvoie pas l'objet du composant tel quel : on
 * le RECONSTRUIT, champ par champ, pour qu'aucune propriété parasite laissée
 * par l'éditeur ne se retrouve stockée.
 *
 * Les coordonnées sont arrondies au dix-millième : une flèche n'a pas besoin
 * de quinze décimales, et la charge utile s'en trouve divisée par trois.
 */
export function serialiserAnnotations(calque: readonly Annotation[]): unknown[] {
  const p = (point: PointNormalise) => ({
    x: Math.round(point.x * 10000) / 10000,
    y: Math.round(point.y * 10000) / 10000,
  });
  const arrondi = (n: number) => Math.round(n * 1000) / 1000;

  return calque.slice(0, ANNOTATIONS_MAX).map((tr) => {
    const commun = { id: tr.id, type: tr.type, debut: arrondi(tr.debut), duree: arrondi(tr.duree), couleur: tr.couleur };
    if (tr.type === "fleche") return { ...commun, de: p(tr.de), a: p(tr.a) };
    if (tr.type === "cercle") return { ...commun, centre: p(tr.centre), rayon: arrondi(tr.rayon) };
    if (tr.type === "trait") return { ...commun, points: tr.points.slice(0, ANNOTATION_POINTS_MAX).map(p) };
    return { ...commun, position: p(tr.position), contenu: tr.contenu.slice(0, ANNOTATION_TEXTE_MAX) };
  });
}

/**
 * Les tracés visibles à l'instant `t`.
 *
 * Borne de FIN exclusive, borne de DÉBUT inclusive : sans cette asymétrie,
 * deux annotations qui se succèdent exactement clignoteraient ensemble sur
 * une image.
 */
export function annotationsVisibles(calque: readonly Annotation[], t: number): Annotation[] {
  return calque.filter((tr) => t >= tr.debut && t < tr.debut + tr.duree);
}

/** Le calque est-il vide ? `null` en base plutôt qu'un tableau vide. */
export function calqueVide(calque: readonly Annotation[]): boolean {
  return calque.length === 0;
}

/** Ce que pèse le calque une fois sérialisé — la mesure qui compte vraiment. */
export function tailleCalque(calque: readonly Annotation[]): number {
  return JSON.stringify(serialiserAnnotations(calque)).length;
}

/**
 * Le calque accepte-t-il encore un tracé ?
 *
 * DEUX bornes, pas une : le NOMBRE (200) et la TAILLE (voir
 * `ANNOTATIONS_OCTETS_MAX`). La seconde existe parce que la première ne borne
 * rien d'utile — deux cents traits libres pèsent plus d'un mégaoctet.
 */
export function calquePlein(calque: readonly Annotation[]): boolean {
  return calque.length >= ANNOTATIONS_MAX || tailleCalque(calque) >= ANNOTATIONS_OCTETS_MAX;
}

/* ════════════════════════════════════════════════════════════════════════
 * GÉOMÉTRIE — où tombe réellement un point normalisé
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Le rectangle où l'IMAGE est réellement dessinée dans un élément vidéo.
 *
 * ─── POURQUOI CE CALCUL EXISTE ───────────────────────────────────────────
 * Une vidéo 16/9 dans un cadre carré ne remplit pas le cadre : elle est
 * centrée, avec des bandes noires au-dessus et en dessous (`object-contain`,
 * le comportement par défaut d'un `<video>`). Convertir un point normalisé
 * en pixels sur la BOÎTE DE L'ÉLÉMENT plutôt que sur l'IMAGE décale donc
 * chaque tracé — et le décalage grandit avec la bande.
 *
 * Le symptôme serait particulièrement traître : le coach annote sur son
 * écran de bureau, où la vidéo remplit à peu près le cadre, et tout paraît
 * juste ; l'élève ouvre sur son téléphone en portrait, où les bandes sont
 * énormes, et la flèche pointe le plafond. D'où ce calcul, ici, testable
 * sans navigateur.
 *
 * Repli sur la boîte de l'élément quand les dimensions de la source ne sont
 * pas encore connues (`videoWidth` vaut 0 avant les métadonnées) : mieux
 * vaut un tracé provisoirement approximatif qu'une division par zéro.
 */
export interface BoiteContenu {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

export function boiteContenuVideo(
  largeurElement: number,
  hauteurElement: number,
  largeurSource: number,
  hauteurSource: number,
): BoiteContenu {
  const repli = { x: 0, y: 0, largeur: largeurElement, hauteur: hauteurElement };
  if (
    !Number.isFinite(largeurSource) ||
    !Number.isFinite(hauteurSource) ||
    largeurSource <= 0 ||
    hauteurSource <= 0 ||
    largeurElement <= 0 ||
    hauteurElement <= 0
  ) {
    return repli;
  }

  const ratio = largeurSource / hauteurSource;
  let largeur = largeurElement;
  let hauteur = largeurElement / ratio;
  if (hauteur > hauteurElement) {
    hauteur = hauteurElement;
    largeur = hauteurElement * ratio;
  }
  return {
    x: (largeurElement - largeur) / 2,
    y: (hauteurElement - hauteur) / 2,
    largeur,
    hauteur,
  };
}

/** Point normalisé → pixels, dans le repère de l'élément. */
export function versPixels(point: PointNormalise, boite: BoiteContenu): { x: number; y: number } {
  return { x: boite.x + point.x * boite.largeur, y: boite.y + point.y * boite.hauteur };
}

/**
 * Pixels → point normalisé, BORNÉ à l'image.
 *
 * Un geste qui déborde sur la bande noire est ramené au bord plutôt que
 * refusé : le coach a visé un peu large, il n'a pas essayé de tricher.
 */
export function versNormalise(x: number, y: number, boite: BoiteContenu): PointNormalise {
  if (boite.largeur <= 0 || boite.hauteur <= 0) return { x: 0, y: 0 };
  return {
    x: borner((x - boite.x) / boite.largeur, 0, 1),
    y: borner((y - boite.y) / boite.hauteur, 0, 1),
  };
}

/**
 * Épaisseur de trait et taille de texte, proportionnelles à la LARGEUR de
 * l'image. Un trait de 3 px fixes est un fil sur un écran de bureau et une
 * barre sur un téléphone : ce qui doit rester constant, c'est la proportion.
 */
export function epaisseurTrait(largeurImage: number): number {
  return Math.max(2, largeurImage * 0.005);
}

export function tailleTexte(largeurImage: number): number {
  return Math.max(12, largeurImage * 0.038);
}

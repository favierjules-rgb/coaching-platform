import {
  epaisseurTrait,
  tailleTexte,
  versPixels,
  type Annotation,
  type BoiteContenu,
  type CouleurAnnotation,
} from "@/lib/video-annotations";

/**
 * COMMENT UN TRACÉ SE DESSINE — un seul endroit, pour les deux côtés.
 *
 * Le coach dessine dans l'éditeur, l'élève regarde dans le lecteur. Si les
 * deux avaient leur propre routine de dessin, la flèche que le coach place
 * ne serait pas tout à fait celle que l'élève voit — et l'écart passerait
 * inaperçu jusqu'à ce qu'il compte. Une seule fonction, donc, appelée par
 * les deux.
 *
 * Ce module touche un `CanvasRenderingContext2D` mais ne connaît ni React,
 * ni le temps qui passe : on lui donne une boîte et une liste de tracés, il
 * les pose. C'est l'appelant qui décide LESQUELS (via `annotationsVisibles`),
 * et l'éditeur y ajoute le tracé en cours de geste.
 *
 * ─── LE HALO N'EST PAS UNE DÉCORATION ────────────────────────────────────
 * Chaque forme est dessinée DEUX fois : d'abord un contour de contraste plus
 * épais, puis la couleur choisie. Sans lui, une flèche blanche sur un mur de
 * salle blanc est invisible — et le coach, qui l'a tracée sur SON écran en
 * la voyant très bien pendant qu'il visait, n'aurait aucun moyen de s'en
 * apercevoir.
 */

/** Contraste : clair sur les couleurs sombres, sombre sur les claires. */
function halo(couleur: CouleurAnnotation): string {
  return couleur === "#111111" ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.55)";
}

function tracerDeuxFois(
  ctx: CanvasRenderingContext2D,
  couleur: CouleurAnnotation,
  epaisseur: number,
  chemin: () => void,
): void {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = halo(couleur);
  ctx.lineWidth = epaisseur * 2.2;
  chemin();
  ctx.stroke();
  ctx.strokeStyle = couleur;
  ctx.lineWidth = epaisseur;
  chemin();
  ctx.stroke();
}

function dessinerFleche(
  ctx: CanvasRenderingContext2D,
  boite: BoiteContenu,
  epaisseur: number,
  tr: Extract<Annotation, { type: "fleche" }>,
): void {
  const de = versPixels(tr.de, boite);
  const a = versPixels(tr.a, boite);
  const angle = Math.atan2(a.y - de.y, a.x - de.x);
  // Pointe proportionnelle au trait, bornée pour rester visible sur une
  // flèche très courte.
  const pointe = Math.max(epaisseur * 4, 10);
  const ouverture = 0.42;

  tracerDeuxFois(ctx, tr.couleur, epaisseur, () => {
    ctx.beginPath();
    ctx.moveTo(de.x, de.y);
    ctx.lineTo(a.x, a.y);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x - pointe * Math.cos(angle - ouverture), a.y - pointe * Math.sin(angle - ouverture));
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x - pointe * Math.cos(angle + ouverture), a.y - pointe * Math.sin(angle + ouverture));
  });
}

function dessinerCercle(
  ctx: CanvasRenderingContext2D,
  boite: BoiteContenu,
  epaisseur: number,
  tr: Extract<Annotation, { type: "cercle" }>,
): void {
  const centre = versPixels(tr.centre, boite);
  // Le rayon est normalisé sur la LARGEUR, et appliqué en pixels dans les
  // deux directions : c'est ce qui garde un cercle rond quand le cadre
  // change de proportions. Le normaliser sur les deux axes en ferait une
  // ellipse dès que le ratio bouge.
  const rayon = Math.max(2, tr.rayon * boite.largeur);
  tracerDeuxFois(ctx, tr.couleur, epaisseur, () => {
    ctx.beginPath();
    ctx.arc(centre.x, centre.y, rayon, 0, Math.PI * 2);
  });
}

function dessinerTrait(
  ctx: CanvasRenderingContext2D,
  boite: BoiteContenu,
  epaisseur: number,
  tr: Extract<Annotation, { type: "trait" }>,
): void {
  if (tr.points.length < 2) return;
  tracerDeuxFois(ctx, tr.couleur, epaisseur, () => {
    ctx.beginPath();
    tr.points.forEach((point, i) => {
      const p = versPixels(point, boite);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  });
}

function dessinerTexte(
  ctx: CanvasRenderingContext2D,
  boite: BoiteContenu,
  tr: Extract<Annotation, { type: "texte" }>,
): void {
  const position = versPixels(tr.position, boite);
  const taille = tailleTexte(boite.largeur);
  ctx.font = `600 ${taille}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.strokeStyle = halo(tr.couleur);
  ctx.lineWidth = Math.max(3, taille * 0.18);
  ctx.strokeText(tr.contenu, position.x, position.y);
  ctx.fillStyle = tr.couleur;
  ctx.fillText(tr.contenu, position.x, position.y);
}

/** Pose les tracés donnés. L'appelant a déjà choisi lesquels et effacé. */
export function dessinerCalque(
  ctx: CanvasRenderingContext2D,
  boite: BoiteContenu,
  calque: readonly Annotation[],
): void {
  if (boite.largeur <= 0 || boite.hauteur <= 0) return;
  const epaisseur = epaisseurTrait(boite.largeur);
  ctx.save();
  ctx.setLineDash([]);
  for (const tr of calque) {
    if (tr.type === "fleche") dessinerFleche(ctx, boite, epaisseur, tr);
    else if (tr.type === "cercle") dessinerCercle(ctx, boite, epaisseur, tr);
    else if (tr.type === "trait") dessinerTrait(ctx, boite, epaisseur, tr);
    else dessinerTexte(ctx, boite, tr);
  }
  ctx.restore();
}

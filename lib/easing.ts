/**
 * Évaluateur cubic-bezier générique (résolution numérique par Newton-
 * Raphson, 8 itérations — largement suffisant pour un usage visuel piloté
 * par le scroll). Permet de réutiliser en JS la même courbe que le token
 * CSS `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` défini dans
 * `app/globals.css` (Lot 6, emil-design-eng), plutôt que d'approximer
 * avec une autre formule.
 */
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number) {
  const cx = 3 * p1x;
  const bx = 3 * (p2x - p1x) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1y;
  const by = 3 * (p2y - p1y) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDerivativeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const dx = sampleX(t) - x;
      const derivative = sampleDerivativeX(t);
      if (Math.abs(derivative) < 1e-6) break;
      t -= dx / derivative;
    }
    return sampleY(t);
  };
}

/** Identique au token CSS `--ease-out` (app/globals.css). */
export const easeOut = cubicBezier(0.23, 1, 0.32, 1);

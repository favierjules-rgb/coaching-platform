import { createRoot } from "react-dom/client";

import { GoogleReviewsStack } from "../../../components/sections/GoogleReviewsStack";
import { AVIS_DEMONSTRATION } from "../../../lib/reviews/google-reviews.mock";
import { avisPubliables } from "../../../lib/reviews/types";

/**
 * Point d'entrée du harnais de rendu réel — chantier AVIS GOOGLE, Phase A.
 *
 * ⚠️ Il monte les VRAIES données de démonstration, passées par le VRAI filtre
 * `avisPubliables` — pas une fixture parallèle. Si le filtre laissait passer
 * un 3 étoiles, il apparaîtrait ici, et le test R11 le verrait.
 *
 * Ce harnais mesure de la GÉOMÉTRIE : débordement, superposition, mise en
 * avant, hauteurs. Jamais du contenu.
 */
const AVIS = avisPubliables(AVIS_DEMONSTRATION);

const racine = document.getElementById("racine");
if (racine) {
  createRoot(racine).render(
    <div style={{ background: "var(--color-background)", minHeight: "100vh" }}>
      <section
        id="avis-clients"
        style={{ overflow: "hidden", paddingTop: "3.5rem", paddingBottom: "5rem" }}
      >
        <div style={{ margin: "0 auto", maxWidth: "80rem", padding: "0 1.5rem" }}>
          <h2
            style={{
              fontFamily: "var(--font-heading), sans-serif",
              fontSize: "2.5rem",
              fontWeight: 800,
              textTransform: "uppercase",
              color: "var(--color-foreground)",
              marginBottom: "1rem",
            }}
          >
            Avis Google
          </h2>
          <p
            data-avis-demonstration
            style={{
              display: "inline-flex",
              gap: "0.5rem",
              border: "1px solid color-mix(in oklab, var(--color-primary) 50%, transparent)",
              padding: "0.5rem 0.75rem",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.16em",
              color: "var(--color-primary)",
              marginBottom: "0.5rem",
            }}
          >
            Données de démonstration — ces avis sont des exemples, pas de vrais avis Google
          </p>
        </div>
        <div style={{ margin: "0 auto", maxWidth: "80rem", padding: "0 1.5rem" }}>
          <GoogleReviewsStack avis={AVIS} />
        </div>
      </section>
    </div>,
  );
}

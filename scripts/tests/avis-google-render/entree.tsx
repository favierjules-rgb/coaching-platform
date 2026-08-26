import { createRoot } from "react-dom/client";

import { GoogleReviewsStack } from "../../../components/sections/GoogleReviewsStack";
import { AVIS_DEMONSTRATION } from "../../../lib/reviews/google-reviews.mock";
import { avisPubliables } from "../../../lib/reviews/types";

/**
 * Point d'entrée du harnais de rendu réel — chantier AVIS GOOGLE, Phase A.
 *
 * ⚠️ Il monte les VRAIES données de la source, passées par le VRAI filtre
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
        style={{ overflowX: "clip", paddingTop: "2.5rem", paddingBottom: "3rem" }}
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
            Leur expérience
          </h2>
        </div>
        <div style={{ margin: "0 auto", maxWidth: "64rem", padding: "0 1.5rem" }}>
          <GoogleReviewsStack avis={AVIS} />
        </div>
      </section>
    </div>,
  );
}

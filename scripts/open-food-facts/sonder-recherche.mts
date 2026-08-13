/**
 * SONDE MANUELLE DE LA RECHERCHE TEXTE — hors CI, à lancer à la main.
 *
 *   OPENFOODFACTS_USER_AGENT="SETH/1.0 (contact@exemple.fr)" \
 *     npx tsx scripts/open-food-facts/sonder-recherche.mts
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SCRIPT N'EST PAS UN TEST, ET ENCORE MOINS QU'EN PHASE 3
 * ────────────────────────────────────────────────────────────────────────────
 * Open Food Facts limite les RECHERCHES à 10 par minute et par IP — deux fois
 * moins que les lectures produit — et sa documentation dit littéralement de ne
 * pas s'en servir pour une recherche au fil de la frappe, « you would be
 * blocked very quickly ». Une CI qui rejouerait trois requêtes à chaque commit
 * ferait bannir son IP en une matinée, et le harnais officiel
 * (`scripts/tests/aliments-a3-search.mts`) travaille donc entièrement sur
 * fixtures.
 *
 * Ce script répond à l'autre question, celle que les fixtures ne peuvent pas
 * poser : « la forme mesurée est-elle encore la forme réelle ? »
 *
 * TROIS requêtes, espacées. Pas une de plus.
 *
 * ⚠️ Si la sonde signale une divergence : s'ARRÊTER et la rapporter. Ne jamais
 * ajuster l'adaptateur pour faire taire la sonde — ce serait remplacer une
 * mesure par une supposition.
 */
import { performance } from "node:perf_hooks";

import { estOffErreur } from "../../lib/open-food-facts/contrat";
import {
  OFF_SEARCH_CONTRACT_VERSION,
  chercherProduitsParTexte,
  urlRechercheProduits,
} from "../../lib/open-food-facts/recherche";

const REQUETES = ["skyr danone", "nutella", "coca cola"] as const;

async function main(): Promise<void> {
  if (!process.env.OPENFOODFACTS_USER_AGENT?.trim()) {
    console.error(
      "OPENFOODFACTS_USER_AGENT absente. Open Food Facts exige un User-Agent " +
        "« AppName/Version (contact) ». Aucun repli n'est fabriqué : la sonde s'arrête.",
    );
    process.exit(2);
  }

  console.log(`Sonde recherche Open Food Facts — contrat annoncé ${OFF_SEARCH_CONTRACT_VERSION}`);
  console.log(`URL type : ${urlRechercheProduits("exemple")}\n`);

  let divergences = 0;

  for (const [index, requete] of REQUETES.entries()) {
    if (index > 0) {
      // Très en dessous des 10/minute du service.
      await new Promise((r) => setTimeout(r, 8000));
    }

    const debut = performance.now();
    try {
      const resultat = await chercherProduitsParTexte(requete);
      const duree = Math.round(performance.now() - debut);

      console.log(`« ${requete} » — ${duree} ms`);
      console.log(
        `  exploitables ${resultat.produits.length} · ignorés ${resultat.ignoredIncompleteCount} · doublons retirés ${resultat.doublonsRetires}`,
      );
      for (const p of resultat.produits.slice(0, 3)) {
        console.log(
          `    ${p.gtin.padStart(14)}  ${p.productName.slice(0, 40).padEnd(40)} ` +
            `${p.brand ?? "—"} · P${p.proteinPer100} G${p.carbPer100} L${p.fatPer100} · ${p.kcalPer100.toFixed(0)} kcal/100${p.nutritionUnit}`,
        );
      }

      // Ce qui vaudrait un STOP : aucune fiche exploitable sur une requête
      // aussi banale n'est pas un hasard, c'est un changement de forme.
      if (resultat.produits.length === 0) {
        divergences += 1;
        console.log("  DIVERGENCE — aucun produit exploitable sur une requête courante.");
      }
      // Les GTIN doivent rester des chaînes de chiffres, zéros de tête compris.
      const malFormes = resultat.produits.filter((p) => !/^[0-9]+$/.test(p.gtin));
      if (malFormes.length > 0) {
        divergences += 1;
        console.log(`  DIVERGENCE — GTIN hors forme : ${malFormes.map((p) => p.gtin).join(", ")}`);
      }
    } catch (erreur) {
      divergences += 1;
      const code = estOffErreur(erreur) ? erreur.code : "INCONNU";
      console.log(`« ${requete} » — ÉCHEC ${code} : ${(erreur as Error).message}`);
    }
  }

  console.log("");
  if (divergences > 0) {
    console.error(`${divergences} divergence(s). Rapporter avant de modifier l'adaptateur.`);
    process.exit(1);
  }
  console.log("Aucune divergence : les fixtures du harnais reflètent toujours la réalité.");
}

void main();

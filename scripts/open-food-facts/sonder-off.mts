/**
 * SONDE MANUELLE D'OPEN FOOD FACTS — hors CI, à lancer à la main.
 *
 *   OPENFOODFACTS_USER_AGENT="SETH/1.0 (contact@exemple.fr)" \
 *     npx tsx scripts/open-food-facts/sonder-off.mts
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SCRIPT N'EST PAS UN TEST
 * ────────────────────────────────────────────────────────────────────────────
 * Parce qu'un test qui appelle un tiers finit toujours par mentir. Il devient
 * rouge quand le tiers tousse — et ce rouge-là, on apprend à l'ignorer, y
 * compris le jour où il veut dire quelque chose. Et il consomme du quota :
 * Open Food Facts limite à 15 requêtes/minute par IP, avec bannissement des
 * récidivistes ; une CI qui rejoue la suite à chaque commit ferait bannir son
 * IP, puis un jour celle du serveur.
 *
 * Le harnais officiel (`scripts/tests/aliments-a3-off.mts`) travaille donc sur
 * des fixtures, hors ligne. Ce script-ci existe pour l'autre question, celle
 * que les fixtures ne peuvent PAS poser : « les fixtures ressemblent-elles
 * encore à la réalité ? »
 *
 * Il fait DEUX appels, pas plus :
 *   1. un produit connu   → le schéma est-il toujours celui de l'audit ?
 *   2. un code inexistant → l'absence rend-elle toujours 404 ?
 *
 * ⚠️ À relancer avant toute modification de la couche OFF, et à ne PAS
 * brancher dans la CI. Si la sonde signale une divergence : s'ARRÊTER et la
 * rapporter. Ne jamais changer `OFF_API_VERSION` en silence pour faire passer
 * la sonde — ce serait remplacer un schéma mesuré par un schéma supposé.
 */
import {
  OFF_API_VERSION,
  lireNutriments,
  urlLookupProduit,
} from "../../lib/open-food-facts/contrat";

/** Nutella — le produit de référence de l'audit de Phase 1. */
const GTIN_CONNU = "3017620422003";
/** Un code bien formé qui ne désigne aucun produit. */
const GTIN_ABSENT = "0000000000000";

const USER_AGENT = process.env.OPENFOODFACTS_USER_AGENT?.trim();

let divergences = 0;

function verifier(libelle: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  OK        ${libelle} — ${detail}`);
  } else {
    divergences += 1;
    console.log(`  DIVERGENCE ${libelle} — ${detail}`);
  }
}

async function main(): Promise<void> {
  if (!USER_AGENT) {
    console.error(
      "OPENFOODFACTS_USER_AGENT absente. Open Food Facts exige un User-Agent " +
        '« AppName/Version (contact) ». Aucun repli n\'est fabriqué : la sonde s\'arrête.',
    );
    process.exit(2);
  }

  console.log(`Sonde Open Food Facts — version épinglée ${OFF_API_VERSION}`);
  console.log(`User-Agent : ${USER_AGENT}\n`);

  // ── 1. Produit connu ────────────────────────────────────────────────────
  console.log(`1. Produit connu (${GTIN_CONNU})`);
  const r1 = await fetch(urlLookupProduit(GTIN_CONNU), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  verifier("HTTP", r1.status === 200, `${r1.status} (attendu 200)`);

  const corps = (await r1.json()) as Record<string, unknown>;
  verifier("status", corps.status === "success", `${JSON.stringify(corps.status)} (attendu "success")`);

  const produit = (corps.product ?? {}) as Record<string, unknown>;
  const teneurs = lireNutriments(produit["nutriments"]);
  verifier(
    "nutriments.*_100g",
    teneurs !== null,
    teneurs === null
      ? "ABSENTS — c'est la signature d'un passage à v3.5+, où `nutriments` est vidé au profit d'un bloc `nutrition`"
      : `P ${teneurs.proteine} / G ${teneurs.glucide} / L ${teneurs.lipide}`,
  );
  verifier(
    "product_name",
    typeof produit["product_name"] === "string" && produit["product_name"] !== "",
    String(produit["product_name"]),
  );

  // Relevé informatif — `schema_version` a cessé d'être publié entre l'audit
  // de Phase 1 (valeur 1002) et le 13/08/2026. Aucun contrôle n'en dépend :
  // la garantie tient à l'URL épinglée et aux teneurs effectivement présentes.
  console.log(`  info      schema_version = ${JSON.stringify(corps.schema_version ?? null)}`);

  // ── Pause : 15 requêtes/minute, on reste très en dessous ────────────────
  await new Promise((r) => setTimeout(r, 5000));

  // ── 2. Produit absent ───────────────────────────────────────────────────
  console.log(`\n2. Code inexistant (${GTIN_ABSENT})`);
  const r2 = await fetch(urlLookupProduit(GTIN_ABSENT), {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  verifier("HTTP", r2.status === 404, `${r2.status} (attendu 404 — v2 rendait 200 avec status: 0)`);

  const corps2 = (await r2.json()) as Record<string, unknown>;
  const resultat = (corps2.result ?? {}) as Record<string, unknown>;
  verifier(
    "result.id",
    resultat["id"] === "product_not_found",
    `${JSON.stringify(resultat["id"])} (attendu "product_not_found")`,
  );

  console.log("");
  if (divergences > 0) {
    console.error(
      `${divergences} divergence(s) avec l'audit. NE PAS changer OFF_API_VERSION pour les faire ` +
        "disparaître : rapporter la divergence, puis décider.",
    );
    process.exit(1);
  }
  console.log("Aucune divergence : les fixtures du harnais reflètent toujours la réalité.");
}

void main();

import "server-only";

import {
  SAISIE_MAX,
  SAISIE_MIN,
  SUGGESTIONS_MAX,
  codeInseeValide,
  departementDuCodeInsee,
} from "@/lib/communes/bornes";

/**
 * L'ANNUAIRE DES COMMUNES FRANÇAISES — L'ÉTAPE DE GÉOCODAGE.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE, ET POURQUOI IL EST SÉPARÉ DE TOUT LE RESTE
 * ════════════════════════════════════════════════════════════════════════════
 * Une ville tapée par un élève n'est pas un identifiant. « Saint-Martin »
 * désigne une trentaine de communes françaises ; la transmettre telle quelle à
 * un moteur de recherche de commerces ne peut produire qu'une liste mélangée ou
 * un « précise ta recherche » sans issue.
 *
 * Ce module résout une saisie en COMMUNES NOMMÉES, chacune avec son code INSEE.
 * L'élève en choisit une, explicitement, et c'est son code qui part chercher
 * les commerces.
 *
 * ⚠️ IL NE CONNAÎT AUCUN COMMERCE, et le moteur de commerces ne le connaît pas.
 * Trois choses distinctes, trois modules : l'annuaire des communes (ici),
 * la recherche de commerces (`lib/openstreetmap/`), le fond de carte
 * (`lib/cartographie/`). Aucun ne peut tomber en entraînant les autres.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA SOURCE : L'API GÉO DE L'ÉTAT FRANÇAIS
 * ════════════════════════════════════════════════════════════════════════════
 *   https://geo.api.gouv.fr/ — API Découpage administratif (etalab / DINUM)
 *   Données : Base officielle des codes postaux, COG INSEE, admin-express IGN
 *   Aucune clé d'API, aucune inscription, aucun quota publié.
 *
 * ⚠️ POURQUOI PAS NOMINATIM, ni le géocodeur du fournisseur de carte. Nominatim
 * a une politique d'usage stricte et n'est pas un annuaire de communes. Le
 * géocodeur de MapTiler, lui, ferait payer des « sessions de recherche » ET
 * ferait connaître à notre fournisseur de cartes chaque ville tapée par chaque
 * élève : exactement le mélange que l'architecture refuse.
 *
 * ⚠️ CE MODULE EST `server-only`. La saisie de l'élève ne doit pas partir de son
 * navigateur vers un tiers : elle passe par NOTRE route, qui porte la limite de
 * débit et ne divulgue ni son adresse IP ni son identité à l'amont.
 */

/** Une commune proposée à l'élève. */
export interface CommuneSuggeree {
  /** Le code INSEE — l'identifiant qui ira chercher les commerces. */
  readonly code: string;
  readonly nom: string;
  /** Le premier code postal, pour distinguer deux homonymes. `null` si aucun. */
  readonly codePostal: string | null;
  /** Le code du département, déduit du code INSEE. */
  readonly departement: string;
  /**
   * Le centre géographique officiel de la commune.
   *
   * ⚠️ IL VIENT DE L'ANNUAIRE, PAS D'UN CALCUL SUR LES COMMERCES, et c'est ce
   * qui permet à la carte de se centrer SANS GPS. Une recherche par ville n'a
   * aucune position de départ : sans ce point, la carte n'aurait rien à
   * montrer tant qu'aucun commerce n'est revenu.
   *
   * ⚠️ `null` SI L'ANNUAIRE NE LE DONNE PAS. On ne le remplace par aucun
   * centre de repli : une carte centrée sur un point inventé est pire qu'une
   * carte qui attend ses résultats.
   */
  readonly centre: { readonly lat: number; readonly lon: number } | null;
}

export type RaisonEchecAnnuaire = "saisie_trop_courte" | "indisponible" | "timeout";

export type ResultatAnnuaire =
  | { readonly statut: "ok"; readonly communes: readonly CommuneSuggeree[] }
  | { readonly statut: "echec"; readonly raison: RaisonEchecAnnuaire };

/*
 * ⚠️ LES BORNES SONT IMPORTÉES, PAS REDÉFINIES. Elles vivent dans
 * `lib/communes/bornes.ts`, sans `server-only`, parce que le schéma d'entrée et
 * le champ de saisie en ont besoin aussi. Deux copies divergeraient.
 */

const DELAI_MS = 6_000;
const BASE = "https://geo.api.gouv.fr/communes";

/**
 * Les communes dont le nom approche la saisie.
 *
 * ⚠️ LA SAISIE EST ENCODÉE, ET BORNÉE AVANT L'APPEL. Ce qui part dans l'URL est
 * un paramètre de requête encodé, d'une longueur vérifiée ; rien de ce que
 * l'élève tape ne peut composer une autre requête.
 *
 * ⚠️ `boost=population` N'EST PAS UN DÉTAIL COSMÉTIQUE. Sans lui, « Toulon »
 * propose d'abord Toulonjac (755 habitants). Avec lui, Toulon (179 000) passe
 * en tête, et l'élève n'a pas à chercher sa propre ville dans la liste.
 */
export async function suggererCommunes(
  saisie: string,
  options: { readonly fetchImpl?: typeof fetch; readonly delaiMs?: number } = {},
): Promise<ResultatAnnuaire> {
  const texte = saisie.trim();
  if (texte.length < SAISIE_MIN || texte.length > SAISIE_MAX) {
    return { statut: "echec", raison: "saisie_trop_courte" };
  }

  // ⚠️ `centre` EST DEMANDÉ ICI, et c'est ce qui permet à la carte de se
  // centrer en mode ville. Il ne coûte rien de plus : c'est un champ de la
  // même réponse, pas un second appel.
  const url = `${BASE}?nom=${encodeURIComponent(texte)}&fields=nom,code,codesPostaux,centre&boost=population&limit=${SUGGESTIONS_MAX}`;
  const executer = options.fetchImpl ?? fetch;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), options.delaiMs ?? DELAI_MS);

  try {
    const reponse = await executer(url, {
      signal: controleur.signal,
      headers: { Accept: "application/json" },
    });
    if (!reponse.ok) return { statut: "echec", raison: "indisponible" };
    const brut: unknown = await reponse.json();
    return { statut: "ok", communes: normaliser(brut) };
  } catch (erreur) {
    // ⚠️ UN ABANDON N'EST PAS UNE PANNE DE L'AMONT. L'élève doit lire « réessaie »
    // et non « service indisponible », qui laisse croire qu'il faut attendre.
    const nom = (erreur as { name?: unknown } | null)?.name;
    return { statut: "echec", raison: nom === "AbortError" ? "timeout" : "indisponible" };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * ⚠️ RIEN N'EST CRU SUR PAROLE, MÊME VENANT DE L'ÉTAT. Une commune sans code
 * INSEE valide ou sans nom est ÉCARTÉE ENTIÈREMENT, jamais complétée : un code
 * inventé enverrait la recherche de commerces sur une autre commune, et un nom
 * inventé donnerait à l'élève une ligne qu'il ne peut pas reconnaître.
 */
function normaliser(brut: unknown): readonly CommuneSuggeree[] {
  if (!Array.isArray(brut)) return [];
  const retenues: CommuneSuggeree[] = [];
  for (const ligne of brut) {
    if (typeof ligne !== "object" || ligne === null) continue;
    const o = ligne as Record<string, unknown>;
    const code = typeof o["code"] === "string" ? o["code"].trim().toUpperCase() : "";
    const nom = typeof o["nom"] === "string" ? o["nom"].trim() : "";
    if (!codeInseeValide(code) || nom === "") continue;

    const postaux = Array.isArray(o["codesPostaux"]) ? o["codesPostaux"] : [];
    const codePostal = postaux.find((cp): cp is string => typeof cp === "string" && /^\d{5}$/.test(cp));

    retenues.push({
      code,
      nom,
      codePostal: codePostal ?? null,
      departement: departementDuCodeInsee(code),
      centre: centreValide(o["centre"]),
    });
    if (retenues.length >= SUGGESTIONS_MAX) break;
  }
  return retenues;
}

/**
 * Le centre d'une commune, tel que l'annuaire le rend — ou `null`.
 *
 * ⚠️ UN POINT GeoJSON : `{ type: "Point", coordinates: [lon, lat] }`, dans CET
 * ordre. L'inverser placerait Toulon en Somalie — c'est l'erreur classique, et
 * elle est silencieuse, parce que les deux nombres sont plausibles.
 *
 * ⚠️ ET RIEN N'EST CRU SUR PAROLE, MÊME VENANT DE L'ÉTAT. Un couple hors
 * bornes est ÉCARTÉ, pas corrigé : une carte centrée sur un point inventé est
 * pire qu'une carte qui attend ses résultats.
 */
function centreValide(brut: unknown): { lat: number; lon: number } | null {
  if (typeof brut !== "object" || brut === null) return null;
  const coords = (brut as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lon, lat] = coords;
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

export { SAISIE_MAX, SAISIE_MIN, SUGGESTIONS_MAX, codeInseeValide, departementDuCodeInsee };

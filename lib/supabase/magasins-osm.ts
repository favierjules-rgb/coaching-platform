import type { SupabaseClient } from "@supabase/supabase-js";

import type { MagasinOsm } from "@/lib/nutrition/magasins-osm";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C4.3c — L'ÉCRITURE D'UN MAGASIN, PAR SON IDENTITÉ OSM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LA CLÉ CANONIQUE EST LE COUPLE `(osm_type, osm_id)`, ET RIEN D'AUTRE
 * ════════════════════════════════════════════════════════════════════════════
 * C4.3a écrivait par `op_location_id` : c'était cohérent tant qu'Open Prices
 * était l'annuaire. Depuis C4.3c, OpenStreetMap l'est — et un magasin peut donc
 * n'avoir AUCUN `op_location_id`. Une clé métier qui peut valoir `null` n'est
 * pas une clé.
 *
 * `stores_osm_identite_unique UNIQUE (osm_type, osm_id)` existe depuis C4.2 :
 * la base était déjà prête, c'est le code qui regardait ailleurs.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ UN PONT CONNU NE S'EFFACE JAMAIS PARCE QU'UNE LECTURE A ÉCHOUÉ
 * ════════════════════════════════════════════════════════════════════════════
 * C'est la règle la plus importante du fichier. Un 404 d'Open Prices est une
 * absence PROUVÉE ; un 503, un 429, un timeout n'en sont pas. Mais même le 404
 * n'autorise pas à effacer un pont déjà connu : une fiche peut disparaître
 * temporairement de l'amont, et nous aurions détruit, pour tous les élèves, une
 * information qui était vraie. On enrichit, on ne retire pas.
 *
 * Le retrait d'un pont est une décision de produit qui mérite son propre lot,
 * son propre contrat, et probablement une trace. Elle n'existe pas ici.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUN `upsert` POSTGREST, ET C'EST DÉLIBÉRÉ
 * ════════════════════════════════════════════════════════════════════════════
 * `.upsert(..., { onConflict })` choisirait tout seul quoi écraser — y compris
 * un `op_location_id` connu par un `null`, et une marque connue par une absence
 * de tag. Le nom de la fonction dit « insérer ou mettre à jour » ; ce qu'on veut
 * dire est « insérer, ou enrichir sans détruire », et cela s'écrit à la main.
 */

export type PontConnu =
  | { readonly statut: "ponte"; readonly opLocationId: number }
  /** 404 : Open Prices a répondu, il ne connaît pas ce lieu. */
  | { readonly statut: "absent" }
  /** Panne, limite, timeout, corps illisible : nous ne savons pas. */
  | { readonly statut: "indetermine" };

export interface ResultatUpsertOsm {
  readonly storeId: string | null;
  readonly erreur: string | null;
  /**
   * Deux identités amont désignent deux lignes différentes — ou contredisent
   * une ligne existante. Aucune mutation n'a eu lieu.
   */
  readonly divergence: boolean;
  /** Ce que la ligne porte APRÈS l'opération. `null` = pas de pont connu. */
  readonly opLocationId: number | null;
}

const COLONNES =
  "id, op_location_id, osm_type, osm_id, name, brand, brand_wikidata, operator_wikidata, city, postcode, country_code, lat, lon";

interface LigneStore {
  readonly id: string;
  readonly op_location_id: number | null;
  readonly brand: string | null;
  readonly brand_wikidata: string | null;
  readonly operator_wikidata: string | null;
  readonly city: string | null;
  readonly postcode: string | null;
  readonly country_code: string | null;
}

function echec(message: string): ResultatUpsertOsm {
  return { storeId: null, erreur: message, divergence: false, opLocationId: null };
}

const DIVERGENCE: ResultatUpsertOsm = {
  storeId: null,
  erreur: null,
  divergence: true,
  opLocationId: null,
};

/**
 * Les métadonnées d'affichage à écrire — celles qu'on CONNAÎT, et elles seules.
 *
 * ⚠️ UN TAG ABSENT N'EST PAS UNE INFORMATION, C'EST UNE ABSENCE D'INFORMATION.
 * Écraser « Naturalia » par `null` parce qu'`brand` manque dans l'export du
 * jour ferait perdre à TOUS les élèves une donnée que personne n'a décidé de
 * retirer — et le prochain export la remettrait, ou pas. Une suppression
 * VOLONTAIRE dans OSM mérite une doctrine explicite : elle n'existe pas encore,
 * et on ne l'invente pas en passant.
 *
 * ⚠️ `name`, `lat` ET `lon` FONT EXCEPTION, PARCE QU'ILS NE PEUVENT PAS MANQUER.
 * `normaliserElementOsm` écarte entièrement un élément qui n'en a pas : s'ils
 * sont là, ils sont à jour, et un magasin renommé doit être renommé.
 *
 * ⚠️ ET LES TROIS COLONNES D'IDENTITÉ SONT ABSENTES DE CET OBJET. C'est ce qui
 * garantit qu'aucune identité ne peut être « corrigée » au passage.
 */
function metadonneesAEcrire(magasin: MagasinOsm): Record<string, unknown> {
  const charge: Record<string, unknown> = {
    name: magasin.name,
    lat: magasin.lat,
    lon: magasin.lon,
  };
  const facultatives: ReadonlyArray<readonly [string, string | null]> = [
    ["brand", magasin.brand],
    ["brand_wikidata", magasin.brandWikidata],
    ["operator_wikidata", magasin.operatorWikidata],
    ["city", magasin.city],
    ["postcode", magasin.postcode],
    ["country_code", magasin.countryCode],
  ];
  for (const [colonne, valeur] of facultatives) {
    if (valeur !== null) charge[colonne] = valeur;
  }
  return charge;
}

/**
 * Insère ou enrichit la ligne de CE magasin OSM.
 *
 * Les six situations, dans l'ordre où elles sont traitées :
 *
 *   1. identité OSM inconnue          → insertion, avec le pont s'il est prouvé ;
 *   2. connue, sans pont + pont prouvé → enrichissement ;
 *   3. connue, avec pont + 404 amont   → RIEN. Le pont connu survit ;
 *   4. connue, avec pont + panne amont → RIEN. Idem ;
 *   5. le pont prouvé appartient déjà à une AUTRE identité OSM, ou contredit
 *      celui déjà en place → DIVERGENCE, aucune mutation ;
 *   6. métadonnées → rafraîchies quand elles sont connues, jamais détruites.
 */
export async function upserterMagasinOsm(
  admin: TypedSupabaseClient,
  magasin: MagasinOsm,
  pont: PontConnu,
): Promise<ResultatUpsertOsm> {
  const { data, error } = await admin
    .from("stores")
    .select(COLONNES)
    .eq("osm_type", magasin.osmType)
    .eq("osm_id", magasin.osmId)
    .maybeSingle();
  if (error) return echec(error.message);

  const existante = (data ?? null) as LigneStore | null;
  const pontProuve = pont.statut === "ponte" ? pont.opLocationId : null;

  // ── CAS 5, premier volet : l'identifiant amont est-il déjà pris ailleurs ? ─
  //
  // ⚠️ ON LE DEMANDE AVANT D'ÉCRIRE, PAS APRÈS AVOIR ÉCHOUÉ. La contrainte
  // UNIQUE de C4.2 refuserait de toute façon — mais elle rendrait une erreur
  // technique illisible, là où « ce magasin est en double dans notre
  // référentiel » est une phrase qu'on peut afficher et instruire.
  if (pontProuve !== null) {
    const { data: porteur, error: erreurPorteur } = await admin
      .from("stores")
      .select("id, osm_type, osm_id")
      .eq("op_location_id", pontProuve)
      .maybeSingle();
    if (erreurPorteur) return echec(erreurPorteur.message);

    const ligne = (porteur ?? null) as { id: string; osm_type: string; osm_id: number } | null;
    if (ligne !== null && (ligne.osm_type !== magasin.osmType || ligne.osm_id !== magasin.osmId)) {
      return DIVERGENCE;
    }
  }

  // ── CAS 1 : identité inconnue → insertion ─────────────────────────────────
  if (existante === null) {
    const { data: cree, error: erreurInsert } = await admin
      .from("stores")
      // `as never` : `stores` n'est pas dans les types générés — comme en C4.3a.
      .insert({
        osm_type: magasin.osmType,
        osm_id: magasin.osmId,
        // ⚠️ `null` EST DÉSORMAIS LÉGAL, ET C'EST TOUTE LA MIGRATION C4.3c.
        // Avant elle, un magasin réel qu'Open Prices ignore n'aurait PAS PU
        // entrer dans le référentiel — et l'élève toulonnais restait devant
        // une liste de deux lieux.
        op_location_id: pontProuve,
        ...metadonneesAEcrire(magasin),
      } as never)
      .select("id")
      .maybeSingle();
    if (erreurInsert) return echec(erreurInsert.message);
    const id = (cree ?? null) as { id: string } | null;
    if (id === null) return echec("aucun identifiant rendu");
    return { storeId: id.id, erreur: null, divergence: false, opLocationId: pontProuve };
  }

  // ── CAS 5, second volet : un pont qui contredit celui déjà connu ──────────
  //
  // Remplacer silencieusement changerait les PRIX d'un magasin que des élèves
  // ont déjà choisi, sans que rien ne l'annonce.
  if (pontProuve !== null && existante.op_location_id !== null && existante.op_location_id !== pontProuve) {
    return DIVERGENCE;
  }

  // ── CAS 2, 3, 4 et 6 : on n'écrit que ce qui AJOUTE ───────────────────────
  const charge = metadonneesAEcrire(magasin);

  // ⚠️ LA COLONNE DU PONT N'APPARAÎT QUE POUR L'ENRICHIR. Absente de la charge,
  // elle ne peut être ni effacée par un `null`, ni remplacée par distraction —
  // ni sur un 404, ni sur une panne, ni sur un pont identique.
  const enrichit = pontProuve !== null && existante.op_location_id === null;
  if (enrichit) charge["op_location_id"] = pontProuve;

  const { error: erreurUpdate } = await admin
    .from("stores")
    .update(charge as never)
    .eq("id", existante.id);
  if (erreurUpdate) return echec(erreurUpdate.message);

  return {
    storeId: existante.id,
    erreur: null,
    divergence: false,
    opLocationId: enrichit ? pontProuve : existante.op_location_id,
  };
}

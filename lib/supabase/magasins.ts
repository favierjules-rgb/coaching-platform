import type { SupabaseClient } from "@supabase/supabase-js";

import type { MagasinProche } from "@/lib/nutrition/magasin-proche";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C4.3a — L'ÉCRITURE DU MAGASIN CHOISI.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX ÉCRITURES, DEUX RÔLES, ET LA FRONTIÈRE EST ENTRE LES DEUX
 * ────────────────────────────────────────────────────────────────────────────
 * `stores` est un référentiel PARTAGÉ : sa serrure de C4.2 n'accorde que
 * `select` à `authenticated`. Seul le rôle serveur peut y écrire, et il n'écrit
 * que ce qu'il a relu chez la source.
 *
 * `student_selected_store` est une donnée PERSONNELLE : l'élève l'écrit
 * lui-même, sous sa propre RLS, avec un privilège limité aux colonnes
 * `student_id` et `store_id`. La date, elle, appartient à la base.
 *
 * ⚠️ AUCUNE FONCTION D'ICI NE REÇOIT DE COORDONNÉE D'ÉLÈVE. La position sert à
 * chercher ; elle ne franchit jamais la frontière de la persistance.
 */

export interface ResultatUpsert {
  readonly storeId: string | null;
  readonly erreur: string | null;
  /** L'identité amont a été trouvée sur deux lignes différentes — voir plus bas. */
  readonly conflitIdentite: boolean;
}

interface LigneStore {
  readonly id: string;
  readonly op_location_id: number;
  readonly osm_type: string;
  readonly osm_id: number;
}

type Decision =
  | { readonly quoi: "inserer" }
  | { readonly quoi: "reutiliser"; readonly ligne: LigneStore }
  | { readonly quoi: "conflit" };

/**
 * ⚠️ QUATRE SITUATIONS, ET UNE SEULE EST UNE MISE À JOUR.
 *
 * La règle vient de la doctrine du fichier : les identités ne se réécrivent
 * JAMAIS toutes seules. Une ligne locale n'est donc réutilisable que si elle
 * porte EXACTEMENT la même identité que la fiche canonique — les DEUX clés,
 * pas une seule.
 *
 *   1. aucune ligne                       → insertion ;
 *   2. deux lignes DIFFÉRENTES            → conflit (la source a fusionné) ;
 *   3. UNE SEULE des deux clés retrouvée  → conflit AUSSI. Exemple : la fiche
 *      dit `op_location_id=42, WAY/999`, et nous avons `op_location_id=42,
 *      WAY/111`. Réutiliser cette ligne reviendrait à dire « c'est le même
 *      magasin » alors que son identité OSM a changé. Le cas symétrique — même
 *      couple OSM, autre `op_location_id` — est le même problème vu de l'autre
 *      côté ;
 *   4. la même ligne sur les deux clés, identité identique → mise à jour de
 *      l'affichage seul.
 *
 * ⚠️ EXTRAITE EN FONCTION PARCE QU'ELLE SERT DEUX FOIS : avant l'insertion, et
 * après un échec d'unicité concurrent. Les deux chemins DOIVENT appliquer la
 * même règle — sinon le rattrapage de concurrence deviendrait une porte
 * dérobée par laquelle une identité partielle passerait.
 */
function resoudreIdentite(
  ligneOpId: LigneStore | null,
  ligneOsm: LigneStore | null,
  magasin: MagasinProche,
): Decision {
  if (ligneOpId === null && ligneOsm === null) return { quoi: "inserer" };
  if (ligneOpId === null || ligneOsm === null) return { quoi: "conflit" };
  if (ligneOpId.id !== ligneOsm.id) return { quoi: "conflit" };

  // Ceinture et bretelles : la ligne retrouvée doit porter mot pour mot
  // l'identité canonique. Une divergence signifierait que la recherche a menti,
  // et écrire par-dessus serait une correction silencieuse.
  const ligne = ligneOpId;
  if (
    ligne.op_location_id !== magasin.opLocationId ||
    ligne.osm_type !== magasin.osmType ||
    ligne.osm_id !== magasin.osmId
  ) {
    return { quoi: "conflit" };
  }
  return { quoi: "reutiliser", ligne };
}

/** Les deux identités, relues en parallèle. */
async function lireIdentites(
  admin: TypedSupabaseClient,
  magasin: MagasinProche,
): Promise<{ opId: LigneStore | null; osm: LigneStore | null; erreur: string | null }> {
  const { data: parOpId, error: erreurOpId } = await admin
    .from("stores")
    .select("id, op_location_id, osm_type, osm_id")
    .eq("op_location_id", magasin.opLocationId)
    .maybeSingle();
  if (erreurOpId) return { opId: null, osm: null, erreur: erreurOpId.message };

  const { data: parOsm, error: erreurOsm } = await admin
    .from("stores")
    .select("id, op_location_id, osm_type, osm_id")
    .eq("osm_type", magasin.osmType)
    .eq("osm_id", magasin.osmId)
    .maybeSingle();
  if (erreurOsm) return { opId: null, osm: null, erreur: erreurOsm.message };

  return {
    opId: (parOpId ?? null) as LigneStore | null,
    osm: (parOsm ?? null) as LigneStore | null,
    erreur: null,
  };
}

/** Violation d'unicité PostgreSQL — le seul code qui déclenche un rattrapage. */
const VIOLATION_UNICITE = "23505";

/**
 * Fait entrer — ou remet à jour — un magasin dans le référentiel canonique.
 *
 * ⚠️ LES DEUX CLÉS NATURELLES SONT VÉRIFIÉES SÉPARÉMENT, ET C'EST DÉLIBÉRÉ.
 * C4.2 pose DEUX contraintes d'unicité indépendantes : `op_location_id`, et le
 * couple `(osm_type, osm_id)`. Un `on conflict` unique ne peut en viser qu'une :
 * l'autre exploserait en violation de contrainte, à un endroit où l'appelant
 * lirait « erreur base de données » sans jamais comprendre laquelle.
 *
 * Le cas qui les sépare est RÉEL : Open Prices peut fusionner deux
 * enregistrements en double. Le lieu garde alors son couple OSM et change
 * d'`op_location_id` — ou l'inverse. Les deux lignes existeraient chez nous.
 *
 * On lit donc les deux identités AVANT d'écrire :
 *   - aucune ligne          → insertion ;
 *   - une seule ligne, la même sur les deux clés → mise à jour de l'affichage ;
 *   - deux lignes DIFFÉRENTES → `conflitIdentite`, et on n'écrit RIEN.
 *
 * ⚠️ LE TROISIÈME CAS N'EST PAS MASQUÉ. Fusionner deux magasins déjà choisis
 * par des élèves, c'est décider à leur place où ils font leurs courses. La
 * sélection échoue franchement, la trace est journalisée, et un humain tranche.
 */
export async function upserterMagasin(
  admin: TypedSupabaseClient,
  magasin: MagasinProche,
): Promise<ResultatUpsert> {
  const identites = await lireIdentites(admin, magasin);
  if (identites.erreur !== null) {
    return { storeId: null, erreur: identites.erreur, conflitIdentite: false };
  }

  const decision = resoudreIdentite(identites.opId, identites.osm, magasin);
  if (decision.quoi === "conflit") return { storeId: null, erreur: null, conflitIdentite: true };
  const existante = decision.quoi === "reutiliser" ? decision.ligne : null;

  // ⚠️ L'IDENTITÉ N'EST JAMAIS RÉÉCRITE SUR UNE LIGNE EXISTANTE. Seul
  // l'affichage se rafraîchit — et c'est précisément parce que les trois
  // colonnes d'identité sont ABSENTES de cet objet que `resoudreIdentite` doit
  // refuser un match partiel : il n'y a aucun chemin par lequel une identité
  // divergente pourrait être « corrigée » en passant.
  const affichage = {
    name: magasin.name,
    brand: magasin.brand,
    city: magasin.city,
    postcode: magasin.postcode,
    country_code: magasin.countryCode,
    lat: magasin.lat,
    lon: magasin.lon,
  };

  if (existante !== null) {
    const { error } = await admin
      .from("stores")
      // `as never` : `stores` n'est pas dans les types générés
      // (`types/supabase.ts`), comme `food_products` avant elle.
      .update(affichage as never)
      .eq("id", existante.id);
    if (error) return { storeId: null, erreur: error.message, conflitIdentite: false };
    return { storeId: existante.id, erreur: null, conflitIdentite: false };
  }

  const { data, error } = await admin
    .from("stores")
    .insert({
      op_location_id: magasin.opLocationId,
      osm_type: magasin.osmType,
      osm_id: magasin.osmId,
      ...affichage,
    } as never)
    .select("id")
    .maybeSingle();

  if (error) {
    // ⚠️ UN SEUL RATTRAPAGE, ET SEULEMENT POUR UNE VIOLATION D'UNICITÉ.
    //
    // La course est réelle : deux élèves choisissent le même magasin à la même
    // seconde. Les deux lisent « aucune ligne », les deux insèrent, le second
    // se heurte à une contrainte de C4.2. Or à cet instant précis le magasin
    // canonique EXISTE, et il est correct — répondre « enregistrement
    // impossible » serait faux.
    //
    // On relit donc, et on applique EXACTEMENT la même règle d'identité : le
    // rattrapage n'est pas une porte dérobée par laquelle un match partiel
    // passerait. Toute autre erreur reste une erreur : aucun retry magique,
    // aucune boucle — une seule relecture, bornée.
    if (error.code !== VIOLATION_UNICITE) {
      return { storeId: null, erreur: error.message, conflitIdentite: false };
    }

    const apres = await lireIdentites(admin, magasin);
    if (apres.erreur !== null) {
      return { storeId: null, erreur: apres.erreur, conflitIdentite: false };
    }
    const seconde = resoudreIdentite(apres.opId, apres.osm, magasin);
    if (seconde.quoi === "reutiliser") {
      // Le concurrent a écrit exactement le magasin que nous voulions écrire :
      // l'opération est idempotente, et son résultat est le nôtre.
      return { storeId: seconde.ligne.id, erreur: null, conflitIdentite: false };
    }
    if (seconde.quoi === "conflit") {
      return { storeId: null, erreur: null, conflitIdentite: true };
    }
    // Toujours rien après une violation d'unicité : la base se contredit. On ne
    // réessaie pas — on remonte l'erreur d'origine, qui est la vraie.
    return { storeId: null, erreur: error.message, conflitIdentite: false };
  }

  const cree = (data ?? null) as { id: string } | null;
  return { storeId: cree?.id ?? null, erreur: null, conflitIdentite: false };
}

/**
 * Enregistre le magasin courant de l'élève.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ PAS D'`upsert` POSTGREST ICI, ET LA RAISON EST MESURÉE
 * ────────────────────────────────────────────────────────────────────────────
 * `.upsert({ student_id, store_id }, { onConflict: "student_id" })` paraissait
 * naturel. Il est INUTILISABLE contre les privilèges de C4.2, et pas seulement
 * au changement de magasin : il échoue DÈS LA PREMIÈRE SÉLECTION.
 *
 * PostgREST engendre, pour CHAQUE colonne du corps (`QueryBuilder.hs`,
 * `"DO UPDATE SET " <> … cfName <> " = EXCLUDED." <> cfName <$> iCols`) :
 *
 *     insert into student_selected_store (student_id, store_id) values (…)
 *     on conflict (student_id) do update
 *       set student_id = excluded.student_id, store_id = excluded.store_id
 *
 * Or C4.2 n'accorde à `authenticated` que `update (store_id)`. Et PostgreSQL
 * vérifie les privilèges des colonnes nommées dans le `DO UPDATE` À LA
 * PLANIFICATION — que le conflit survienne ou non. Mesuré sur la base locale
 * reconstruite, sous le rôle `authenticated` :
 *
 *     avec    `set student_id = excluded.student_id, store_id = …`
 *       → 42501 permission denied for table student_selected_store
 *     sans    `student_id` dans le SET
 *       → succès
 *     `update … set store_id = … where student_id = …`
 *       → succès, 1 ligne
 *
 * ⚠️ LE CORRECTIF EST DANS LE CODE, PAS DANS LES GRANTS. `student_id` est
 * l'identité PROPRIÉTAIRE de la ligne : la rendre modifiable pour arranger un
 * appel client, ce serait ouvrir à un élève la possibilité de déplacer sa
 * sélection vers la ligne d'un autre. C4.2 a raison ; c'est l'appel qui doit
 * changer de forme.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * L'ALGORITHME, ET SES BORNES
 * ────────────────────────────────────────────────────────────────────────────
 *   1. `update (store_id) where student_id` — la ligne existe presque toujours
 *      dès la deuxième fois, et cet ordre n'utilise QUE le privilège accordé ;
 *   2. une ligne touchée → succès ;
 *   3. aucune ligne → `insert (student_id, store_id)`, les deux seules colonnes
 *      qu'un élève a le droit d'insérer ;
 *   4. `23505` sur cet insert → un concurrent a créé la ligne entre-temps :
 *      UN SEUL `update (store_id)` de rattrapage, puis on s'arrête.
 *
 * Aucune boucle. Deux ordres au plus en régime normal, trois dans la course.
 *
 * ⚠️ `updated_at` N'EST JAMAIS NOMMÉE. Le `default` la pose à l'insertion, le
 * trigger `set_updated_at` la renouvelle à chaque mise à jour — et le privilège
 * de colonne interdirait de toute façon à l'élève de l'écrire.
 */
async function poserStoreId(
  supabase: TypedSupabaseClient,
  studentId: string,
  storeId: string,
): Promise<{ touchee: boolean; erreur: string | null }> {
  // ⚠️ `store_id` SEUL DANS LA CHARGE : c'est exactement `grant update
  // (store_id)`. Y ajouter quoi que ce soit rendrait l'ordre non exécutable.
  const { data, error } = await supabase
    .from("student_selected_store")
    .update({ store_id: storeId } as never)
    .eq("student_id", studentId)
    .select("student_id");
  if (error) return { touchee: false, erreur: error.message };
  return { touchee: Array.isArray(data) && data.length > 0, erreur: null };
}

export async function enregistrerMagasinChoisi(
  supabase: TypedSupabaseClient,
  studentId: string,
  storeId: string,
): Promise<{ ok: boolean; erreur: string | null }> {
  const premier = await poserStoreId(supabase, studentId, storeId);
  if (premier.erreur !== null) return { ok: false, erreur: premier.erreur };
  if (premier.touchee) return { ok: true, erreur: null };

  const { error } = await supabase
    .from("student_selected_store")
    .insert({ student_id: studentId, store_id: storeId } as never);
  if (error === null) return { ok: true, erreur: null };

  // Toute erreur AUTRE qu'une violation d'unicité est une vraie erreur : un
  // privilège refusé ou une clé étrangère absente ne se répare pas en
  // réessayant. Aucun rattrapage magique.
  if (error.code !== VIOLATION_UNICITE) return { ok: false, erreur: error.message };

  // La course : un concurrent a inséré la ligne entre notre `update` et notre
  // `insert`. Elle existe maintenant — un seul `update` de rattrapage, et stop.
  const rattrapage = await poserStoreId(supabase, studentId, storeId);
  if (rattrapage.erreur !== null) return { ok: false, erreur: rattrapage.erreur };
  if (rattrapage.touchee) return { ok: true, erreur: null };
  return { ok: false, erreur: error.message };
}

export interface MagasinChoisi {
  readonly storeId: string;
  readonly name: string;
  readonly brand: string | null;
  readonly city: string | null;
}

/** Le magasin courant de l'élève, lu sous sa propre RLS. */
export async function lireMagasinChoisi(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<MagasinChoisi | null> {
  const { data, error } = await supabase
    .from("student_selected_store")
    .select("store_id, stores (id, name, brand, city)")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error || !data) return null;

  const ligne = data as unknown as {
    store_id: string;
    stores: { id: string; name: string; brand: string | null; city: string | null } | null;
  };
  if (!ligne.stores) return null;
  return {
    storeId: ligne.stores.id,
    name: ligne.stores.name,
    brand: ligne.stores.brand,
    city: ligne.stores.city,
  };
}

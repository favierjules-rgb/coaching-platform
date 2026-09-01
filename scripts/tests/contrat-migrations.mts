/**
 * LE CONTRAT DES MIGRATIONS — une seule vérité, partagée par trois suites.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * Avant C2, trois suites (`liste-de-courses-c1`, `courses-c0-validation`,
 * `liste-de-courses-ux`) portaient chacune la même garantie, écrite trois fois :
 *
 *     « ce lot n'introduit AUCUNE migration inattendue ».
 *
 * Elle s'exprimait par un compte — `assert.equal(migrations.length, 80)` — et
 * par le nom de la dernière. C2 introduit une migration : le compte devient
 * faux, et la tentation serait de le remonter à 81.
 *
 * ⚠️ REMONTER LE COMPTE AFFAIBLIRAIT LA GARANTIE, ET C'EST EXACTEMENT CE QU'IL
 * NE FAUT PAS FAIRE. « 81 migrations » est satisfait par n'importe quelle
 * 81ᵉ migration — y compris une migration étrangère glissée en même temps, y
 * compris deux migrations C2 dont l'une écraserait l'autre. Le compte ne dit
 * rien de ce qui a été ajouté.
 *
 * La garantie est donc RENFORCÉE, pas déplacée : au lieu d'un nombre, on fige
 * l'IDENTITÉ EXACTE de ce qui est autorisé, l'ORDRE dans lequel les deux
 * dernières migrations doivent apparaître, et une EMPREINTE de tout l'historique
 * antérieur — qui rougit si une migration est antidatée pour se glisser avant.
 *
 * ⚠️ CE MODULE N'EST PAS UNE SUITE. Il n'exécute aucun test ; il expose une
 * fonction que les suites appellent avec leur propre `assert`.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

/** La dernière migration d'avant C2 : le verrou serveur du repas consommé. */
export const MIGRATION_C0_1 = "20260914090000_c0_1_verrou_repas_consomme.sql";

/** La SEULE migration que C2 a le droit d'ajouter. */
export const MIGRATION_C2 = "20260915090000_c2_liste_de_courses_persistante.sql";

/** La SEULE migration que C3 a le droit d'ajouter. */
export const MIGRATION_C3 = "20260916090000_c3_budget_et_prix_estimatifs.sql";

/**
 * La SEULE migration que C4.1 a le droit d'ajouter — le pont aliment → produit.
 *
 * ⚠️ Elle est ADDITIVE et n'ajoute qu'UNE table (`food_catalog_retail_review`).
 * Elle ne touche ni `food_products`, ni `food_catalog`, ni aucune structure de
 * C2/C3. C'est le point 4 ci-dessous qui interdit qu'une seconde migration C4
 * se glisse pour « corriger » celle-ci : une migration déjà appliquée en
 * distant ne se réécrit pas, mais une migration du même lot ne se dédouble pas
 * non plus.
 */
export const MIGRATION_C4_1 = "20260917090000_c4_1_pont_retail.sql";

/**
 * La SEULE migration que C4.2 a le droit d'ajouter — le modèle du magasin.
 *
 * ⚠️ ADDITIVE, et elle ne crée que DEUX tables : `stores` (référentiel canonique
 * minimal, fermé à l'écriture cliente) et `student_selected_store` (un magasin
 * actif par élève, garanti par la clé primaire). Elle ne touche à AUCUNE
 * structure de C2, C3 ou C4.1, n'introduit aucun prix, aucune disponibilité et
 * aucun appel réseau — c'est C4.3a qui fera entrer un magasin dans la table.
 *
 * ⚠️ SON HORODATAGE EST UN COMPTEUR D'ORDRE, PAS UNE DATE. `20260918…` suit
 * `20260917…` parce que `supabase db push` applique les fichiers dans l'ordre
 * lexicographique de leur nom, et pour aucune autre raison.
 */
export const MIGRATION_C4_2 = "20260918090000_c4_2_magasins.sql";

/**
 * La SEULE migration que C4.3c a le droit d'ajouter — OpenStreetMap devient
 * l'annuaire des magasins.
 *
 * ⚠️ ADDITIVE, ET ELLE NE CRÉE AUCUNE TABLE. Elle fait trois choses et pas une
 * de plus : elle rend `stores.op_location_id` NULLABLE — un magasin réel peut
 * exister sans que Open Prices le connaisse, et c'est le fait mesuré à Toulon
 * qui l'impose ; elle ajoute `brand_wikidata` et `operator_wikidata`, tous deux
 * nullables, pour identifier une enseigne autrement que par son nom ; et elle
 * pose la FORME de ces deux identifiants (`^Q[1-9][0-9]*$`).
 *
 * ⚠️ ELLE NE TOUCHE NI À `stores_op_location_id_key` NI À
 * `stores_op_location_id_positif`. Vérifié sur un PostgreSQL 16 réel : un
 * UNIQUE simple traite les NULL comme DISTINCTS, et un CHECK ne rougit que sur
 * FALSE — `NULL > 0` vaut UNKNOWN et passe. Les deux contraintes existantes
 * couvraient donc déjà le cas nullable, et une migration qui les aurait
 * réécrites « pour être sûre » aurait été du bruit dangereux.
 *
 * ⚠️ SON RETOUR EN ARRIÈRE N'EST PLUS ANODIN une fois qu'un magasin sans pont
 * a été sélectionné : réimposer NOT NULL échouerait sur les lignes existantes.
 */
export const MIGRATION_C4_3C = "20260919090000_c4_3c_magasins_osm.sql";

/**
 * Les migrations du chantier COURSES, dans l'ordre d'application.
 *
 * ⚠️ CETTE LISTE EST LE CONTRAT, ET ELLE S'ALLONGE EXPLICITEMENT. Chaque lot
 * qui ajoute une migration doit venir l'inscrire ici — c'est précisément ce que
 * le compte seul ne demandait pas, et c'est pour ça qu'il a été remplacé.
 */
/**
 * N1.7 — LA PREMIÈRE MIGRATION POSTÉRIEURE AU CHANTIER COURSES.
 *
 * ⚠️ ELLE N'APPARTIENT PAS À COURSES, ET C'EST TOUT L'INTÉRÊT DE LA NOMMER À
 * PART. Le contrat disait jusqu'ici « après C0.1, il n'y a QUE des migrations
 * COURSES » — une formulation qui n'était vraie que tant qu'aucun autre
 * chantier n'ajoutait de migration. La règle réelle, celle qui vaut la peine
 * d'être gardée, est plus simple : TOUTE migration ajoutée doit être inscrite
 * ici, nommément. Elle l'est.
 */
export const MIGRATION_N1_7 = "20260920090000_n1_7_listes_ignorables.sql";

export const MIGRATIONS_COURSES: readonly string[] = [
  MIGRATION_C2,
  MIGRATION_C3,
  MIGRATION_C4_1,
  MIGRATION_C4_2,
  MIGRATION_C4_3C,
];

/**
 * TOUT CE QUI SUIT C0.1, DANS L'ORDRE D'APPLICATION — chantier COURSES compris.
 *
 * ⚠️ C'EST CETTE LISTE QUE LES POINTS 2 ET 5 COMPARENT, et plus
 * `MIGRATIONS_COURSES` seule. Une migration ajoutée sans être inscrite ici
 * rougit toujours : la garantie est intacte, elle a seulement cessé de
 * supposer que le dernier chantier du dépôt serait éternellement COURSES.
 */
export const MIGRATIONS_APRES_C0_1: readonly string[] = [...MIGRATIONS_COURSES, MIGRATION_N1_7];

/** Le compte attendu — nécessaire, jamais suffisant. */
export const NOMBRE_DE_MIGRATIONS = 86;

/**
 * L'empreinte des 79 migrations ANTÉRIEURES à C0.1, dans l'ordre.
 *
 * ⚠️ C'EST ELLE QUI ATTRAPE L'ANTIDATAGE. Une migration étrangère horodatée
 * `20260101…` se rangerait avant C0.1 sans changer ni le nom de la dernière ni
 * l'ordre du couple final ; seule une empreinte de l'historique complet la voit.
 * Elle attrape aussi le renommage silencieux d'une migration passée.
 */
export const EMPREINTE_HISTORIQUE = "9e3a7691dceff667";

export function listerMigrations(): readonly string[] {
  return readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** `20260915090000` → 20260915090000. `null` si le nom n'est pas horodaté. */
export function estampille(nom: string): number | null {
  const m = /^(\d{14})_/.exec(nom);
  return m ? Number(m[1]) : null;
}

export function empreinte(noms: readonly string[]): string {
  return createHash("sha256").update(noms.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Le contrat, en sept points. Chacun peut rougir seul, et chacun nomme ce qui
 * l'a fait rougir.
 *
 * `assert` est passé par la suite appelante : ce module ne dépend d'aucune.
 */
export function verifierContratDesMigrations(assert: typeof import("node:assert/strict")): void {
  const migrations = listerMigrations();

  // 1. LE COMPTE — nécessaire, et volontairement insuffisant à lui seul.
  assert.equal(
    migrations.length,
    NOMBRE_DE_MIGRATIONS,
    `${migrations.length} migrations au lieu de ${NOMBRE_DE_MIGRATIONS} : une migration a été ajoutée ou retirée`,
  );

  // 2. L'ORDRE ET L'IDENTITÉ DES DERNIÈRES. C0.1, puis C2, puis C3 — et rien
  //    après. Antidater l'une d'elles casse l'ordre, et rougit ici.
  assert.deepEqual(
    migrations.slice(-(1 + MIGRATIONS_APRES_C0_1.length)),
    [MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1],
    "les dernières migrations doivent être C0.1 puis celles déclarées, dans l'ordre",
  );

  // 3. L'HORODATAGE, pas seulement l'ordre alphabétique. Un nom qui trie bien
  //    mais dont l'estampille est antérieure serait accepté par le point 2 sur
  //    un dépôt renommé ; il ne l'est pas ici.
  const tC01 = estampille(MIGRATION_C0_1);
  assert.ok(tC01 !== null, "la migration C0.1 doit être horodatée");
  let precedente = tC01;
  for (const nom of MIGRATIONS_APRES_C0_1) {
    const t = estampille(nom);
    assert.ok(t !== null, `${nom} doit être horodatée`);
    assert.ok(t > precedente, `${nom} (${t}) doit être POSTÉRIEURE à ${precedente}`);
    precedente = t;
  }

  // 4. EXACTEMENT UNE MIGRATION DE LISTE DE COURSES, et c'est celle de C2.
  //    Une seconde migration C2 — un correctif « vite fait » qui redéfinirait
  //    la RPC — rougit ici, là où un simple compte l'aurait absorbée.
  const deCourses = migrations.filter((f) =>
    /shopping|grocer|liste_de_courses|courses|panier|checklist|budget|prix|pont_retail|_c0_|_c1_|_c2_|_c3_|_c4_/i.test(f),
  );
  // ⚠️ C0.1 EST DANS LA COMPARAISON — élargi en C4.1 avec le motif `_c0_|_c1_`.
  // Le verrou du repas consommé appartient au chantier COURSES ; il est
  // simplement nommé à part parce qu'il précède la première liste. L'inclure
  // ici ferme le dernier trou du balayage : une migration nommée `_c1_` ou
  // `_c0_` — un lot qui aurait « juste ajouté une petite table » — n'a plus
  // aucun moyen de passer inaperçue.
  assert.deepEqual(
    deCourses,
    [MIGRATION_C0_1, ...MIGRATIONS_COURSES],
    `migrations COURSES inattendues : ${deCourses.join(", ") || "aucune"}`,
  );

  // 5. RIEN APRÈS LA DERNIÈRE MIGRATION COURSES. Une migration étrangère postérieure serait invisible au
  //    point 2 seulement si elle triait avant — le point 2 la voit ; ici on
  //    nomme précisément les intruses, pour que l'échec soit lisible.
  const apresC01 = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t >= tC01;
  });
  const autorisees = new Set([MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1]);
  assert.deepEqual(
    apresC01,
    [MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1],
    `migrations inattendues depuis C0.1 : ${apresC01.filter((f) => !autorisees.has(f)).join(", ")}`,
  );

  // 6. L'HISTORIQUE ANTÉRIEUR EST FIGÉ. C1 et C0 n'ont pas gagné de migration
  //    rétroactive, et aucune migration passée n'a été renommée.
  const historique = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t < tC01;
  });
  assert.equal(
    historique.length,
    NOMBRE_DE_MIGRATIONS - 1 - MIGRATIONS_APRES_C0_1.length,
    "l'historique antérieur a changé de taille",
  );
  assert.equal(
    empreinte(historique),
    EMPREINTE_HISTORIQUE,
    "une migration a été ajoutée, retirée ou renommée AVANT C0.1 (antidatage)",
  );

  // 7. AUCUN NOM NON HORODATÉ. Une migration sans estampille échapperait aux
  //    points 3, 5 et 6 d'un seul coup.
  const sansEstampille = migrations.filter((f) => estampille(f) === null);
  assert.deepEqual(sansEstampille, [], `migrations sans horodatage : ${sansEstampille.join(", ")}`);
}

/**
 * LE MANIFESTE — la propriété RÉELLE que dix compteurs figés essayaient
 * d'exprimer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SECOND CONTRÔLE
 * ────────────────────────────────────────────────────────────────────────────
 * Six suites du dépôt portaient un `assert.equal(migrations.length, N)`. Leur
 * intention, écrite noir sur blanc dans `aliments-a1`, était bonne :
 *
 *     « ajouter un fichier au dossier est un acte délibéré, et ce rouge en est
 *       l'accusé de réception »
 *
 * Mais le MOYEN était faux, et il s'est cassé exactement comme prévu : un
 * compte ne dit pas CE QUI a été ajouté, il doit être recopié dans dix
 * fichiers, et le jour où l'un n'est pas mis à jour on remonte le nombre sans
 * regarder. Mesuré le 17/08/2026 : les compteurs disaient 76 et 80 pendant que
 * le dossier en portait 82 — et surtout, **C2 et C3 n'avaient jamais été
 * déclarées au manifeste**, ce que personne n'avait vu.
 *
 * L'accusé de réception existe pourtant déjà, et il est meilleur : le
 * MANIFESTE (`supabase/baseline/manifest.json`) énumère NOMMÉMENT les
 * migrations à rejouer par-dessus le baseline. Ajouter une migration sans l'y
 * déclarer casse le bootstrap d'une base neuve — c'est une conséquence réelle,
 * pas une convention de test.
 *
 * Ce contrôle vérifie donc l'égalité EXACTE des deux ensembles, dans les deux
 * sens. Aucun nombre n'y est écrit en dur.
 */
export const BORNE_POST_BASELINE = "20260724214500";

export function migrationsPostBaseline(): readonly string[] {
  return listerMigrations()
    .filter((f) => f >= BORNE_POST_BASELINE)
    .sort();
}

export function verifierManifesteDesMigrations(assert: typeof import("node:assert/strict")): void {
  const manifeste = JSON.parse(
    readFileSync(new URL("../../supabase/baseline/manifest.json", import.meta.url), "utf8"),
  ) as { migrations_post_baseline_attendues?: unknown };

  const declarees = manifeste.migrations_post_baseline_attendues;
  assert.ok(Array.isArray(declarees), "le manifeste doit énumérer les migrations post-baseline");

  const surDisque = migrationsPostBaseline();
  const declareesTriees = [...(declarees as string[])].sort();

  // Les deux sens, nommés séparément : « oubliée au manifeste » et « déclarée
  // mais absente » sont deux fautes différentes, et le message doit le dire.
  const oubliees = surDisque.filter((f) => !declareesTriees.includes(f));
  assert.deepEqual(
    oubliees,
    [],
    `migration(s) présentes sur le disque mais NON déclarées au manifeste : ${oubliees.join(", ")}`,
  );

  const fantomes = declareesTriees.filter((f) => !surDisque.includes(f));
  assert.deepEqual(
    fantomes,
    [],
    `migration(s) déclarées au manifeste mais absentes du disque : ${fantomes.join(", ")}`,
  );

  assert.deepEqual(declareesTriees, surDisque, "le manifeste et le dossier doivent coïncider");
}

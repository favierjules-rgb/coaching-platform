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
import { readdirSync } from "node:fs";

/** La dernière migration d'avant C2 : le verrou serveur du repas consommé. */
export const MIGRATION_C0_1 = "20260914090000_c0_1_verrou_repas_consomme.sql";

/** La SEULE migration que C2 a le droit d'ajouter. */
export const MIGRATION_C2 = "20260915090000_c2_liste_de_courses_persistante.sql";

/** Le compte attendu — nécessaire, jamais suffisant. */
export const NOMBRE_DE_MIGRATIONS = 81;

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

  // 2. L'ORDRE ET L'IDENTITÉ DES DEUX DERNIÈRES. C0.1, puis C2 — et rien après.
  //    Antidater C2 avant C0.1 inverse ce couple, et rougit ici.
  assert.deepEqual(
    migrations.slice(-2),
    [MIGRATION_C0_1, MIGRATION_C2],
    "les deux dernières migrations doivent être C0.1 puis C2, dans cet ordre",
  );

  // 3. L'HORODATAGE, pas seulement l'ordre alphabétique. Un nom qui trie bien
  //    mais dont l'estampille est antérieure serait accepté par le point 2 sur
  //    un dépôt renommé ; il ne l'est pas ici.
  const tC01 = estampille(MIGRATION_C0_1);
  const tC2 = estampille(MIGRATION_C2);
  assert.ok(tC01 !== null && tC2 !== null, "les migrations C0.1 et C2 doivent être horodatées");
  assert.ok(tC2 > tC01, `C2 (${tC2}) doit être POSTÉRIEURE à C0.1 (${tC01})`);

  // 4. EXACTEMENT UNE MIGRATION DE LISTE DE COURSES, et c'est celle de C2.
  //    Une seconde migration C2 — un correctif « vite fait » qui redéfinirait
  //    la RPC — rougit ici, là où un simple compte l'aurait absorbée.
  const deCourses = migrations.filter((f) =>
    /shopping|grocer|liste_de_courses|courses|panier|checklist|_c2_/i.test(f),
  );
  assert.deepEqual(
    deCourses,
    [MIGRATION_C2],
    `une seule migration de liste de courses est autorisée : ${deCourses.join(", ") || "aucune"}`,
  );

  // 5. RIEN APRÈS C2. Une migration étrangère postérieure serait invisible au
  //    point 2 seulement si elle triait avant — le point 2 la voit ; ici on
  //    nomme précisément les intruses, pour que l'échec soit lisible.
  const apresC01 = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t >= tC01;
  });
  assert.deepEqual(
    apresC01,
    [MIGRATION_C0_1, MIGRATION_C2],
    `migrations inattendues depuis C0.1 : ${apresC01.filter((f) => f !== MIGRATION_C0_1 && f !== MIGRATION_C2).join(", ")}`,
  );

  // 6. L'HISTORIQUE ANTÉRIEUR EST FIGÉ. C1 et C0 n'ont pas gagné de migration
  //    rétroactive, et aucune migration passée n'a été renommée.
  const historique = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t < tC01;
  });
  assert.equal(historique.length, NOMBRE_DE_MIGRATIONS - 2, "l'historique antérieur a changé de taille");
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

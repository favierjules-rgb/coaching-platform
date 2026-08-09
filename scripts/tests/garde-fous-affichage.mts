import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * MENU8 — `display_prefs` N'AUTORISE RIEN, ET NE DOIT JAMAIS COMMENCER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA TENTATION QU'IL FAUT FERMER
 * ════════════════════════════════════════════════════════════════════════
 * `display_prefs` mémorise l'`access_type` pour que le menu soit le même
 * hors ligne qu'en ligne. C'est tout ce qu'il fait, et c'est tout ce qu'il
 * a le droit de faire.
 *
 * La tentation viendra un jour : une garde de route a besoin de savoir si
 * ce compte est « programme_seul », la valeur est là, à portée de main, et
 * elle évite une requête. Le jour où quelqu'un l'utilise ainsi,
 * l'application demande à l'utilisateur quels droits il souhaite — la
 * valeur est écrite sur SON téléphone, donc modifiable par lui.
 *
 * Ce contrôle lit le source et refuse toute apparition de `display_prefs`,
 * `lireTypeAcces` ou `MAGASINS.affichage` dans un fichier qui décide d'un
 * ACCÈS : gardes, routes d'API, middleware, politiques.
 *
 * Comme les garde-fous de `scripts/tests/idb/`, il cherche du texte —
 * parce que la propriété à prouver est une propriété du source.
 */

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Les endroits où une décision d'ACCÈS se prend. */
const ZONES_D_AUTORITE = [
  join("app", "api"),
  join("lib", "supabase", "guards.ts"),
  "middleware.ts",
];

/** Ce qui ne doit jamais y apparaître. */
const INTERDITS = [/display_prefs/, /\blireTypeAcces\b/, /MAGASINS\s*\.\s*affichage/];

const EXTENSIONS = [".ts", ".tsx", ".mts"];

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

async function fichiers(chemin: string): Promise<string[]> {
  const trouves: string[] = [];
  async function descendre(courant: string): Promise<void> {
    let entrees;
    try {
      entrees = await readdir(courant, { withFileTypes: true });
    } catch {
      // `readdir` a échoué : soit un FICHIER unique (guards.ts, middleware.ts),
      // soit un chemin absent. Seul le premier cas nous intéresse — un
      // chemin absent ne doit ni faire échouer le contrôle, ni le vider en
      // silence : c'est l'assertion `lus > 0` qui garde ce dernier cas.
      if (existsSync(courant) && EXTENSIONS.some((ext) => courant.endsWith(ext))) {
        trouves.push(courant);
      }
      return;
    }
    for (const entree of entrees) {
      const complet = join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === "node_modules" || entree.name.startsWith(".")) continue;
        await descendre(complet);
      } else if (EXTENSIONS.some((ext) => entree.name.endsWith(ext))) {
        trouves.push(complet);
      }
    }
  }
  await descendre(join(RACINE, chemin));
  return trouves;
}

await test("MENU8. `display_prefs` n'apparaît dans AUCUN chemin d'autorisation", async () => {
  const coupables: string[] = [];
  let lus = 0;
  for (const zone of ZONES_D_AUTORITE) {
    for (const chemin of await fichiers(zone)) {
      lus += 1;
      const source = await readFile(chemin, "utf8");
      if (INTERDITS.some((motif) => motif.test(source))) {
        coupables.push(relative(RACINE, chemin).split(sep).join(sep));
      }
    }
  }
  assert.ok(lus > 0, "aucun fichier d'autorité n'a été lu — le contrôle porterait sur rien");
  assert.deepEqual(
    coupables.sort(),
    [],
    "une préférence d'AFFICHAGE, écrite sur le téléphone de l'utilisateur, sert à décider d'un accès",
  );
});

await test("MENU8b. le contrôle sait DÉTECTER une violation", async () => {
  // Sans cette vérification, MENU8 pourrait passer parce qu'il ne lit rien.
  const faux = "const acces = await depot.lireTypeAcces(userId);";
  assert.ok(
    INTERDITS.some((motif) => motif.test(faux)),
    "le motif ne reconnaît pas un usage pourtant évident",
  );
  assert.equal(
    INTERDITS.some((motif) => motif.test("const menu = accessType === 'programme_seul';")),
    false,
    "le motif est trop large : il interdirait un usage d'affichage légitime",
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

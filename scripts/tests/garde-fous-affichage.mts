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


/* ════════════════════════════════════════════════════════════════════════
 * `!active` N'EST PAS UN SYNONYME DE « DÉMONSTRATION »
 * ════════════════════════════════════════════════════════════════════════
 * Le défaut le plus coûteux de ce chantier, répété sur trois écrans : un
 * hook rendait `active: false` dès que le chargement n'aboutissait pas —
 * panne réseau comprise — et la page traitait ce `false` comme « nous
 * sommes en démonstration », donc affichait `data/student.ts`.
 *
 * En avion, un élève réel voyait les programmes d'Alexandre, une séance qui
 * n'était pas la sienne, et un lien vers un identifiant qui n'existait nulle
 * part. Rien à l'écran ne le disait.
 *
 * La règle : un écran élève qui peut afficher la démonstration doit d'abord
 * DEMANDER POURQUOI le chargement a échoué — via le diagnostic partagé
 * (`useEtatOfflineEleve` ou `useSeanceHorsLigne`, tous deux adossés à
 * `diagnostiquer` + `classerSource`). Sans cette question, `!active` reste
 * un fourre-tout.
 *
 * Ce contrôle lit le source : la propriété à prouver est une propriété du
 * source, exactement comme les garde-fous de `scripts/tests/idb/`.
 * ════════════════════════════════════════════════════════════════════════ */

/** Les écrans élève. */
const ZONES_ELEVE = [join("app", "(student)"), join("components", "student")];

/**
 * ÉCRANS ENCORE À FERMER — dette CONNUE, pas dette oubliée.
 *
 * ELLE EST VIDE, et c'est le but : les six écrans élève qui pouvaient
 * afficher `data/student.ts` demandent tous, désormais, POURQUOI le
 * chargement a échoué avant de le faire.
 *
 * Cette liste n'a le droit que de rétrécir. Elle reste ici parce qu'un jour
 * quelqu'un ajoutera un écran, MOCK1 le signalera, et la tentation sera de
 * l'inscrire ici « en attendant ». Ce sera un choix explicite, écrit, revu —
 * pas un oubli silencieux. MOCK2 refuse d'y laisser un écran déjà corrigé.
 */
const RESTENT_A_FERMER: string[] = [];

/**
 * « Cet écran peut afficher la démonstration. »
 *
 * Deux formes, et il a fallu les deux : l'import direct de `data/student`,
 * et l'usage de `useStudentProfile` — le profil mock/localStorage.
 * `ProfilPageContent` n'avait que la seconde (l'import vivait dans la page,
 * l'appel des hooks dans le composant) et passait donc sous le radar. Il a
 * fallu un huitième écran fautif pour s'en apercevoir.
 */
const UTILISE_DEMONSTRATION = /from "@\/data\/student"|\buseStudentProfile\s*\(/;
const CHARGE_DEPUIS_SUPABASE = /\buseSupabase[A-Za-z]*\s*\(/;
const DEMANDE_POURQUOI = /useEtatOfflineEleve|useSeanceHorsLigne/;

async function ecransSuspects(): Promise<string[]> {
  const suspects: string[] = [];
  for (const zone of ZONES_ELEVE) {
    for (const chemin of await fichiers(zone)) {
      const source = await readFile(chemin, "utf8");
      if (!UTILISE_DEMONSTRATION.test(source)) continue;
      if (!CHARGE_DEPUIS_SUPABASE.test(source)) continue;
      if (DEMANDE_POURQUOI.test(source)) continue;
      suspects.push(relative(RACINE, chemin).split(sep).join(sep));
    }
  }
  return suspects.sort();
}

await test("MOCK1. aucun NOUVEL écran élève ne traite `!active` comme « démonstration »", async () => {
  const suspects = await ecransSuspects();
  const nouveaux = suspects.filter((f) => !RESTENT_A_FERMER.includes(f));
  assert.deepEqual(
    nouveaux,
    [],
    "cet écran affiche data/student.ts sans avoir demandé POURQUOI le chargement a échoué : en avion, il montrera la démonstration à un élève réel",
  );
});

await test("MOCK2. la liste de dette ne contient que des écrans RÉELLEMENT encore ouverts", async () => {
  const suspects = await ecransSuspects();
  const dejaFermes = RESTENT_A_FERMER.filter((f) => !suspects.includes(f));
  assert.deepEqual(
    dejaFermes,
    [],
    "ces écrans ont été corrigés : retire-les de RESTENT_A_FERMER, sinon la liste protège du vide",
  );
});

await test("MOCK3. le contrôle sait DÉTECTER le motif", async () => {
  // Sans cette vérification, MOCK1 pourrait passer parce qu'il ne reconnaît
  // plus rien — un renommage de hook suffirait à le rendre aveugle.
  const fautif = 'import { activeProgram } from "@/data/student";\nconst t = useSupabaseTrainingProgram();';
  assert.ok(UTILISE_DEMONSTRATION.test(fautif) && CHARGE_DEPUIS_SUPABASE.test(fautif));
  assert.equal(DEMANDE_POURQUOI.test(fautif), false);

  const corrige = fautif + '\nconst local = useEtatOfflineEleve(t.ready && !t.active);';
  assert.ok(DEMANDE_POURQUOI.test(corrige), "un écran corrigé ne doit plus être signalé");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

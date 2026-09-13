/**
 * LA RÈGLE D'ÉCRITURE DES DURÉES — seuils, et rien que les seuils.
 *
 * Ce harnais existe parce que trois graphies de la même grandeur ont
 * coexisté dans l'application (« 1min30 », « 1 h 08 », « 60s »). Il vérifie
 * deux choses séparées :
 *
 *   A. la RÈGLE elle-même, exhaustivement autour des quatre frontières
 *      (0/1 s, 59/60 s, 3599/3600 s, minute pleine) ;
 *   B. le fait qu'aucun composant ne la RÉÉCRIVE dans son coin — la faute
 *      d'origine n'était pas une mauvaise règle, c'était trois règles.
 *
 * Les SABOTAGES ne modifient aucun fichier : ils rejouent la batterie A
 * contre des implémentations volontairement fausses, et échouent si la
 * batterie les laisse passer. Un test qui ne détecte pas une régression
 * qu'on lui présente ne protège de rien.
 *
 * Lancement : npx tsx scripts/tests/duree-format.mts
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formaterDuree, formaterDureeMinutes } from "../../lib/duree";
import { formatDurationSeconds } from "../../lib/cardio";
import { formatDureeSeance } from "../../lib/session-completion";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return (async () => {
    try {
      await fn();
      passed += 1;
      console.log(`ok - ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`ÉCHEC - ${name}`);
      console.error(error);
    }
  })();
}

/* ════════════════════════════════════════════════════════════════════════
 * A. LA RÈGLE
 * ════════════════════════════════════════════════════════════════════════ */

/** Les huit exemples imposés par le cahier des charges, mot pour mot. */
const EXEMPLES_IMPOSES: readonly (readonly [number, string])[] = [
  [30, "30 s"],
  [60, "1 min"],
  [90, "1 min 30 s"],
  [600, "10 min"],
  [3599, "59 min 59 s"],
  [3600, "1 h"],
  [3660, "1 h 1 min"],
  [5400, "1 h 30 min"],
];

/**
 * La batterie complète, applicable à N'IMPORTE QUELLE implémentation — c'est
 * ce qui permet de la rejouer contre les saboteurs. Retourne la liste des
 * écarts constatés plutôt que de jeter : un saboteur doit pouvoir en produire
 * plusieurs.
 */
function batterie(f: (secondes: number) => string): string[] {
  const ecarts: string[] = [];
  const attendu: (readonly [number, string])[] = [
    ...EXEMPLES_IMPOSES,

    // ── Frontière 0 / 1 seconde ───────────────────────────────────────
    [1, "1 s"],
    [2, "2 s"],

    // ── Frontière 59 / 60 secondes ────────────────────────────────────
    [58, "58 s"],
    [59, "59 s"],
    [60, "1 min"],
    [61, "1 min 1 s"],

    // ── Minute pleine contre minute entamée ───────────────────────────
    [119, "1 min 59 s"],
    [120, "2 min"],
    [121, "2 min 1 s"],
    [1800, "30 min"],
    [3540, "59 min"],
    [3541, "59 min 1 s"],

    // ── Frontière 3599 / 3600 secondes ────────────────────────────────
    [3598, "59 min 58 s"],
    [3599, "59 min 59 s"],
    [3600, "1 h"],
    [3601, "1 h"], // les secondes DISPARAISSENT au format heure
    [3659, "1 h"], // …y compris 59 d'entre elles : troncature, jamais arrondi
    [3660, "1 h 1 min"],

    // ── Au-delà ───────────────────────────────────────────────────────
    [7200, "2 h"],
    [7260, "2 h 1 min"],
    [86399, "23 h 59 min"],
    [86400, "24 h"],
  ];
  for (const [entree, sortie] of attendu) {
    const obtenu = f(entree);
    if (obtenu !== sortie) ecarts.push(`${entree} → « ${obtenu} » au lieu de « ${sortie} »`);
  }
  return ecarts;
}

await test("A1 — les huit exemples imposés, mot pour mot", () => {
  for (const [entree, sortie] of EXEMPLES_IMPOSES) {
    assert.equal(formaterDuree(entree), sortie, `${entree} s`);
  }
});

await test("A2 — batterie complète des seuils (59/60, 3599/3600, minute pleine)", () => {
  assert.deepEqual(batterie(formaterDuree), []);
});

await test("A3 — jamais de secondes au format heure", () => {
  for (let s = 3600; s <= 3659; s += 1) {
    assert.equal(formaterDuree(s), "1 h", `${s} s`);
  }
  for (let s = 3660; s <= 3719; s += 1) {
    assert.equal(formaterDuree(s), "1 h 1 min", `${s} s`);
  }
});

await test("A4 — valeurs dégénérées : aucun jet, aucun NaN, aucune durée négative", () => {
  for (const entree of [0, -1, -3600, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const obtenu = formaterDuree(entree);
    assert.equal(obtenu, "0 s", `entrée ${entree}`);
    assert.ok(!obtenu.includes("NaN"), "aucun NaN visible");
    assert.ok(!obtenu.includes("-"), "aucun signe négatif visible");
  }
});

await test("A5 — les fractions sont arrondies à la seconde avant la règle", () => {
  assert.equal(formaterDuree(89.6), "1 min 30 s", "89,6 s est une durée de 90 s");
  assert.equal(formaterDuree(59.4), "59 s");
  assert.equal(formaterDuree(59.5), "1 min", "arrondi à 60 → franchit le seuil");
});

await test("A6 — la variante minutes passe par la même règle", () => {
  assert.equal(formaterDureeMinutes(48), "48 min");
  assert.equal(formaterDureeMinutes(59), "59 min");
  assert.equal(formaterDureeMinutes(60), "1 h");
  assert.equal(formaterDureeMinutes(68), "1 h 8 min");
  assert.equal(formaterDureeMinutes(90), "1 h 30 min");
  assert.equal(formaterDureeMinutes(0), "0 s");
  assert.equal(formaterDureeMinutes(-5), "0 s");
  // Propriété : X minutes s'écrit toujours comme X × 60 secondes.
  for (let m = 1; m <= 200; m += 1) {
    assert.equal(formaterDureeMinutes(m), formaterDuree(m * 60), `${m} min`);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * B. LES APPELANTS N'ONT PLUS DE RÈGLE À EUX
 * ════════════════════════════════════════════════════════════════════════ */

await test("B1 — formatDurationSeconds délègue (et garde SON tiret pour l'absence)", () => {
  assert.deepEqual(batterie(formatDurationSeconds), [], "mêmes seuils que la règle");
  assert.equal(formatDurationSeconds(null), "—", "valeur absente ≠ durée nulle");
  assert.equal(formatDurationSeconds(undefined), "—");
  assert.equal(formatDurationSeconds(0), "—");
  assert.equal(formatDurationSeconds(-10), "—");
});

await test("B2 — formatDureeSeance délègue (et garde SON null pour l'absence)", () => {
  assert.equal(formatDureeSeance(48), "48 min");
  assert.equal(formatDureeSeance(60), "1 h");
  assert.equal(formatDureeSeance(68), "1 h 8 min", "contrat changé volontairement : plus de « 1 h 08 »");
  assert.equal(formatDureeSeance(90), "1 h 30 min");
  assert.equal(formatDureeSeance(null), null);
  assert.equal(formatDureeSeance(0), null, "zéro minute n'est pas une durée");
  for (let m = 1; m <= 200; m += 1) {
    assert.equal(formatDureeSeance(m), formaterDuree(m * 60), `${m} min`);
  }
});

/**
 * Les commentaires sont RETIRÉS avant analyse : un commentaire a le droit de
 * citer les anciennes graphies pour expliquer pourquoi elles ont disparu —
 * c'est même exactement ce que font lib/cardio.ts et lib/session-completion.ts.
 */
function codeSeul(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Graphies mortes et formatages refaits à la main. Retourne les violations. */
function graphiesMortes(chemin: string, source: string): string[] {
  const code = codeSeul(source);
  const violations: string[] = [];
  if (/\}min\$\{|\}\s*min\$\{String\(/.test(code)) {
    violations.push(`${chemin} : graphie « 1min30 » reconstruite à la main`);
  }
  if (/\}h\$\{|\}h"|\}\s*h\s*\$\{String\(/.test(code)) {
    violations.push(`${chemin} : graphie « 1h00 » reconstruite à la main`);
  }
  if (/\$\{[A-Za-z0-9_.[\]]*[Ss]econds?\}\s*s\b/.test(code)) {
    violations.push(`${chemin} : secondes collées à un « s » sans passer par le formateur`);
  }
  // La constante peut être écrite en clair OU nommée : un composant qui
  // s'offre un `SECONDES_PAR_HEURE` local refabrique la règle tout autant.
  if (/Math\.floor\([^)]*\/\s*(?:3600|3_600|SECONDES_PAR_HEURE)\s*\)/.test(code)) {
    violations.push(`${chemin} : décomposition en heures refaite localement`);
  }
  return violations;
}

/** « {x.durationMinutes} min » et ses variantes, jamais formatées. */
function minutesBrutes(chemin: string, source: string): string[] {
  const code = codeSeul(source);
  if (
    /\{\s*[A-Za-z0-9_.!?[\]]*[Dd]urationMinutes\s*\}\s*min/.test(code) ||
    /\$\{[^}]*[Dd]urationMinutes\}\s*min/.test(code)
  ) {
    return [`${chemin} : « {durationMinutes} min » subsiste, non formaté`];
  }
  return [];
}

const FICHIERS_SANS_GRAPHIE_MORTE = [
  "lib/cardio.ts",
  "lib/session-completion.ts",
  "components/student/ExerciseFeedbackCard.tsx",
  "components/student/SessionFeedbackSection.tsx",
];

await test("B3 — les deux graphies mortes n'existent plus nulle part", async () => {
  for (const chemin of FICHIERS_SANS_GRAPHIE_MORTE) {
    const source = await readFile(join(RACINE, chemin), "utf8");
    assert.deepEqual(graphiesMortes(chemin, source), []);
  }
});

await test("B4 — lib/duree.ts est la SEULE implémentation de la règle", async () => {
  const duree = await readFile(join(RACINE, "lib", "duree.ts"), "utf8");
  assert.ok(/SECONDES_PAR_HEURE = 3600/.test(duree), "la constante d'heure vit bien ici");
  // Et le prédicat qui interdit la décomposition ailleurs se déclencherait
  // sur lib/duree.ts lui-même : c'est la preuve qu'il cherche la bonne chose.
  assert.ok(
    graphiesMortes("lib/duree.ts", duree).length > 0,
    "le prédicat ne reconnaît même pas la décomposition qu'il est censé traquer",
  );
});

await test("B5 — les sites d'affichage importent bien le formateur", async () => {
  const attendus: readonly (readonly [string, string])[] = [
    ["components/student/ExerciseFeedbackCard.tsx", "formaterDuree"],
    ["components/student/SessionFeedbackSection.tsx", "formaterDuree"],
    ["components/student/NextSessionHighlight.tsx", "formaterDureeMinutes"],
    ["components/student/ProgramWeekCalendar.tsx", "formaterDureeMinutes"],
    ["components/student/DashboardContent.tsx", "formaterDureeMinutes"],
    ["components/admin/SessionTemplateLibraryManager.tsx", "formaterDureeMinutes"],
    ["app/(student)/entrainement/seance/[sessionId]/page.tsx", "formaterDureeMinutes"],
    ["app/admin/programmes/[programId]/page.tsx", "formaterDureeMinutes"],
  ];
  for (const [chemin, fonction] of attendus) {
    const source = await readFile(join(RACINE, chemin), "utf8");
    assert.ok(
      new RegExp(`import \\{[^}]*${fonction}[^}]*\\} from "@/lib/duree"`).test(source),
      `${chemin} : n'importe pas ${fonction} depuis @/lib/duree`,
    );
    assert.ok(source.includes(`${fonction}(`), `${chemin} : importe ${fonction} sans l'appeler`);
    assert.deepEqual(minutesBrutes(chemin, source), []);
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * SABOTAGES — la batterie doit MORDRE
 * ════════════════════════════════════════════════════════════════════════ */

const SABOTEURS: readonly (readonly [string, (s: number) => string])[] = [
  [
    "S1 — retour d'affichage UNIQUEMENT en secondes",
    (s) => `${Math.round(s)} s`,
  ],
  [
    "S2 — bascule à 60 s oubliée (< 60 exclu au lieu de inclus)",
    (s) => {
      const t = Math.round(s);
      if (t <= 60) return `${t} s`;
      return formaterDuree(t);
    },
  ],
  [
    "S3 — bascule à l'heure oubliée : tout en minutes",
    (s) => {
      const t = Math.round(s);
      if (t < 60) return `${t} s`;
      const m = Math.floor(t / 60);
      const r = t % 60;
      return r === 0 ? `${m} min` : `${m} min ${r} s`;
    },
  ],
  [
    "S4 — secondes affichées au format heure",
    (s) => {
      const t = Math.round(s);
      if (t < 3600) return formaterDuree(t);
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const r = t % 60;
      return `${h} h ${m} min ${r} s`;
    },
  ],
  [
    "S5 — secondes ARRONDIES en minutes au lieu d'être tronquées",
    (s) => {
      const t = Math.round(s);
      if (t < 3600) return formaterDuree(t);
      const h = Math.floor(t / 3600);
      const m = Math.round((t % 3600) / 60);
      return m === 0 ? `${h} h` : `${h} h ${m} min`;
    },
  ],
  [
    "S6 — ancienne graphie compacte « 1min30 » / « 1h00 »",
    (s) => {
      const t = Math.round(s);
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const r = t % 60;
      if (h > 0) return `${h}h${String(m).padStart(2, "0")}`;
      if (m > 0 && r > 0) return `${m}min${String(r).padStart(2, "0")}`;
      if (m > 0) return `${m} min`;
      return `${r} s`;
    },
  ],
  [
    "S7 — « 0 min » écrit au lieu de « 1 h » à la minute pleine",
    (s) => {
      const t = Math.round(s);
      if (t < 60) return `${t} s`;
      const h = Math.floor(t / 3600);
      const m = Math.floor((t % 3600) / 60);
      const r = t % 60;
      if (h > 0) return `${h} h ${m} min`;
      return r === 0 ? `${m} min` : `${m} min ${r} s`;
    },
  ],
];

for (const [nom, saboteur] of SABOTEURS) {
  await test(`SAB ${nom} — la batterie le détecte`, () => {
    const ecarts = batterie(saboteur);
    assert.ok(ecarts.length > 0, "le saboteur passe la batterie : elle ne protège de rien");
  });
}

/* ── Sabotages de SOURCE : les prédicats textuels doivent mordre aussi ── */

const SABOTAGES_SOURCE: readonly (readonly [string, (chemin: string, source: string) => string[], string])[] = [
  [
    "S8 — un composant refabrique « 1min30 »",
    graphiesMortes,
    'const label = `${minutes}min${String(secs).padStart(2, "0")}`;',
  ],
  [
    "S9 — un composant refabrique « 1h00 »",
    graphiesMortes,
    'const label = `${hours}h${String(minutes).padStart(2, "0")}`;',
  ],
  [
    "S10 — des secondes collées à un « s » sans formateur",
    graphiesMortes,
    'const label = `${exercise.restSeconds}s repos`;',
  ],
  [
    "S11 — décomposition en heures refaite localement",
    graphiesMortes,
    "const hours = Math.floor(total / 3600);",
  ],
  [
    "S12 — « {durationMinutes} min » réintroduit en JSX",
    minutesBrutes,
    "<span>{session.durationMinutes} min</span>",
  ],
  [
    "S13 — « {durationMinutes} min » réintroduit dans un gabarit",
    minutesBrutes,
    "const ligne = `${upcomingSession.durationMinutes} min`;",
  ],
];

for (const [nom, predicat, sourceSabotee] of SABOTAGES_SOURCE) {
  await test(`SAB ${nom} — le contrôle de source le détecte`, () => {
    assert.ok(
      predicat("faux-fichier.tsx", sourceSabotee).length > 0,
      "le contrôle laisse passer la régression qu'on lui présente",
    );
  });
}

await test("SAB S14 — un commentaire citant l'ancienne graphie ne déclenche PAS le contrôle", () => {
  const commentaire = [
    "/**",
    " * Cette fonction écrivait `${minutes}min${String(secs).padStart(2, \"0\")}`",
    " * et `${hours}h${String(minutes).padStart(2, \"0\")}`. Les deux sont mortes.",
    " */",
    "export const x = 1;",
  ].join("\n");
  assert.deepEqual(
    graphiesMortes("faux-fichier.ts", commentaire),
    [],
    "un contrôle qui interdit d'EXPLIQUER l'ancienne graphie force à effacer la mémoire du bug",
  );
});

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);

/**
 * Harnais — LE PENSE-BÊTE « À JOUR / À VÉRIFIER » SE RÉINITIALISE TOUT SEUL.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER PROUVE
 * ════════════════════════════════════════════════════════════════════════
 * Qu'une validation vaut pour la SEMAINE COURANTE et pour elle seule ; qu'au
 * lundi suivant l'état redevient « À vérifier » SANS qu'aucune tâche ne se
 * déclenche ; et que ce drapeau n'écrit rien d'autre que sa propre ligne — ni
 * dans `programs`, ni dans les séances, ni dans la progression.
 *
 * ⚠️ LE TEST CENTRAL EST LE 4 : la MÊME ligne en base, lue un lundi puis le
 * lundi suivant, doit changer d'état. C'est ce qui distingue une semaine
 * stockée d'un booléen qu'il faudrait aller éteindre.
 *
 * Lancement : npm run test:verification-programme
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { PilluleVerification } from "../../components/admin/PilluleVerification";
import {
  LIBELLES_VERIFICATION,
  bascule,
  cleDeSemaine,
  dateDuJour,
  etatDeVerification,
} from "../../lib/verification-programme";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const texteRendu = (html: string) => html.replace(/<!-- -->/g, "");

/** Lundi 7 septembre 2026 → dimanche 13. Le lundi suivant est le 14. */
const LUNDI = "2026-09-07";
const MERCREDI = "2026-09-09";
const DIMANCHE = "2026-09-13";
const LUNDI_SUIVANT = "2026-09-14";

test("1. LA CLÉ D'UNE SEMAINE EST SON LUNDI — du lundi au dimanche", () => {
  for (const jour of [LUNDI, MERCREDI, DIMANCHE]) {
    assert.equal(cleDeSemaine(jour), LUNDI, `${jour} appartient à la semaine du ${LUNDI}`);
  }
  assert.equal(cleDeSemaine(LUNDI_SUIVANT), LUNDI_SUIVANT, "le lundi suivant ouvre une nouvelle semaine");
  assert.equal(cleDeSemaine("pas une date"), null, "on ne devine pas une semaine à partir de rien");
});

test("2. JAMAIS VALIDÉ — « À vérifier »", () => {
  assert.equal(etatDeVerification({ verifieePourLaSemaine: null, aujourdhui: MERCREDI }), "a-verifier");
});

test("3. VALIDÉ CETTE SEMAINE — « À jour » toute la semaine", () => {
  for (const jour of [LUNDI, MERCREDI, DIMANCHE]) {
    assert.equal(
      etatDeVerification({ verifieePourLaSemaine: LUNDI, aujourdhui: jour }),
      "a-jour",
      `une validation posée le lundi tient encore le ${jour}`,
    );
  }
});

test("4. RESET HEBDOMADAIRE — la MÊME ligne redevient « À vérifier » le lundi suivant", () => {
  const ligneEnBase = LUNDI; // rien n'est réécrit entre les deux lectures
  assert.equal(etatDeVerification({ verifieePourLaSemaine: ligneEnBase, aujourdhui: DIMANCHE }), "a-jour");
  assert.equal(
    etatDeVerification({ verifieePourLaSemaine: ligneEnBase, aujourdhui: LUNDI_SUIVANT }),
    "a-verifier",
    "aucune tâche n'a tourné entre les deux : c'est le calendrier qui a changé",
  );
});

test("5. UNE VALIDATION FUTURE NE VAUT PAS « À jour »", () => {
  assert.equal(
    etatDeVerification({ verifieePourLaSemaine: LUNDI_SUIVANT, aujourdhui: MERCREDI }),
    "a-verifier",
    "une date en avance (horloge décalée, écriture directe) ne doit pas peindre en vert pendant des semaines",
  );
});

test("6. UNE DATE ILLISIBLE NE PRÉTEND RIEN", () => {
  assert.equal(etatDeVerification({ verifieePourLaSemaine: LUNDI, aujourdhui: "//" }), "a-verifier");
});

test("7. LA BASCULE VA D'UN ÉTAT À L'AUTRE, SANS TROISIÈME", () => {
  assert.equal(bascule("a-jour"), "a-verifier");
  assert.equal(bascule("a-verifier"), "a-jour");
});

test("8. LA DATE DU JOUR EST INJECTABLE — le test ne dépend pas de l'horloge", () => {
  assert.equal(dateDuJour(new Date(2026, 8, 9)), MERCREDI);
  assert.match(dateDuJour(), /^\d{4}-\d{2}-\d{2}$/);
});

test("9. LA PASTILLE AFFICHE L'ÉTAT DÉRIVÉ, pas un état stocké", () => {
  const rendre = (semaineValidee: string | null, aujourdhui: string) =>
    texteRendu(
      renderToString(
        createElement(PilluleVerification, {
          semaineValidee,
          aujourdhui,
          semaineCourante: cleDeSemaine(aujourdhui),
          onBasculer: () => {},
        }),
      ),
    );

  assert.ok(rendre(LUNDI, MERCREDI).includes(LIBELLES_VERIFICATION["a-jour"]));
  assert.ok(rendre(LUNDI, LUNDI_SUIVANT).includes(LIBELLES_VERIFICATION["a-verifier"]));
  assert.ok(rendre(null, MERCREDI).includes(LIBELLES_VERIFICATION["a-verifier"]));

  // Le libellé accessible dit l'état ET l'action, jamais la couleur.
  const html = rendre(LUNDI, MERCREDI);
  assert.ok(/aria-pressed="true"/.test(html));
  assert.ok(!/vert|rouge|orange/i.test(html), "aucune couleur dans le texte accessible");
});

test("10. LE PENSE-BÊTE N'ÉCRIT QUE SA PROPRE TABLE", () => {
  const depot = lire("../../lib/supabase/verification-programme.ts");
  const corps = depot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const tables = [...corps.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(tables)],
    ["program_review_flags"],
    "toucher `programs` bougerait son `updated_at`, que la sauvegarde du builder surveille",
  );
  for (const interdit of ["workout_sessions", "workout_feedback", "notification"]) {
    assert.ok(!corps.includes(interdit), `le pense-bête ne doit pas connaître ${interdit}`);
  }
});

test("11. LA MIGRATION CRÉE UNE TABLE, ET NE TOUCHE À RIEN D'AUTRE", () => {
  const sql = lire("../../supabase/migrations/20260926090000_program_review_flags.sql");
  assert.ok(/create table if not exists public\.program_review_flags/.test(sql));
  assert.ok(/verified_week date not null/.test(sql), "la semaine est stockée, pas un booléen");
  assert.ok(/enable row level security/.test(sql));
  assert.ok(/is_coach_or_admin\(\)/.test(sql), "la policy doit réserver la table au staff");

  const instructions = sql.replace(/--.*$/gm, "");
  assert.ok(
    !/alter table public\.programs/.test(instructions),
    "aucune colonne ajoutée à `programs` : le drapeau ne fait pas partie du programme",
  );
  assert.ok(!/drop /i.test(instructions), "aucune suppression");
  assert.ok(!/create trigger/i.test(instructions), "aucun trigger");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);

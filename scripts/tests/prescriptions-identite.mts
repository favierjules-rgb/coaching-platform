/*
 * ════════════════════════════════════════════════════════════════════════════
 * L'IDENTITÉ DES PRESCRIPTIONS CARDIO, DU BUILDER JUSQU'À LA CHARGE RPC
 * ════════════════════════════════════════════════════════════════════════════
 * Lot D du chantier feat/entrainement-performances.
 *
 * Ce que ces tests mesurent, et pourquoi chacun existe :
 *
 *   · `serializeBlock` transmet l'identifiant RÉEL d'une prescription
 *     existante. Il le JETAIT : le serveur ne pouvait alors que supprimer puis
 *     réinsérer tout le bloc, d'où des `id` qui changeaient à chaque
 *     enregistrement et les 228 retours d'exercice orphelins de production.
 *
 *   · `duplicateBlock` donne à chaque prescription dupliquée un identifiant
 *     temporaire RECONNAISSABLE comme tel. Il donnait un `crypto.randomUUID()`
 *     NU, indiscernable d'un identifiant persisté : le serveur le cherchait sur
 *     ce bloc, ne le trouvait pas, et levait `FOREIGN_PRESCRIPTION_ID`. Mesuré
 *     sur le banc SQL : dupliquer une semaine échouait, 3 passages sur 3.
 *
 *   · le traitement de `id_mapping.prescriptions` — ce que le client en fait
 *     RÉELLEMENT, qui n'est pas ce qu'on pourrait croire (voir la section 4).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isNewPrescriptionId,
  isUuid,
  makeNewPrescriptionId,
  normalizeTrainingPrescriptionId,
} from "../../lib/training-blocks";
import { regenerateBlockIdsForDuplication } from "../../lib/training-block-editing";
import { buildCanonicalSessionBlocksInput } from "../../lib/supabase/training-session-blocks";
import type { AdminCardioSegment, TrainingBlock } from "../../types";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/** Le code débarrassé de sa prose : les assertions « ce mot n'apparaît pas »
 *  ne doivent pas attraper un commentaire qui, lui, a le droit de le citer. */
const sansProse = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const UUID_REEL_1 = "11111111-1111-4111-8111-111111111111";
const UUID_REEL_2 = "22222222-2222-4222-8222-222222222222";

function segment(id: string, titre = "Segment"): AdminCardioSegment {
  return {
    id,
    order: 0,
    segmentType: "work",
    title: titre,
    durationSeconds: 600,
    intensityTargetType: "heart_rate_percentage",
    targetHrPercentage: 70,
    targetZone: 4,
    targetPowerPercentage: 85,
  } as AdminCardioSegment;
}

function blocCardio(segments: AdminCardioSegment[], id = UUID_REEL_1): TrainingBlock {
  return {
    id,
    category: "cardio",
    title: "Bloc cardio",
    colorKey: "green",
    position: 0,
    cardioType: "continuous_run",
    prescriptions: segments,
  } as unknown as TrainingBlock;
}

/* ═══════════ 1. LA GRAMMAIRE DES IDENTIFIANTS ═══════════ */

await test("1. `makeNewPrescriptionId` produit un identifiant temporaire reconnaissable", () => {
  const id = makeNewPrescriptionId(() => UUID_REEL_1);
  assert.equal(id, `new-prescription:${UUID_REEL_1}`);
  assert.ok(isNewPrescriptionId(id), "il doit être reconnaissable comme temporaire");
  assert.equal(isUuid(id), false, "et ne JAMAIS passer pour un UUID persisté");
});

await test("2. la normalisation conserve le réel et convertit le reste", () => {
  // Un UUID réel traverse intact : c'est lui qui dit « mets cette ligne à jour ».
  assert.equal(normalizeTrainingPrescriptionId(UUID_REEL_1), UUID_REEL_1);
  // Un temporaire déjà formé n'est pas reforgé — sinon deux appels successifs
  // donneraient deux identités à la même ligne.
  const deja = `new-prescription:${UUID_REEL_2}`;
  assert.equal(normalizeTrainingPrescriptionId(deja), deja);
  // Un identifiant local du builder (`generateId("seg")`) devient temporaire.
  const local = normalizeTrainizedOrFallback("seg-1761000000-3");
  assert.ok(isNewPrescriptionId(local), "un id local doit devenir temporaire");
  // Et l'absence d'identifiant aussi, plutôt que de partir `undefined`.
  assert.ok(isNewPrescriptionId(normalizeTrainingPrescriptionId(undefined)));
  assert.ok(isNewPrescriptionId(normalizeTrainingPrescriptionId(null)));
  assert.ok(isNewPrescriptionId(normalizeTrainingPrescriptionId("")));
});

function normalizeTrainizedOrFallback(id: string): string {
  return normalizeTrainingPrescriptionId(id);
}

/* ═══════════ 2. `serializeBlock` TRANSMET L'IDENTITÉ RÉELLE ═══════════ */

await test("3. la charge RPC porte l'identifiant RÉEL d'une prescription existante", () => {
  const entree = buildCanonicalSessionBlocksInput({
    sessionId: UUID_REEL_2,
    expectedUpdatedAt: "2026-10-25T00:00:00.000Z",
    blocks: [blocCardio([segment(UUID_REEL_1, "Existante")])],
  });
  const bloc = entree.blocks[0] as unknown as { prescriptions: { id: string }[] };
  assert.equal(bloc.prescriptions[0]?.id, UUID_REEL_1,
    "l'UUID persisté doit traverser l'adaptateur sans être reforgé");
});

await test("4. une prescription NEUVE part avec un identifiant temporaire strict", () => {
  const entree = buildCanonicalSessionBlocksInput({
    sessionId: UUID_REEL_2,
    expectedUpdatedAt: "2026-10-25T00:00:00.000Z",
    blocks: [blocCardio([segment("seg-1761000000-7", "Neuve")])],
  });
  const bloc = entree.blocks[0] as unknown as { prescriptions: { id: string }[] };
  const id = bloc.prescriptions[0]?.id ?? "";
  assert.ok(isNewPrescriptionId(id), `attendu new-prescription:…, obtenu ${id}`);
  assert.ok(isUuid(id.slice("new-prescription:".length)), "le suffixe doit être un UUID");
});

await test("5. le sérialiseur envoie bien la clé `id`, et les 25 champs avec elle", () => {
  /*
   * ⚠️ LA PRÉSENCE DE CHAQUE CLÉ COMPTE MAINTENANT. Le serveur garde la valeur
   * en base pour toute clé ABSENTE (`case when v_prescription ? 'clé'`) : une
   * clé oubliée ici ne serait donc plus jamais mise à jour, et rien ne le
   * signalerait — l'ancienne valeur resterait, plausible.
   */
  const code = sansProse(lire("../../lib/supabase/training-session-blocks.ts"));
  const debut = code.indexOf("prescriptions: block.prescriptions.map");
  assert.ok(debut > -1, "le sérialiseur des prescriptions doit exister");
  const bloc = code.slice(debut, debut + 1800);
  assert.match(bloc, /\bid: normalizeTrainingPrescriptionId\(seg\.id\)/,
    "`serializeBlock` doit envoyer l'identifiant");
  for (const cle of [
    "segment_type", "title", "repetitions", "work_duration_seconds", "distance_meters",
    "elevation_gain_meters", "incline_percentage", "recovery_duration_seconds",
    "recovery_distance_meters", "intensity_target_type", "target_vma_percentage",
    "target_speed_kmh", "target_pace_seconds_per_km", "target_hr_percentage",
    "target_hr_zone", "target_power_watts", "target_cadence", "intensity_min",
    "intensity_max", "target_zone", "target_power_percentage", "surface", "terrain",
    "equipment_type", "coach_notes",
  ]) {
    assert.ok(bloc.includes(`${cle}:`), `clé absente de la charge : ${cle}`);
  }
});

/* ═══════════ 3. LA DUPLICATION NE RÉUTILISE AUCUN IDENTIFIANT PERSISTÉ ═══════════ */

await test("6. dupliquer un bloc cardio régénère TOUS les ids de prescription", () => {
  const source = blocCardio([segment(UUID_REEL_1, "A"), segment(UUID_REEL_2, "B")]);
  let n = 0;
  const copies = regenerateBlockIdsForDuplication([source], () => {
    n += 1;
    return `0000000${n}-1111-4111-8111-11111111111${n}`;
  });
  const copie = copies[0] as unknown as { id: string; prescriptions: { id: string; order: number }[] };

  assert.ok(copie.id.startsWith("new-block:"), "le bloc copié est temporaire");
  for (const p of copie.prescriptions) {
    assert.ok(isNewPrescriptionId(p.id), `prescription copiée non temporaire : ${p.id}`);
    assert.equal(isUuid(p.id), false, "elle ne doit jamais ressembler à un id persisté");
  }
  // ⚠️ LE CŒUR DU DÉFAUT : aucun identifiant de la SOURCE ne doit réapparaître.
  const idsSource = [UUID_REEL_1, UUID_REEL_2];
  for (const p of copie.prescriptions) {
    assert.ok(!idsSource.some((s) => p.id.includes(s)),
      `l'identifiant persisté de la source est réutilisé : ${p.id}`);
  }
  assert.deepEqual(copie.prescriptions.map((p) => p.order), [0, 1], "l'ordre est renuméroté");
});

await test("7. la source reste INTACTE après duplication", () => {
  const source = blocCardio([segment(UUID_REEL_1, "A")]);
  regenerateBlockIdsForDuplication([source]);
  const inchange = source as unknown as { prescriptions: { id: string }[] };
  assert.equal(inchange.prescriptions[0]?.id, UUID_REEL_1,
    "dupliquer ne doit pas muter le bloc d'origine");
});

await test("8. `duplicateBlock` n'appelle plus `gen()` nu pour les prescriptions", () => {
  const code = sansProse(lire("../../lib/training-block-editing.ts"));
  assert.ok(!/\{ \.\.\.prescription, id: gen\(\), order: index \}/.test(code),
    "le `gen()` nu — indiscernable d'un UUID persisté — doit avoir disparu");
  assert.match(code, /id: makeNewPrescriptionId\(gen\)/,
    "la duplication doit forger un identifiant temporaire strict");
});

/* ═══════════ 4. CE QUE LE CLIENT FAIT DE `id_mapping.prescriptions` ═══════════ */

await test("9. `id_mapping.prescriptions` est LU et propagé, avec un repli explicite", () => {
  /*
   * ⚠️ `undefined` ET `{}` NE VEULENT PAS DIRE LA MÊME CHOSE, et c'est pour
   * cela qu'il n'y a pas de `?? {}` ici. `undefined` = la base n'a pas encore
   * la migration 20261029090000 ; `{}` = elle l'a, et cet appel n'a créé aucune
   * prescription. Confondre les deux ferait croire à un client futur qu'il peut
   * toujours réconcilier.
   */
  const tsb = sansProse(lire("../../lib/supabase/training-session-blocks.ts"));
  assert.match(tsb, /prescriptions:\s*\n?\s*idMapping\.prescriptions === undefined/,
    "la lecture doit distinguer `undefined` de l'objet vide");
  const tps = sansProse(lire("../../lib/supabase/training-program-save.ts"));
  assert.match(tps, /prescriptions: s\.id_mapping\?\.prescriptions,/,
    "la RPC groupée doit propager la correspondance sans la vider");
  assert.ok(!/prescriptions: s\.id_mapping\?\.prescriptions \?\? \{\}/.test(tps),
    "pas de `?? {}` : il écraserait la distinction");
});

await test("10. la RÉCONCILIATION passe par la relecture, et c'est documenté", () => {
  /*
   * ⚠️ CE TEST CONSTATE L'ARCHITECTURE RÉELLE PLUTÔT QUE CELLE QU'ON IMAGINE.
   * Aucun composant ne consomme `idMapping` : sur un succès, la page remplace
   * son instantané et incrémente `builderRevision`, ce qui change la `key` du
   * builder et le réinitialise depuis les données FRAÎCHES — donc avec les
   * identifiants réels. Les identifiants temporaires sont donc remplacés par la
   * relecture, pas par la correspondance.
   *
   * Si cette architecture changeait, ce test rougirait — et c'est voulu : il
   * faudrait alors brancher la correspondance pour de bon.
   */
  const page = lire("../../app/admin/programmes/[programId]/builder/page.tsx");
  assert.match(page, /refetch: \(\) => supabaseProgram\.refetch\(\)/,
    "la page relit la programmation après un enregistrement");
  /*
   * ⚠️ LA DÉCISION A ÉTÉ EXTRAITE HORS DE REACT (gestionnaire
   * `executerSauvegardeDeLaPage`). La page écrit toujours l'instantané, mais
   * depuis l'état rendu par le gestionnaire, et SEULEMENT s'il a changé.
   * L'invariant « seul un succès remplace l'instantané ET incrémente la
   * révision » est vérifié pour de vrai sur `nextBuilderState`, dans
   * reprise-interface-desynchronisee (E1) et reprise-relecture-echouee (7).
   */
  assert.match(page, /setSavedProgram\(etat\.program\)/, "elle remplace son instantané");
  assert.match(page, /executerSauvegardeDeLaPage\(\{/, "via le gestionnaire extrait, testé directement");
  /*
   * ⚠️ ET LA RELECTURE N'EST PLUS LE SEUL CHEMIN DE RÉCONCILIATION : quand elle
   * ÉCHOUE, la page refuse désormais toute nouvelle sauvegarde jusqu'à une
   * resynchronisation explicite. C'est ce qui rend sûr le fait de ne pas
   * brancher `idMapping` — sans cette garde, la protection reposait uniquement
   * sur le verrou optimiste. Voir reprise-interface-desynchronisee A4 et B1.
   */
  assert.match(page, /executerResynchronisationDeLaPage\(\{/,
    "et une resynchronisation explicite existe quand la relecture a échoué");
  assert.match(page, /setBuilderRevision\(etat\.revision\)/, "et incrémente la révision");
  assert.match(page, /key=\{`\$\{activeProgram\.id\}:\$\{builderRevision\}`\}/,
    "la `key` dépend de la révision : le builder se réinitialise sur les données fraîches");

  // Et personne ne consomme encore la correspondance : état constaté, pas souhaité.
  for (const f of [
    "../../components/admin/ProgramBuilderFullscreen.tsx",
    "../../app/admin/programmes/[programId]/builder/page.tsx",
    "../../lib/supabase/programs.ts",
  ]) {
    assert.ok(!/idMapping/.test(sansProse(lire(f))),
      `${f} consomme idMapping : la réconciliation a changé, ce test doit être revu`);
  }
});

/* ═══════════ 5. LA MIGRATION ET LE CLIENT DISENT LA MÊME CHOSE ═══════════ */

await test("11. la migration accepte exactement la grammaire que le client émet", () => {
  const sql = lire("../../supabase/migrations/20261029090000_training_prescriptions_synchronisation_differentielle.sql");
  /*
   * ⚠️ LES ASSERTIONS « CE MOT N'APPARAÎT PLUS » PORTENT SUR LE CODE SQL, pas
   * sur le fichier brut. L'en-tête de cette migration CITE l'ancien
   * `delete from … where block_id = v_block_uuid;` — c'est ce qu'elle
   * remplace, et l'expliquer est son rôle. Mesurer le fichier entier rendait
   * le test rouge alors que la migration était juste : exactement la faute que
   * j'avais déjà commise sur `statement_timeout`.
   *
   * `codeSql` retire les lignes de commentaire `--` et les blocs d'étoiles,
   * sans toucher aux chaînes du corps. La vérification interne de la migration,
   * elle, interroge `prosrc` : le corps compilé, déjà sans commentaires.
   */
  const codeSql = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*--.*$/gm, " ");
  /*
   * ⚠️ ET LE « DELETE A DISPARU » SE MESURE DANS LE CORPS DE LA FONCTION, pas
   * dans le fichier. La migration porte elle-même un garde-fou
   * `if v_src like '%delete from … v_block_uuid;%' then raise exception …` :
   * la chaîne figure donc légitimement dans le code, en tant que MOTIF
   * RECHERCHÉ. Mon assertion l'attrapait et rougissait sur le garde-fou qui
   * protège exactement la propriété qu'elle voulait vérifier.
   */
  const debutCorps = sql.indexOf("as $fn$");
  const finCorps = sql.indexOf("$fn$;", debutCorps);
  assert.ok(debutCorps > -1 && finCorps > debutCorps, "le corps de la fonction doit être délimité");
  const corps = sql.slice(debutCorps, finCorps);
  assert.ok(sql.includes("new-prescription:"), "le serveur connaît le préfixe temporaire");
  assert.ok(sql.includes("INVALID_NEW_PRESCRIPTION_ID"), "suffixe non UUID refusé");
  assert.ok(sql.includes("DUPLICATE_TEMP_PRESCRIPTION_ID"), "doublon d'id temporaire refusé");
  assert.ok(sql.includes("UNRECOGNIZED_PRESCRIPTION_ID"), "forme inconnue refusée");
  assert.ok(sql.includes("FOREIGN_PRESCRIPTION_ID"), "id d'un autre bloc refusé");
  assert.ok(sql.includes("'prescriptions', v_presc_map"), "la correspondance est rendue");
  // Le DELETE inconditionnel a disparu, la suppression est bornée.
  assert.ok(!corps.includes("delete from public.training_prescriptions where block_id = v_block_uuid;"),
    "le DELETE inconditionnel ne doit plus être dans le CORPS de la fonction");
  assert.ok(corps.includes("id <> all(v_kept_presc_uuids)"), "la suppression est bornée aux lignes retirées");
  // Et le garde-fou de la migration, qui cherche ce DELETE, doit être présent.
  assert.match(sql, /if v_src like '%delete from public\.training_prescriptions where block_id = v_block_uuid;%' then/,
    "la migration doit vérifier elle-même que le DELETE a disparu");
  assert.ok(!/statement_timeout/i.test(codeSql), "aucune manipulation de statement_timeout");
});

await test("12. chacune des 25 colonnes porte sa garde de présence", () => {
  /*
   * Sans `case when v_prescription ? 'clé'`, une clé absente de la charge
   * mettrait sa colonne à NULL : une charge partielle effacerait tout ce
   * qu'elle ne mentionne pas. On compte, plutôt que de faire confiance.
   */
  const sql = lire("../../supabase/migrations/20261029090000_training_prescriptions_synchronisation_differentielle.sql");
  const debut = sql.indexOf("update public.training_prescriptions set");
  const fin = sql.indexOf("where id = v_presc_uuid", debut);
  assert.ok(debut > -1 && fin > debut, "l'UPDATE des prescriptions doit exister");
  const gardes = sql.slice(debut, fin).match(/case when v_prescription \? '[a-z_]+' then/g) ?? [];
  assert.equal(gardes.length, 25,
    `gardes de présence : ${gardes.length} au lieu de 25 — une colonne non gardée serait effacée`);
  // Les parents ne sont jamais dans le SET.
  assert.ok(!/\bblock_id\s*=/.test(sql.slice(debut, fin)), "block_id ne doit pas être modifié");
  assert.ok(!/\bexercise_id\s*=/.test(sql.slice(debut, fin)), "exercise_id ne doit pas être modifié");
});

await test("13. la migration est déclarée au contrat et au manifeste", () => {
  const contrat = lire("../../scripts/tests/contrat-migrations.mts");
  assert.match(contrat, /NOMBRE_DE_MIGRATIONS = 123/, "le compte attendu doit suivre");
  assert.match(contrat, /MIGRATION_PRESCRIPTIONS_DIFF/, "la migration doit être nommée");
  assert.match(contrat, /20261029090000_training_prescriptions_synchronisation_differentielle\.sql/);
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json")) as {
    migrations_post_baseline_attendues: string[];
  };
  assert.ok(
    manifeste.migrations_post_baseline_attendues.includes(
      "20261029090000_training_prescriptions_synchronisation_differentielle.sql",
    ),
    "sans cette déclaration, security-hardening rougit",
  );
});

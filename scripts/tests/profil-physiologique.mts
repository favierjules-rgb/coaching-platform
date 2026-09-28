/**
 * Harnais — LA FICHE PHYSIOLOGIQUE S'ENREGISTRE VRAIMENT, ET N'ATTEINT QU'UN
 * SEUL ATHLÈTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER REFUSE DE LAISSER PASSER
 * ════════════════════════════════════════════════════════════════════════
 *   1. une colonne écrite qu'AUCUNE migration ne crée — l'UPDATE partirait,
 *      PostgREST refuserait la requête ENTIÈRE, et l'écran dirait « enregistré »
 *      si personne ne comptait les lignes ;
 *   2. « Réinitialiser mes zones iDO » qui toucherait une référence
 *      physiologique (VMA, FTP, PMA, FCmax, FC repos, poids) ;
 *   3. une écriture sur Jules qui modifierait Marco ;
 *   4. une borne de zone personnalisée inversée, ou posée sur une zone que le
 *      barème déclare non significative ;
 *   5. une provenance « estimée » laissée orpheline sur un champ vidé ;
 *   6. une estimation physiologique réintroduite (Karvonen, FCmax depuis
 *      l'âge, VO2max depuis la VMA).
 *
 * Lancement : npm run test:profil-physiologique
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  ageAffiche,
  CHAMPS_PHYSIO,
  champsDuGroupe,
  ecritureDepuisSaisie,
  provenancesDepuisPhysiologie,
  saisieDepuisPhysiologie,
} from "../../lib/physiologie-champs";
import {
  enregistrerPhysiologie,
  enregistrerReglagesZones,
  lirePhysiologie,
  physiologieDepuisLigne,
  PHYSIOLOGIE_VIDE,
  referencesDepuisPhysiologie,
} from "../../lib/supabase/physiologie";
import {
  avecBornes,
  bornesAppliquees,
  bornesDeReference,
  cleSaisie,
  estPersonnalisee,
  famillesDuSport,
  possedeUnePersonnalisation,
  reglagesDepuisSaisie,
  saisieDepuisReglages,
} from "../../lib/zones-personnalisation";
import { reinitialiserZones, tableauZones, type ReglagesZones } from "../../lib/zones-physiologiques";

const RACINE = new URL("../../", import.meta.url).pathname;
const lireSource = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const sansCommentaires = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

let réussis = 0;
let échecs = 0;
async function test(nom: string, fn: () => void | Promise<void>) {
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

/* ════════════════════════════════════════════════════════════════════════
 * LE DOUBLE POSTGREST — même sémantique que scripts/tests/persistance-date-debut
 * ════════════════════════════════════════════════════════════════════════ */

type Ligne = Record<string, unknown>;

function creerBase() {
  const tables = new Map<string, Ligne[]>();
  const ordres: { table: string; op: string; valeurs: Ligne; filtres: [string, unknown][] }[] = [];
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom) as Ligne[];
  };

  function from(nom: string) {
    const état: {
      op: "select" | "update";
      valeurs?: Ligne;
      filtres: [string, unknown][];
      representation: boolean;
    } = { op: "select", filtres: [], representation: false };
    const correspond = (l: Ligne) => état.filtres.every(([c, v]) => l[c] === v);

    const exécuter = (): Ligne[] => {
      const lignes = table(nom);
      if (état.op === "select") return lignes.filter(correspond).map((l) => ({ ...l }));
      ordres.push({ table: nom, op: "update", valeurs: { ...(état.valeurs ?? {}) }, filtres: [...état.filtres] });
      const touchées = lignes.filter(correspond);
      for (const l of touchées) Object.assign(l, état.valeurs);
      // ⚠️ AUCUNE ERREUR SUR ZÉRO LIGNE — sémantique réelle de PostgREST.
      return touchées.map((l) => ({ ...l }));
    };

    const chaîne: Record<string, unknown> = {
      select: () => {
        état.representation = true;
        return chaîne;
      },
      update(v: Ligne) {
        état.op = "update";
        état.valeurs = v;
        return chaîne;
      },
      eq(c: string, v: unknown) {
        état.filtres.push([c, v]);
        return chaîne;
      },
      maybeSingle: () => Promise.resolve({ data: exécuter()[0] ?? null, error: null }),
      then: (résoudre: (v: { data: Ligne[] | null; error: null }) => void) => {
        const lignes = exécuter();
        const rendable = état.op === "select" || état.representation;
        return Promise.resolve(résoudre({ data: rendable ? lignes : null, error: null }));
      },
    };
    return chaîne;
  }

  return { client: { from } as never, table, ordres };
}

/** Deux athlètes, deux profils — le décor de tous les tests d'isolation. */
function decorDeuxAthletes() {
  const base = creerBase();
  base.table("student_profiles").push({
    id: "profil-jules", student_id: "jules",
    current_weight_kg: 72, height_cm: 178, hr_resting: 48, hr_max: 190,
    vma_kmh: 11, ftp_watts: 210, pma_watts: 320,
    physio_sources: { hr_max: "estimee" }, zone_settings: null, physio_updated_at: null,
  });
  base.table("student_profiles").push({
    id: "profil-marco", student_id: "marco",
    current_weight_kg: 81, height_cm: 184, hr_resting: 52, hr_max: 186,
    vma_kmh: 16.5, ftp_watts: 280, pma_watts: 390,
    physio_sources: {}, zone_settings: { fc: { 2: [70, 80] } }, physio_updated_at: null,
  });
  return base;
}

/* ════════════════════════════════════════════════════════════════════════
 * I. LECTURE
 * ════════════════════════════════════════════════════════════════════════ */

await test("LECTURE1. une ligne absente rend le profil vide, jamais une exception", () => {
  assert.deepEqual(physiologieDepuisLigne(null), PHYSIOLOGIE_VIDE);
});

await test("LECTURE2. AVANT la migration : les colonnes manquantes valent null, les autres sont lues", () => {
  // La ligne telle que la base la rend AUJOURD'HUI (migration non appliquée) :
  // ni `sex`, ni `pma_watts`, ni `zone_settings`.
  const physio = physiologieDepuisLigne({
    student_id: "jules", current_weight_kg: 72, hr_max: 190, vma_kmh: 11, ftp_watts: 210,
  });
  assert.equal(physio.hrMax, 190);
  assert.equal(physio.vmaCourseKmh, 11);
  assert.equal(physio.ftpWatts, 210);
  assert.equal(physio.sex, null, "une colonne absente ne doit pas devenir une chaîne");
  assert.equal(physio.pmaWatts, null);
  assert.equal(physio.reglagesZones, null);
  assert.deepEqual(physio.sources, {});
});

await test("LECTURE3. une source inconnue est ignorée, pas devinée", () => {
  const physio = physiologieDepuisLigne({
    hr_max: 190, physio_sources: { hr_max: "estimee", vma_kmh: "devinee", ftp_watts: 42 },
  });
  assert.deepEqual(physio.sources, { hr_max: "estimee" });
});

await test("LECTURE4. un zone_settings corrompu redevient le barème, jamais un objet à moitié appliqué", () => {
  for (const corrompu of [
    { fc: { 2: [70] } },
    { fc: { 2: ["70", "80"] } },
    { fc: { 9: [70, 80] } },
    { vmaCourse: "n'importe quoi" },
    [1, 2, 3],
    "texte",
  ]) {
    assert.equal(physiologieDepuisLigne({ zone_settings: corrompu }).reglagesZones, null, JSON.stringify(corrompu));
  }
  // Une borne valide, elle, passe.
  assert.deepEqual(physiologieDepuisLigne({ zone_settings: { fc: { 2: [74, 84] } } }).reglagesZones, {
    fc: { 2: [74, 84] } as never,
  });
});

await test("LECTURE5. la provenance par défaut est « mesurée », jamais « estimée »", () => {
  const references = referencesDepuisPhysiologie(
    physiologieDepuisLigne({ hr_max: 190, vma_kmh: 11, physio_sources: { hr_max: "estimee" } }),
  );
  assert.equal(references.fcMax.source, "estimee");
  assert.equal(references.vmaCourseKmh.source, "mesuree", "une valeur saisie sans mention est MESURÉE");
  assert.equal(references.pmaWatts.source, "absente");
});

await test("LECTURE6. lirePhysiologie ne rend QUE l'athlète nommé", async () => {
  const base = decorDeuxAthletes();
  const jules = await lirePhysiologie(base.client, "jules");
  assert.equal(jules.erreur, null);
  assert.equal(jules.physio.vmaCourseKmh, 11);
  const marco = await lirePhysiologie(base.client, "marco");
  assert.equal(marco.physio.vmaCourseKmh, 16.5);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. ÉCRITURE
 * ════════════════════════════════════════════════════════════════════════ */

await test("ECRITURE1. la valeur arrive en base et physio_updated_at est posé", async () => {
  const base = decorDeuxAthletes();
  const resultat = await enregistrerPhysiologie(base.client, "jules", {
    colonnes: { vma_kmh: 12.5 },
    sources: { vma_kmh: "mesuree" },
  });
  assert.equal(resultat.ok, true);
  const jules = base.table("student_profiles").find((l) => l.student_id === "jules") as Ligne;
  assert.equal(jules.vma_kmh, 12.5);
  assert.deepEqual(jules.physio_sources, { vma_kmh: "mesuree" });
  assert.ok(typeof jules.physio_updated_at === "string", "la traçabilité est écrite");
});

await test("ECRITURE2. ISOLATION — écrire Jules ne touche pas Marco", async () => {
  const base = decorDeuxAthletes();
  const avant = { ...(base.table("student_profiles").find((l) => l.student_id === "marco") as Ligne) };
  await enregistrerPhysiologie(base.client, "jules", { colonnes: { vma_kmh: 12.5, hr_max: 195 } });
  const apres = base.table("student_profiles").find((l) => l.student_id === "marco") as Ligne;
  assert.deepEqual(apres, avant, "Marco doit être intact, à l'octet près");
  // Et l'ordre émis ne nomme QUE `student_id = jules`.
  const ordre = base.ordres.at(-1);
  assert.deepEqual(ordre?.filtres, [["student_id", "jules"]]);
});

await test("ECRITURE3. zéro ligne touchée = ÉCHEC, jamais un faux succès", async () => {
  const base = decorDeuxAthletes();
  const resultat = await enregistrerPhysiologie(base.client, "inconnu", { colonnes: { vma_kmh: 12 } });
  assert.equal(resultat.ok, false);
  assert.match(String(resultat.erreur), /aucun profil/);
});

await test("ECRITURE4. l'ordre demande la représentation — sans `select`, rien n'est comptable", () => {
  const source = sansCommentaires(lireSource("lib/supabase/physiologie.ts"));
  const occurrences = source.match(/\.select\("id"\)/g) ?? [];
  assert.ok(occurrences.length >= 2, "chaque UPDATE doit demander la représentation");
  assert.ok(/lignes\.length === 0/.test(source), "le nombre de lignes touchées est vérifié");
});

/* ════════════════════════════════════════════════════════════════════════
 * III. « RÉINITIALISER MES ZONES iDO »
 * ════════════════════════════════════════════════════════════════════════ */

await test("RESET1. la réinitialisation est un EFFACEMENT, pas une réécriture du barème", () => {
  assert.deepEqual(reinitialiserZones(), {});
});

await test("RESET2. l'ordre émis ne nomme QUE zone_settings", async () => {
  const base = decorDeuxAthletes();
  const resultat = await enregistrerReglagesZones(base.client, "marco", reinitialiserZones());
  assert.equal(resultat.ok, true);
  const ordre = base.ordres.at(-1);
  assert.deepEqual(Object.keys(ordre?.valeurs ?? {}), ["zone_settings"]);
  assert.equal(ordre?.valeurs.zone_settings, null);
});

await test("RESET3. AUCUNE référence physiologique n'est perdue par la réinitialisation", async () => {
  const base = decorDeuxAthletes();
  const avant = { ...(base.table("student_profiles").find((l) => l.student_id === "marco") as Ligne) };
  await enregistrerReglagesZones(base.client, "marco", reinitialiserZones());
  const apres = base.table("student_profiles").find((l) => l.student_id === "marco") as Ligne;
  for (const colonne of [
    "vma_kmh", "ftp_watts", "pma_watts", "hr_max", "hr_resting", "current_weight_kg", "height_cm",
  ]) {
    assert.equal(apres[colonne], avant[colonne], `${colonne} a été touchée par la réinitialisation`);
  }
  assert.equal(apres.zone_settings, null, "seules les zones sont effacées");
});

await test("RESET4. ISOLATION — réinitialiser Marco laisse les zones de Jules intactes", async () => {
  const base = creerBase();
  base.table("student_profiles").push({ id: "p1", student_id: "jules", zone_settings: { fc: { 2: [74, 84] } } });
  base.table("student_profiles").push({ id: "p2", student_id: "marco", zone_settings: { fc: { 3: [86, 90] } } });
  await enregistrerReglagesZones(base.client, "marco", reinitialiserZones());
  const jules = base.table("student_profiles").find((l) => l.student_id === "jules") as Ligne;
  assert.deepEqual(jules.zone_settings, { fc: { 2: [74, 84] } });
});

await test("RESET5. le bouton de l'écran passe par ce chemin et par aucun autre", () => {
  const source = sansCommentaires(lireSource("components/admin/physio/TableauZonesSport.tsx"));
  assert.match(source, /Réinitialiser mes zones iDO/, "le libellé exact de la capture");
  assert.match(source, /onReinitialiser\(\)/, "le bouton appelle la réinitialisation");
  const hook = sansCommentaires(lireSource("hooks/usePhysiologieEleve.ts"));
  assert.match(hook, /enregistrerZones\(reinitialiserZones\(\)\)/);
  assert.ok(
    !/reinitialiser[\s\S]{0,400}enregistrerPhysiologie/.test(hook),
    "la réinitialisation ne doit jamais passer par l'écriture des références",
  );
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. PERSONNALISATION DES BORNES
 * ════════════════════════════════════════════════════════════════════════ */

await test("PERSO1. une borne posée s'applique, une borne remise au barème DISPARAÎT", () => {
  const avec = avecBornes({}, "vmaCourse", 3, [72, 86]);
  assert.deepEqual(avec, { vmaCourse: { 3: [72, 86] } });
  assert.equal(estPersonnalisee("vmaCourse", 3, avec), true);
  const revenu = avecBornes(avec, "vmaCourse", 3, bornesDeReference("vmaCourse", 3) as [number, number]);
  assert.deepEqual(revenu, {}, "retour au barème = plus aucun réglage, donc l'athlète suit le barème futur");
  assert.equal(possedeUnePersonnalisation(revenu), false);
});

await test("PERSO2. la personnalisation change réellement les vitesses calculées", () => {
  const references = referencesDepuisPhysiologie(physiologieDepuisLigne({ vma_kmh: 11, hr_max: 190, hr_resting: 48 }));
  const barème = tableauZones("course", references);
  const perso = tableauZones("course", references, { vmaCourse: { 3: [72, 86] } } as ReglagesZones);
  assert.equal(barème[2].libellePourcentages, "70% - 85%");
  assert.equal(perso[2].libellePourcentages, "72% - 86%");
  assert.notEqual(perso[2].vitesse.libelle, barème[2].vitesse.libelle);
  // Les autres zones ne bougent pas.
  assert.equal(perso[1].vitesse.libelle, barème[1].vitesse.libelle);
});

await test("PERSO3. une borne inversée ou vide est REFUSÉE, et rien n'est enregistré", () => {
  const saisie = saisieDepuisReglages("course", {});
  /*
   * ⚠️ UNE BORNE VALIDE ACCOMPAGNE LA BORNE REFUSÉE, ET C'EST INDISPENSABLE.
   * Sans elle, ce test passait même quand la fonction rendait les réglages
   * partiellement appliqués : toutes les autres zones valaient le barème, donc
   * l'objet rendu restait vide par coïncidence. Un sabotage l'a montré.
   */
  const inversée = {
    ...saisie,
    [cleSaisie("vmaCourse", 2)]: { min: "62", max: "72" },
    [cleSaisie("vmaCourse", 3)]: { min: "90", max: "80" },
  };
  const resultat = reglagesDepuisSaisie({}, "course", inversée);
  assert.equal(resultat.ok, false);
  assert.deepEqual(resultat.reglages, {}, "aucune borne valide ne doit passer quand une autre est refusée");
  assert.match(String(resultat.erreurs[cleSaisie("vmaCourse", 3)]), /inférieure/);

  const vide = { ...saisie, [cleSaisie("vmaCourse", 4)]: { min: "", max: "92" } };
  assert.equal(reglagesDepuisSaisie({}, "course", vide).ok, false);
});

await test("PERSO4. une saisie identique au barème ne crée AUCUN réglage", () => {
  const resultat = reglagesDepuisSaisie({}, "course", saisieDepuisReglages("course", {}));
  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.reglages, {});
});

await test("PERSO5. Z6/Z7 en FC ne sont pas personnalisables — le barème les déclare non significatives", () => {
  assert.equal(bornesDeReference("fc", 6), null);
  assert.equal(bornesDeReference("fc", 7), null);
  const saisie = { ...saisieDepuisReglages("course", {}), [cleSaisie("fc", 6)]: { min: "100", max: "110" } };
  const resultat = reglagesDepuisSaisie({}, "course", saisie);
  assert.equal(resultat.ok, true);
  assert.equal(resultat.reglages.fc?.[6], undefined, "aucune borne ne doit être inventée pour Z6");
});

await test("PERSO6. le vélo porte DEUX référentiels indépendants, %FTP et %PMA", () => {
  assert.deepEqual(famillesDuSport("velo"), ["ftp", "pma", "fc"]);
  assert.deepEqual(famillesDuSport("course"), ["vmaCourse", "fc"]);
  assert.deepEqual(famillesDuSport("natation"), ["vmaNatation", "fc"]);
  const avec = avecBornes({}, "ftp", 4, [88, 104]);
  assert.deepEqual(bornesAppliquees("pma", 4, avec), bornesDeReference("pma", 4), "modifier le FTP ne touche pas la PMA");
});

await test("PERSO7. personnaliser un sport ne modifie pas les bornes d'un autre sport", () => {
  const resultat = reglagesDepuisSaisie(
    { vmaNatation: { 3: [79, 83] } } as ReglagesZones,
    "course",
    { ...saisieDepuisReglages("course", {}), [cleSaisie("vmaCourse", 3)]: { min: "72", max: "86" } },
  );
  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.reglages.vmaNatation, { 3: [79, 83] });
  assert.deepEqual(resultat.reglages.vmaCourse, { 3: [72, 86] });
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LE FORMULAIRE
 * ════════════════════════════════════════════════════════════════════════ */

await test("CHAMPS1. chaque colonne écrite est créée par une migration du dépôt", () => {
  const dossier = join(RACINE, "supabase/migrations");
  const sql = readdirSync(dossier)
    .filter((nom) => nom.endsWith(".sql"))
    .map((nom) => readFileSync(join(dossier, nom), "utf8"))
    .join("\n");
  for (const champ of CHAMPS_PHYSIO) {
    assert.ok(
      new RegExp(`\\b${champ.colonne}\\b`).test(sql),
      `${champ.colonne} n'est créée par AUCUNE migration : l'UPDATE échouerait en entier`,
    );
  }
  // Les colonnes de trace écrites par les tests terrain suivent la même règle.
  for (const colonne of ["last_fitness_test_date", "fitness_test_protocol", "physio_sources", "zone_settings"]) {
    assert.ok(new RegExp(`\\b${colonne}\\b`).test(sql), `${colonne} absente des migrations`);
  }
});

await test("CHAMPS2. aucune colonne n'est écrite deux fois, aucune clé n'est dupliquée", () => {
  const colonnes = CHAMPS_PHYSIO.map((c) => c.colonne);
  assert.equal(new Set(colonnes).size, colonnes.length, "deux champs écriraient la même colonne");
  const cles = CHAMPS_PHYSIO.map((c) => c.cle);
  assert.equal(new Set(cles).size, cles.length);
  // Les quatre groupes sont tous servis.
  for (const groupe of ["general", "course", "velo", "natation"] as const) {
    assert.ok(champsDuGroupe(groupe).length > 0, `le groupe ${groupe} n'a aucun champ`);
  }
});

await test("CHAMPS3. un champ vidé EFFACE la donnée et retire sa provenance", () => {
  const physio = physiologieDepuisLigne({ vma_kmh: 11, hr_max: 190, physio_sources: { hr_max: "estimee" } });
  const saisie = { ...saisieDepuisPhysiologie(physio), hrMax: "" };
  const resultat = ecritureDepuisSaisie(saisie, provenancesDepuisPhysiologie(physio), physio.sources);
  assert.equal(resultat.ok, true);
  assert.equal(resultat.ecriture?.colonnes.hr_max, null);
  assert.equal(resultat.ecriture?.sources?.hr_max, undefined, "une provenance orpheline réapparaîtrait plus tard");
  assert.equal(resultat.ecriture?.colonnes.vma_kmh, 11, "les autres valeurs sont préservées");
});

await test("CHAMPS4. une valeur refusée bloque TOUT l'enregistrement", () => {
  const saisie = { ...saisieDepuisPhysiologie(PHYSIOLOGIE_VIDE), vmaCourseKmh: "11", hrMax: "abc" };
  const resultat = ecritureDepuisSaisie(saisie, {}, {});
  assert.equal(resultat.ok, false);
  assert.equal(resultat.ecriture, null, "aucune écriture partielle");
  assert.match(String(resultat.erreurs.hrMax), /Nombre/);
});

await test("CHAMPS5. une FC non entière, une valeur négative et une date mal formée sont refusées", () => {
  const base = saisieDepuisPhysiologie(PHYSIOLOGIE_VIDE);
  assert.equal(ecritureDepuisSaisie({ ...base, hrMax: "190,5" }, {}, {}).ok, false);
  assert.equal(ecritureDepuisSaisie({ ...base, hrMax: "-190" }, {}, {}).ok, false);
  assert.equal(ecritureDepuisSaisie({ ...base, vmaCourseKmh: "0" }, {}, {}).ok, false);
  assert.equal(ecritureDepuisSaisie({ ...base, birthDate: "12/05/1994" }, {}, {}).ok, false);
  assert.equal(ecritureDepuisSaisie({ ...base, sex: "autre" }, {}, {}).ok, false);
  // La virgule décimale française passe.
  const ok = ecritureDepuisSaisie({ ...base, vmaCourseKmh: "11,5" }, {}, {});
  assert.equal(ok.ok, true);
  assert.equal(ok.ecriture?.colonnes.vma_kmh, 11.5);
});

await test("CHAMPS6. « estimée » n'est enregistrée que si elle est déclarée", () => {
  const base = saisieDepuisPhysiologie(PHYSIOLOGIE_VIDE);
  const sans = ecritureDepuisSaisie({ ...base, hrMax: "190" }, {}, {});
  assert.equal(sans.ecriture?.sources?.hr_max, "mesuree");
  const avec = ecritureDepuisSaisie({ ...base, hrMax: "190" }, { hrMax: "estimee" }, {});
  assert.equal(avec.ecriture?.sources?.hr_max, "estimee");
});

await test("CHAMPS7. l'âge affiché ne sert QU'À L'AFFICHAGE — aucune FC n'en dérive", () => {
  assert.equal(ageAffiche("1994-05-12", new Date("2026-09-28T00:00:00Z")), 32);
  assert.equal(ageAffiche("1994-12-12", new Date("2026-09-28T00:00:00Z")), 31);
  assert.equal(ageAffiche(null, new Date()), null);
  assert.equal(ageAffiche("pas une date", new Date()), null);
  // Structurel : le module de calcul physiologique ne connaît pas l'âge.
  const physiologie = sansCommentaires(lireSource("lib/physiologie.ts"));
  // « pourcentage » contient « age » : la recherche doit porter sur le MOT.
  assert.ok(!/\bages?\b|\bâges?\b|birth|naissance/i.test(physiologie), "lib/physiologie.ts doit ignorer l'âge");
  assert.ok(!/220\s*-|207|Karvonen/i.test(physiologie), "une formule d'estimation de FCmax est réapparue");
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. TESTS TERRAIN
 * ════════════════════════════════════════════════════════════════════════ */

await test("TERRAIN1. enregistrer un test écrit la référence ET sa trace, sans nouvelle table", () => {
  const source = sansCommentaires(lireSource("components/admin/physio/CalculateursTests.tsx"));
  assert.match(source, /last_fitness_test_date/);
  assert.match(source, /fitness_test_protocol/);
  assert.match(source, /vma_kmh/);
  assert.match(source, /vma_swim_kmh/);
  // Les formules ne sont pas recopiées : elles sont IMPORTÉES.
  assert.match(source, /import \{[\s\S]*?vmaDepuisTest6Minutes[\s\S]*?\} from "@\/lib\/physiologie"/);
  assert.match(source, /vitesseDepuisTest400m/);
  const calculs = source.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
  assert.ok(!/1440\s*\//.test(calculs), "la formule du 400 m a été recopiée hors de lib/physiologie.ts");
  assert.ok(!/\*\s*0\.01/.test(calculs), "la formule du test 6 min a été recopiée hors de lib/physiologie.ts");
});

await test("TERRAIN2. le calcul ne s'enregistre pas tout seul", () => {
  const source = sansCommentaires(lireSource("components/admin/physio/CalculateursTests.tsx"));
  assert.ok(!/useEffect/.test(source), "un effet écrirait la VMA sans clic");
  assert.match(source, /Enregistrer comme référence/);
});

/* ════════════════════════════════════════════════════════════════════════
 * VII. LA MIGRATION RESTE NON APPLIQUÉE — et complète
 * ════════════════════════════════════════════════════════════════════════ */

await test("MIGRATION1. la migration n'élargit aucune policy et ne crée aucune table", () => {
  const brut = lireSource("supabase/migrations/20260930090000_profil_physiologique.sql");
  // Les commentaires SQL EXPLIQUENT pourquoi il n'y a ni policy ni grant : les
  // chercher dans le texte brut ferait échouer le test sur sa propre note.
  const sql = brut.replace(/^\s*--.*$/gm, " ");
  assert.ok(!/create policy|drop policy|alter policy/i.test(sql), "aucune policy touchée");
  assert.ok(!/create table/i.test(sql), "aucune table créée : student_profiles porte la donnée");
  assert.ok(!/\bgrant\b/i.test(sql), "aucun grant : authenticated a déjà ce qu'il faut");
  assert.match(sql, /add column if not exists zone_settings jsonb/);
  assert.match(sql, /add column if not exists physio_sources jsonb not null default '\{\}'::jsonb/);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

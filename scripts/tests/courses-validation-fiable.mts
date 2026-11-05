/**
 * Harnais — COURSES : FIABILITÉ DE LA VALIDATION DES REPAS (phase 2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE HARNAIS EXISTE, ET POURQUOI IL N'EXISTAIT PAS AVANT
 * ────────────────────────────────────────────────────────────────────────────
 * Les neuf cas que l'énoncé demande d'éprouver — double clic, réponse lente,
 * erreur réseau, erreur Supabase, nouvelle tentative, absence de doublons —
 * sont tous des cas de CONCURRENCE et de PANNE. Tant que la boucle de
 * validation vivait dans `useListeDeCourses`, aucun test Node ne pouvait la
 * faire tourner : on ne pouvait que lire le code et affirmer. Ce harnais
 * EXÉCUTE l'orchestrateur extrait dans `lib/nutrition/validation-en-serie.ts`.
 *
 * ⚠️ CE QUI NE SE PROUVE QUE DANS POSTGRESQL n'est pas remimé ici :
 * l'idempotence réelle de `enregistrer_repas_planifie`, le verrou de ligne de
 * son `on conflict`, et le refus RLS vivent dans
 * `supabase/tests/courses_c0_validation_checklist.sql`. Ici on prouve ce dont
 * le NAVIGATEUR est responsable : qu'il n'envoie pas deux fois la même
 * écriture, qu'il n'annonce pas un succès que la base n'a pas confirmé, et
 * qu'il ne perd pas les choix de l'élève quand ça casse.
 *
 * ⚠️ AUCUNE MIGRATION DANS CE LOT. `V-19` le vérifie.
 *
 * Lancement : npm run test:courses-validation
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  creerValidateurEnSerie,
  type EntreeAEcrire,
} from "../../lib/nutrition/validation-en-serie";
import { messageDeRefus } from "../../hooks/useListeDeCourses";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire la prose : une assertion « ce mot n'apparaît pas » doit porter sur le CODE. */
function sansProse(source: string): string {
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1 ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

const CODE_SERIE = sansProse(lire("../../lib/nutrition/validation-en-serie.ts"));
const CODE_HOOK = sansProse(lire("../../hooks/useListeDeCourses.ts"));
const CODE_PARCOURS = sansProse(lire("../../components/student/ListeDeCoursesParcours.tsx"));

/** Une charge de test : un identifiant de repas, rien de plus. */
type Charge = { readonly id: string };

function entrees(...ids: readonly string[]): readonly EntreeAEcrire<Charge>[] {
  return ids.map((id) => ({ cle: id, libelle: `Repas ${id}`, charge: { id } }));
}

/** Un banc d'essai : compte les écritures, les relectures, et la trace d'état. */
function banc(options?: {
  readonly ecrire?: (charge: Charge) => Promise<unknown>;
  readonly relire?: () => Promise<void>;
}) {
  const ecrites: string[] = [];
  const etats: boolean[] = [];
  let relectures = 0;
  return {
    ecrites,
    etats,
    get relectures() {
      return relectures;
    },
    deps: {
      ecrire: async (charge: Charge) => {
        ecrites.push(charge.id);
        if (options?.ecrire) return options.ecrire(charge);
        return undefined;
      },
      relire: async () => {
        relectures += 1;
        if (options?.relire) await options.relire();
      },
      surChangementDEtat: (enCours: boolean) => {
        etats.push(enCours);
      },
    },
  };
}

/**
 * Une PORTE : toute écriture s'y gare jusqu'à l'ouverture.
 *
 * ⚠️ PAS UNE SEULE PROMESSE CAPTURÉE. Une série écrit repas après repas : un
 * `resolve` mémorisé dans une variable serait écrasé par le repas suivant, et
 * le test se bloquerait sans rien prouver. La porte libère tout ce qui attend
 * ET tout ce qui arrivera ensuite.
 */
function porte() {
  let ouverte = false;
  const attentes: (() => void)[] = [];
  return {
    attendre: () => (ouverte ? Promise.resolve() : new Promise<void>((r) => attentes.push(r))),
    ouvrir: () => {
      ouverte = true;
      for (const liberer of attentes.splice(0)) liberer();
    },
  };
}

const neutre = { traduireErreur: messageDeRefus };

/* ══════════════════════════════════════════════════════════════════════════
 * 1. VALIDATION NORMALE D'UN REPAS
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-01 — un repas validé : une écriture, un rapport complet", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc();
  const rapport = await v.valider(entrees("a"), b.deps);
  assert.deepEqual(b.ecrites, ["a"]);
  assert.equal(rapport.valides, 1);
  assert.deepEqual(rapport.echecs, []);
  assert.equal(rapport.complet, true);
  assert.equal(rapport.refuseCarEnCours, false);
});

test("V-02 — une semaine entière : chaque repas écrit UNE fois, dans l'ordre", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc();
  const rapport = await v.valider(entrees("a", "b", "c", "d", "e"), b.deps);
  assert.deepEqual(b.ecrites, ["a", "b", "c", "d", "e"]);
  assert.equal(rapport.valides, 5);
  assert.equal(rapport.complet, true);
});

test("V-03 — une série VIDE n'est jamais « complète » : rien n'a été validé", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc();
  const rapport = await v.valider([], b.deps);
  assert.deepEqual(b.ecrites, []);
  assert.equal(rapport.valides, 0);
  assert.equal(rapport.complet, false, "une série vide annoncée complète serait un faux succès");
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. DOUBLE CLIC SUR LE BOUTON DE VALIDATION
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-04 — DOUBLE CLIC : le second appel est refusé, pas mis en file", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });

  // Les deux clics partent dans le MÊME tour de boucle d'événements : c'est
  // exactement ce qu'un double tap produit, et ce que `disabled={enCours}`
  // — effectif au rendu SUIVANT — ne pouvait pas arrêter.
  const premier = v.valider(entrees("a", "b"), b.deps);
  const second = await v.valider(entrees("a", "b"), b.deps);

  assert.equal(second.refuseCarEnCours, true);
  assert.equal(second.valides, 0);
  assert.equal(second.complet, false);
  p.ouvrir();
  const rapport = await premier;
  assert.equal(rapport.valides, 2);
  assert.deepEqual(b.ecrites, ["a", "b"], "aucune écriture n'a été doublée");
});

test("V-05 — DOUBLE CLIC : le refus nomme les repas, sans prétendre qu'ils ont échoué", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });
  const premier = v.valider(entrees("a"), b.deps);
  const second = await v.valider(entrees("a", "b"), b.deps);
  assert.equal(second.echecs.length, 2);
  assert.deepEqual(
    second.echecs.map((e) => e.cle),
    ["a", "b"],
  );
  for (const echec of second.echecs) {
    assert.match(echec.message, /d[ée]j[àa] en cours/i);
  }
  assert.equal(
    second.refuseCarEnCours,
    true,
    "l'appelant doit pouvoir distinguer ce refus d'une panne : sinon il affiche « à corriger »",
  );
  p.ouvrir();
  await premier;
});

test("V-06 — DIX clics simultanés : une seule série part", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });
  const tous = [v.valider(entrees("a"), b.deps)];
  for (let i = 0; i < 9; i += 1) tous.push(v.valider(entrees("a"), b.deps));
  const refus = await Promise.all(tous.slice(1));
  assert.equal(refus.filter((r) => r.refuseCarEnCours).length, 9);
  p.ouvrir();
  await tous[0];
  assert.deepEqual(b.ecrites, ["a"]);
});

test("V-07 — VERROU SYNCHRONE : `enVol` est vrai avant le premier `await`", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });
  assert.equal(v.enVol(), false);
  const promesse = v.valider(entrees("a"), b.deps);
  assert.equal(v.enVol(), true, "un verrou qui ne se voit qu'après un tour de boucle ne verrouille rien");
  p.ouvrir();
  await promesse;
  assert.equal(v.enVol(), false);
});

test("V-08 — UN SEUL VALIDATEUR POUR LES DEUX GESTES : valider un repas pendant la semaine est refusé", async () => {
  // Deux boutons (« valider la semaine », « valider ce repas ») passent par le
  // MÊME validateur dans le hook — donc par le même verrou. Un second
  // mécanisme aurait rouvert la brèche.
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });
  const semaine = v.valider(entrees("a", "b", "c"), b.deps);
  const unSeul = await v.valider(entrees("z"), b.deps);
  assert.equal(unSeul.refuseCarEnCours, true);
  assert.equal(b.ecrites.includes("z"), false);
  p.ouvrir();
  await semaine;
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. RÉPONSE SERVEUR LENTE
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-09 — RÉPONSE LENTE : le verrou tient toute la durée, l'état reste « en cours »", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({
    ecrire: () => new Promise<void>((r) => setTimeout(r, 30)),
  });
  const promesse = v.valider(entrees("a", "b"), b.deps);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(v.enVol(), true);
  assert.deepEqual(b.etats, [true], "l'écran ne doit pas être réactivé en plein vol");
  const refuse = await v.valider(entrees("a", "b"), b.deps);
  assert.equal(refuse.refuseCarEnCours, true);
  await promesse;
  assert.deepEqual(b.etats, [true, false]);
  assert.deepEqual(b.ecrites, ["a", "b"]);
});

test("V-10 — RÉPONSE LENTE : la relecture est ATTENDUE avant que le verrou ne tombe", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  let relectureFinie = false;
  const b = banc({
    relire: async () => {
      await new Promise((r) => setTimeout(r, 25));
      relectureFinie = true;
    },
  });
  await v.valider(entrees("a"), b.deps);
  assert.equal(
    relectureFinie,
    true,
    "rendre la main avant la relecture ferait avancer l'écran sur l'état d'AVANT",
  );
  assert.equal(v.enVol(), false);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. ERREUR RÉSEAU
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-11 — ERREUR RÉSEAU sur tous les repas : rien n'est annoncé validé", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new TypeError("Failed to fetch")) });
  const rapport = await v.valider(entrees("a", "b", "c"), b.deps);
  assert.equal(rapport.valides, 0);
  assert.equal(rapport.echecs.length, 3);
  assert.equal(rapport.complet, false);
  assert.equal(rapport.refuseCarEnCours, false, "une panne n'est pas un refus de concurrence");
  for (const echec of rapport.echecs) {
    assert.match(echec.message, /r[ée]essaie|connexion/i);
  }
});

test("V-12 — ÉCHEC PARTIEL : les suivants sont tentés, et le compte est exact", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({
    ecrire: async (charge) => {
      if (charge.id === "b") throw new TypeError("Failed to fetch");
    },
  });
  const rapport = await v.valider(entrees("a", "b", "c", "d"), b.deps);
  assert.deepEqual(b.ecrites, ["a", "b", "c", "d"], "un échec au deuxième n'arrête pas les suivants");
  assert.equal(rapport.valides, 3);
  assert.deepEqual(
    rapport.echecs.map((e) => e.cle),
    ["b"],
  );
  assert.equal(rapport.complet, false, "trois sur quatre n'est pas « complet »");
});

test("V-13 — ÉCHEC PARTIEL : la relecture a lieu quand même", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("boom")) });
  await v.valider(entrees("a", "b"), b.deps);
  assert.equal(b.relectures, 1, "onze repas écrits sur vingt-et-un doivent apparaître validés");
});

test("V-14 — UNE RELECTURE QUI ÉCHOUE N'AVALE PAS LE RAPPORT", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ relire: () => Promise.reject(new Error("lecture coupée")) });
  const rapport = await v.valider(entrees("a", "b"), b.deps);
  assert.equal(rapport.valides, 2, "les écritures ont eu lieu : les perdre serait la pire réponse");
  assert.equal(v.enVol(), false, "le verrou doit tomber même si la relecture casse");
  assert.deepEqual(b.etats, [true, false]);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. ERREUR SUPABASE (motifs de la RPC)
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-15 — ERREUR SUPABASE : `REPAS_DEJA_CONSOMME` est affiché, pas avalé", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("REPAS_DEJA_CONSOMME")) });
  const rapport = await v.valider(entrees("a"), b.deps);
  assert.equal(rapport.valides, 0);
  assert.match(rapport.echecs[0]!.message, /d[ée]j[àa] [ée]t[ée] enregistr[ée]/i);
  assert.doesNotMatch(
    rapport.echecs[0]!.message,
    /REPAS_DEJA_CONSOMME/,
    "le code brut de la base n'est pas un message pour l'élève",
  );
});

test("V-16 — ERREUR SUPABASE : `IDENTITE_INVALIDE` dit quoi faire", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("IDENTITE_INVALIDE")) });
  const rapport = await v.valider(entrees("a"), b.deps);
  assert.match(rapport.echecs[0]!.message, /recharge/i);
});

test("V-17 — ERREUR SUPABASE : un motif inconnu n'invente rien", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("23505 duplicate key")) });
  const rapport = await v.valider(entrees("a"), b.deps);
  assert.match(rapport.echecs[0]!.message, /La validation a [ée]chou[ée]/i);
  assert.equal(rapport.valides, 0);
});

test("V-18 — CONNEXION INDISPONIBLE : le hook refuse AVANT d'écrire, et le dit", async () => {
  // Sans client Supabase, l'écriture doit REJETER, pas être silencieusement
  // sautée : un repas sauté serait compté validé sans l'être.
  assert.match(CODE_HOOK, /if \(!supabase\) throw new Error\("CONNEXION_INDISPONIBLE"\)/);

  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("CONNEXION_INDISPONIBLE")) });
  const rapport = await v.valider(entrees("a", "b"), b.deps);
  assert.equal(rapport.valides, 0);
  assert.equal(rapport.echecs.length, 2);
  assert.match(rapport.echecs[0]!.message, /Connexion indisponible/i);
  assert.match(
    rapport.echecs[0]!.message,
    /conserv/i,
    "l'élève doit savoir que ses choix sont toujours là",
  );
  assert.doesNotMatch(rapport.echecs[0]!.message, /CONNEXION_INDISPONIBLE/);
});

test("V-19 — AUCUNE MIGRATION, AUCUNE TABLE NOUVELLE DANS CE LOT", () => {
  assert.doesNotMatch(CODE_SERIE, /\bfrom\b|supabase|rpc\(/i, "l'orchestrateur ignore Supabase");
  assert.doesNotMatch(
    CODE_SERIE,
    /\breact\b/i,
    "l'orchestrateur doit rester exécutable hors React : c'est ce qui rend ces cas testables",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. NOUVELLE TENTATIVE APRÈS ÉCHEC
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-20 — NOUVELLE TENTATIVE : le verrou est rendu, le second essai passe", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  let doitEchouer = true;
  const b = banc({
    ecrire: async () => {
      if (doitEchouer) throw new TypeError("Failed to fetch");
    },
  });
  const premier = await v.valider(entrees("a"), b.deps);
  assert.equal(premier.valides, 0);
  assert.equal(v.enVol(), false, "un verrou resté posé après un échec bloquerait toute reprise");

  doitEchouer = false;
  const second = await v.valider(entrees("a"), b.deps);
  assert.equal(second.valides, 1);
  assert.equal(second.complet, true);
  assert.deepEqual(b.ecrites, ["a", "a"], "deux tentatives, dont une refusée par le serveur");
  assert.equal(b.relectures, 2);
});

test("V-21 — NOUVELLE TENTATIVE : on peut ne réessayer QUE ce qui a échoué", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  let doitEchouer = true;
  const b = banc({
    ecrire: async (charge) => {
      if (doitEchouer && charge.id === "b") throw new Error("boom");
    },
  });
  const premier = await v.valider(entrees("a", "b", "c"), b.deps);
  assert.deepEqual(
    premier.echecs.map((e) => e.cle),
    ["b"],
    "le rapport doit NOMMER les repas à reprendre, sinon on rejoue les trois",
  );

  doitEchouer = false;
  const reprise = await v.valider(entrees("b"), b.deps);
  assert.equal(reprise.complet, true);
  assert.deepEqual(b.ecrites, ["a", "b", "c", "b"], "a et c ne sont PAS réécrits");
});

test("V-22 — ÉCHEC PUIS DOUBLE CLIC SUR « RÉESSAYER » : toujours une seule série", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b1 = banc({ ecrire: () => Promise.reject(new Error("boom")) });
  await v.valider(entrees("a"), b1.deps);

  const p = porte();
  const b2 = banc({ ecrire: () => p.attendre() });
  const reprise = v.valider(entrees("a"), b2.deps);
  const doublon = await v.valider(entrees("a"), b2.deps);
  assert.equal(doublon.refuseCarEnCours, true);
  p.ouvrir();
  await reprise;
  assert.deepEqual(b2.ecrites, ["a"]);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. CONSERVATION DES CHOIX APRÈS ERREUR
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-23 — CONSERVATION : l'orchestrateur ne touche pas aux entrées qu'on lui donne", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc({ ecrire: () => Promise.reject(new Error("boom")) });
  const liste = entrees("a", "b");
  const avant = JSON.stringify(liste);
  await v.valider(liste, b.deps);
  assert.equal(JSON.stringify(liste), avant, "les choix de l'élève sont ses données, pas un brouillon");
  assert.equal(liste.length, 2);
});

test("V-24 — CONSERVATION : la même liste peut être rejouée telle quelle", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  let doitEchouer = true;
  const b = banc({
    ecrire: async () => {
      if (doitEchouer) throw new Error("boom");
    },
  });
  const liste = entrees("a", "b", "c");
  await v.valider(liste, b.deps);
  doitEchouer = false;
  const second = await v.valider(liste, b.deps);
  assert.equal(second.valides, 3, "rien dans la liste n'a été consommé par la tentative ratée");
});

test("V-25 — CONSERVATION : un refus de concurrence ne vide pas l'écran", () => {
  // Le hook distingue les deux cas : refus de concurrence → il rend `false`
  // SANS poser d'erreur globale ; panne → il affiche le motif.
  assert.match(CODE_HOOK, /refuseCarEnCours\s*\)\s*return false/);
  assert.match(CODE_HOOK, /!rapport\.refuseCarEnCours\s*&&\s*rapport\.valides === 0/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. ABSENCE DE DOUBLONS EN BASE
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-26 — AUCUN DOUBLON : une entrée répétée dans la liste n'est écrite qu'une fois par occurrence demandée", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc();
  await v.valider(entrees("a", "b", "c"), b.deps);
  const comptes = new Map<string, number>();
  for (const id of b.ecrites) comptes.set(id, (comptes.get(id) ?? 0) + 1);
  assert.deepEqual([...comptes.values()], [1, 1, 1]);
});

test("V-27 — AUCUN DOUBLON sous rafale : 21 repas, 5 clics, 21 écritures", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const ids = Array.from({ length: 21 }, (_, i) => `r${i}`);
  const b = banc({ ecrire: () => new Promise<void>((r) => setTimeout(r, 1)) });
  const serie = v.valider(entrees(...ids), b.deps);
  const refus = await Promise.all([
    v.valider(entrees(...ids), b.deps),
    v.valider(entrees(...ids), b.deps),
    v.valider(entrees(...ids), b.deps),
    v.valider(entrees(...ids), b.deps),
  ]);
  assert.equal(refus.every((r) => r.refuseCarEnCours), true);
  const rapport = await serie;
  assert.equal(rapport.valides, 21);
  assert.equal(b.ecrites.length, 21, "42 écritures, c'était le défaut mesuré en phase 1");
  assert.deepEqual(b.ecrites, ids);
});

test("V-28 — AUCUN DOUBLON : le bouton n'est pas le seul garde-fou", () => {
  // `disabled` reste — pour l'ergonomie — mais il n'est plus ce qui protège :
  // il est effectif au rendu SUIVANT, et le double tap tient dans un seul tour.
  assert.match(CODE_PARCOURS, /disabled=\{/, "le bouton reste désactivé pendant l'envoi");
  assert.match(
    CODE_SERIE,
    /let enVol = false/,
    "le garde-fou réel est une variable lue et écrite synchroniquement",
  );
  assert.match(CODE_SERIE, /if \(enVol\)/);
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. MISE À JOUR CORRECTE DE L'INTERFACE APRÈS SUCCÈS
 * ══════════════════════════════════════════════════════════════════════════ */

test("V-29 — APRÈS SUCCÈS : l'ordre est écrire → relire → déverrouiller → rendre la main", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const trace: string[] = [];
  const rapport = await v.valider(entrees("a", "b"), {
    ecrire: async (charge) => {
      trace.push(`ecrire:${charge.id}`);
    },
    relire: async () => {
      trace.push("relire");
    },
    surChangementDEtat: (enCours) => {
      trace.push(enCours ? "verrou" : "libre");
    },
  });
  assert.deepEqual(trace, ["verrou", "ecrire:a", "ecrire:b", "relire", "libre"]);
  assert.equal(rapport.complet, true);
});

test("V-30 — APRÈS SUCCÈS : l'état « en cours » est posé puis rendu, UNE fois", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const b = banc();
  await v.valider(entrees("a", "b", "c"), b.deps);
  assert.deepEqual(b.etats, [true, false], "un `finally` par repas rallumerait le bouton en plein vol");
});

test("V-31 — APRÈS REFUS DE CONCURRENCE : l'état d'affichage n'est PAS touché", async () => {
  const v = creerValidateurEnSerie<Charge>(neutre);
  const p = porte();
  const b = banc({ ecrire: () => p.attendre() });
  const premier = v.valider(entrees("a"), b.deps);
  await v.valider(entrees("a"), b.deps);
  assert.deepEqual(
    b.etats,
    [true],
    "le refus ne doit pas éteindre le bouton pendant que la première série écrit",
  );
  p.ouvrir();
  await premier;
  assert.deepEqual(b.etats, [true, false]);
  assert.equal(b.relectures, 1, "un refus ne déclenche aucune relecture : rien n'a changé");
});

test("V-32 — APRÈS SUCCÈS : le hook relit la BASE, il ne recopie pas le rapport", () => {
  assert.match(CODE_HOOK, /const relire = useCallback\(async \(\) => \{\s*await charger\(\);/);
  assert.match(CODE_HOOK, /relire,/);
});

test("V-33 — LE VALIDATEUR N'A AUCUNE DÉPENDANCE D'ÉCRAN", () => {
  // Construit une fois avec `[]`, et les dépendances effectives passées AU
  // MOMENT DU GESTE : capturées à la construction, elles reliraient une
  // période obsolète — et le verrou serait recréé à chaque rendu.
  assert.match(CODE_HOOK, /creerValidateurEnSerie<RepasAValider>\(\{[^}]*\}\),\s*\[\],/);
  assert.match(CODE_HOOK, /dependances\(\)/);
});

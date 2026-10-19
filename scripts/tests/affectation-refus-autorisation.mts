/**
 * P13-B — LE PARCOURS APPLICATIF D'UN REFUS D'AFFECTATION.
 *
 *   npm run test:affectation-refus
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CETTE SUITE PROUVE, ET POURQUOI ELLE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * La migration 20261011130000 ferme `provision_program_copy` : un
 * collaborateur doit réunir la permission `entrainement / ecriture` ET
 * l'affectation explicite de l'élève. La checklist SQL le mesure EN BASE
 * (section H, 17 contrôles). Rien n'y mesurait ce que l'INTERFACE fait de ce
 * refus — et c'est là qu'était le défaut restant :
 *
 *   · le refus arrivait en `42501` ;
 *   · `cloneIndividualProgramCopy` l'écrasait en `null`, comme une panne ;
 *   · la modale affichait « réessaie, ou vérifie ta connexion ».
 *
 * Aucun faux succès — ce point tenait déjà, et deux tests ci-dessous
 * l'épinglent pour qu'il continue de tenir. Mais le message envoyait
 * l'utilisateur réessayer indéfiniment une opération définitivement refusée.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DOUBLE REJOUE LA GARDE SQL, IL NE REJOUE PAS SON VERDICT
 * ════════════════════════════════════════════════════════════════════════
 * `rpcProvision` ci-dessous applique la RÈGLE de la migration (service_role,
 * puis `is_admin()`, puis l'appartenance à la portée `entrainement/ecriture`),
 * à partir d'une description d'acteur. Coder en dur « ce rôle est refusé »
 * aurait fait passer les tests même si la règle changeait de sens ; ici, les
 * cinq rôles demandés traversent la même décision que la base.
 *
 * Rien de réel n'est contacté : ni Supabase, ni réseau, ni email.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { estRefusAutorisation, messageEchecAffectation } from "../../lib/assignment-refus";
import { terminerAssignation } from "../../lib/assignment-selection";
import {
  droitEcritureProgrammes,
  MESSAGE_LECTURE_SEULE_PROGRAMMES,
  type ContexteDroitAffectation,
} from "../../lib/droit-affectation";
import { provisionPurchasedProgram, setProgramAssignment } from "../../lib/supabase/programs";

let passed = 0;
let failed = 0;
async function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${nom}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(error);
  }
}

/* ═════════════════════ Acteurs et portées ═════════════════════ */

const MODELE = "prog-modele";
const ELEVE_A = "eleve-a"; // élève du coach 1
const ELEVE_B = "eleve-b"; // élève du coach 2

interface Acteur {
  readonly libelle: string;
  /** `service_role` : webhook Stripe et cron. */
  readonly serviceRole?: boolean;
  /** `public.is_admin()` — l'administrateur RÉEL, pas l'étiquette `coach`. */
  readonly admin?: boolean;
  /**
   * `public.student_ids_entrainement_ecriture()` — l'INTERSECTION de la portée
   * et de la permission. Pour un collaborateur : affectation ET `ecriture`.
   * Une permission seule ou une affectation seule donne un ensemble VIDE,
   * exactement comme en base.
   */
  readonly portéeEntrainementEcriture: readonly string[];
}

const COLLAB_AUTORISE: Acteur = {
  libelle: "collaborateur entrainement/ecriture + élève affecté",
  portéeEntrainementEcriture: [ELEVE_A],
};
const COLLAB_SANS_PERMISSION: Acteur = {
  libelle: "collaborateur affecté, SANS permission",
  portéeEntrainementEcriture: [],
};
const COLLAB_SANS_AFFECTATION: Acteur = {
  libelle: "collaborateur avec la permission, SANS affectation",
  portéeEntrainementEcriture: [],
};
const COLLAB_LECTURE: Acteur = {
  libelle: "collaborateur entrainement/LECTURE + élève affecté",
  portéeEntrainementEcriture: [],
};
const ASSISTANT: Acteur = {
  libelle: "assistant (coach autonome) sur SON élève",
  portéeEntrainementEcriture: [ELEVE_A],
};
const ADMIN: Acteur = { libelle: "administrateur", admin: true, portéeEntrainementEcriture: [] };
const SERVICE: Acteur = { libelle: "service_role (webhook)", serviceRole: true, portéeEntrainementEcriture: [] };

/* ═════════════════════ Double Supabase ═════════════════════ */

type Ligne = Record<string, unknown>;

interface Base {
  client: never;
  table: (nom: string) => Ligne[];
  /** Erreur posée sur le PROCHAIN appel de la RPC, à la place de la garde. */
  erreurRpc: { code?: string; message: string } | null;
  appelsRpc: number;
}

/**
 * La garde de la migration 20261011130000, rejouée.
 *
 * Quatre chemins, dans cet ordre — et le refus est le `42501` que PostgREST
 * remonte, message inclus, tel quel.
 */
function rpcProvision(
  base: Base,
  acteur: Acteur,
  args: { p_program_id: string; p_student_id: string | null; p_checkout_session_id: string | null },
): { data: string | null; error: { code?: string; message: string } | null } {
  base.appelsRpc += 1;
  if (base.erreurRpc) {
    const erreur = base.erreurRpc;
    base.erreurRpc = null;
    return { data: null, error: erreur };
  }
  const refus = {
    data: null,
    error: { code: "42501", message: "provision_program_copy : accès refusé" },
  };
  if (!acteur.serviceRole) {
    if (!acteur.admin) {
      if (args.p_student_id === null) return refus;
      if (!acteur.portéeEntrainementEcriture.includes(args.p_student_id)) return refus;
    }
  }
  const copieId = `copie-${args.p_student_id}`;
  base.table("programs").push({
    id: copieId,
    name: "Force",
    status: "actif",
    program_mode: "individuel",
    is_public: false,
    owner_student_id: args.p_student_id,
    source_template_id: args.p_program_id,
    source_checkout_session_id: args.p_checkout_session_id,
  });
  base.table("assignments").push({
    id: `aff-${args.p_student_id}`,
    student_id: args.p_student_id,
    content_type: "programme",
    content_id: copieId,
    program_start_date: null,
  });
  return { data: copieId, error: null };
}

function creerBase(acteur: Acteur): Base {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  table("programs").push({
    id: MODELE,
    name: "Force",
    status: "actif",
    program_mode: "individuel",
    is_public: false,
    owner_student_id: null,
    source_template_id: null,
    source_checkout_session_id: null,
  });

  const base = { table, erreurRpc: null, appelsRpc: 0 } as unknown as Base;

  /** Constructeur de requête minimal : select/eq/limit/maybeSingle/insert/delete. */
  function from(nom: string) {
    const filtres: Array<[string, unknown]> = [];
    const lignes = () => table(nom).filter((l) => filtres.every(([c, v]) => l[c] === v));
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (colonne: string, valeur: unknown) => {
        filtres.push([colonne, valeur]);
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: lignes()[0] ?? null, error: null }),
      single: async () => ({ data: lignes()[0] ?? null, error: null }),
      insert: async (charge: Ligne | Ligne[]) => {
        for (const ligne of Array.isArray(charge) ? charge : [charge]) {
          table(nom).push({ id: `${nom}-${table(nom).length + 1}`, ...ligne });
        }
        return { data: null, error: null };
      },
      delete: () => ({
        eq: (colonne: string, valeur: unknown) => {
          filtres.push([colonne, valeur]);
          const cible = new Set(lignes());
          const restant = table(nom).filter((l) => !cible.has(l));
          table(nom).length = 0;
          table(nom).push(...restant);
          return Object.assign(Promise.resolve({ data: null, error: null }), {
            eq: (c2: string, v2: unknown) => {
              filtres.push([c2, v2]);
              return Promise.resolve({ data: null, error: null });
            },
          });
        },
      }),
      update: () => builder,
      then: undefined,
    };
    return builder;
  }

  Object.assign(base, {
    client: {
      from,
      rpc: async (nom: string, args: Record<string, unknown>) => {
        assert.equal(nom, "provision_program_copy", "seule cette RPC est attendue sur ce parcours");
        return rpcProvision(base, acteur, args as never);
      },
    } as never,
  });
  return base;
}

/* ═════════════════════ Le « Terminer » de la modale ═════════════════════ */

/**
 * Ce que fait « Terminer » : le diff part, TOUTES les écritures sont
 * attendues, et l'issue décide du message. C'est la chaîne réelle —
 * `terminerAssignation` est la fonction utilisée par les deux modales.
 *
 * `emails` compte les notifications « contenu assigné » : le hook ne les
 * déclenche que sur un `ok`, et un refus ne doit donc en produire aucune.
 */
async function terminer(
  base: Base,
  eleves: readonly string[],
): Promise<{ succesAffiche: boolean; message: string | null; emails: number }> {
  let emails = 0;
  const { ok, echec } = await terminerAssignation([], [...eleves], async (studentId, assigned) => {
    const resultat = await setProgramAssignment(base.client, studentId, MODELE, assigned);
    if (resultat && assigned) emails += 1;
    return resultat;
  });
  return {
    succesAffiche: ok,
    message: ok ? null : messageEchecAffectation(echec ?? "technique"),
    emails,
  };
}

const MESSAGE_TECHNIQUE = "L'enregistrement a échoué. Ta sélection est conservée — réessaie, ou vérifie ta connexion.";

/* ═════════════════════ 1. Les cinq rôles demandés ═════════════════════ */

await test("1. collaborateur autorisé (entrainement/ecriture + affectation) : l'opération aboutit", async () => {
  const base = creerBase(COLLAB_AUTORISE);
  const issue = await terminer(base, [ELEVE_A]);
  assert.equal(issue.succesAffiche, true, "le succès doit être affiché");
  assert.equal(issue.message, null, "aucun message d'échec");
  assert.equal(base.appelsRpc, 1, "la RPC est bien le chemin emprunté");
  assert.equal(base.table("programs").filter((p) => p.owner_student_id === ELEVE_A).length, 1, "une copie créée");
  assert.equal(
    base.table("assignments").filter((a) => a.student_id === ELEVE_A).length,
    1,
    "une affectation créée, vers la COPIE",
  );
  assert.equal(base.table("assignments")[0].content_id, `copie-${ELEVE_A}`, "jamais le modèle");
  assert.equal(issue.emails, 1, "l'email d'attribution part sur une vraie attribution");
});

for (const acteur of [COLLAB_SANS_PERMISSION, COLLAB_SANS_AFFECTATION, COLLAB_LECTURE]) {
  await test(`2. refus : ${acteur.libelle} — aucun succès, message de droits, rien en base`, async () => {
    const base = creerBase(acteur);
    const issue = await terminer(base, [ELEVE_A]);
    assert.equal(issue.succesAffiche, false, "un refus ne doit JAMAIS afficher de succès");
    assert.equal(issue.message, messageEchecAffectation("autorisation"), "message de droits, pas de panne réseau");
    assert.notEqual(issue.message, MESSAGE_TECHNIQUE, "« réessaie » serait un conseil faux");
    assert.equal(base.table("programs").length, 1, "aucun programme créé — seul le modèle subsiste");
    assert.equal(base.table("assignments").length, 0, "aucune affectation créée");
    assert.equal(issue.emails, 0, "aucun email d'attribution sur un refus");
  });
}

await test("3. assistant HORS de sa portée : refusé, et il ne gagne aucun accès global", async () => {
  const base = creerBase(ASSISTANT);
  const refus = await terminer(base, [ELEVE_B]);
  assert.equal(refus.succesAffiche, false, "l'élève d'un autre coach reste hors d'atteinte");
  assert.equal(refus.message, messageEchecAffectation("autorisation"));
  assert.equal(base.table("assignments").length, 0, "rien n'a été créé pour l'élève d'un autre coach");

  // …et la même session reste pleinement fonctionnelle sur SON élève : un
  // refus ne doit pas « casser » le parcours autorisé.
  const autorise = await terminer(base, [ELEVE_A]);
  assert.equal(autorise.succesAffiche, true, "sa portée légitime reste ouverte");
  assert.equal(base.table("assignments").filter((a) => a.student_id === ELEVE_A).length, 1);
});

await test("4. administrateur : autorisé sur n'importe quel élève", async () => {
  const base = creerBase(ADMIN);
  const issue = await terminer(base, [ELEVE_B]);
  assert.equal(issue.succesAffiche, true, "l'administrateur ne dépend d'aucune affectation");
  assert.equal(base.table("assignments").filter((a) => a.student_id === ELEVE_B).length, 1);
});

/* ═════════════════════ 2. Ce que le message dit, et ne dit pas ═════════════════════ */

await test("5. le message de refus n'expose ni SQL, ni code d'erreur, ni élève visé", () => {
  const message = messageEchecAffectation("autorisation");
  for (const interdit of [
    "42501",
    "provision_program_copy",
    "insufficient_privilege",
    "accès refusé",
    "SQL",
    "RPC",
    "policy",
    "RLS",
    "student",
    ELEVE_A,
    ELEVE_B,
    MODELE,
  ]) {
    assert.ok(!message.includes(interdit), `le message ne doit pas contenir « ${interdit} »`);
  }
  assert.ok(message.length > 40 && /droits/i.test(message), "il doit rester compréhensible et nommer la cause");
  assert.ok(/administrateur/i.test(message), "et dire à qui s'adresser");
  assert.ok(!/réessaie/i.test(message), "réessayer est inutile sur un refus : ne pas le suggérer");
});

await test("6. l'exception portée par un refus ne transporte aucun détail technique", async () => {
  const base = creerBase(COLLAB_SANS_PERMISSION);
  let capturee: unknown = null;
  try {
    await setProgramAssignment(base.client, ELEVE_A, MODELE, true);
  } catch (erreur) {
    capturee = erreur;
  }
  assert.ok(capturee !== null, "le refus doit remonter, pas être avalé en silence");
  assert.ok(estRefusAutorisation(capturee), "et être reconnu comme un refus de droits");
  const texte = `${(capturee as Error).name} ${(capturee as Error).message}`;
  for (const interdit of ["42501", "provision_program_copy", ELEVE_A, MODELE]) {
    assert.ok(!texte.includes(interdit), `l'exception ne doit pas contenir « ${interdit} »`);
  }
});

/* ═════════════════════ 3. Les autres erreurs n'ont pas changé ═════════════════════ */

await test("7. une panne serveur garde son chemin ET son message d'avant", async () => {
  const base = creerBase(COLLAB_AUTORISE);
  base.erreurRpc = { code: "XX000", message: "internal error" };
  const issue = await terminer(base, [ELEVE_A]);
  assert.equal(issue.succesAffiche, false, "une panne reste un échec");
  assert.equal(issue.message, MESSAGE_TECHNIQUE, "message technique INCHANGÉ, au caractère près");
  assert.equal(base.table("assignments").length, 0, "et rien n'est créé");
});

await test("8. un écrivain qui rend `false` (nutrition, documents) reste un échec technique", async () => {
  const { ok, echec } = await terminerAssignation([], ["x"], async () => false);
  assert.equal(ok, false);
  assert.equal(echec, "technique", "aucun autre parcours ne doit hériter du message de droits");
  assert.equal(messageEchecAffectation(echec ?? "technique"), MESSAGE_TECHNIQUE);
});

await test("9. un succès ne porte aucune nature d'échec", async () => {
  const { ok, echec } = await terminerAssignation([], ["x"], async () => true);
  assert.equal(ok, true);
  assert.equal(echec, null, "`echec` doit rester nul sur un succès : pas de message fantôme");
});

await test("10. refus et panne dans le MÊME lot : le refus l'emporte", async () => {
  const base = creerBase(COLLAB_AUTORISE); // ELEVE_A autorisé, ELEVE_B non
  base.erreurRpc = { code: "XX000", message: "internal error" };
  const issue = await terminer(base, [ELEVE_A, ELEVE_B]);
  assert.equal(issue.succesAffiche, false);
  assert.equal(
    issue.message,
    messageEchecAffectation("autorisation"),
    "un refus nomme une cause définitive : c'est lui qu'il faut lire",
  );
});

/* ═════════════════════ 4. Le serveur garde son contrat ═════════════════════ */

await test("11. provisionPurchasedProgram (webhook) rend un booléen, jamais une exception", async () => {
  // Décor : l'achat d'un programme individuel. En `service_role` la garde
  // laisse passer — on vérifie d'abord le chemin normal…
  const service = creerBase(SERVICE);
  assert.equal(
    await provisionPurchasedProgram(service.client, ELEVE_B, MODELE, null),
    true,
    "le provisionnement d'achat doit aboutir en service_role",
  );

  // …puis qu'un refus (impossible en service_role, mais la fonction ne doit
  // pas en dépendre) est arrêté AVANT de sortir du module : un webhook rend
  // un booléen à Stripe, il ne propage pas une exception de modale.
  const refuse = creerBase(COLLAB_SANS_PERMISSION);
  const issue = await provisionPurchasedProgram(refuse.client, ELEVE_A, MODELE, null);
  assert.equal(issue, false, "un refus devient `false`, comme toute autre copie impossible");
  assert.equal(refuse.table("assignments").length, 0, "et rien n'est affecté");
});

/* ═════════════════════ 5. Contrôles statiques — pas de retour en arrière ═════════════════════ */

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");

await test("12. les deux modales lisent la nature de l'échec, et ne codent plus un message unique", () => {
  for (const chemin of [
    "components/admin/AssignStudentsModal.tsx",
    "components/admin/AssignContentToStudentModal.tsx",
  ]) {
    const source = lire(chemin);
    assert.ok(/messageEchecAffectation\(/.test(source), `${chemin} : le message doit venir de la source unique`);
    assert.ok(
      !/L&apos;enregistrement a échoué/.test(source),
      `${chemin} : plus de message en dur — il masquait le refus de droits`,
    );
    assert.ok(!/saveFailed/.test(source), `${chemin} : le booléen ne peut plus porter deux causes distinctes`);
    assert.ok(/echecSauvegarde/.test(source), `${chemin} : la nature de l'échec doit être mémorisée`);
    assert.ok(/role="alert"/.test(source), `${chemin} : le message doit être annoncé aux lecteurs d'écran`);
  }
});

await test("13. le hook rafraîchit même sur un rejet, et n'envoie aucun email", () => {
  const source = lire("hooks/useContentAssignment.ts");
  // Deux bras explicites sur le `then` : succès et rejet. Un seul bras laissait
  // `onWritten` de côté sur un refus — dans un lot mixte, l'écriture réussie
  // n'était alors pas relue.
  const rejet = source.slice(source.indexOf("(erreur) => {"));
  assert.ok(rejet.length > 0, "le bras de rejet doit exister");
  assert.ok(/onWritten\?\.\(\);/.test(rejet), "un rejet doit tout de même déclencher la relecture");
  assert.ok(/throw erreur;/.test(rejet), "et relancer l'erreur : l'avaler rendrait un faux succès");
  assert.ok(!/fetch\(/.test(rejet), "aucun email ne part sur un rejet : rien n'a été attribué");
  // L'email reste conditionné au succès ET à une vraie attribution.
  assert.ok(
    /if \(ok && assigned && notifyByEmail && motif !== "date"\)/.test(source),
    "la règle d'envoi de l'email ne doit pas avoir changé",
  );
});

await test("14. le refus est levé depuis la RPC, et seulement pour une autorisation", () => {
  const source = lire("lib/supabase/programs.ts");
  assert.ok(
    /if \(classerErreur\(error\) === "autorisation"\) \{[\s\S]{0,400}?throw new RefusAutorisationAffectation\(/.test(
      source,
    ),
    "seul un échec classé « autorisation » doit lever le refus",
  );
  assert.ok(
    /devWarn\("cloneIndividualProgramCopy \(rpc\)", error as \{ message: string \}\);\s*\n\s*return null;/.test(source),
    "toute autre erreur garde EXACTEMENT son chemin d'avant (devWarn puis null)",
  );
  assert.ok(
    /isMissingProvisionRpc/.test(source),
    "le repli « migration non appliquée » reste en place et n'est pas un refus",
  );
  // Le repli applicatif ne doit jamais rattraper un refus : il est réservé au
  // cas PGRST202, testé avant la classification.
  const corps = source.slice(source.indexOf("async function cloneIndividualProgramCopy"));
  assert.ok(
    corps.indexOf("isMissingProvisionRpc") < corps.indexOf("classerErreur"),
    "l'absence de RPC est tranchée AVANT la nature de l'erreur",
  );
});

await test("15. `ok` conserve sa définition : seul le MOTIF a été ajouté", () => {
  const source = lire("lib/assignment-selection.ts");
  assert.ok(
    /ok: issues\.every\(\(\{ valeur \}\) => valeur !== false\)/.test(source),
    "un `false` ou un rejet vaut toujours échec — rien d'autre",
  );
  assert.equal(
    (source.match(/echec: echecDominant\(/g) ?? []).length,
    2,
    "les deux « Terminer » (multiple et choix unique) rapportent le motif",
  );
  assert.ok(/estRefusAutorisation/.test(source), "la lecture du refus passe par la source unique");
});

/* ═════════════════════ 6. L'INDICE D'INTERFACE — lecture seule ═════════════════════ */

/**
 * Contexte de droits, par défaut « tout est lu, rien n'est accordé ». Chaque
 * cas ne déclare que ce qui le distingue : un oubli saute aux yeux.
 */
function contexte(partiel: Partial<ContexteDroitAffectation> = {}): ContexteDroitAffectation {
  return {
    chargement: false,
    estAdmin: false,
    role: null,
    categoriesEcriture: [],
    mecanismeIndisponible: false,
    ...partiel,
  };
}

await test("16. collaborateur entrainement/LECTURE : l'action est grisée", () => {
  // `categories_ecriture()` ne rend QUE les catégories en écriture : un
  // collaborateur en lecture n'y figure pas, même si `categories_lecture()`
  // contient bien `entrainement`.
  assert.equal(
    droitEcritureProgrammes(contexte({ role: "collaborateur", categoriesEcriture: [] })),
    "lecture_seule",
  );
  // Une écriture sur une AUTRE catégorie n'ouvre pas l'entraînement.
  assert.equal(
    droitEcritureProgrammes(contexte({ role: "collaborateur", categoriesEcriture: ["nutrition"] })),
    "lecture_seule",
    "la nutrition en écriture ne donne aucun droit sur l'entraînement",
  );
  assert.equal(
    droitEcritureProgrammes(
      contexte({ role: "collaborateur", categoriesEcriture: ["suivi_eleve", "agenda_communication"] }),
    ),
    "lecture_seule",
  );
});

await test("17. collaborateur entrainement/ECRITURE : le fonctionnement actuel est préservé", () => {
  assert.equal(
    droitEcritureProgrammes(contexte({ role: "collaborateur", categoriesEcriture: ["entrainement"] })),
    "autorisee",
  );
  assert.equal(
    droitEcritureProgrammes(
      contexte({ role: "collaborateur", categoriesEcriture: ["entrainement", "nutrition"] }),
    ),
    "autorisee",
  );
});

await test("18. les autres rôles ne sont jamais grisés", () => {
  assert.equal(droitEcritureProgrammes(contexte({ role: "assistant" })), "autorisee",
    "un assistant écrit sur ses élèves : categories_ecriture() lui rend les quatre");
  assert.equal(droitEcritureProgrammes(contexte({ role: "admin" })), "autorisee");
  assert.equal(droitEcritureProgrammes(contexte({ estAdmin: true })), "autorisee",
    "l'administrateur réel passe même sans fiche coaches lue");
  assert.equal(
    droitEcritureProgrammes(contexte({ estAdmin: true, role: "collaborateur", categoriesEcriture: [] })),
    "autorisee",
    "profiles.role = admin l'emporte : il ne peut pas se griser lui-même",
  );
});

await test("19. LE DOUTE NE GRISE PAS — un coach autorisé n'est jamais bloqué par un signal manquant", () => {
  /*
   * ⚠️ L'INVERSE DU FAIL-CLOSED, ET C'EST LE BON ARBITRAGE ICI. Une garde de
   * sécurité refuse quand elle ne sait pas ; un indice d'interface qui grise
   * sur un doute bloque un ayant droit sans rien protéger — la base, elle,
   * l'aurait laissé passer. Les quatre doutes ci-dessous rendent le
   * comportement d'avant ce lot, à l'identique.
   */
  assert.equal(droitEcritureProgrammes(contexte({ chargement: true, role: "collaborateur" })), "inconnue",
    "pendant la lecture : aucun grisé, donc aucun clignotement");
  assert.equal(
    droitEcritureProgrammes(contexte({ mecanismeIndisponible: true, role: "collaborateur" })),
    "inconnue",
    "migrations P13-B non appliquées : comportement d'avant",
  );
  assert.equal(droitEcritureProgrammes(contexte({ role: null })), "inconnue",
    "rôle non lu : inconnu, jamais « refusé »");
  assert.equal(droitEcritureProgrammes(contexte({ role: null, categoriesEcriture: [] })), "inconnue");
});

await test("20. le hook lit bien le NIVEAU, et son absence compte comme mécanisme indisponible", () => {
  const source = lire("hooks/useStaffContext.ts");
  assert.ok(/rpc\("categories_ecriture"\)/.test(source),
    "sans categories_ecriture(), lecture et écriture sont indiscernables");
  assert.ok(/rpc\("categories_lecture"\)/.test(source), "la lecture reste lue, pour la navigation");
  assert.ok(/categoriesEcriture: normaliserCategories\(ecritureRpc\.data\)/.test(source),
    "la valeur doit être normalisée comme les autres setof text");
  assert.ok(/estFonctionAbsente\(ecritureRpc\.error\)/.test(source),
    "fonction absente → mécanisme indisponible → l'interface ne grise pas");
  assert.ok(!/from\("coaches"\)/.test(source),
    "toujours aucun select sur coaches : il serait vide pour un collaborateur");
});

await test("21. AssignStudentsModal : grisé pour les PROGRAMMES seulement, message lié au bouton", () => {
  const source = lire("components/admin/AssignStudentsModal.tsx");
  // ⚠️ LE TEST SUR contentType EST LA MOITIÉ DU CORRECTIF : ce bouton sert
  // aussi aux plans alimentaires et aux documents, qu'un droit d'entraînement
  // ne doit pas fermer.
  assert.ok(
    /const ecritureProgrammeRefusee = contentType === "programme" && droitEcriture === "lecture_seule";/.test(source),
    "le grisé doit être limité aux programmes",
  );
  assert.ok(/disabled=\{ecritureProgrammeRefusee\}/.test(source), "le déclencheur doit être désactivé");
  assert.ok(/if \(ecritureProgrammeRefusee\) return;/.test(source),
    "et un clic programmatique ne doit pas ouvrir une modale sans issue");
  assert.ok(/MESSAGE_LECTURE_SEULE_PROGRAMMES/.test(source), "le message doit venir de la source unique");
  assert.ok(/aria-describedby=\{ecritureProgrammeRefusee \? idLectureSeule : undefined\}/.test(source),
    "le message doit être rattaché au bouton pour les lecteurs d'écran");
  assert.ok(/role="note"/.test(source), "et annoncé comme une note, pas comme une erreur");
});

await test("22. AssignContentToStudentModal : seule la section Programmes est neutralisée", () => {
  const source = lire("components/admin/AssignContentToStudentModal.tsx");
  // Le déclencheur ouvre TROIS sections : le griser priverait un
  // collaborateur nutrition de deux sections qu'il a le droit d'écrire.
  assert.ok(!/disabled=\{ecritureProgrammeRefusee\}/.test(source),
    "le déclencheur « Attribuer contenu » doit rester actif");
  assert.ok(/\{ecritureProgrammeRefusee \? \(/.test(source),
    "la section Programmes doit afficher l'encart à la place des cases");
  assert.ok(/MESSAGE_LECTURE_SEULE_PROGRAMMES/.test(source), "même message, même source");
  // Et aucune écriture de programme ne peut partir — y compris la correction
  // de date, qui ne vient PAS de la sélection.
  assert.ok(
    /if \(type === "programme" && ecritureProgrammeRefusee\) \{\s*\n\s*return Promise\.resolve\(\{ ok: true, echec: null, added: \[\], removed: \[\], reappliques: \[\] \}\);/.test(
      source,
    ),
    "le type programme doit être sauté, en rendant la forme d'un lot vide",
  );
  // Les deux autres types ne sont pas conditionnés.
  assert.ok(!/type === "nutrition" && ecritureProgrammeRefusee/.test(source));
  assert.ok(!/type === "document" && ecritureProgrammeRefusee/.test(source));
});

await test("23. le message de lecture seule nomme la permission, et rien d'autre", () => {
  const m = MESSAGE_LECTURE_SEULE_PROGRAMMES;
  assert.ok(/lecture seule/i.test(m) && /écriture/i.test(m), "il doit dire ce qui manque");
  assert.ok(/entraînement/i.test(m), "et sur quelle catégorie");
  assert.ok(/administrateur/i.test(m), "et à qui la demander");
  for (const interdit of ["42501", "provision_program_copy", "RLS", "policy", "collaborateur_permissions", ELEVE_A, MODELE]) {
    assert.ok(!m.includes(interdit), `le message ne doit pas contenir « ${interdit} »`);
  }
});

await test("24. la lecture des droits est MUTUALISÉE : une fois par page, pas une fois par ligne", () => {
  /*
   * ⚠️ CE N'EST PAS UNE OPTIMISATION DE CONFORT. `AssignStudentsModal` est
   * rendu PAR LIGNE dans /admin/programmes et /admin/nutrition : brancher le
   * hook sans mutualisation déclenchait quatre RPC et un select par programme
   * affiché, soit une centaine de requêtes pour une vingtaine de lignes.
   */
  const source = lire("hooks/useStaffContext.ts");
  assert.ok(/let lectureEnCours: Promise<StaffContext> \| null = null;/.test(source),
    "la lecture doit être partagée par une promesse de module");
  assert.ok(/if \(lectureEnCours === null\) \{/.test(source),
    "seul le premier appelant déclenche la lecture");
  // Et un échec ne doit PAS être mémorisé : sinon une coupure au chargement
  // figerait « inconnu » pour toute la session.
  assert.ok(/\.catch\(\(erreur\) => \{\s*\n\s*lectureEnCours = null;\s*\n\s*throw erreur;/.test(source),
    "une lecture ratée doit libérer le cache");
  assert.ok(/export function reinitialiserContexteStaff\(\): void/.test(source),
    "le cache doit être réinitialisable pour les tests");
  // Le démontage ne doit pas écrire dans un composant disparu.
  assert.ok((source.match(/if \(!annule\) setEtat\(/g) ?? []).length >= 2,
    "les deux issues doivent respecter le drapeau d'annulation");
});

await test("25. CONTRÔLE DU CONTRÔLE — aucune garde serveur n'a été touchée pour cette UX", () => {
  /*
   * L'amélioration est purement cosmétique au sens strict : si elle se
   * trompait, la base refuserait quand même. On le prouve en deux temps —
   * la règle d'interface n'est lue par aucune garde serveur, et le refus
   * réel reste mesuré (tests 2 et 3 ci-dessus, qui n'ont pas changé).
   */
  for (const chemin of ["lib/api/authz.ts", "lib/supabase/programs.ts", "lib/assignment-selection.ts"]) {
    const source = lire(chemin);
    assert.ok(
      !/droitEcritureProgrammes|MESSAGE_LECTURE_SEULE_PROGRAMMES|useDroitEcritureProgrammes/.test(source),
      `${chemin} : une décision serveur ne doit jamais dépendre d'un indice d'interface`,
    );
  }
  // Et la règle elle-même dit explicitement qu'elle n'est pas une garde.
  const regle = lire("lib/droit-affectation.ts");
  assert.ok(/n'est PAS une garde de sécurité/.test(regle), "l'intention doit rester écrite dans le code");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

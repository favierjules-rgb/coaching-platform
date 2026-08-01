/**
 * Remise du lien d'accès après achat — tests comportementaux serveur.
 *
 *   npm run test:account-activation-provisioning
 *
 * Le VRAI `provisionPublicProgramAccess` s'exécute ; seuls Supabase et le
 * transport d'e-mail sont remplacés par des doubles. Le faux `generateLink`
 * renvoie un jeton DIFFÉRENT à chaque appel, ce qui permet de vérifier
 * lequel finit réellement dans l'e-mail.
 *
 * Règle vérifiée ici : le jeton envoyé est toujours celui de l'appel qui
 * précède immédiatement l'envoi, jamais un jeton généré plus tôt. Si le
 * second appel échoue après avoir été traité par Supabase, il a pu invalider
 * le premier : envoyer l'ancien reviendrait à expédier un lien mort.
 *
 * Aucun service externe n'est contacté, aucun e-mail n'est envoyé, aucun
 * jeton n'est journalisé.
 */

import assert from "node:assert/strict";
import { programAssignmentTestHooks } from "../../lib/supabase/programs";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RACINE_MODULES = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (chemin: string) => readFileSync(join(ICI, chemin), "utf8");

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

/**
 * Provisionnement : e-mails et journal remplacés par des doubles. Le VRAI
 * code de `public-program-provisioning` s'exécute, seuls les effets de bord
 * sont observés.
 */
const courrier = {
  envois: [] as { emailType: string; relatedEntityType?: string; relatedEntityId?: string; html: string }[],
  dejaEnvoyes: new Set<string>(),
  statutProchainEnvoi: "sent" as "sent" | "failed",
};
mock.module(pathToFileURL(join(RACINE_MODULES, "lib/email/send-transactional-email.ts")).href, {
  namedExports: {
    sendTransactionalEmail: async (_c: unknown, input: Record<string, string>) => {
      courrier.envois.push({
        emailType: input.emailType,
        relatedEntityType: input.relatedEntityType,
        relatedEntityId: input.relatedEntityId,
        html: String(input.html ?? ""),
      });
      return { status: courrier.statutProchainEnvoi };
    },
    wasEmailAlreadySent: async (_c: unknown, p: { emailType: string; relatedEntityType: string; relatedEntityId: string }) =>
      courrier.dejaEnvoyes.has(`${p.emailType}|${p.relatedEntityType}|${p.relatedEntityId}`),
    wasEmailRecentlySent: async () => false,
  },
});

const { provisionPublicProgramAccess, RetryablePublicProgramProvisioningError } = await import(
  pathToFileURL(join(RACINE_MODULES, "lib/supabase/public-program-provisioning.ts")).href
);

/* ═══════════ 16 + 21-27. Remise du lien : aucun repli, idempotence ═══════════ */

const JETON_PREMIER = "jeton-premier-appel-non-reel";
const JETON_SECOND = "jeton-second-appel-non-reel";

/**
 * Faux Supabase : `generateLink` renvoie un jeton DIFFÉRENT à chaque appel,
 * ce qui permet de vérifier lequel finit dans l'e-mail.
 */
function faireSupabaseProvisionnement(options: {
  eleveExistant?: { id: string; access_type: string; user_id: string | null; email: string } | null;
  echecSecondLien?: boolean;
  /** Renseigné quand le compte a déjà servi : la reprise ne doit rien envoyer. */
  derniereConnexion?: string | null;
  /** Simule une panne transitoire de l'API Auth. */
  echecGetUserById?: boolean;
  /** Simule une réponse sans erreur mais sans utilisateur (cas ambigu). */
  utilisateurAbsent?: boolean;
}) {
  const appelsGenerateLink: string[] = [];
  const client = {
    auth: {
      admin: {
        getUserById: async () => {
          if (options.echecGetUserById) {
            return { data: { user: null }, error: { message: "service indisponible (simulé)" } };
          }
          if (options.utilisateurAbsent) {
            return { data: { user: null }, error: null };
          }
          return {
            data: { user: { last_sign_in_at: options.derniereConnexion ?? null } },
            error: null,
          };
        },
        generateLink: async ({ type }: { type: string }) => {
          appelsGenerateLink.push(type);
          const premier = appelsGenerateLink.length === 1;
          if (!premier && options.echecSecondLien) {
            return { data: null, error: { message: "réseau indisponible (simulé)" } };
          }
          return {
            data: {
              user: { id: "auth-user-1" },
              properties: { hashed_token: premier ? JETON_PREMIER : JETON_SECOND },
            },
            error: null,
          };
        },
      },
    },
    from: (table: string) => {
      const chainable: Record<string, unknown> = {};
      const retour = () => chainable;
      const colonnesEq: string[] = [];
      for (const m of ["select", "ilike", "order", "limit", "is", "lt", "neq", "insert", "update", "upsert", "delete"]) {
        chainable[m] = retour;
      }
      chainable.eq = (colonne: string) => {
        colonnesEq.push(colonne);
        return chainable;
      };
      chainable.maybeSingle = async () => {
        if (table === "students") return { data: options.eleveExistant ?? null, error: null };
        if (table === "programs") {
          // Recherche d'une copie existante par session d'achat : aucune en
          // harnais (le stub de clonage en crée une à chaque passage).
          if (colonnesEq.includes("source_checkout_session_id")) return { data: null, error: null };
          // Lecture du programme commercial : mode achat unique explicite.
          return {
            data: {
              id: "programme-1",
              name: "Programme Test",
              status: "actif",
              program_mode: "individuel",
              is_public: true,
              owner_student_id: null,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      chainable.single = async () => ({
        data: table === "students" ? { id: "student-1" } : null,
        error: null,
      });
      return chainable;
    },
  };
  return { client, appelsGenerateLink };
}

// Correction produit : l'achat unique crée une copie individuelle. Le clonage
// profond est couvert ailleurs ; ici on le remplace par un stub qui rend un id
// de copie stable, pour tester le PROVISIONNEMENT (ordre, idempotence, reprise).
programAssignmentTestHooks.duplicate = async () => "copie-programme-1";

function entreeAchat() {
  return {
    email: "acheteur@exemple.test",
    firstName: "Alex",
    lastName: "Test",
    programId: "programme-1",
    programName: "Programme Test",
    coachId: null,
    checkoutSessionId: "cs_test_provisionnement",
  };
}

await test("16. le premier jeton n'est jamais intégré dans l'e-mail", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client } = faireSupabaseProvisionnement({ eleveExistant: null });

  await provisionPublicProgramAccess(client as never, entreeAchat() as never);

  const welcome = courrier.envois.find((e) => e.emailType === "welcome");
  assert.ok(welcome, "un e-mail de bienvenue doit partir");
  assert.ok(!welcome.html.includes(JETON_PREMIER), "le jeton du PREMIER appel ne doit jamais être envoyé");
});

await test("21. le second jeton est le seul envoyé", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({ eleveExistant: null });

  await provisionPublicProgramAccess(client as never, entreeAchat() as never);

  assert.equal(appelsGenerateLink.length, 2, "deux appels : création du compte, puis jeton de l'e-mail");
  assert.deepEqual(appelsGenerateLink, ["invite", "invite"], "toujours le type invite");
  const welcome = courrier.envois.find((e) => e.emailType === "welcome");
  assert.ok(welcome?.html.includes(JETON_SECOND), "le jeton du SECOND appel doit être celui envoyé");
});

await test("22. si le second generateLink échoue, aucun e-mail welcome n'est envoyé", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client } = faireSupabaseProvisionnement({ eleveExistant: null, echecSecondLien: true });

  await assert.rejects(
    () => provisionPublicProgramAccess(client as never, entreeAchat() as never),
    RetryablePublicProgramProvisioningError,
    "l'échec doit être signalé comme rejouable",
  );
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "welcome").length,
    0,
    "AUCUN e-mail de bienvenue ne doit partir sans jeton frais",
  );
});

await test("23. aucun ancien token_hash n'est utilisé en repli", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const fonction = source.slice(source.indexOf("async function envoyerLienAccesInitial"));
  const corps = fonction.slice(0, fonction.indexOf("\n}\n"));

  // Un repli se reconnaîtrait à un `??` entre deux jetons.
  assert.ok(!/hashed_token\s*\?\?/.test(corps), "aucun repli sur un jeton antérieur");
  assert.ok(!/creation\.properties/.test(source), "le jeton du premier appel ne doit plus être lu");
  assert.ok(
    /const hashedToken = lien\?\.properties\?\.hashed_token;/.test(corps),
    "un seul jeton, celui de l'appel courant",
  );
});

await test("24. paiement et attribution restent conservés quand seul l'envoi échoue", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const corps = source.slice(source.indexOf("async function createProgramOnlyStudent"));

  // L'attribution précède la remise du lien : un échec d'envoi la laisse
  // intacte, et rien dans le code ne la retire.
  const posAssignation = corps.indexOf("provisionPurchasedProgram");
  const posEnvoi = corps.indexOf("envoyerLienAccesInitial");
  assert.ok(posAssignation > 0 && posEnvoi > posAssignation, "le programme est attribué avant l'envoi");

  const fonctionEnvoi = source.slice(source.indexOf("async function envoyerLienAccesInitial"));
  const corpsEnvoi = fonctionEnvoi.slice(0, fonctionEnvoi.indexOf("\n}\n"));
  assert.ok(!/provisionPurchasedProgram\([^)]*false|assignSharedProgram\([^)]*false|setProgramAssignment\([^)]*false/.test(corpsEnvoi), "l'envoi ne retire jamais l'attribution");
  assert.ok(!/delete\(\)/.test(corpsEnvoi), "l'envoi ne supprime rien");
  assert.ok(!/refund|cancel/i.test(corpsEnvoi), "aucune annulation de paiement");
});

await test("25. une reprise idempotente génère un jeton frais", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  // Le compte existe déjà (créé par la tentative précédente) et n'a jamais
  // reçu son e-mail de bienvenue.
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-user-1", email: "acheteur@exemple.test" },
  });

  await provisionPublicProgramAccess(client as never, entreeAchat() as never);

  assert.equal(appelsGenerateLink.length, 1, "la reprise ne recrée pas le compte, elle regénère le lien");
  const welcome = courrier.envois.find((e) => e.emailType === "welcome");
  assert.ok(welcome, "la reprise doit envoyer le lien manquant");
  assert.ok(welcome.html.includes(JETON_PREMIER), "le jeton envoyé est celui généré lors de la reprise");
  assert.equal(welcome.relatedEntityType, "student", "idempotence par élève");
});

await test("26. après un envoi réussi, un rejeu n'envoie pas un second welcome", async () => {
  courrier.envois.length = 0;
  courrier.statutProchainEnvoi = "sent";
  // Le journal porte la trace d'un envoi réussi.
  courrier.dejaEnvoyes.clear();
  courrier.dejaEnvoyes.add("welcome|student|student-1");

  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-user-1", email: "acheteur@exemple.test" },
  });

  await provisionPublicProgramAccess(client as never, entreeAchat() as never);

  assert.equal(
    courrier.envois.filter((e) => e.emailType === "welcome").length,
    0,
    "aucun second e-mail de bienvenue",
  );
  assert.equal(appelsGenerateLink.length, 0, "aucun jeton généré inutilement");
});

await test("27. un envoi en échec est rejouable, sans second compte ni seconde attribution", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "failed";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({ eleveExistant: null });

  await assert.rejects(
    () => provisionPublicProgramAccess(client as never, entreeAchat() as never),
    RetryablePublicProgramProvisioningError,
    "un envoi refusé doit être rejouable",
  );
  // Le compte a été créé une seule fois ; la reprise passera par le chemin
  // « élève existant », donc sans nouvelle création ni nouvelle attribution.
  assert.equal(appelsGenerateLink.length, 2, "un appel de création, un appel de remise");
});


/* ═══════ 28-37. Idempotence par COMPTE, jamais par programme ═══════ */

/**
 * Régression du 29/07/2026 : la clé de déduplication du welcome interrogeait
 * aussi `program/programId`. Or ce champ est partagé par tous les acheteurs
 * d'un même programme — dès qu'un premier avait reçu son lien, tous les
 * suivants étaient ignorés en silence. Les journaux de production l'ont
 * confirmé : deux `welcome` en statut `sent`, une seule valeur de
 * `related_entity_id`.
 */

const PROGRAMME_X = "programme-x";

function achatDe(email: string, session: string) {
  return {
    email,
    firstName: "Acheteur",
    lastName: "Test",
    programId: PROGRAMME_X,
    programName: "Programme X",
    coachId: null,
    checkoutSessionId: session,
  };
}

await test("28. élève A achète le programme X → welcome envoyé", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client } = faireSupabaseProvisionnement({ eleveExistant: null });

  await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never);
  const welcome = courrier.envois.filter((e) => e.emailType === "welcome");
  assert.equal(welcome.length, 1, "l'élève A doit recevoir son lien");
  assert.equal(welcome[0].relatedEntityType, "student", "la clé du journal est l'élève");
});

await test("29. élève B achète le MÊME programme X → welcome envoyé aussi", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  // L'élève A a bien reçu le sien : sa trace existe, sous SA clé.
  courrier.dejaEnvoyes.add("welcome|student|student-A");
  courrier.statutProchainEnvoi = "sent";
  const { client } = faireSupabaseProvisionnement({ eleveExistant: null });

  await provisionPublicProgramAccess(client as never, achatDe("b@exemple.test", "cs_b") as never);
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "welcome").length,
    1,
    "l'élève B doit recevoir SON lien, indépendamment de l'élève A",
  );
});

await test("30. une ancienne ligne welcome liée au programId ne bloque personne", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  // Exactement la situation de production : un welcome historique journalisé
  // sous le programme, pas sous l'élève.
  courrier.dejaEnvoyes.add(`welcome|program|${PROGRAMME_X}`);
  courrier.statutProchainEnvoi = "sent";
  const { client } = faireSupabaseProvisionnement({ eleveExistant: null });

  await provisionPublicProgramAccess(client as never, achatDe("b@exemple.test", "cs_b") as never);
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "welcome").length,
    1,
    "une trace par programme ne doit JAMAIS bloquer un nouvel acheteur",
  );
});

await test("31. le code n'interroge plus jamais le journal par programme pour le welcome", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const appels = [...source.matchAll(/wasEmailAlreadySent\(supabase, \{([\s\S]*?)\}\)/g)].map((m) => m[1]);
  assert.ok(appels.length > 0, "aucun appel trouvé — le test ne prouverait rien");
  for (const appel of appels) {
    if (!appel.includes('emailType: "welcome"')) continue;
    assert.ok(
      appel.includes('relatedEntityType: "student"'),
      `la clé du welcome doit être l'élève : ${appel.trim()}`,
    );
    assert.ok(
      !appel.includes('relatedEntityType: "program"'),
      `programId ne doit jamais servir de clé d'idempotence : ${appel.trim()}`,
    );
  }
});

await test("32. rejeu après un welcome sent → aucun deuxième e-mail", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.dejaEnvoyes.add("welcome|student|student-1");
  courrier.statutProchainEnvoi = "sent";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
  });

  await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never);
  assert.equal(courrier.envois.filter((e) => e.emailType === "welcome").length, 0, "aucun second welcome");
  assert.equal(appelsGenerateLink.length, 0, "aucun jeton généré inutilement");
});

await test("33. rejeu après un welcome failed → nouveau lien et nouvel envoi", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear(); // `failed` n'est jamais enregistré comme « déjà envoyé »
  courrier.statutProchainEnvoi = "sent";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
  });

  await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never);
  assert.equal(appelsGenerateLink.length, 1, "un jeton frais est généré pour la reprise");
  assert.equal(courrier.envois.filter((e) => e.emailType === "welcome").length, 1, "l'envoi est retenté");
});

await test("34. la reprise ne duplique ni le compte ni l'attribution", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
  });

  const resultat = await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never);
  assert.equal(resultat?.isNewAccount, false, "aucun nouveau compte n'est créé");
  assert.equal(resultat?.studentId, "student-1", "c'est bien l'élève existant qui est repris");
  // Un seul generateLink : celui de la remise. Aucun appel de création.
  assert.equal(appelsGenerateLink.length, 1, "aucun compte Auth supplémentaire");

  // `setProgramAssignment` est idempotent côté base ; le code ne le rejoue
  // qu'une fois par passage.
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const grant = source.slice(source.indexOf("async function grantExistingStudent"), source.indexOf("async function envoyerLienAccesInitial"));
  assert.equal(
    (grant.match(/provisionPurchasedProgram/g) ?? []).length,
    1,
    "une seule attribution par passage",
  );
});

await test("35. un compte déjà utilisé ne reçoit pas de lien d'activation", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  // `last_sign_in_at` renseigné : l'acheteur a déjà un mot de passe.
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
    derniereConnexion: "2026-07-20T10:00:00Z",
  });

  await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_b") as never);
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "welcome").length,
    0,
    "un compte actif ne doit pas recevoir de lien d'activation",
  );
  assert.equal(appelsGenerateLink.length, 0, "aucun jeton généré");
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "program_assigned").length,
    1,
    "il reçoit en revanche « ton programme est disponible »",
  );
});

await test("36. checkout-status n'annonce un envoi que s'il est confirmé", () => {
  const route = lire("../../app/api/public/programs/checkout-status/route.ts");
  assert.ok(route.includes("accessEmailSent"), "le statut d'envoi doit être exposé");
  assert.ok(route.includes('.eq("status", "sent")'), "seul un envoi abouti compte");
  assert.ok(route.includes('.eq("related_entity_type", "student")'), "la clé lue est l'élève");
  // Aucun lien d'authentification ne revient par cette porte.
  const sansCommentaires = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const interdit of ["action_link", "hashed_token", "access_token", "refresh_token", "loginUrl", "magiclink"]) {
    assert.ok(!sansCommentaires.includes(interdit), `la réponse ne doit pas contenir « ${interdit} »`);
  }

  const composant = lire("../../components/sections/ProgrammesMerciStatus.tsx");
  assert.ok(composant.includes("accessEmailSent === true"), "la page ne doit affirmer que sur confirmation");
  assert.ok(
    composant.includes("vérifier tes spams"),
    "à défaut de confirmation, la formulation doit rester prudente",
  );
});

await test("37. aucun e-mail, jeton ni lien dans les journaux du provisionnement", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const journaux = [...source.matchAll(/console\.(?:log|warn|error)\(([\s\S]*?)\);/g)].map((m) => m[1]);
  for (const journal of journaux) {
    for (const interdit of ["hashed_token", "actionLink", "action_link", "access_token", "refresh_token", "setPasswordUrl"]) {
      assert.ok(!journal.includes(interdit), `journal fautif : ${journal.trim().slice(0, 70)}`);
    }
  }
  // L'adresse de l'acheteur ne doit plus apparaître non plus.
  for (const journal of journaux) {
    assert.ok(
      !/\$\{input\.email\}|\$\{recipientEmail\}|\$\{email\}/.test(journal),
      `adresse journalisée : ${journal.trim().slice(0, 70)}`,
    );
  }
});


/* ═══ 38-42. Incertitude sur l'état Auth : jamais un succès silencieux ═══ */

/**
 * Correctif du 29/07/2026. Une version précédente traitait un échec de
 * `getUserById` en réputant le compte actif : aucun e-mail, mais webhook 200.
 * Stripe tenait alors l'évènement pour traité et ne le rejouait jamais —
 * l'acheteur restait sans lien, et rien ne le signalait. Une panne
 * transitoire de l'API Auth doit produire une erreur rejouable, pas un
 * silence.
 */

await test("38. getUserById échoue → rien n'est envoyé, l'erreur est rejouable", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
    echecGetUserById: true,
  });

  await assert.rejects(
    () => provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never),
    RetryablePublicProgramProvisioningError,
    "une incertitude doit être signalée comme rejouable",
  );

  assert.equal(courrier.envois.filter((e) => e.emailType === "welcome").length, 0, "aucun welcome");
  assert.equal(
    courrier.envois.filter((e) => e.emailType === "program_assigned").length,
    0,
    "aucun « programme disponible » : rien ne doit laisser croire que tout est normal",
  );
  assert.equal(appelsGenerateLink.length, 0, "aucun jeton généré");
});

await test("39. réponse ambiguë (ni erreur, ni utilisateur) → même traitement", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  const { client } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
    utilisateurAbsent: true,
  });

  await assert.rejects(
    () => provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never),
    RetryablePublicProgramProvisioningError,
    "un utilisateur absent sans erreur reste une incertitude",
  );
  assert.equal(courrier.envois.length, 0, "aucun e-mail, quel qu'il soit");
});

await test("40. l'attribution du programme est conservée malgré l'incertitude", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  const grant = source.slice(
    source.indexOf("async function grantExistingStudent"),
    source.indexOf("async function envoyerLienAccesInitial"),
  );
  // L'attribution précède la lecture de l'état Auth : une levée ultérieure
  // ne peut pas la défaire.
  const posAssignation = grant.indexOf("provisionPurchasedProgram");
  const posEtatAuth = grant.indexOf("getUserById");
  assert.ok(posAssignation > 0 && posEtatAuth > posAssignation, "le programme est attribué avant la lecture Auth");
  // Et rien, dans ce chemin, ne retire ou n'annule quoi que ce soit.
  const depuisEtatAuth = grant.slice(posEtatAuth);
  assert.ok(!/provisionPurchasedProgram\([^)]*false|assignSharedProgram\([^)]*false|setProgramAssignment\([^)]*false/.test(depuisEtatAuth), "aucune désattribution");
  assert.ok(!/delete\(\)|refund|cancel/i.test(depuisEtatAuth), "aucune suppression ni annulation");
});

await test("41. reprise après rétablissement : jeton frais, un seul welcome", async () => {
  courrier.envois.length = 0;
  courrier.dejaEnvoyes.clear();
  courrier.statutProchainEnvoi = "sent";
  // L'API Auth répond de nouveau ; le compte n'a jamais servi.
  const { client, appelsGenerateLink } = faireSupabaseProvisionnement({
    eleveExistant: { id: "student-1", access_type: "programme_seul", user_id: "auth-1", email: "a@exemple.test" },
    derniereConnexion: null,
  });

  const resultat = await provisionPublicProgramAccess(client as never, achatDe("a@exemple.test", "cs_a") as never);

  assert.equal(resultat?.isNewAccount, false, "le compte existant est retrouvé, pas recréé");
  assert.equal(appelsGenerateLink.length, 1, "un jeton frais, généré pour cette reprise");
  assert.equal(courrier.envois.filter((e) => e.emailType === "welcome").length, 1, "un seul welcome");
});

await test("42. aucun chemin d'erreur Auth n'aboutit à un succès silencieux", () => {
  const source = lire("../../lib/supabase/public-program-provisioning.ts");
  // Découpe à partir de l'APPEL, pas de la première mention du nom : le
  // commentaire qui explique le correctif cite lui aussi `getUserById`.
  const bloc = source.slice(source.indexOf("const { data: compte, error: compteError }"));
  const corps = bloc.slice(0, bloc.indexOf("compteJamaisConnecte = !compte"));

  // La branche d'erreur doit lever, jamais se rabattre sur une valeur.
  assert.ok(/throw new RetryablePublicProgramProvisioningError/.test(corps), "l'incertitude doit lever");
  assert.ok(
    !/compteJamaisConnecte = false;?\s*\/\/ *(fail|repli)/i.test(corps),
    "aucun repli silencieux sur « compte actif »",
  );
  // Le drapeau n'est calculé qu'APRÈS la garde : il ne peut pas hériter
  // d'une réponse douteuse.
  const posGarde = bloc.indexOf("throw new RetryablePublicProgramProvisioningError");
  const posCalcul = bloc.indexOf("compteJamaisConnecte = !compte.user.last_sign_in_at");
  assert.ok(posGarde > 0 && posCalcul > posGarde, "le calcul suit la garde, jamais l'inverse");
});


console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

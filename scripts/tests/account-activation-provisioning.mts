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
}) {
  const appelsGenerateLink: string[] = [];
  const client = {
    auth: {
      admin: {
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
      for (const m of ["select", "eq", "ilike", "order", "limit", "is", "lt", "neq", "insert", "update", "upsert", "delete"]) {
        chainable[m] = retour;
      }
      chainable.maybeSingle = async () => ({
        data: table === "students" ? options.eleveExistant ?? null : null,
        error: null,
      });
      chainable.single = async () => ({
        data: table === "students" ? { id: "student-1" } : null,
        error: null,
      });
      return chainable;
    },
  };
  return { client, appelsGenerateLink };
}

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
  const posAssignation = corps.indexOf("setProgramAssignment");
  const posEnvoi = corps.indexOf("envoyerLienAccesInitial");
  assert.ok(posAssignation > 0 && posEnvoi > posAssignation, "le programme est attribué avant l'envoi");

  const fonctionEnvoi = source.slice(source.indexOf("async function envoyerLienAccesInitial"));
  const corpsEnvoi = fonctionEnvoi.slice(0, fonctionEnvoi.indexOf("\n}\n"));
  assert.ok(!/setProgramAssignment\([^)]*false/.test(corpsEnvoi), "l'envoi ne retire jamais l'attribution");
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


console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

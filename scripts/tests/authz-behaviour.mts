/**
 * Tests COMPORTEMENTAUX des correctifs H-1, H-2 et H-3
 * (audit de sécurité, seconde passe — 27/07/2026).
 *
 *   npm run test:authz-behaviour
 *
 * Contrairement à `authz-hardening.mts`, qui inspecte le code source, ces
 * tests EXÉCUTENT réellement les handlers de route et les gardes
 * d'autorisation, puis observent la réponse HTTP produite. Un correctif peut
 * en effet être présent dans le code et malgré tout inopérant — seule
 * l'exécution le prouve.
 *
 * Rien de réel n'est contacté : Supabase, Stripe, Upstash et les services
 * d'email sont remplacés par des doubles au niveau du module, via
 * `mock.module` (d'où le drapeau `--experimental-test-module-mocks`). Aucune
 * base distante n'est lue ou écrite, aucun email n'est envoyé.
 *
 * Les mocks sont pilotés par des variables mutables (`etat`) plutôt que
 * redéfinis à chaque test : `mock.module` s'applique au premier import du
 * module, on ne peut donc pas le reconfigurer après coup.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const moduleUrl = (relatif: string) => pathToFileURL(join(RACINE, relatif)).href;

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

/** `NODE_ENV` est en lecture seule pour TypeScript : on passe par le cast. */
function setNodeEnv(valeur: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (valeur === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = valeur;
}

/* ═════════════════════ État piloté par les tests ═════════════════════ */

interface EtatMocks {
  /** Session Stripe renvoyée par `sessions.retrieve`. */
  sessionStripe: Record<string, unknown> | null;
  /** Lignes renvoyées par les tables Supabase, par nom de table. */
  lignes: Record<string, unknown | null>;
  /** Identité de l'appelant. */
  utilisateur: { id: string } | null;
  role: string | null;
  /** Effets externes observés — doivent rester vides sur un refus. */
  emailsEnvoyes: unknown[];
  appelsBrevo: unknown[];
}

const etat: EtatMocks = {
  sessionStripe: null,
  lignes: {},
  utilisateur: null,
  role: null,
  emailsEnvoyes: [],
  appelsBrevo: [],
};

function reinitialiser() {
  etat.sessionStripe = null;
  etat.lignes = {};
  etat.utilisateur = null;
  etat.role = null;
  etat.emailsEnvoyes = [];
  etat.appelsBrevo = [];
}

/** Double minimal du client Supabase : `.from(t).select().eq()….maybeSingle()`. */
function faireClientSupabase() {
  const construireRequete = (table: string) => {
    const chainable: Record<string, unknown> = {};
    const retour = () => chainable;
    for (const methode of ["select", "eq", "ilike", "order", "limit", "is", "lt", "neq"]) {
      chainable[methode] = retour;
    }
    chainable.maybeSingle = async () => ({ data: etat.lignes[table] ?? null, error: null });
    chainable.single = async () => ({ data: etat.lignes[table] ?? null, error: null });
    chainable.then = undefined;
    return chainable;
  };
  return { from: (table: string) => construireRequete(table) };
}

/* ═════════════════════ Mocks de modules ═════════════════════ */

mock.module(moduleUrl("lib/stripe/client.ts"), {
  namedExports: {
    getStripeClient: () => ({
      checkout: {
        sessions: {
          retrieve: async () => {
            if (!etat.sessionStripe) throw new Error("session introuvable");
            return etat.sessionStripe;
          },
        },
      },
    }),
  },
});

mock.module(moduleUrl("lib/supabase/admin.ts"), {
  namedExports: { createSupabaseAdminClient: () => faireClientSupabase() },
});

mock.module(moduleUrl("lib/supabase/auth.ts"), {
  namedExports: {
    getCurrentUser: async () => etat.utilisateur,
    getCurrentUserRole: async () => etat.role,
    getProfileByUserId: async () => ({ firstName: "Test", lastName: "Utilisateur" }),
    getCurrentProfile: async () => null,
    isAdminOrCoach: async () => etat.role === "admin" || etat.role === "coach",
    isStudent: async () => etat.role === "student",
  },
});

mock.module(moduleUrl("lib/supabase/server.ts"), {
  namedExports: { createSupabaseServerClient: async () => faireClientSupabase() },
});

// Services à effet externe : on enregistre l'appel au lieu de le faire.
mock.module(moduleUrl("lib/business-inquiry/email.ts"), {
  namedExports: {
    sendBusinessInquiryEmail: async (input: unknown) => {
      etat.emailsEnvoyes.push(input);
      return { status: "sent" };
    },
    getBusinessContactRecipient: () => "coach@test.local",
  },
});

mock.module(moduleUrl("lib/brevo/client.ts"), {
  namedExports: {
    upsertNewsletterContact: async (email: unknown) => {
      etat.appelsBrevo.push(email);
      return { ok: true, skipped: false, brevoContactId: 1, listId: 1 };
    },
    deleteBrevoContact: async (email: unknown) => {
      etat.appelsBrevo.push(email);
      return { ok: true, skipped: false };
    },
    isBrevoConfigured: () => true,
    isNewsletterEnabled: () => true,
  },
});

/* ═════════════════════ Imports après mocks ═════════════════════ */

const { GET: checkoutStatus } = await import(moduleUrl("app/api/public/programs/checkout-status/route.ts"));
const { POST: businessInquiry } = await import(moduleUrl("app/api/business-inquiry/route.ts"));
const { requireAdmin, requireStaff, requireStaffForStudent } = await import(moduleUrl("lib/api/authz.ts"));
const { consumeRateLimit, getTrustedClientIp } = await import(moduleUrl("lib/security/rate-limit.ts"));
const { BUSINESS_INQUIRY_IP } = await import(moduleUrl("lib/security/rules.ts"));
const { DELETE: supprimerCoach } = await import(moduleUrl("app/api/admin/coaches/[coachId]/route.ts"));
const { DELETE: supprimerEleve } = await import(moduleUrl("app/api/admin/students/[studentId]/route.ts"));
const { DELETE: supprimerPaiement } = await import(moduleUrl("app/api/admin/billing/payments/[id]/route.ts"));

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

/* ═══════════════════ H-1 — checkout-status, exécuté ═══════════════════ */

// `accountReady` et `accessEmailSent` ont été ajoutés le 29/07/2026 : la page
// de remerciement ne doit plus AFFIRMER qu'un e-mail est parti sans que le
// backend l'ait confirmé. Ce sont des booléens, sans donnée personnelle.
const CHAMPS_AUTORISES = new Set(["paid", "ready", "redirectTo", "error", "accountReady", "accessEmailSent"]);

function requeteStatut(sessionId: string): Request {
  return new Request(`https://exemple.test/api/public/programs/checkout-status?session_id=${sessionId}`, {
    headers: { "x-vercel-forwarded-for": "203.0.113.10" },
  });
}

await test("1. session payée et provisionnée : la réponse ne contient QUE les champs autorisés", async () => {
  reinitialiser();
  etat.sessionStripe = {
    payment_status: "paid",
    metadata: { public_program_id: "prog-1", email: "attaquant@test.local" },
    customer_details: { email: "acheteur@test.local" },
  };
  etat.lignes = { students: { id: UUID_A }, assignments: { id: "a-1" } };

  const res = await checkoutStatus(requeteStatut("cs_test_ABCDEFGHIJKLMNOP"));
  const corps = await res.json();

  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(corps).sort(), ["accessEmailSent", "accountReady", "paid", "ready", "redirectTo"]);
  for (const cle of Object.keys(corps)) {
    assert.ok(CHAMPS_AUTORISES.has(cle), `champ inattendu dans la réponse : ${cle}`);
  }
  assert.equal(corps.paid, true);
  assert.equal(corps.ready, true);
});

await test("2. aucun lien, jeton, email ou URL externe dans la réponse", async () => {
  reinitialiser();
  etat.sessionStripe = {
    payment_status: "paid",
    metadata: { public_program_id: "prog-1" },
    customer_details: { email: "acheteur@test.local" },
  };
  etat.lignes = { students: { id: UUID_A }, assignments: { id: "a-1" } };

  const res = await checkoutStatus(requeteStatut("cs_test_ABCDEFGHIJKLMNOP"));
  const brut = JSON.stringify(await res.json());

  for (const interdit of [
    "action_link",
    "magiclink",
    "access_token",
    "refresh_token",
    "token_hash",
    "hashed_token",
    "loginUrl",
    "acheteur@test.local", // l'email ne doit pas non plus ressortir
    "@",
  ]) {
    assert.ok(!brut.includes(interdit), `la réponse contient « ${interdit} » : ${brut}`);
  }
  // Aucune URL absolue : ni Supabase, ni Stripe, ni quoi que ce soit d'externe.
  assert.ok(!/https?:\/\//.test(brut), `URL externe dans la réponse : ${brut}`);
});

await test("3. Cache-Control: no-store sur la réponse de succès ET sur les erreurs", async () => {
  reinitialiser();
  etat.sessionStripe = {
    payment_status: "paid",
    metadata: { public_program_id: "prog-1" },
    customer_details: { email: "acheteur@test.local" },
  };
  etat.lignes = { students: { id: UUID_A }, assignments: { id: "a-1" } };
  const ok = await checkoutStatus(requeteStatut("cs_test_ABCDEFGHIJKLMNOP"));
  assert.equal(ok.headers.get("cache-control"), "no-store");

  // Erreur de validation du paramètre.
  const invalide = await checkoutStatus(
    new Request("https://exemple.test/api/public/programs/checkout-status?session_id=pas-un-cs", {
      headers: { "x-vercel-forwarded-for": "203.0.113.11" },
    }),
  );
  assert.equal(invalide.status, 400);
  assert.equal(invalide.headers.get("cache-control"), "no-store");

  // Session Stripe introuvable.
  reinitialiser();
  etat.sessionStripe = null;
  const absente = await checkoutStatus(requeteStatut("cs_test_INTROUVABLE00"));
  assert.equal(absente.status, 404);
  assert.equal(absente.headers.get("cache-control"), "no-store");
});

await test("4. redirectTo ne peut valoir qu'une destination interne autorisée", async () => {
  reinitialiser();
  etat.sessionStripe = {
    payment_status: "paid",
    metadata: { public_program_id: "prog-1" },
    customer_details: { email: "acheteur@test.local" },
  };
  etat.lignes = { students: { id: UUID_A }, assignments: { id: "a-1" } };

  const corps = await (await checkoutStatus(requeteStatut("cs_test_ABCDEFGHIJKLMNOP"))).json();
  assert.equal(corps.redirectTo, "/connexion");
  assert.ok(corps.redirectTo.startsWith("/"), "destination non interne");
  assert.ok(
    !/reinitialiser-mot-de-passe|dashboard|entrainement|admin/.test(corps.redirectTo),
    "un session_id ne doit ouvrir aucun espace privilégié",
  );
});

await test("5. paiement non abouti : ni ready, ni destination", async () => {
  reinitialiser();
  etat.sessionStripe = { payment_status: "unpaid", metadata: { public_program_id: "prog-1" } };
  const corps = await (await checkoutStatus(requeteStatut("cs_test_NONPAYE000000"))).json();
  assert.deepEqual(corps, { paid: false, ready: false });
});

await test("6. les journaux ne contiennent jamais le session_id complet", async () => {
  reinitialiser();
  const sessionId = "cs_test_SECRETABCDEFGHIJKLMNOP";
  const captures: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    captures.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
  };
  try {
    etat.sessionStripe = null; // provoque le chemin d'erreur, donc un log
    await checkoutStatus(requeteStatut(sessionId));
  } finally {
    console.error = original;
  }

  assert.ok(captures.length > 0, "aucun journal produit — le test ne prouverait rien");
  for (const ligne of captures) {
    assert.ok(!ligne.includes(sessionId), `session_id complet journalisé : ${ligne}`);
  }
  // La trace tronquée reste présente, pour rester exploitable au diagnostic.
  assert.ok(captures.some((l) => l.includes("cs_test_SEC")), "la trace tronquée doit figurer");
});

/* ═══════════════════ H-2 — rate limit, exécuté ═══════════════════════ */

await test("7. changer X-Forwarded-For ne change pas l'identité réseau en production", async () => {
  const avant = process.env.NODE_ENV;
  setNodeEnv("production");
  try {
    const identites = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      const requete = new Request("https://exemple.test/api/business-inquiry", {
        method: "POST",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`, // forgé par le client
          "x-vercel-forwarded-for": "203.0.113.42", // posé par la plateforme
        },
      });
      identites.add(getTrustedClientIp(requete));
    }
    assert.deepEqual([...identites], ["203.0.113.42"], "l'en-tête client ne doit jamais l'emporter");
  } finally {
    setNodeEnv(avant);
  }
});

await test("8. sans en-tête de plateforme, X-Forwarded-For est ignoré en production", async () => {
  const avant = process.env.NODE_ENV;
  setNodeEnv("production");
  try {
    const requete = new Request("https://exemple.test/api/business-inquiry", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.7" },
    });
    assert.equal(getTrustedClientIp(requete), "unknown", "aucune identité forgée ne doit être retenue");
  } finally {
    setNodeEnv(avant);
  }
});

/**
 * Faux Upstash en mémoire : implémente INCR/PTTL/PEXPIRE via l'API REST
 * attendue par `consumeFromUpstash`. Permet d'exercer le VRAI chemin de
 * production (magasin partagé joignable) sans service externe.
 */
function installerUpstashFactice() {
  const compteurs = new Map<string, number>();
  const original = globalThis.fetch;
  globalThis.fetch = (async (entree: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entree);
    if (url.endsWith("/pipeline")) {
      const commandes = JSON.parse(String(init?.body ?? "[]")) as string[][];
      const cle = commandes[0]?.[1] ?? "";
      const valeur = (compteurs.get(cle) ?? 0) + 1;
      compteurs.set(cle, valeur);
      return new Response(JSON.stringify([{ result: valeur }, { result: 60000 }]), { status: 200 });
    }
    return new Response("{}", { status: 200 }); // PEXPIRE
  }) as typeof fetch;
  return {
    compteurs,
    restaurer: () => {
      globalThis.fetch = original;
    },
  };
}

await test("9. un quota ne se réinitialise pas en changeant X-Forwarded-For", async () => {
  const avant = process.env.NODE_ENV;
  setNodeEnv("production");
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.factice.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "jeton-de-test";
  const upstash = installerUpstashFactice();
  try {
    const decisions: boolean[] = [];
    // 5 requêtes, chacune avec un X-Forwarded-For DIFFÉRENT, mais la même
    // identité de plateforme. Le quota est de 3 : les deux dernières doivent
    // être refusées malgré l'en-tête qui change à chaque appel.
    for (let i = 0; i < 5; i += 1) {
      const requete = new Request("https://exemple.test/api/business-inquiry", {
        method: "POST",
        headers: {
          "x-forwarded-for": `198.51.100.${i}`,
          "x-vercel-forwarded-for": "203.0.113.99",
        },
      });
      const ip = getTrustedClientIp(requete);
      const decision = await consumeRateLimit(`comportement_h2:${ip}`, BUSINESS_INQUIRY_IP);
      decisions.push(decision.allowed);
    }
    assert.deepEqual(
      decisions,
      [true, true, true, false, false],
      "changer l'en-tête ne doit pas ouvrir un compteur neuf",
    );
    // Preuve complémentaire : une seule clé a été créée côté magasin.
    assert.equal(upstash.compteurs.size, 1, `5 en-têtes différents ont créé ${upstash.compteurs.size} compteur(s)`);
  } finally {
    upstash.restaurer();
    setNodeEnv(avant);
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

/**
 * Corps valide pour le formulaire « Services aux entreprises » — aligné sur
 * `lib/business-inquiry/schema.ts`. Un corps invalide serait rejeté en 400
 * AVANT la limitation de fréquence, et le test ne prouverait plus rien.
 */
function corpsDemandeEntreprise() {
  return {
    companyName: "Acme Industries",
    contactName: "Camille Martin",
    contactRole: "Responsable RH",
    email: "camille.martin@acme.test",
    phone: "01 23 45 67 89",
    headcount: "26-50",
    needs: ["prevention-tms", "qvt"],
    otherNeed: "",
    format: "sur-site",
    city: "Lyon",
    projectDetails: "Deux séances par semaine à partir de septembre.",
    privacyAccepted: true,
    website: "",
  };
}

await test("10. Upstash injoignable en production : 503, aucun email envoyé", async () => {
  reinitialiser();
  const avantEnv = process.env.NODE_ENV;
  const avantFetch = globalThis.fetch;
  setNodeEnv("production");
  process.env.UPSTASH_REDIS_REST_URL = "https://upstash.invalide.test";
  process.env.UPSTASH_REDIS_REST_TOKEN = "jeton-de-test";
  // Le magasin partagé est configuré mais ne répond pas.
  globalThis.fetch = (async () => {
    throw new Error("réseau indisponible (simulé)");
  }) as typeof fetch;

  try {
    const res = await businessInquiry(
      new Request("https://exemple.test/api/business-inquiry", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "203.0.113.200",
        },
        body: JSON.stringify(corpsDemandeEntreprise()),
      }),
    );
    const corps = await res.json();

    assert.equal(res.status, 503, "une route à effet externe doit refuser, pas s'ouvrir");
    assert.equal(etat.emailsEnvoyes.length, 0, "AUCUN email ne doit partir");
    assert.equal(etat.appelsBrevo.length, 0, "aucun appel à un service tiers");

    // Le message ne révèle rien de l'infrastructure.
    const message = String(corps.error ?? "");
    for (const fuite of ["Upstash", "Redis", "rate", "quota", "réseau", "token", "URL"]) {
      assert.ok(!message.toLowerCase().includes(fuite.toLowerCase()), `détail technique exposé : « ${message} »`);
    }
    assert.ok(message.length > 0, "un message générique doit être renvoyé");
  } finally {
    setNodeEnv(avantEnv);
    globalThis.fetch = avantFetch;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

await test("11. hors production, l'absence d'Upstash n'empêche pas le service", async () => {
  reinitialiser();
  const avant = process.env.NODE_ENV;
  setNodeEnv("development");
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    const res = await businessInquiry(
      new Request("https://exemple.test/api/business-inquiry", {
        method: "POST",
        headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.201" },
        body: JSON.stringify(corpsDemandeEntreprise()),
      }),
    );
    assert.equal(res.status, 200, "le développement local ne doit pas exiger Upstash");
    assert.equal(etat.emailsEnvoyes.length, 1, "l'email légitime doit partir");
  } finally {
    setNodeEnv(avant);
  }
});

/* ═══════════════════ H-3 — autorisations, exécutées ═════════════════ */

await test("12. admin : autorisé sur les actions globales", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-admin" };
  etat.role = "admin";

  const acces = await requireAdmin();
  assert.equal(acces.ok, true, "l'administrateur doit passer");
  assert.equal(acces.ok && acces.estAdmin, true);
});

await test("13. coach : refusé sur les actions globales (requireAdmin)", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";

  const acces = await requireAdmin();
  assert.equal(acces.ok, false, "un coach ne doit jamais passer requireAdmin");
  if (!acces.ok) assert.equal(acces.response.status, 403);
});

await test("14. coach : autorisé sur SON élève", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  etat.lignes = { coaches: { id: "coach-1" }, students: { coach_id: "coach-1" } };

  const acces = await requireStaffForStudent(UUID_A);
  assert.equal(acces.ok, true, "le coach doit pouvoir agir sur son propre élève");
});

await test("15. coach : refusé sur l'élève d'un autre coach", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  etat.lignes = { coaches: { id: "coach-1" }, students: { coach_id: "coach-2" } };

  const acces = await requireStaffForStudent(UUID_B);
  assert.equal(acces.ok, false, "l'élève d'un autre coach doit être refusé");
  if (!acces.ok) assert.equal(acces.response.status, 403);
});

await test("16. coach sans fiche : refusé, aucun repli sur un coach par défaut", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  etat.lignes = { coaches: null, students: { coach_id: "coach-1" } };

  const acces = await requireStaffForStudent(UUID_A);
  assert.equal(acces.ok, false, "sans fiche coach, aucun élève ne doit être accessible");
});

await test("17. admin : autorisé sur n'importe quel élève, sans condition d'affectation", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-admin" };
  etat.role = "admin";
  etat.lignes = { coaches: null, students: { coach_id: "coach-2" } };

  const acces = await requireStaffForStudent(UUID_B);
  assert.equal(acces.ok, true, "l'administrateur ne dépend d'aucune affectation");
});

await test("18. élève : refusé sur toutes les gardes staff", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-eleve" };
  etat.role = "student";

  for (const [nom, garde] of [
    ["requireAdmin", requireAdmin],
    ["requireStaff", requireStaff],
  ] as const) {
    const acces = await garde();
    assert.equal(acces.ok, false, `${nom} doit refuser un élève`);
    if (!acces.ok) assert.equal(acces.response.status, 403);
  }
  etat.lignes = { coaches: { id: "coach-1" }, students: { coach_id: "coach-1" } };
  const surEleve = await requireStaffForStudent(UUID_A);
  assert.equal(surEleve.ok, false, "un élève ne doit pas passer par la garde staff");
});

await test("19. non authentifié : 401, jamais 403", async () => {
  reinitialiser();
  etat.utilisateur = null;
  etat.role = null;

  const acces = await requireAdmin();
  assert.equal(acces.ok, false);
  if (!acces.ok) assert.equal(acces.response.status, 401);
});

await test("20. coach : refusé pour supprimer un coach (route exécutée)", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";

  const res = await supprimerCoach(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ coachId: UUID_B }),
  });
  assert.equal(res.status, 403, "un coach ne doit pas pouvoir supprimer un collaborateur");
});

await test("21. coach : refusé pour supprimer un administrateur (route exécutée)", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  // La cible est la fiche d'un administrateur.
  etat.lignes = { coaches: { id: UUID_A, user_id: "user-admin" }, profiles: { role: "admin" } };

  const res = await supprimerCoach(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ coachId: UUID_A }),
  });
  assert.equal(res.status, 403, "un coach ne doit jamais atteindre le compte d'un administrateur");
});

await test("22. coach : refusé pour supprimer définitivement un élève (route exécutée)", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  // Même s'il s'agit de SON élève : la suppression définitive est réservée
  // à l'administrateur (arbitrage Jules du 27/07/2026).
  etat.lignes = { coaches: { id: "coach-1" }, students: { coach_id: "coach-1" } };

  const res = await supprimerEleve(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ studentId: UUID_A }),
  });
  assert.equal(res.status, 403, "la suppression définitive doit rester administrateur");
});

await test("23. coach : refusé sur la facturation globale (route exécutée)", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";

  const res = await supprimerPaiement(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ id: UUID_A }),
  });
  assert.equal(res.status, 403, "un coach ne touche pas aux données de facturation");
});

await test("24. élève : refusé sur les routes staff exécutées", async () => {
  reinitialiser();
  etat.utilisateur = { id: "user-eleve" };
  etat.role = "student";

  for (const [nom, handler, params] of [
    ["suppression coach", supprimerCoach, { coachId: UUID_A }],
    ["suppression élève", supprimerEleve, { studentId: UUID_A }],
    ["suppression paiement", supprimerPaiement, { id: UUID_A }],
  ] as const) {
    const res = await handler(new Request("https://exemple.test", { method: "DELETE" }), {
      params: Promise.resolve(params),
    });
    assert.equal(res.status, 403, `${nom} : un élève doit être refusé`);
  }
});

await test("25. le refus ne distingue pas coach et élève", async () => {
  // Deux appelants différents, même réponse : rien n'indique au coach qu'il
  // lui « manque juste » un rôle.
  reinitialiser();
  etat.utilisateur = { id: "user-coach" };
  etat.role = "coach";
  const refusCoach = await supprimerPaiement(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ id: UUID_A }),
  });
  const corpsCoach = await refusCoach.json();

  reinitialiser();
  etat.utilisateur = { id: "user-eleve" };
  etat.role = "student";
  const refusEleve = await supprimerPaiement(new Request("https://exemple.test", { method: "DELETE" }), {
    params: Promise.resolve({ id: UUID_A }),
  });
  const corpsEleve = await refusEleve.json();

  assert.equal(refusCoach.status, refusEleve.status);
  assert.deepEqual(corpsCoach, corpsEleve, "les deux refus doivent être indiscernables");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

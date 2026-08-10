/**
 * L'OUTIL DE TEST ADMIN — QUI EST VRAIMENT CIBLÉ.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CETTE SUITE EXISTE POUR FERMER
 * ════════════════════════════════════════════════════════════════════════
 * 10/08/2026 : `push_subscriptions` contenait DEUX lignes actives pour le
 * compte élève, et le tableau de bord admin répondait pourtant « Aucun
 * appareil abonné. Active d'abord les notifications dans ton profil. »
 *
 * La cause n'était pas l'inscription : `NotificationTestButton` postait un
 * corps vide (`"{}"`), la route retombait donc sur `acces.user.id` — le
 * compte STAFF connecté — et cherchait les abonnements de l'administrateur,
 * qui n'en a aucun. Les deux appareils de l'élève n'ont jamais été
 * interrogés.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST EXÉCUTÉ, ET CE QUI EST DOUBLÉ
 * ════════════════════════════════════════════════════════════════════════
 * Le VRAI handler de route et les VRAIES gardes (`lib/api/authz.ts`) sont
 * exécutés. Sont doublés au niveau du module : l'identité de l'appelant,
 * le client Supabase service role, et le transport push — de sorte
 * qu'aucune base n'est lue et qu'aucun octet ne part sur le réseau.
 *
 * Les mocks sont pilotés par un `etat` mutable : `mock.module` s'applique au
 * premier import, il ne peut pas être reconfiguré après coup.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const moduleUrl = (relatif: string) => pathToFileURL(join(RACINE, relatif)).href;

let réussis = 0;
let échecs = 0;
async function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
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

/* ═════════════════════ Les deux élèves, et leurs appareils ═════════════════════ */

const ELEVE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const COMPTE_A = "11111111-1111-4111-8111-111111111111";
const COMPTE_B = "22222222-2222-4222-8222-222222222222";
const COMPTE_STAFF = "99999999-9999-4999-8999-999999999999";

const IPHONE_A = "https://web.push.apple.com/eleve-A-iphone";
const IPAD_A = "https://web.push.apple.com/eleve-A-ipad";
const IPHONE_B = "https://web.push.apple.com/eleve-B-iphone";

interface LigneAbonnement {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  disabled_at: string | null;
}

interface ResultatEnvoi {
  endpoint: string;
  statut: "envoyee" | "echouee";
  codeErreur: string | null;
  suite: "aucune" | "desactiver";
}

interface Etat {
  utilisateur: { id: string } | null;
  role: string | null;
  /** Fiches `students`, par identifiant de fiche. */
  eleves: Record<string, { user_id: string | null; coach_id: string | null }>;
  /** Fiche `coaches` du compte connecté, s'il en a une. */
  ficheCoach: { id: string } | null;
  abonnements: LigneAbonnement[];
  /** Ce que le transport push répond, appareil par appareil. */
  verdicts: Record<string, ResultatEnvoi["statut"] | number>;
  /* Effets observés. */
  envois: { endpoints: string[] }[];
  desactives: { endpoint: string; raison: string }[];
  succes: string[];
}

const etat: Etat = {
  utilisateur: null, role: null, eleves: {}, ficheCoach: null,
  abonnements: [], verdicts: {}, envois: [], desactives: [], succes: [],
};

function reinitialiser() {
  etat.utilisateur = { id: COMPTE_STAFF };
  etat.role = "admin";
  etat.ficheCoach = null;
  etat.eleves = {
    [ELEVE_A]: { user_id: COMPTE_A, coach_id: null },
    [ELEVE_B]: { user_id: COMPTE_B, coach_id: null },
  };
  etat.abonnements = [
    { id: "s1", user_id: COMPTE_A, endpoint: IPHONE_A, p256dh: "PA1", auth: "AA1", disabled_at: null },
    { id: "s2", user_id: COMPTE_A, endpoint: IPAD_A, p256dh: "PA2", auth: "AA2", disabled_at: null },
    { id: "s3", user_id: COMPTE_B, endpoint: IPHONE_B, p256dh: "PB1", auth: "AB1", disabled_at: null },
  ];
  etat.verdicts = {};
  etat.envois = [];
  etat.desactives = [];
  etat.succes = [];
}

/* ═════════════════════ Double du client service role ═════════════════════ */

/**
 * Assez de Supabase pour ce que la route fait RÉELLEMENT :
 *   students          .select().eq("id",…).maybeSingle()
 *   coaches           .select().eq("user_id",…).maybeSingle()
 *   push_subscriptions.select().eq("user_id",…).is("disabled_at", null)
 *   push_subscriptions.update({…}).eq("endpoint",…)
 *
 * Les filtres sont ACCUMULÉS puis appliqués : un test qui cible l'élève A ne
 * peut pas recevoir les lignes de B par inadvertance.
 */
function faireClientSupabase() {
  function requete(table: string) {
    const filtres: Record<string, unknown> = {};
    let miseAJour: Record<string, unknown> | null = null;

    const lignes = (): LigneAbonnement[] => {
      if (table !== "push_subscriptions") return [];
      return etat.abonnements.filter((l) =>
        Object.entries(filtres).every(([col, val]) => (l as unknown as Record<string, unknown>)[col] === val),
      );
    };

    const chaine: Record<string, unknown> = {
      select: () => chaine,
      eq: (colonne: string, valeur: unknown) => {
        filtres[colonne] = valeur;
        return chaine;
      },
      is: (colonne: string, valeur: null) => {
        filtres[colonne] = valeur;
        return chaine;
      },
      update: (valeurs: Record<string, unknown>) => {
        miseAJour = valeurs;
        return chaine;
      },
      maybeSingle: async () => {
        if (table === "students") {
          const id = filtres.id as string;
          return { data: etat.eleves[id] ?? null, error: null };
        }
        if (table === "coaches") return { data: etat.ficheCoach, error: null };
        return { data: null, error: null };
      },
      // `await` sur la chaîne : lecture filtrée, ou application de l'update.
      then: (resoudre: (v: unknown) => unknown) => {
        if (miseAJour) {
          const endpoint = filtres.endpoint as string;
          const maj = miseAJour as Record<string, unknown>;
          if (maj.disabled_at) {
            etat.desactives.push({ endpoint, raison: String(maj.disabled_reason ?? "") });
            for (const l of etat.abonnements) {
              if (l.endpoint === endpoint) l.disabled_at = String(maj.disabled_at);
            }
          } else if (maj.last_success_at) {
            etat.succes.push(endpoint);
          }
          return Promise.resolve({ error: null }).then(resoudre);
        }
        return Promise.resolve({ data: lignes(), error: null }).then(resoudre);
      },
    };
    return chaine;
  }
  return { from: (table: string) => requete(table) };
}

/* ═════════════════════ Mocks de modules ═════════════════════ */

mock.module(moduleUrl("lib/supabase/admin.ts"), {
  namedExports: { createSupabaseAdminClient: () => faireClientSupabase() },
});

mock.module(moduleUrl("lib/supabase/auth.ts"), {
  namedExports: {
    getCurrentUser: async () => etat.utilisateur,
    getCurrentUserRole: async () => etat.role,
    getProfileByUserId: async () => null,
    getCurrentProfile: async () => null,
    isAdminOrCoach: async () => etat.role === "admin" || etat.role === "coach",
    isStudent: async () => etat.role === "student",
  },
});

mock.module(moduleUrl("lib/supabase/server.ts"), {
  namedExports: { createSupabaseServerClient: async () => faireClientSupabase() },
});

/**
 * Le transport push, remplacé par un greffier. Il note QUELS endpoints on
 * lui a demandé de servir — c'est toute la question de cette suite — et rend
 * le verdict que le test a choisi pour chacun.
 */
mock.module(moduleUrl("lib/push/envoyer.ts"), {
  namedExports: {
    envoyerNotifications: async (abonnements: { endpoint: string }[]) => {
      etat.envois.push({ endpoints: abonnements.map((a) => a.endpoint) });
      return abonnements.map((a) => {
        const verdict = etat.verdicts[a.endpoint];
        if (typeof verdict === "number") {
          return {
            endpoint: a.endpoint,
            statut: "echouee" as const,
            codeErreur: String(verdict),
            suite: verdict === 404 || verdict === 410 ? ("desactiver" as const) : ("aucune" as const),
          };
        }
        return { endpoint: a.endpoint, statut: "envoyee" as const, codeErreur: null, suite: "aucune" as const };
      });
    },
  },
});

/* ═════════════════════ Import APRÈS les mocks ═════════════════════ */

const route = await import(moduleUrl("app/api/admin/notifications/test/route.ts"));
const envoyerTest = route.POST as (r: Request) => Promise<Response>;
const compterTest = route.GET as ((r: Request) => Promise<Response>) | undefined;

function requete(corps: unknown): Request {
  return new Request("https://exemple.test/api/admin/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corps),
  });
}

/** Toutes les valeurs texte d'une réponse, à plat — pour y chercher un secret. */
function valeursTexte(valeur: unknown, acc: string[] = []): string[] {
  if (typeof valeur === "string") acc.push(valeur);
  else if (Array.isArray(valeur)) valeur.forEach((v) => valeursTexte(v, acc));
  else if (valeur && typeof valeur === "object") Object.values(valeur).forEach((v) => valeursTexte(v, acc));
  return acc;
}

/* ════════════════════════════════════════════════════════════════════════
 * TESTPUSH1-7
 * ════════════════════════════════════════════════════════════════════════ */

await test("TESTPUSH1. l'admin choisit l'élève A : SEULS les appareils de A sont ciblés", async () => {
  reinitialiser();
  // Un `userId` fabriqué dans le navigateur est joint À DESSEIN : le serveur
  // ne doit lire QUE `studentId`, et résoudre le compte lui-même.
  const res = await envoyerTest(requete({ studentId: ELEVE_A, userId: COMPTE_STAFF }));
  const corps = await res.json();

  assert.equal(res.status, 200, `statut inattendu : ${res.status}`);
  assert.equal(etat.envois.length, 1, "un seul envoi doit être tenté");
  assert.deepEqual([...etat.envois[0].endpoints].sort(), [IPAD_A, IPHONE_A].sort());
  assert.equal(corps.utilisateursCibles, 1);
});

await test("TESTPUSH2. A possède 2 appareils : 2 tentatives d'envoi, et l'aperçu l'annonce", async () => {
  reinitialiser();
  const res = await envoyerTest(requete({ studentId: ELEVE_A }));
  const corps = await res.json();

  assert.equal(etat.envois[0].endpoints.length, 2, "les deux appareils doivent être servis");
  assert.equal(corps.appareilsCibles, 2);
  assert.equal(corps.envoyes, 2);
  assert.equal(corps.echoues, 0);

  // L'aperçu qui alimente « 2 appareils joignables » avant tout envoi.
  assert.ok(compterTest, "la route doit exposer un aperçu (GET) pour compter sans envoyer");
  const avant = etat.envois.length;
  const apercu = await compterTest(
    new Request(`https://exemple.test/api/admin/notifications/test?studentId=${ELEVE_A}`),
  );
  const vu = await apercu.json();
  assert.equal(apercu.status, 200);
  assert.equal(vu.appareilsCibles, 2);
  assert.equal(etat.envois.length, avant, "l'aperçu ne doit RIEN envoyer");
});

await test("TESTPUSH3. B n'est jamais ciblé quand on choisit A", async () => {
  reinitialiser();
  await envoyerTest(requete({ studentId: ELEVE_A }));
  const servis = etat.envois.flatMap((e) => e.endpoints);
  assert.ok(!servis.includes(IPHONE_B), "l'appareil de B ne doit jamais recevoir");
  assert.equal(etat.desactives.length, 0, "aucun appareil de B ne doit être touché");
});

await test("TESTPUSH4. élève sans appareil : 0 joignable, et surtout pas une erreur serveur", async () => {
  reinitialiser();
  etat.abonnements = etat.abonnements.filter((l) => l.user_id !== COMPTE_A);
  const res = await envoyerTest(requete({ studentId: ELEVE_A }));
  const corps = await res.json();

  assert.equal(res.status, 200, "un élève sans appareil n'est pas une panne");
  assert.equal(corps.utilisateursCibles, 1, "l'élève existe : il reste une cible");
  assert.equal(corps.appareilsCibles, 0);
  assert.equal(corps.envoyes, 0);
  assert.equal(corps.echoues, 0);
  assert.equal(etat.envois.length, 0, "rien ne doit être tenté");
});

await test("TESTPUSH5. un non-staff reçoit 403, et aucun envoi n'est tenté", async () => {
  for (const role of ["student", null]) {
    reinitialiser();
    etat.role = role;
    const res = await envoyerTest(requete({ studentId: ELEVE_A }));
    assert.equal(res.status, 403, `rôle ${String(role)} : 403 attendu, reçu ${res.status}`);
    assert.equal(etat.envois.length, 0, "un refus ne doit rien envoyer");
  }

  // Pas de session du tout : 401, et toujours rien d'envoyé.
  reinitialiser();
  etat.utilisateur = null;
  etat.role = null;
  const anonyme = await envoyerTest(requete({ studentId: ELEVE_A }));
  assert.equal(anonyme.status, 401);
  assert.equal(etat.envois.length, 0);
});

await test("TESTPUSH6. la réponse ne contient AUCUN endpoint, p256dh ni auth", async () => {
  reinitialiser();
  etat.verdicts[IPAD_A] = 410; // même en cas d'échec, rien ne doit fuiter
  const res = await envoyerTest(requete({ studentId: ELEVE_A }));
  const corps = await res.json();

  const clesAutorisees = new Set(["ok", "utilisateursCibles", "appareilsCibles", "envoyes", "echoues"]);
  for (const cle of Object.keys(corps)) {
    assert.ok(clesAutorisees.has(cle), `champ inattendu dans la réponse : ${cle}`);
  }
  const texte = valeursTexte(corps).join(" ") + JSON.stringify(corps);
  for (const secret of [IPHONE_A, IPAD_A, IPHONE_B, "PA1", "PA2", "AA1", "AA2", "web.push.apple.com"]) {
    assert.ok(!texte.includes(secret), `« ${secret} » ne doit jamais sortir de l'API`);
  }
});

await test("TESTPUSH7. 410 sur un appareil : lui seul est désactivé, l'autre reçoit", async () => {
  reinitialiser();
  etat.verdicts[IPHONE_A] = 410;
  const res = await envoyerTest(requete({ studentId: ELEVE_A }));
  const corps = await res.json();

  assert.equal(etat.envois[0].endpoints.length, 2, "les deux ont été tentés");
  assert.deepEqual(etat.desactives.map((d) => d.endpoint), [IPHONE_A], "un seul appareil désactivé");
  assert.deepEqual(etat.succes, [IPAD_A], "l'appareil vivant est marqué servi");

  const ipad = etat.abonnements.find((l) => l.endpoint === IPAD_A)!;
  assert.equal(ipad.disabled_at, null, "l'appareil vivant ne doit pas être désactivé");
  assert.equal(corps.envoyes, 1);
  assert.equal(corps.echoues, 1);
  assert.equal(corps.appareilsCibles, 2);

  // 500 n'est PAS une raison de désactiver : la panne peut être passagère.
  reinitialiser();
  etat.verdicts[IPHONE_A] = 500;
  await envoyerTest(requete({ studentId: ELEVE_A }));
  assert.deepEqual(etat.desactives, [], "une panne serveur ne doit désactiver personne");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

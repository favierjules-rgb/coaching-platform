/**
 * LE CENTRE DE NOTIFICATIONS — CIBLAGE, PROGRAMMATION, RÉCURRENCE, REPRISE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST EXÉCUTÉ
 * ════════════════════════════════════════════════════════════════════════
 * Les VRAIS handlers de route, les VRAIES gardes d'autorisation, le VRAI
 * planificateur et le VRAI calcul d'échéance. Sont doublés : l'identité de
 * l'appelant, le transport push, et la base.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA BASE DOUBLÉE ARBITRE VRAIMENT
 * ════════════════════════════════════════════════════════════════════════
 * Un double qui accepte tout ne prouverait rien de l'idempotence — or c'est
 * elle qu'on teste. Ce double applique donc réellement les deux contraintes
 * d'unicité du schéma :
 *
 *     notification_occurrences  unique (campaign_id, scheduled_for)
 *     notification_deliveries   unique (occurrence_id, subscription_id)
 *
 * Une insertion en conflit rend l'erreur `23505`, comme Postgres. C'est ce
 * qui rend ADMINPUSH15 (deux crons simultanés) autre chose qu'une
 * déclaration d'intention.
 */

import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const moduleUrl = (relatif: string) => pathToFileURL(join(RACINE, relatif)).href;
const lire = (relatif: string) => readFileSync(join(RACINE, relatif), "utf8");

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

/* ═══════════════════════ Le monde de référence ═══════════════════════ */

const ELEVE_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ELEVE_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const ELEVE_C = "cccccccc-3333-4333-8333-cccccccccccc"; // sans aucun appareil
const COMPTE_A = "11111111-1111-4111-8111-111111111111";
const COMPTE_B = "22222222-2222-4222-8222-222222222222";
const COMPTE_C = "33333333-3333-4333-8333-333333333333";
const ADMIN = "99999999-9999-4999-8999-999999999999";

const IPHONE_A = "https://web.push.apple.com/A-iphone";
const IPAD_A = "https://web.push.apple.com/A-ipad";
const IPHONE_B = "https://web.push.apple.com/B-iphone";

type Ligne = Record<string, unknown>;

interface Base {
  students: Ligne[];
  coaches: Ligne[];
  push_subscriptions: Ligne[];
  notification_campaigns: Ligne[];
  notification_campaign_targets: Ligne[];
  notification_occurrences: Ligne[];
  notification_deliveries: Ligne[];
}

const etat: {
  utilisateur: { id: string } | null;
  role: string | null;
  base: Base;
  /** endpoint → verdict : `true` = envoyé, un nombre = statut HTTP d'échec. */
  verdicts: Record<string, true | number>;
  envois: { endpoints: string[]; titre: string; corps: string; destination: string }[];
  compteur: number;
} = {
  utilisateur: null, role: null,
  base: {
    students: [], coaches: [], push_subscriptions: [], notification_campaigns: [],
    notification_campaign_targets: [], notification_occurrences: [], notification_deliveries: [],
  },
  verdicts: {}, envois: [], compteur: 0,
};

function reinitialiser() {
  etat.utilisateur = { id: ADMIN };
  etat.role = "admin";
  etat.verdicts = {};
  etat.envois = [];
  etat.compteur = 0;
  etat.base = {
    students: [
      { id: ELEVE_A, user_id: COMPTE_A, coach_id: null },
      { id: ELEVE_B, user_id: COMPTE_B, coach_id: null },
      { id: ELEVE_C, user_id: COMPTE_C, coach_id: null },
    ],
    coaches: [],
    push_subscriptions: [
      { id: "sub-A1", user_id: COMPTE_A, endpoint: IPHONE_A, p256dh: "PA1", auth: "AA1", disabled_at: null, disabled_reason: null },
      { id: "sub-A2", user_id: COMPTE_A, endpoint: IPAD_A, p256dh: "PA2", auth: "AA2", disabled_at: null, disabled_reason: null },
      { id: "sub-B1", user_id: COMPTE_B, endpoint: IPHONE_B, p256dh: "PB1", auth: "AB1", disabled_at: null, disabled_reason: null },
    ],
    notification_campaigns: [], notification_campaign_targets: [],
    notification_occurrences: [], notification_deliveries: [],
  };
}

/* ═══════════════════════ Le double de Supabase ═══════════════════════ */

const UNIQUES: Record<string, string[][]> = {
  notification_occurrences: [["campaign_id", "scheduled_for"]],
  notification_deliveries: [["occurrence_id", "subscription_id"]],
  push_subscriptions: [["endpoint"]],
};

const DEFAUTS: Record<string, Ligne> = {
  notification_campaigns: { active: true, status: "programmee", recurrence: null, next_run_at: null, timezone: "Europe/Paris", created_at: "2026-08-10T00:00:00.000Z" },
  notification_occurrences: { status: "en_attente", claimed_at: null, finished_at: null },
  notification_deliveries: { status: "en_attente", error_code: null, attempted_at: null, sent_at: null },
};

interface Filtre {
  colonne: string;
  genre: "eq" | "in" | "is" | "lte" | "notis";
  valeur: unknown;
}

function correspond(ligne: Ligne, filtres: Filtre[]): boolean {
  return filtres.every((f) => {
    const v = ligne[f.colonne];
    if (f.genre === "eq") return v === f.valeur;
    if (f.genre === "in") return (f.valeur as unknown[]).includes(v);
    if (f.genre === "is") return v === null || v === undefined;
    if (f.genre === "notis") return v !== null && v !== undefined;
    return typeof v === "string" && typeof f.valeur === "string" && v <= f.valeur;
  });
}

function faireClient() {
  function requete(table: keyof Base) {
    const filtres: Filtre[] = [];
    let operation: "select" | "insert" | "update" | "delete" = "select";
    let valeurs: Ligne | Ligne[] = {};
    let tri: { colonne: string; asc: boolean } | null = null;

    function executer(): { data: unknown; error: unknown } {
      const lignes = etat.base[table];

      if (operation === "insert") {
        const aInserer = Array.isArray(valeurs) ? valeurs : [valeurs];
        const creees: Ligne[] = [];
        for (const brute of aInserer) {
          const ligne: Ligne = { ...(DEFAUTS[table] ?? {}), ...brute };
          if (ligne.id === undefined) {
            etat.compteur += 1;
            ligne.id = `${table}-${etat.compteur}`;
          }
          // Les contraintes d'unicité du schéma, appliquées pour de vrai.
          for (const cles of UNIQUES[table] ?? []) {
            const conflit = lignes.some((l) => cles.every((c) => l[c] === ligne[c]));
            if (conflit) return { data: null, error: { code: "23505", message: "duplicate key" } };
          }
          lignes.push(ligne);
          creees.push(ligne);
        }
        return { data: creees, error: null };
      }

      if (operation === "update") {
        const touchees = lignes.filter((l) => correspond(l, filtres));
        for (const l of touchees) Object.assign(l, valeurs);
        return { data: touchees, error: null };
      }

      if (operation === "delete") {
        const restantes = lignes.filter((l) => !correspond(l, filtres));
        etat.base[table] = restantes;
        return { data: [], error: null };
      }

      let resultat = lignes.filter((l) => correspond(l, filtres));
      if (tri) {
        const { colonne, asc } = tri;
        resultat = [...resultat].sort((x, y) => {
          const a = String(x[colonne] ?? "");
          const b = String(y[colonne] ?? "");
          return asc ? a.localeCompare(b) : b.localeCompare(a);
        });
      }
      return { data: resultat.map((l) => ({ ...l })), error: null };
    }

    const chaine: Record<string, unknown> = {
      select: () => chaine,
      insert: (v: Ligne | Ligne[]) => { operation = "insert"; valeurs = v; return chaine; },
      update: (v: Ligne) => { operation = "update"; valeurs = v; return chaine; },
      delete: () => { operation = "delete"; return chaine; },
      eq: (c: string, v: unknown) => { filtres.push({ colonne: c, genre: "eq", valeur: v }); return chaine; },
      in: (c: string, v: unknown[]) => { filtres.push({ colonne: c, genre: "in", valeur: v }); return chaine; },
      is: (c: string) => { filtres.push({ colonne: c, genre: "is", valeur: null }); return chaine; },
      lte: (c: string, v: unknown) => { filtres.push({ colonne: c, genre: "lte", valeur: v }); return chaine; },
      not: (c: string) => { filtres.push({ colonne: c, genre: "notis", valeur: null }); return chaine; },
      order: (c: string, o?: { ascending?: boolean }) => { tri = { colonne: c, asc: o?.ascending !== false }; return chaine; },
      maybeSingle: async () => {
        const r = executer();
        if (r.error) return r;
        const liste = r.data as Ligne[];
        return { data: liste.length > 0 ? liste[0] : null, error: null };
      },
      then: (suite: (v: unknown) => unknown) => Promise.resolve(executer()).then(suite),
    };
    return chaine;
  }
  return { from: (table: string) => requete(table as keyof Base) };
}

/* ═══════════════════════ Mocks ═══════════════════════ */

mock.module(moduleUrl("lib/supabase/admin.ts"), {
  namedExports: { createSupabaseAdminClient: () => faireClient() },
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
  namedExports: { createSupabaseServerClient: async () => faireClient() },
});
mock.module(moduleUrl("lib/push/envoyer.ts"), {
  namedExports: {
    envoyerNotifications: async (
      abonnements: { endpoint: string }[],
      contenu: { titre: string; corps: string; destination: string },
    ) => {
      etat.envois.push({ endpoints: abonnements.map((a) => a.endpoint), ...contenu });
      return abonnements.map((a) => {
        const v = etat.verdicts[a.endpoint];
        if (typeof v === "number") {
          return {
            endpoint: a.endpoint, statut: "echouee" as const, codeErreur: String(v),
            suite: v === 404 || v === 410 ? ("desactiver" as const) : ("aucune" as const),
          };
        }
        return { endpoint: a.endpoint, statut: "envoyee" as const, codeErreur: null, suite: "aucune" as const };
      });
    },
  },
});

process.env.NOTIFICATION_CRON_SECRET = "secret-de-test";

const campagnes = await import(moduleUrl("app/api/admin/notifications/campaigns/route.ts"));
const parCampagne = await import(moduleUrl("app/api/admin/notifications/campaigns/[id]/route.ts"));
const audience = await import(moduleUrl("app/api/admin/notifications/audience/route.ts"));
const cron = await import(moduleUrl("app/api/cron/notifications/route.ts"));
const { prochaineEcheance, lireRegle } = await import(moduleUrl("lib/notifications/recurrence.ts"));
const { lireSaisie } = await import(moduleUrl("lib/notifications/saisie.ts"));

const creer = campagnes.POST as (r: Request) => Promise<Response>;
const lister = campagnes.GET as () => Promise<Response>;
const modifier = parCampagne.PATCH as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
const supprimer = parCampagne.DELETE as (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
const compter = audience.POST as (r: Request) => Promise<Response>;
const planifier = cron.POST as (r: Request) => Promise<Response>;

function requeteJson(corps: unknown, url = "https://exemple.test/api/admin/notifications/campaigns"): Request {
  return new Request(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corps),
  });
}
function requeteCron(secret = "secret-de-test"): Request {
  return new Request("https://exemple.test/api/cron/notifications", {
    method: "POST", headers: { authorization: `Bearer ${secret}` },
  });
}
function contexte(id: string) {
  return { params: Promise.resolve({ id }) };
}

const MESSAGE = { titre: "Rappel", corps: "Pense à renseigner ton poids.", destination: "/profil" };
const servis = () => etat.envois.flatMap((e) => e.endpoints);

/* ════════════════════════════ ADMINPUSH1-4 : LE CIBLAGE ════════════════════════════ */

await test("ADMINPUSH1. un élève : seuls SES appareils sont servis", async () => {
  reinitialiser();
  const res = await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" },
  }));
  const corps = await res.json();
  assert.equal(res.status, 200, JSON.stringify(corps));
  assert.deepEqual([...servis()].sort(), [IPAD_A, IPHONE_A].sort());
  assert.equal(corps.envoyes, 2);
});

await test("ADMINPUSH2. plusieurs élèves : les appareils des deux, et d'eux seuls", async () => {
  reinitialiser();
  await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A, ELEVE_B] }, quand: { mode: "now" },
  }));
  assert.deepEqual([...servis()].sort(), [IPAD_A, IPHONE_A, IPHONE_B].sort());
});

await test("ADMINPUSH3. tout le monde : tous les comptes rattachés à un élève", async () => {
  reinitialiser();
  const res = await creer(requeteJson({ ...MESSAGE, cible: { genre: "all" }, quand: { mode: "now" } }));
  const corps = await res.json();
  assert.equal(res.status, 200, JSON.stringify(corps));
  assert.deepEqual([...servis()].sort(), [IPAD_A, IPHONE_A, IPHONE_B].sort());
  // L'élève C existe et a un compte, mais aucun appareil : il ne fait pas
  // échouer l'envoi et n'ajoute aucun push.
  assert.equal(corps.appareilsCibles, 3);
});

await test("ADMINPUSH4. confirmation globale : les trois nombres, et « tout le monde » réservé à l'admin", async () => {
  reinitialiser();
  const res = await compter(requeteJson({ genre: "all" }, "https://exemple.test/api/admin/notifications/audience"));
  const corps = await res.json();
  assert.equal(corps.cibles, 3, "trois élèves visés");
  assert.equal(corps.joignables, 2, "seuls A et B ont un appareil");
  assert.equal(corps.appareils, 3, "deux appareils pour A, un pour B");

  // Un coach ne peut pas viser tout le monde — ni l'envoyer, ni même le compter.
  etat.role = "coach";
  assert.equal((await compter(requeteJson({ genre: "all" }, "https://exemple.test/api/admin/notifications/audience"))).status, 403);
  assert.equal((await creer(requeteJson({ ...MESSAGE, cible: { genre: "all" }, quand: { mode: "now" } }))).status, 403);
  assert.equal(etat.envois.length, 0, "un refus ne doit rien envoyer");
});

/* ════════════════════════════ ADMINPUSH5-7 : LE TEMPS ════════════════════════════ */

await test("ADMINPUSH5. envoi immédiat : une occurrence, une seule, et la campagne est close", async () => {
  reinitialiser();
  await creer(requeteJson({ ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" } }));
  assert.equal(etat.base.notification_occurrences.length, 1);
  assert.equal(etat.base.notification_occurrences[0].status, "envoyee");
  const campagne = etat.base.notification_campaigns[0];
  assert.equal(campagne.active, false, "un envoi immédiat ne se répète pas");
  assert.equal(campagne.next_run_at, null);
  assert.equal(etat.base.notification_deliveries.length, 2, "un envoi par APPAREIL");
});

await test("ADMINPUSH6. programmée pour plus tard : le planificateur ne touche à rien avant l'heure", async () => {
  reinitialiser();
  const dans2h = new Date(Date.now() + 2 * 3600_000);
  const jour = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(dans2h);
  const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(dans2h);

  const res = await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] },
    quand: { mode: "once", date: jour, heure, fuseau: "Europe/Paris" },
  }));
  assert.equal(res.status, 200);
  assert.equal(etat.envois.length, 0, "rien ne part à la création");

  const bilan = await (await planifier(requeteCron())).json();
  assert.equal(bilan.occurrences, 0, "l'heure n'est pas venue");
  assert.equal(etat.envois.length, 0);
  assert.equal(etat.base.notification_occurrences.length, 0);
});

await test("ADMINPUSH7. l'heure arrive : le planificateur envoie, une fois", async () => {
  reinitialiser();
  // Une échéance dans le passé : c'est exactement ce que voit le cron une
  // minute après l'heure prévue.
  etat.base.notification_campaigns.push({
    id: "camp-7", created_by: ADMIN, title: "Rappel", body: "Ton poids", destination: "/profil",
    target_kind: "students", schedule_kind: "once", timezone: "Europe/Paris", recurrence: null,
    next_run_at: new Date(Date.now() - 60_000).toISOString(), active: true, status: "programmee",
    created_at: "2026-08-10T00:00:00.000Z",
  });
  etat.base.notification_campaign_targets.push({ campaign_id: "camp-7", student_id: ELEVE_A });

  const bilan = await (await planifier(requeteCron())).json();
  assert.equal(bilan.occurrences, 1);
  assert.equal(bilan.envoyes, 2);
  assert.deepEqual([...servis()].sort(), [IPAD_A, IPHONE_A].sort());

  // Deuxième passage : plus d'échéance, donc plus rien.
  etat.envois = [];
  const second = await (await planifier(requeteCron())).json();
  assert.equal(second.occurrences, 0);
  assert.equal(etat.envois.length, 0, "une occurrence passée ne repart jamais");
});

/* ════════════════════════════ ADMINPUSH8-10 : LA RÉCURRENCE ════════════════════════════ */

await test("ADMINPUSH8. hebdomadaire : l'échéance suivante tombe sept jours plus tard, à la même heure locale", async () => {
  reinitialiser();
  const regle = lireRegle({ freq: "weekly", weekdays: [1], hour: 8, minute: 0 })!;
  const premiere = prochaineEcheance(regle, "Europe/Paris", new Date("2026-08-10T00:00:00Z"))!;
  const seconde = prochaineEcheance(regle, "Europe/Paris", premiere)!;
  assert.equal(seconde.getTime() - premiere.getTime(), 7 * 24 * 3600_000);

  const heureLocale = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  assert.equal(heureLocale(premiere), "08:00");
  assert.equal(heureLocale(seconde), "08:00");

  // Et le planificateur repose bien cette échéance après avoir envoyé.
  etat.base.notification_campaigns.push({
    id: "camp-8", created_by: ADMIN, title: "Rappel poids", body: "Ton poids", destination: "/profil",
    target_kind: "all", schedule_kind: "recurring", timezone: "Europe/Paris",
    recurrence: { freq: "weekly", weekdays: [1], hour: 8, minute: 0 },
    next_run_at: new Date(Date.now() - 60_000).toISOString(), active: true, status: "programmee",
    created_at: "2026-08-10T00:00:00.000Z",
  });
  await planifier(requeteCron());
  const camp = etat.base.notification_campaigns.find((c) => c.id === "camp-8")!;
  assert.equal(camp.active, true, "une campagne récurrente reste active");
  assert.ok(camp.next_run_at, "une nouvelle échéance doit être posée");
  assert.ok(new Date(String(camp.next_run_at)).getTime() > Date.now(), "et elle est dans le futur");
  assert.equal(heureLocale(new Date(String(camp.next_run_at))), "08:00");
});

await test("ADMINPUSH9. certains jours : mardi ET jeudi, en alternance, à 20:00", () => {
  const regle = lireRegle({ freq: "weekly", weekdays: [2, 4], hour: 20, minute: 0 })!;
  let t = new Date("2026-08-10T06:00:00Z"); // un lundi
  const jours: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    t = prochaineEcheance(regle, "Europe/Paris", t)!;
    jours.push(new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t));
  }
  assert.deepEqual(jours, ["mardi 20:00", "jeudi 20:00", "mardi 20:00", "jeudi 20:00"]);
});

await test("ADMINPUSH10. changement d'heure : 08:00 reste 08:00, l'instant UTC change", () => {
  const regle = lireRegle({ freq: "weekly", weekdays: [1], hour: 8, minute: 0 })!;
  const hiver = prochaineEcheance(regle, "Europe/Paris", new Date("2026-01-05T12:00:00Z"))!;
  const ete = prochaineEcheance(regle, "Europe/Paris", new Date("2026-07-06T12:00:00Z"))!;

  const local = (d: Date) =>
    new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  assert.equal(local(hiver), "08:00");
  assert.equal(local(ete), "08:00");
  // La preuve que ce n'est PAS une addition de durée : l'heure UTC diffère.
  assert.equal(hiver.getUTCHours(), 7, "08:00 Paris en hiver = 07:00 UTC");
  assert.equal(ete.getUTCHours(), 6, "08:00 Paris en été = 06:00 UTC");

  // Le lundi qui suit immédiatement le passage à l'heure d'été (29/03/2026).
  const apresBascule = prochaineEcheance(regle, "Europe/Paris", new Date("2026-03-29T12:00:00Z"))!;
  assert.equal(local(apresBascule), "08:00");
  assert.equal(apresBascule.getUTCHours(), 6);
});

/* ════════════════════════════ ADMINPUSH11-14 : LE CYCLE DE VIE ════════════════════════════ */

async function campagneHebdo(id = "camp-vie") {
  etat.base.notification_campaigns.push({
    id, created_by: ADMIN, title: "Rappel poids", body: "Ton poids", destination: "/profil",
    target_kind: "all", schedule_kind: "recurring", timezone: "Europe/Paris",
    recurrence: { freq: "weekly", weekdays: [1], hour: 8, minute: 0 },
    next_run_at: new Date(Date.now() - 60_000).toISOString(), active: true, status: "programmee",
    created_at: "2026-08-10T00:00:00.000Z",
  });
  return id;
}

await test("ADMINPUSH11. pause : plus aucune échéance, et le planificateur ne trouve rien", async () => {
  reinitialiser();
  const id = await campagneHebdo();
  const res = await modifier(requeteJson({ active: false }), contexte(id));
  assert.equal(res.status, 200);
  const camp = etat.base.notification_campaigns[0];
  assert.equal(camp.active, false);
  assert.equal(camp.next_run_at, null, "une campagne en pause n'a plus d'échéance en attente");

  const bilan = await (await planifier(requeteCron())).json();
  assert.equal(bilan.occurrences, 0);
  assert.equal(etat.envois.length, 0);
});

await test("ADMINPUSH12. réactivation : l'échéance est RECALCULÉE, jamais restaurée", async () => {
  reinitialiser();
  const id = await campagneHebdo();
  await modifier(requeteJson({ active: false }), contexte(id));
  const res = await modifier(requeteJson({ active: true }), contexte(id));
  const corps = await res.json();
  assert.equal(corps.active, true);
  assert.ok(corps.prochaineEcheance, "une échéance doit revenir");
  assert.ok(
    new Date(corps.prochaineEcheance).getTime() > Date.now(),
    "et dans le FUTUR : restaurer l'ancienne ferait partir la campagne immédiatement, puis à chaque minute",
  );
  const bilan = await (await planifier(requeteCron())).json();
  assert.equal(bilan.occurrences, 0, "rien ne part avant la nouvelle échéance");
});

await test("ADMINPUSH13. modification : le futur change, le passé reste tel qu'il est parti", async () => {
  reinitialiser();
  const id = await campagneHebdo();
  await planifier(requeteCron());
  const envoiInitial = etat.envois[0];
  assert.equal(envoiInitial.titre, "Rappel poids");

  await modifier(requeteJson({ titre: "Nouveau titre", corps: "Nouveau message", destination: "/entrainement" }), contexte(id));
  const camp = etat.base.notification_campaigns[0];
  assert.equal(camp.title, "Nouveau titre");
  assert.equal(camp.destination, "/entrainement");

  // L'occurrence déjà partie n'a pas été réécrite.
  assert.equal(etat.base.notification_occurrences.length, 1);
  assert.equal(etat.base.notification_occurrences[0].status, "envoyee");
  assert.equal(etat.envois[0].titre, "Rappel poids", "l'envoi passé garde le texte qu'il portait");

  // Une destination externe reste refusée en modification comme à la création.
  const refus = await modifier(requeteJson({ destination: "https://evil.example" }), contexte(id));
  assert.equal(refus.status, 400);
});

await test("ADMINPUSH14. annulation : la ligne reste, l'envoi ne repart pas", async () => {
  reinitialiser();
  const id = await campagneHebdo();
  const res = await supprimer(new Request("https://exemple.test/x", { method: "DELETE" }), contexte(id));
  assert.equal(res.status, 200);

  const camp = etat.base.notification_campaigns[0];
  assert.equal(camp.status, "annulee");
  assert.equal(camp.active, false);
  assert.equal(camp.next_run_at, null);
  assert.equal(etat.base.notification_campaigns.length, 1, "une suppression dure emporterait tout l'historique par cascade");

  const bilan = await (await planifier(requeteCron())).json();
  assert.equal(bilan.occurrences, 0);
  assert.equal(etat.envois.length, 0);
});

/* ════════════════════════════ ADMINPUSH15-18 : LES ENVOIS ════════════════════════════ */

await test("ADMINPUSH15. deux planificateurs simultanés : une occurrence, un push par appareil", async () => {
  reinitialiser();
  await campagneHebdo("camp-concurrent");
  // Simultanés pour de vrai : les deux passent par la même base, et c'est la
  // contrainte d'unicité qui départage — pas l'ordre des `await`.
  const [a, b] = await Promise.all([
    planifier(requeteCron()).then((r) => r.json()),
    planifier(requeteCron()).then((r) => r.json()),
  ]);

  assert.equal(etat.base.notification_occurrences.length, 1, "une seule occurrence pour cette échéance");
  assert.equal(a.occurrences + b.occurrences, 1, "un seul des deux a réservé");

  const parEndpoint = new Map<string, number>();
  for (const endpoint of servis()) parEndpoint.set(endpoint, (parEndpoint.get(endpoint) ?? 0) + 1);
  for (const [endpoint, n] of parEndpoint) {
    assert.equal(n, 1, `${endpoint} a été servi ${n} fois`);
  }
  assert.equal(etat.base.notification_deliveries.length, 3, "un envoi par appareil, pas deux");
});

await test("ADMINPUSH16. plusieurs appareils : tous ciblés, aucun oublié", async () => {
  reinitialiser();
  etat.base.push_subscriptions.push({
    id: "sub-A3", user_id: COMPTE_A, endpoint: "https://web.push.apple.com/A-mac",
    p256dh: "PA3", auth: "AA3", disabled_at: null, disabled_reason: null,
  });
  await creer(requeteJson({ ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" } }));
  assert.equal(servis().length, 3, "les trois appareils de A");
  assert.equal(etat.base.notification_deliveries.filter((d) => d.status === "envoyee").length, 3);
});

await test("ADMINPUSH17. 410 sur un appareil : lui seul est désactivé, l'autre reçoit", async () => {
  reinitialiser();
  etat.verdicts[IPHONE_A] = 410;
  const res = await creer(requeteJson({ ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" } }));
  const corps = await res.json();

  assert.equal(corps.envoyes, 1);
  assert.equal(corps.echoues, 1);
  const iphone = etat.base.push_subscriptions.find((s) => s.endpoint === IPHONE_A)!;
  const ipad = etat.base.push_subscriptions.find((s) => s.endpoint === IPAD_A)!;
  assert.ok(iphone.disabled_at, "l'appareil mort est désactivé");
  assert.equal(ipad.disabled_at, null, "l'appareil vivant ne l'est pas");
  assert.equal(etat.base.notification_occurrences[0].status, "partielle");

  // Une panne passagère (500) ne désactive personne.
  reinitialiser();
  etat.verdicts[IPHONE_A] = 500;
  await creer(requeteJson({ ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" } }));
  assert.equal(etat.base.push_subscriptions.filter((s) => s.disabled_at).length, 0);
});

await test("ADMINPUSH18. élève sans appareil : aucune erreur, et les autres partent quand même", async () => {
  reinitialiser();
  const res = await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_C] }, quand: { mode: "now" },
  }));
  const corps = await res.json();
  assert.equal(res.status, 200, "personne de joignable est un fait, pas une panne");
  assert.equal(corps.appareilsCibles, 0);
  assert.equal(corps.envoyes, 0);
  assert.equal(etat.base.notification_occurrences[0].status, "envoyee");

  // Et mélangé aux autres, il n'empêche rien.
  reinitialiser();
  await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_C, ELEVE_A] }, quand: { mode: "now" },
  }));
  assert.deepEqual([...servis()].sort(), [IPAD_A, IPHONE_A].sort());
});

/* ════════════════════════════ ADMINPUSH19-21 : DROITS, DESTINATION, HISTOIRE ════════════════════════════ */

await test("ADMINPUSH19. un élève reçoit 403 partout, et rien ne part", async () => {
  const routes: [string, () => Promise<Response>][] = [
    ["créer", () => creer(requeteJson({ ...MESSAGE, cible: { genre: "all" }, quand: { mode: "now" } }))],
    ["lister", () => lister()],
    ["compter", () => compter(requeteJson({ genre: "all" }, "https://exemple.test/api/admin/notifications/audience"))],
    ["modifier", () => modifier(requeteJson({ active: false }), contexte("camp-x"))],
    ["supprimer", () => supprimer(new Request("https://exemple.test/x", { method: "DELETE" }), contexte("camp-x"))],
  ];
  for (const [nom, appel] of routes) {
    reinitialiser();
    etat.role = "student";
    const res = await appel();
    assert.equal(res.status, 403, `${nom} : 403 attendu, reçu ${res.status}`);
    assert.equal(etat.envois.length, 0, `${nom} ne doit rien envoyer`);
  }

  // Le planificateur n'est pas une route d'administration : il exige SON secret.
  reinitialiser();
  assert.equal((await planifier(requeteCron("mauvais"))).status, 401);
  assert.equal((await planifier(new Request("https://exemple.test/x", { method: "POST" }))).status, 401);
  assert.equal(etat.envois.length, 0);
});

await test("ADMINPUSH20. une URL externe est refusée — et la liste interne, acceptée", async () => {
  reinitialiser();
  for (const destination of [
    "https://evil.example/vol", "//evil.example", "javascript:alert(1)",
    "/admin", "/admin/eleves", "dashboard", "/entrainement/seance/pas-un-uuid", "",
  ]) {
    const res = await creer(requeteJson({
      ...MESSAGE, destination, cible: { genre: "all" }, quand: { mode: "now" },
    }));
    assert.equal(res.status, 400, `${destination} aurait dû être refusée`);
  }
  assert.equal(etat.envois.length, 0);

  for (const destination of ["/dashboard", "/entrainement", "/progression", "/nutrition", "/documents", "/profil"]) {
    const lecture = lireSaisie(
      { ...MESSAGE, destination, cible: { genre: "all" }, quand: { mode: "now" } },
      new Date(),
    );
    assert.equal(lecture.ok, true, `${destination} aurait dû être acceptée`);
  }
});

await test("ADMINPUSH21. l'historique dit qui, quand, combien — sans jamais un endpoint", async () => {
  reinitialiser();
  etat.verdicts[IPHONE_A] = 410;
  await creer(requeteJson({
    ...MESSAGE, cible: { genre: "students", studentIds: [ELEVE_A] }, quand: { mode: "now" },
  }));

  const vue = await (await lister()).json();
  assert.equal(vue.campagnes.length, 1);
  assert.deepEqual(vue.campagnes[0].studentIds, [ELEVE_A]);
  assert.equal(vue.historique.length, 1);

  const ligne = vue.historique[0];
  assert.equal(ligne.statut, "partielle");
  assert.equal(ligne.envoyes, 1);
  assert.equal(ligne.echoues, 1);
  assert.ok(ligne.echeance, "l'heure prévue doit être là");
  assert.ok(ligne.termineeLe, "l'heure d'envoi aussi");

  const texte = JSON.stringify(vue);
  for (const secret of [IPHONE_A, IPAD_A, IPHONE_B, "PA1", "AA1", "web.push.apple.com", "sub-A1"]) {
    assert.ok(!texte.includes(secret), `« ${secret} » ne doit jamais sortir de l'API`);
  }
});

/* ════════════════════════════ ADMINPUSH22 : LE SOCLE ════════════════════════════ */

await test("ADMINPUSH22. aucune infrastructure Push parallèle, et le socle validé n'est pas touché", () => {
  // Un seul module parle à `web-push`, et c'est celui validé sur iPhone.
  const fichiers = [
    "lib/notifications/execution.ts", "lib/notifications/depot.ts",
    "app/api/cron/notifications/route.ts", "app/api/admin/notifications/campaigns/route.ts",
  ];
  for (const f of fichiers) {
    const source = lire(f);
    assert.ok(!source.includes('from "web-push"'), `${f} ne doit pas parler à web-push directement`);
    assert.ok(!/createTable|create table/i.test(source), `${f} ne crée aucune table`);
  }

  // Le centre de notifications RÉUTILISE le socle plutôt que de le doubler.
  const execution = lire("lib/notifications/execution.ts");
  assert.ok(execution.includes('from "@/lib/push/envoyer"'), "l'envoi passe par le socle validé");
  assert.ok(execution.includes('from "@/lib/push/depot-abonnements"'), "la désactivation 410 aussi");

  // Les cinq tables du socle, et pas une de plus : ce chantier n'a ajouté
  // AUCUNE migration — c'était la condition posée avant de coder.
  const manifeste = JSON.parse(readFileSync(join(RACINE, "supabase/baseline/manifest.json"), "utf8")) as {
    migrations_post_baseline_attendues: string[];
  };
  const migrationsNotifications = manifeste.migrations_post_baseline_attendues.filter((f) =>
    /notification|push/i.test(f),
  );
  assert.deepEqual(
    migrationsNotifications,
    ["20260828090000_web_push_notifications.sql"],
    "une seule migration de notifications, celle du socle déjà appliquée",
  );

  // La route de test iPhone, validée sur le terrain, est intacte dans son contrat.
  const test = lire("app/api/admin/notifications/test/route.ts");
  assert.ok(test.includes("requireStaffForStudent(studentId)"));
  assert.ok(test.includes('.from("students").select("user_id")'));

  // Le service worker n'a pas été retouché pour ce chantier.
  const sw = lire("public/sw.js");
  assert.ok(sw.includes('const VERSION = "seth-pwa-v4"'), "la génération de cache ne change pas");
  assert.ok(sw.includes("addEventListener(\"push\""), "le gestionnaire push validé est toujours là");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

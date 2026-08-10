import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { lireAbonnement } from "../../lib/push/abonnement";
import { DESTINATIONS_STATIQUES, estDestinationInterne } from "../../lib/push/destinations";
import { composerCharge, envoyerNotifications, suiteADonner } from "../../lib/push/envoyer";

/**
 * LE SOCLE WEB PUSH — CE QUI DOIT ÊTRE VRAI AVANT LE PREMIER ENVOI RÉEL.
 *
 * Modules purs, exécutés dans Node. Aucun réseau : le transport est injecté.
 */

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => Promise<void> | void) {
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

/**
 * Une configuration VAPID FACTICE, posée ici et nulle part ailleurs.
 *
 * `envoyerNotifications` refuse d'envoyer sans configuration — c'est voulu.
 * Les valeurs ci-dessous ne servent qu'à franchir ce contrôle : le transport
 * est injecté dans chaque cas, aucun octet ne part sur le réseau.
 */
process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "cle-publique-de-test";
process.env.VAPID_PRIVATE_KEY = "cle-privee-de-test";
process.env.VAPID_SUBJECT = "mailto:test@example.com";

const ABONNEMENT = {
  endpoint: "https://web.push.apple.com/abc",
  keys: { p256dh: "BFakePublicKey_-123", auth: "FakeAuth-123" },
};

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QU'ON ACCEPTE D'ENREGISTRER
 * ════════════════════════════════════════════════════════════════════════ */

await test("PUSH1. un abonnement valide est lu, et réduit à ses trois champs", () => {
  const lu = lireAbonnement(ABONNEMENT);
  assert.deepEqual(lu, {
    endpoint: "https://web.push.apple.com/abc",
    p256dh: "BFakePublicKey_-123",
    auth: "FakeAuth-123",
  });
});

await test("PUSH2. un endpoint qui n'est pas https est REFUSÉ", () => {
  // Le serveur ira lui-même frapper cette adresse : accepter n'importe quel
  // protocole reviendrait à lui faire émettre des requêtes choisies par le
  // client (SSRF).
  for (const endpoint of [
    "http://push.example/abc",
    "file:///etc/passwd",
    "https://",
    "pas-une-url",
    "",
  ]) {
    assert.equal(
      lireAbonnement({ ...ABONNEMENT, endpoint }),
      null,
      `${endpoint} aurait dû être refusé`,
    );
  }
});

await test("PUSH3. des clés absentes, mal formées ou démesurées sont REFUSÉES", () => {
  assert.equal(lireAbonnement({ endpoint: ABONNEMENT.endpoint }), null);
  assert.equal(lireAbonnement({ ...ABONNEMENT, keys: { p256dh: "clé avec espaces", auth: "a" } }), null);
  assert.equal(lireAbonnement({ ...ABONNEMENT, keys: { p256dh: "A".repeat(500), auth: "a" } }), null);
  assert.equal(lireAbonnement(null), null);
  assert.equal(lireAbonnement("texte"), null);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. OÙ UNE NOTIFICATION A LE DROIT D'EMMENER
 * ════════════════════════════════════════════════════════════════════════ */

await test("PUSH4. les destinations internes sont acceptées, les autres non", () => {
  for (const bonne of [...DESTINATIONS_STATIQUES, "/entrainement/seance/33333333-3333-4333-8333-777777777777"]) {
    assert.equal(estDestinationInterne(bonne), true, `${bonne} devrait être acceptée`);
  }
  for (const mauvaise of [
    "https://evil.example/vol",
    "//evil.example/vol",
    "javascript:alert(1)",
    "/admin",
    "/admin/eleves",
    "dashboard",
    "/entrainement/seance/pas-un-uuid",
    "/profil\\n/admin",
    "",
    null,
    42,
  ]) {
    assert.equal(estDestinationInterne(mauvaise), false, `${String(mauvaise)} aurait dû être refusée`);
  }
});

await test("PUSH5. les TROIS listes de destinations sont identiques", () => {
  // Elle existe en trois exemplaires — TypeScript, service worker, contrainte
  // SQL — parce que les trois s'exécutent dans des mondes qui ne peuvent pas
  // s'importer. Trois copies qui dérivent seraient pires qu'une seule.
  const sw = lire("public/sw.js");
  const debut = sw.indexOf("const DESTINATIONS_NOTIFICATION = [");
  const listeSw = Array.from(sw.slice(debut, sw.indexOf("];", debut)).matchAll(/"([^"]+)"/g)).map((m) => m[1]);
  assert.deepEqual(listeSw.slice().sort(), [...DESTINATIONS_STATIQUES].sort(), "sw.js a dérivé");

  const migration = lire("supabase/migrations/20260828090000_web_push_notifications.sql");
  const contrainte = migration.slice(migration.indexOf("check (destination ~"), migration.indexOf("target_kind text"));
  for (const destination of DESTINATIONS_STATIQUES) {
    assert.ok(
      contrainte.includes(destination.slice(1)),
      `${destination} manque dans la contrainte SQL`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * III. CE QU'ON FAIT DE CHAQUE ÉCHEC
 * ════════════════════════════════════════════════════════════════════════ */

await test("PUSH6. 404 et 410 désactivent l'abonnement ; rien d'autre ne le fait", () => {
  assert.equal(suiteADonner(404), "desactiver");
  assert.equal(suiteADonner(410), "desactiver");
  // Un 500 est une panne d'en face : effacer l'appareil serait perdre un
  // abonnement vivant.
  for (const statut of [400, 401, 403, 413, 429, 500, 502, 503, null]) {
    assert.equal(suiteADonner(statut), "aucune", `${statut} ne doit pas désactiver`);
  }
});

await test("PUSH7. la charge utile assainit la destination et reste minimale", () => {
  const charge = JSON.parse(composerCharge({ titre: "T", corps: "C", destination: "https://evil.example" }));
  assert.equal(charge.destination, "/dashboard");
  assert.deepEqual(Object.keys(charge).sort(), ["corps", "destination", "titre"]);
});

/* ════════════════════════════════════════════════════════════════════════
 * IV. PLUSIEURS APPAREILS, PLUSIEURS VERDICTS
 * ════════════════════════════════════════════════════════════════════════ */

const TROIS_APPAREILS = [
  { endpoint: "https://web.push.apple.com/iphone", p256dh: "k1", auth: "a1" },
  { endpoint: "https://web.push.apple.com/ipad", p256dh: "k2", auth: "a2" },
  { endpoint: "https://updates.push.services.mozilla.com/ordi", p256dh: "k3", auth: "a3" },
];

await test("PUSH8. chaque appareil reçoit le sien (ADMINPUSH1, multi-appareils)", async () => {
  const vus: string[] = [];
  const resultats = await envoyerNotifications(
    TROIS_APPAREILS,
    { titre: "T", corps: "C" },
    {
      transport: async (abonnement) => {
        vus.push(abonnement.endpoint);
      },
    },
  );
  assert.equal(vus.length, 3, "les trois appareils doivent être servis");
  assert.equal(resultats.filter((r) => r.statut === "envoyee").length, 3);
});

await test("PUSH9. un appareil MORT n'emporte pas les autres (ADMINPUSH11)", async () => {
  const resultats = await envoyerNotifications(
    TROIS_APPAREILS,
    { titre: "T", corps: "C" },
    {
      transport: async (abonnement) => {
        if (abonnement.endpoint.endsWith("/ipad")) {
          throw Object.assign(new Error("Gone"), { statusCode: 410 });
        }
      },
    },
  );
  const parEndpoint = new Map(resultats.map((r) => [r.endpoint, r]));
  assert.equal(parEndpoint.get("https://web.push.apple.com/ipad")!.suite, "desactiver");
  assert.equal(parEndpoint.get("https://web.push.apple.com/iphone")!.statut, "envoyee");
  assert.equal(parEndpoint.get("https://updates.push.services.mozilla.com/ordi")!.statut, "envoyee");
});

await test("PUSH10. une panne passagère n'efface personne", async () => {
  const resultats = await envoyerNotifications(
    [TROIS_APPAREILS[0]],
    { titre: "T", corps: "C" },
    {
      transport: async () => {
        throw Object.assign(new Error("Service Unavailable"), { statusCode: 503 });
      },
    },
  );
  assert.equal(resultats[0].statut, "echouee");
  assert.equal(resultats[0].suite, "aucune");
  assert.equal(resultats[0].codeErreur, "503");
});

await test("PUSH11. aucun message d'erreur brut n'est conservé", async () => {
  // Un message de `web-push` contient l'endpoint complet — donc un
  // identifiant d'appareil. Seul le statut est gardé.
  const resultats = await envoyerNotifications(
    [TROIS_APPAREILS[0]],
    { titre: "T", corps: "C" },
    {
      transport: async () => {
        throw new Error("Received unexpected response code for https://web.push.apple.com/iphone");
      },
    },
  );
  assert.equal(resultats[0].codeErreur, "inconnue");
  assert.ok(!JSON.stringify(resultats).includes("iphone/"), "un endpoint a fuité dans le résultat");
});

/* ════════════════════════════════════════════════════════════════════════
 * V. LA CLÉ PRIVÉE NE DOIT JAMAIS ATTEINDRE UN NAVIGATEUR
 * ════════════════════════════════════════════════════════════════════════ */

const FICHIERS_SERVEUR = ["lib/push/vapid.ts", "lib/push/envoyer.ts", "lib/push/depot-abonnements.ts"];

await test("PUSH12. les modules qui touchent la clé privée sont `server-only`", () => {
  // `import \"server-only\"` fait ÉCHOUER LE BUILD si le fichier est importé
  // depuis un composant client. C'est la seule garantie mécanique ; une revue
  // humaine finit toujours par laisser passer un import.
  for (const fichier of FICHIERS_SERVEUR) {
    assert.ok(
      lire(fichier).trimStart().startsWith('import "server-only";'),
      `${fichier} doit commencer par import "server-only"`,
    );
  }
});

await test("PUSH13. `VAPID_PRIVATE_KEY` n'apparaît dans AUCUN fichier client", () => {
  const clients = [
    "hooks/useNotificationsPush.ts",
    "components/student/NotificationsSection.tsx",
    "lib/push/appareil.ts",
    "lib/push/destinations.ts",
    "lib/push/abonnement.ts",
    "public/sw.js",
  ];
  for (const fichier of clients) {
    const source = lire(fichier);
    assert.ok(!source.includes("VAPID_PRIVATE_KEY"), `${fichier} mentionne la clé privée`);
    assert.ok(!source.includes("vapid.ts"), `${fichier} importe la configuration serveur`);
  }
});

await test("PUSH14. aucune variable `NEXT_PUBLIC_` ne porte une clé privée", () => {
  // Le préfixe `NEXT_PUBLIC_` inscrit la valeur dans le bundle navigateur.
  for (const fichier of [...FICHIERS_SERVEUR, "hooks/useNotificationsPush.ts", ".env.example"]) {
    let source: string;
    try {
      source = lire(fichier);
    } catch {
      continue;
    }
    assert.ok(
      !/NEXT_PUBLIC_[A-Z_]*PRIVATE/.test(source),
      `${fichier} expose une clé privée au navigateur`,
    );
  }
});

/* ════════════════════════════════════════════════════════════════════════
 * VI. LES ROUTES SONT GARDÉES CÔTÉ SERVEUR
 * ════════════════════════════════════════════════════════════════════════ */

await test("PUSH15. abonnement et désabonnement exigent une session (ADMINPUSH13)", () => {
  for (const route of ["app/api/push/subscribe/route.ts", "app/api/push/unsubscribe/route.ts"]) {
    const source = lire(route);
    assert.ok(source.includes("supabase.auth.getUser()"), `${route} ne vérifie pas la session`);
    assert.ok(source.includes("401"), `${route} ne refuse pas un appel non authentifié`);
    assert.ok(
      !/user_id\s*:\s*(corps|body)/.test(source),
      `${route} lit l'identité dans le corps de la requête`,
    );
  }
});

await test("PUSH16. le désabonnement ne peut viser que SES propres appareils", () => {
  const depot = lire("lib/push/depot-abonnements.ts");
  const bloc = depot.slice(depot.indexOf("export async function retirerAbonnement"));
  assert.ok(bloc.includes('.eq("user_id", userId)'), "la suppression doit être filtrée sur l'utilisateur");
});

await test("PUSH17. l'envoi de test est rattaché à un ÉLÈVE, jamais à l'appelant (ADMINPUSH13)", () => {
  // Les COMMENTAIRES sont retirés avant l'inspection : le fichier raconte
  // justement le défaut qu'il a corrigé, et une recherche naïve prendrait ce
  // récit pour le code qu'il décrit.
  const source = lire("app/api/admin/notifications/test/route.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  // Cette assertion a changé le 10/08/2026, et c'est le correctif lui-même.
  // Elle exigeait `requireStaff()` + `requireAdmin()` — c'est-à-dire le
  // schéma « sans destinataire, j'envoie à MOI-MÊME », qui faisait chercher
  // les appareils de l'administrateur pendant que ceux de l'élève dormaient
  // dans `push_subscriptions`. Le repli implicite ne doit pas revenir.
  assert.ok(
    source.includes("requireStaffForStudent(studentId)"),
    "l'accès doit être jugé sur l'ÉLÈVE visé (admin, ou coach de cet élève)",
  );
  assert.ok(
    !source.includes("acces.user.id"),
    "la route ne doit JAMAIS retomber sur le compte de l'appelant",
  );
  assert.ok(
    !/corps\.userId|body\.userId/.test(source),
    "un identifiant de compte venu du navigateur ne doit pas être lu",
  );
  assert.ok(
    source.includes('.from("students").select("user_id")'),
    "le compte destinataire doit être résolu côté serveur depuis la fiche élève",
  );
});

await test("PUSH18. sans configuration VAPID, RIEN ne part", async () => {
  // Une Preview sans clés ne doit pas planter : elle doit dire qu'elle ne
  // peut pas envoyer.
  const memoire = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    let appels = 0;
    const resultats = await envoyerNotifications(
      TROIS_APPAREILS,
      { titre: "T", corps: "C" },
      {
        transport: async () => {
          appels += 1;
        },
      },
    );
    assert.equal(appels, 0, "aucun envoi ne doit être tenté");
    assert.equal(resultats.every((r) => r.codeErreur === "vapid_absent"), true);
  } finally {
    process.env.VAPID_PRIVATE_KEY = memoire;
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

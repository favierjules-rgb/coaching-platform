/**
 * Harnais — TOUR DE RÔLE Jules / Yoann du contact NFC « HTS » (chantier
 * feat/contact-nfc-hts, 25/11/2026) : rotation pure, compteur, client
 * Upstash et route `/api/contact-nfc/tour` de bout en bout.
 *
 * ⚠️ LE SCRIPT LUA N'EST PAS EXÉCUTÉ ICI. Aucun Redis n'est disponible en
 * test : le magasin Upstash est vérifié sur les COMMANDES qu'il émet et sur
 * sa lecture des réponses, le comportement « comparer puis incrémenter » sur
 * le magasin mémoire, qui applique la même règle. L'exécution réelle du
 * script se vérifie sur la Preview Vercel, avec le vrai Upstash.
 *
 * Aucun SMS, aucun réseau : `globalThis.fetch` est intercepté, et toute
 * requête hors de l'hôte Upstash factice fait échouer le test.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/contact-nfc-tour.mts
 * (la condition est requise par `server-only`.)
 */
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import assert from "node:assert/strict";

import { COACHS_HTS } from "../../lib/contact-nfc/config";
import {
  COACH_PAR_DEFAUT,
  coachDuCompteur,
  coachSuivant,
  estIdentifiantCoachHts,
  IDENTIFIANTS_COACHS_HTS,
} from "../../lib/contact-nfc/rotation";
import {
  CLE_COMPTEUR_TOUR,
  creerMagasinMemoire,
  creerMagasinUpstash,
  executeurUpstash,
  lireTour,
  reinitialiserTourMemoire,
  SCRIPT_AVANCER_SI,
  signalerOuverture,
  type ExecuteurRedis,
  type MagasinTour,
} from "../../lib/contact-nfc/tour";
import { resetMemoryRateLimits } from "../../lib/security/rate-limit";
import * as routeTour from "../../app/api/contact-nfc/tour/route";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`ÉCHEC - ${name}`);
    console.error(error);
  }
}

/**
 * Simule N visiteurs qui, chacun, lisent le tour puis ouvrent le SMS du coach
 * affiché. Rend la liste des coachs servis. Réutilisé par la contre-épreuve.
 */
async function servirVisiteurs(magasin: MagasinTour, nombre: number): Promise<string[]> {
  const servis: string[] = [];
  for (let i = 0; i < nombre; i += 1) {
    const coach = await lireTour(magasin);
    servis.push(coach.identifiant);
    await signalerOuverture(magasin, coach.identifiant);
  }
  return servis;
}

/** Contrôle de stricte alternance : Jules, Yoann, Jules, Yoann… */
function verifierAlternance(servis: string[]): void {
  servis.forEach((coach, rang) => {
    assert.equal(coach, COACHS_HTS[rang % COACHS_HTS.length].identifiant, `visiteur ${rang + 1}`);
  });
}

/* ─────────────── Rotation pure ─────────────── */

await test("T1 — compteur 0 → Jules, 1 → Yoann, 2 → Jules ; Jules est le coach par défaut", () => {
  assert.equal(coachDuCompteur(0).identifiant, "jules");
  assert.equal(coachDuCompteur(1).identifiant, "yoann");
  assert.equal(coachDuCompteur(2).identifiant, "jules");
  assert.equal(coachDuCompteur(1001).identifiant, "yoann");
  assert.equal(COACH_PAR_DEFAUT.identifiant, "jules");
});

await test("T2 — compteur corrompu refusé, jamais interprété", () => {
  for (const valeur of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
    assert.throws(() => coachDuCompteur(valeur), /Compteur de tour invalide/, String(valeur));
  }
});

await test("T3 — suivant : Jules → Yoann → Jules ; identifiants en liste fermée", () => {
  assert.equal(coachSuivant("jules").identifiant, "yoann");
  assert.equal(coachSuivant("yoann").identifiant, "jules");
  assert.deepEqual(IDENTIFIANTS_COACHS_HTS, ["jules", "yoann"]);
  assert.equal(estIdentifiantCoachHts("jules"), true);
  for (const intrus of ["Jules", "autre", "", null, 0, "+33670856513"]) {
    assert.equal(estIdentifiantCoachHts(intrus), false, String(intrus));
  }
});

/* ─────────────── Compteur (magasin mémoire) ─────────────── */

await test("T4 — dix visiteurs : stricte alternance, cinq chacun", async () => {
  const servis = await servirVisiteurs(creerMagasinMemoire(), 10);
  verifierAlternance(servis);
  assert.equal(servis.filter((c) => c === "jules").length, 5);
  assert.equal(servis.filter((c) => c === "yoann").length, 5);
});

await test("T5 — lire le tour (scan, affichage) ne fait JAMAIS avancer", async () => {
  const magasin = creerMagasinMemoire();
  for (let i = 0; i < 5; i += 1) assert.equal((await lireTour(magasin)).identifiant, "jules");
  assert.equal(await magasin.lireCompteur(), 0);
});

await test("T6 — double signalement du même coach (double appui, rejeu) : une seule avance", async () => {
  const magasin = creerMagasinMemoire();
  const premier = await signalerOuverture(magasin, "jules");
  const second = await signalerOuverture(magasin, "jules");
  assert.deepEqual([premier.avance, premier.prochain.identifiant], [true, "yoann"]);
  assert.deepEqual([second.avance, second.prochain.identifiant], [false, "yoann"]);
  assert.equal(await magasin.lireCompteur(), 1);
});

await test("T7 — deux visiteurs simultanés sur le tour de Jules : le tour n'avance qu'une fois", async () => {
  const magasin = creerMagasinMemoire();
  const resultats = await Promise.all([signalerOuverture(magasin, "jules"), signalerOuverture(magasin, "jules")]);
  assert.equal(resultats.filter((r) => r.avance).length, 1);
  assert.equal(await magasin.lireCompteur(), 1);
});

await test("T8 — signalement hors tour (Yoann alors que c'est Jules) : aucune avance", async () => {
  const magasin = creerMagasinMemoire();
  const resultat = await signalerOuverture(magasin, "yoann");
  assert.deepEqual([resultat.avance, resultat.prochain.identifiant], [false, "jules"]);
});

await test("T8b — contre-épreuve : un magasin qui avance à chaque signalement casse l'alternance et est détecté", async () => {
  let compteur = 0;
  const fautif: MagasinTour = {
    nom: "memoire",
    async lireCompteur() {
      return compteur;
    },
    async avancerSi() {
      compteur += 1;
      return { compteur, avance: true };
    },
  };
  // Chaque visiteur signale DEUX fois (double appui) : le magasin fautif saute un tour.
  const servis: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const coach = await lireTour(fautif);
    servis.push(coach.identifiant);
    await signalerOuverture(fautif, coach.identifiant);
    await signalerOuverture(fautif, coach.identifiant);
  }
  assert.throws(() => verifierAlternance(servis));
});

/* ─────────────── Magasin Upstash ─────────────── */

await test("T9 — Upstash : GET de la clé ; clé absente → tour de Jules", async () => {
  const commandes: string[][] = [];
  const executer: ExecuteurRedis = async (commande) => {
    commandes.push(commande);
    return null;
  };
  const magasin = creerMagasinUpstash(executer);
  assert.equal((await lireTour(magasin)).identifiant, "jules");
  assert.deepEqual(commandes, [["GET", CLE_COMPTEUR_TOUR]]);
});

await test("T10 — Upstash : EVAL du script atomique avec le rang attendu et le nombre de coachs", async () => {
  const commandes: string[][] = [];
  const executer: ExecuteurRedis = async (commande) => {
    commandes.push(commande);
    return [7, 1];
  };
  const resultat = await signalerOuverture(creerMagasinUpstash(executer), "yoann");
  assert.deepEqual(commandes, [["EVAL", SCRIPT_AVANCER_SI, "1", CLE_COMPTEUR_TOUR, "1", "2"]]);
  assert.deepEqual([resultat.avance, resultat.prochain.identifiant], [true, "yoann"]);
});

await test("T11 — Upstash : réponses illisibles refusées (jamais un coach au hasard)", async () => {
  for (const reponse of ["abc", -3, 1.5, { n: 1 }]) {
    const magasin = creerMagasinUpstash(async () => reponse);
    await assert.rejects(() => magasin.lireCompteur(), /illisible/, JSON.stringify(reponse));
  }
  for (const reponse of [null, [1], "2", [1, "x"]]) {
    const magasin = creerMagasinUpstash(async () => reponse);
    await assert.rejects(() => magasin.avancerSi(0, 2), /illisible/, JSON.stringify(reponse));
  }
});

await test("T12 — script Lua : compare le reste puis incrémente, dans un seul script", () => {
  assert.match(SCRIPT_AVANCER_SI, /redis\.call\('GET', KEYS\[1\]\)/);
  assert.match(SCRIPT_AVANCER_SI, /n % tonumber\(ARGV\[2\]\) == tonumber\(ARGV\[1\]\)/);
  assert.match(SCRIPT_AVANCER_SI, /redis\.call\('INCR', KEYS\[1\]\)/);
  assert.equal((SCRIPT_AVANCER_SI.match(/INCR/g) ?? []).length, 1, "un seul incrément possible");
});

await test("T13 — client REST : POST authentifié vers l'URL Upstash, corps = la commande ; erreurs levées", async () => {
  const appels: { url: string; init: RequestInit }[] = [];
  const faux = (async (url: string, init: RequestInit) => {
    appels.push({ url, init });
    return new Response(JSON.stringify({ result: "4" }), { status: 200 });
  }) as unknown as typeof fetch;
  const executer = executeurUpstash("https://upstash.factice.test", "jeton-factice", faux);
  assert.equal(await executer(["GET", CLE_COMPTEUR_TOUR]), "4");
  assert.equal(appels[0].url, "https://upstash.factice.test");
  assert.equal(appels[0].init.method, "POST");
  assert.equal((appels[0].init.headers as Record<string, string>).Authorization, "Bearer jeton-factice");
  assert.equal(appels[0].init.body, JSON.stringify(["GET", CLE_COMPTEUR_TOUR]));

  const enErreur = executeurUpstash(
    "https://upstash.factice.test",
    "j",
    (async () => new Response(JSON.stringify({ error: "ERR" }), { status: 200 })) as unknown as typeof fetch,
  );
  await assert.rejects(() => enErreur(["GET", "x"]), /refusé/);
  const horsService = executeurUpstash(
    "https://upstash.factice.test",
    "j",
    (async () => new Response("", { status: 500 })) as unknown as typeof fetch,
  );
  await assert.rejects(() => horsService(["GET", "x"]), /500/);
});

/* ─────────────── Route /api/contact-nfc/tour ─────────────── */

const URL_ROUTE = "http://localhost/api/contact-nfc/tour";
let ipCourante = 1;

function requete(methode: "GET" | "POST", corps?: string, ip = `203.0.113.${ipCourante}`): Request {
  const headers: Record<string, string> = { "x-real-ip": ip };
  if (corps !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(corps));
  }
  return new Request(URL_ROUTE, { method: methode, headers, body: corps });
}

async function lireJson(reponse: Response): Promise<Record<string, unknown>> {
  return (await reponse.json()) as Record<string, unknown>;
}

function avantChaqueTestDeRoute() {
  reinitialiserTourMemoire();
  resetMemoryRateLimits();
  ipCourante += 1;
}

/** Aucun appel réseau sortant pendant les tests de route (pas d'Upstash configuré). */
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entree: string | URL | Request) => {
  throw new Error(`Appel réseau inattendu : ${String(entree)}`);
}) as typeof fetch;

try {
  await test("R1 — GET : tour de Jules, sans cache, réponse limitée à l'identifiant", async () => {
    avantChaqueTestDeRoute();
    const reponse = await routeTour.GET(requete("GET"));
    assert.equal(reponse.status, 200);
    assert.equal(reponse.headers.get("cache-control"), "no-store");
    assert.deepEqual(await lireJson(reponse), { coach: "jules" });
  });

  await test("R2 — GET répétés (scans) : le tour ne bouge pas", async () => {
    avantChaqueTestDeRoute();
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(await lireJson(await routeTour.GET(requete("GET"))), { coach: "jules" });
    }
  });

  await test("R3 — POST Jules → tour de Yoann ; POST Yoann → tour de Jules", async () => {
    avantChaqueTestDeRoute();
    assert.deepEqual(await lireJson(await routeTour.POST(requete("POST", '{"coach":"jules"}'))), {
      coach: "yoann",
      avance: true,
    });
    assert.deepEqual(await lireJson(await routeTour.GET(requete("GET"))), { coach: "yoann" });
    assert.deepEqual(await lireJson(await routeTour.POST(requete("POST", '{"coach":"yoann"}'))), {
      coach: "jules",
      avance: true,
    });
  });

  await test("R4 — POST rejoué (double appui) : pas de seconde avance", async () => {
    avantChaqueTestDeRoute();
    await routeTour.POST(requete("POST", '{"coach":"jules"}'));
    assert.deepEqual(await lireJson(await routeTour.POST(requete("POST", '{"coach":"jules"}'))), {
      coach: "yoann",
      avance: false,
    });
  });

  await test("R5 — corps invalides refusés en 400 : coach inconnu, clé en trop, numéro, JSON cassé", async () => {
    avantChaqueTestDeRoute();
    for (const corps of [
      '{"coach":"autre"}',
      '{"coach":"jules","telephone":"0600000000"}',
      '{"coach":"+33670856513"}',
      '{"coach":1}',
      "{}",
      "pas du json",
    ]) {
      const reponse = await routeTour.POST(requete("POST", corps));
      assert.equal(reponse.status, 400, corps);
    }
    assert.deepEqual(await lireJson(await routeTour.GET(requete("GET"))), { coach: "jules" }, "aucune avance");
  });

  await test("R6 — corps trop volumineux : 413, sans lecture", async () => {
    avantChaqueTestDeRoute();
    const reponse = await routeTour.POST(requete("POST", JSON.stringify({ coach: "jules", x: "a".repeat(400) })));
    assert.equal(reponse.status, 413);
  });

  await test("R7 — quota d'ouvertures : la 11e en dix minutes depuis la même IP est refusée (429)", async () => {
    avantChaqueTestDeRoute();
    const ip = "198.51.100.7";
    const statuts: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuts.push((await routeTour.POST(requete("POST", '{"coach":"jules"}', ip))).status);
    }
    assert.deepEqual(statuts.slice(0, 10), Array(10).fill(200));
    assert.equal(statuts[10], 429);
  });
} finally {
  globalThis.fetch = fetchOriginal;
}

console.log(`\n${passed} réussis, ${failed} échecs`);
if (failed > 0) process.exit(1);

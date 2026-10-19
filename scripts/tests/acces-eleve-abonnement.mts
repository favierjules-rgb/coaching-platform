/*
 * ════════════════════════════════════════════════════════════════════════════
 * ACCÈS ÉLÈVE — LE CONTRÔLE D'ABONNEMENT, ET CE QU'IL NE DOIT PAS INVENTER
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ CE QUE CE FICHIER MESURE, ET POURQUOI IL EXISTE. Le 18/10, tous les
 * élèves ont basculé sur « ACCÈS TEMPORAIREMENT LIMITÉ ». La cause n'était ni
 * un abonnement expiré, ni une formule absente : la fiche élève était devenue
 * ILLISIBLE pour le rôle `authenticated` (privilège de colonne retiré sur
 * `student_profiles`), et le code traitait « je n'ai pas pu lire » exactement
 * comme « abonnement requis, aucun abonnement ». Les 34 élèves en accès manuel
 * autorisé sont passés de « autorisés » à « bloqués » sans qu'une seule donnée
 * ne change.
 *
 * Les contrôles ci-dessous figent les deux moitiés de la règle :
 *   · un verdict calculé sur des données LUES reste strictement celui du
 *     produit — un élève sans abonnement ni dérogation reste bloqué ;
 *   · un verdict qu'on N'A PAS PU calculer ne bloque personne, et crie.
 * ════════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeStudentAccess, destinationRefusAcces } from "@/lib/stripe/access-status";
import { getStudentAccessStatus, lireModeAccesFacturation } from "@/lib/supabase/student-access";

let passed = 0;
let failed = 0;
function test(nom: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(error);
    });
}

const lire = (chemin: string) => readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");

/**
 * Client Supabase de test, réduit à ce que le contrôle d'accès appelle.
 *
 * ⚠️ IL IMITE AUSSI LES ERREURS, et c'est tout l'intérêt : le défaut du 18/10
 * ne se voit QUE sur le chemin d'erreur. Un faux client qui ne sait que
 * réussir n'aurait rien attrapé.
 */
function clientFactice(options: {
  profil?: { billing_access_mode: string } | null;
  erreurProfil?: { message: string } | null;
  abonnement?: { status: string } | null;
  erreurAbonnement?: { message: string } | null;
  colonnesVues?: string[];
}) {
  const colonnesVues = options.colonnesVues ?? [];
  return {
    from(table: string) {
      const constructeur = {
        select(colonnes: string) {
          colonnesVues.push(`${table}:${colonnes}`);
          return constructeur;
        },
        eq() {
          return constructeur;
        },
        order() {
          return constructeur;
        },
        limit() {
          return constructeur;
        },
        maybeSingle() {
          if (table === "student_profiles") {
            return Promise.resolve({ data: options.profil ?? null, error: options.erreurProfil ?? null });
          }
          return Promise.resolve({ data: options.abonnement ?? null, error: options.erreurAbonnement ?? null });
        },
      };
      return constructeur;
    },
  } as never;
}

const ELEVE = "11111111-1111-4111-8111-111111111111";

/* ═══════════ A — LE CALCUL PUR, INCHANGÉ ═══════════ */

await test("A1. accès manuel autorisé : l'élève passe, même sans aucun abonnement", () => {
  // ⚠️ C'EST LE CAS DE 34 ÉLÈVES SUR 36 EN PRODUCTION (relevé le 19/10 :
  // 34 `manual_allowed`, 0 abonnement, 0 formule attribuée). Le produit
  // fonctionne ainsi : le coach ouvre l'accès à la main.
  const statut = computeStudentAccess("manual_allowed", null);
  assert.equal(statut.allowed, true);
  assert.equal(statut.reason, "manual_allowed");
});

await test("A2. abonnement requis + abonnement actif : il passe", () => {
  assert.equal(computeStudentAccess("subscription_required", "active").allowed, true);
  assert.equal(computeStudentAccess("subscription_required", "trialing").allowed, true);
});

await test("A3. abonnement requis SANS abonnement : il reste bloqué", () => {
  // Le contrôle n'est pas contourné : c'est la règle normale du produit.
  const statut = computeStudentAccess("subscription_required", null);
  assert.equal(statut.allowed, false);
  assert.equal(statut.reason, "no_subscription");
});

await test("A4. les statuts Stripe dégradés bloquent, chacun avec sa raison", () => {
  for (const [stripe, raison] of [
    ["past_due", "subscription_past_due"],
    ["canceled", "subscription_canceled"],
    ["unpaid", "subscription_unpaid"],
    ["paused", "subscription_paused"],
    ["incomplete", "subscription_incomplete"],
    ["incomplete_expired", "subscription_incomplete_expired"],
  ] as const) {
    const statut = computeStudentAccess("subscription_required", stripe);
    assert.equal(statut.allowed, false, `${stripe} ne doit pas ouvrir l'accès`);
    assert.equal(statut.reason, raison);
  }
});

await test("A5. blocage manuel : il bloque même avec un abonnement actif", () => {
  const statut = computeStudentAccess("manual_blocked", "active");
  assert.equal(statut.allowed, false);
  assert.equal(statut.reason, "manual_blocked");
});

/* ═══════════ B — LA LECTURE : ÉCHEC ≠ ABSENCE ═══════════ */

await test("B1. une fiche lue rend son mode", async () => {
  const resolution = await lireModeAccesFacturation(clientFactice({ profil: { billing_access_mode: "manual_allowed" } }), ELEVE);
  assert.deepEqual(resolution, { mode: "manual_allowed", lectureEchouee: false });
});

await test("B2. AUCUNE fiche : mode nul, lecture réussie — l'élève retombe sur la règle normale", () => {
  return lireModeAccesFacturation(clientFactice({ profil: null }), ELEVE).then((resolution) => {
    assert.deepEqual(resolution, { mode: null, lectureEchouee: false });
  });
});

await test("B3. ⚠️ une lecture en ERREUR ne rend pas « aucun mode » : elle rend « on ne sait pas »", async () => {
  /*
   * C'est exactement l'erreur observée en production le 18/10 :
   *     42501 permission denied for table student_profiles
   * Avant ce correctif, elle se traduisait par un profil `null`, donc par
   * `subscription_required`, donc par un blocage pour tout le monde.
   */
  const resolution = await lireModeAccesFacturation(
    clientFactice({ erreurProfil: { message: "permission denied for table student_profiles" } }),
    ELEVE,
  );
  assert.deepEqual(resolution, { mode: null, lectureEchouee: true });
});

await test("B4. la lecture ne nomme que les deux colonnes dont elle a besoin", async () => {
  /*
   * ⚠️ LE DÉFAUT VENAIT DE LÀ. Le contrôle lisait la fiche ENTIÈRE pour un
   * seul champ : une colonne fermée ailleurs faisait tomber toute la requête.
   */
  const colonnesVues: string[] = [];
  await lireModeAccesFacturation(clientFactice({ profil: { billing_access_mode: "manual_allowed" }, colonnesVues }), ELEVE);
  assert.deepEqual(colonnesVues, ["student_profiles:student_id, billing_access_mode"]);
});

/* ═══════════ C — LE VERDICT COMPLET ═══════════ */

await test("C1. accès manuel autorisé, aucun abonnement : autorisé", async () => {
  const statut = await getStudentAccessStatus(clientFactice({ profil: { billing_access_mode: "manual_allowed" } }), ELEVE);
  assert.equal(statut.allowed, true);
  assert.equal(statut.reason, "manual_allowed");
});

await test("C2. abonnement requis, aucun abonnement : bloqué (règle du produit, intacte)", async () => {
  const statut = await getStudentAccessStatus(clientFactice({ profil: { billing_access_mode: "subscription_required" } }), ELEVE);
  assert.equal(statut.allowed, false);
  assert.equal(statut.reason, "no_subscription");
});

await test("C3. abonnement requis + abonnement actif : autorisé", async () => {
  const statut = await getStudentAccessStatus(
    clientFactice({ profil: { billing_access_mode: "subscription_required" }, abonnement: { status: "active" } }),
    ELEVE,
  );
  assert.equal(statut.allowed, true);
  assert.equal(statut.reason, "subscription_active");
});

await test("C4. aucune fiche élève : bloqué, comme avant", async () => {
  const statut = await getStudentAccessStatus(clientFactice({ profil: null }), ELEVE);
  assert.equal(statut.allowed, false);
  assert.equal(statut.reason, "no_subscription");
});

await test("C5. ⚠️ fiche illisible : accès NON accordé, mais sous sa propre raison", async () => {
  /*
   * ⚠️ DEUX EXIGENCES, ET IL FAUT LES DEUX. Le contenu protégé reste fermé —
   * on n'accorde rien sur une panne. Mais le refus ne doit PAS emprunter la
   * raison d'un refus commercial : c'est elle qui enverrait l'élève sur un
   * écran lui affirmant qu'aucune formule ne lui est attribuée, ce qui était
   * faux pour 34 élèves le 18/10.
   */
  const statut = await getStudentAccessStatus(
    clientFactice({ erreurProfil: { message: "permission denied for table student_profiles" } }),
    ELEVE,
  );
  assert.equal(statut.allowed, false, "une panne ne doit pas ouvrir l'accès");
  assert.equal(statut.reason, "indetermine", "…et elle doit être NOMMÉE, pas déguisée en « aucun abonnement »");
  assert.notEqual(statut.reason, "no_subscription");
});

await test("C6. …et un blocage manuel explicite reste un blocage", async () => {
  const statut = await getStudentAccessStatus(clientFactice({ profil: { billing_access_mode: "manual_blocked" } }), ELEVE);
  assert.equal(statut.allowed, false);
  assert.equal(statut.reason, "manual_blocked");
});

/* ═══════════ E — LES QUATRE SITUATIONS, ET OÙ ELLES MÈNENT ═══════════ */

await test("E1. les quatre situations métier, bout en bout", async () => {
  /*
   * Le tableau que le produit doit tenir, et que ce test fige :
   *
   *   manual_allowed, aucun abonnement ....... autorisé
   *   subscription_required, aucun abonnement  refusé  → /acces-limite
   *   manual_blocked ......................... refusé  → /acces-limite
   *   lecture en erreur ...................... refusé  → /acces-indisponible
   */
  const cas = [
    { nom: "manual_allowed", client: clientFactice({ profil: { billing_access_mode: "manual_allowed" } }), autorise: true, raison: "manual_allowed", destination: null },
    { nom: "subscription_required sans abonnement", client: clientFactice({ profil: { billing_access_mode: "subscription_required" } }), autorise: false, raison: "no_subscription", destination: "/acces-limite" },
    { nom: "manual_blocked", client: clientFactice({ profil: { billing_access_mode: "manual_blocked" } }), autorise: false, raison: "manual_blocked", destination: "/acces-limite" },
    { nom: "lecture en erreur", client: clientFactice({ erreurProfil: { message: "permission denied for table student_profiles" } }), autorise: false, raison: "indetermine", destination: "/acces-indisponible" },
  ] as const;

  for (const c of cas) {
    const statut = await getStudentAccessStatus(c.client, ELEVE);
    assert.equal(statut.allowed, c.autorise, `${c.nom} : accès attendu ${c.autorise}`);
    assert.equal(statut.reason, c.raison, `${c.nom} : raison attendue ${c.raison}`);
    if (c.destination !== null) {
      assert.equal(destinationRefusAcces(statut), c.destination, `${c.nom} : destination attendue ${c.destination}`);
    }
  }
});

await test("E2. une erreur technique ne mène JAMAIS à l'écran « aucune formule »", () => {
  assert.equal(destinationRefusAcces({ reason: "indetermine" }), "/acces-indisponible");
  // Tous les refus commerciaux, eux, gardent leur écran.
  for (const raison of ["no_subscription", "manual_blocked", "subscription_past_due",
                        "subscription_canceled", "subscription_unpaid", "subscription_paused",
                        "subscription_incomplete", "subscription_incomplete_expired"] as const) {
    assert.equal(destinationRefusAcces({ reason: raison }), "/acces-limite", `${raison} reste sur /acces-limite`);
  }
});

await test("E3. les deux gardes redirigent par cette règle, pas en dur", () => {
  const guards = lire("lib/supabase/guards.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const redirections = guards.match(/redirect\((?:"\/acces-limite"|destinationRefusAcces\(status\))\)/g) ?? [];
  assert.equal(redirections.length, 2, "les deux gardes d'accès doivent rediriger");
  for (const redirection of redirections) {
    assert.ok(/destinationRefusAcces\(status\)/.test(redirection),
      "une garde redirige encore en dur vers /acces-limite");
  }
});

await test("E4. l'écran d'indisponibilité dit la panne, propose de réessayer, et n'affirme rien", () => {
  const ecran = lire("components/shared/AccessUnavailableContent.tsx");
  const visible = ecran.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(/Accès momentanément indisponible/.test(visible), "le titre doit nommer l'indisponibilité");
  assert.ok(/Réessayer/.test(visible), "un bouton Réessayer est exigé");
  assert.ok(/router\.refresh\(\)/.test(visible), "le réessai doit rejouer la vérification serveur");
  // ⚠️ IL NE DOIT RIEN AFFIRMER SUR L'ABONNEMENT NI SUR LA FORMULE.
  assert.ok(!/aucune formule/i.test(visible), "cet écran ne doit pas parler de formule attribuée");
  assert.ok(!/validation de votre abonnement/i.test(visible));
  // …et la page existe bien, sans quoi la redirection tomberait en 404.
  assert.ok(/AccessUnavailableContent/.test(lire("app/acces-indisponible/page.tsx")));
  // L'écran est autonome (pas de nav marketing par-dessus).
  assert.ok(/"\/acces-indisponible"/.test(lire("components/layout/SiteChrome.tsx")));
});

await test("E6. même atteint directement, l'écran commercial n'affirme rien sur une panne", () => {
  // /acces-limite reste tapable à la main : tant que la raison est
  // `indetermine`, il ne doit pas prétendre qu'aucune formule n'est attribuée.
  const ecran = lire("components/shared/AccessLimitedContent.tsx");
  assert.ok(/access\.status\?\.reason === "indetermine"/.test(ecran));
  assert.ok(/\/acces-indisponible/.test(ecran));
});

await test("E5. …et l'écran commercial, lui, garde son message", () => {
  // On ne masque pas le contrôle d'abonnement : /acces-limite reste ce qu'il
  // est, pour les refus qui en relèvent vraiment.
  const ecran = lire("components/shared/AccessLimitedContent.tsx");
  assert.ok(/Accès temporairement limité/.test(ecran));
  assert.ok(/Aucune formule attribuée pour le moment/.test(ecran));
});

/* ═══════════ D — CE QUE LE CODE NE DOIT PLUS FAIRE ═══════════ */

await test("D1. le contrôle d'accès ne lit plus la fiche entière", () => {
  const source = lire("lib/supabase/student-access.ts");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/getStudentProfile/.test(code),
    "le contrôle d'accès ne doit plus dépendre de la fiche complète");
  assert.ok(/select\("student_id, billing_access_mode"\)/.test(code));
});

await test("D2. aucune lecture `select(\"*\")` ne subsiste sur la table student_profiles", () => {
  /*
   * ⚠️ C'EST LA REQUÊTE QUI A TOUT CASSÉ. Relevé dans les journaux Supabase :
   *     403 — /rest/v1/student_profiles?select=*&student_id=eq.<élève>
   *     première occurrence 18/10 11:53, six minutes après la migration qui
   *     a retiré le privilège de table.
   * La fiche complète passe désormais par la vue `student_profiles_lisible`.
   */
  for (const fichier of ["lib/supabase/student-access.ts", "lib/supabase/students.ts",
                         "lib/supabase/billing.ts", "lib/supabase/physiologie.ts",
                         "lib/supabase/onboarding.ts"]) {
    const source = lire(fichier).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const lectures = source.match(/from\("student_profiles"\)[\s\S]{0,80}?\.select\([^)]*\)/g) ?? [];
    for (const lecture of lectures) {
      assert.ok(!/select\("\*"\)/.test(lecture),
        `${fichier} lit encore toute la table student_profiles : ${lecture.slice(0, 60)}`);
    }
  }
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

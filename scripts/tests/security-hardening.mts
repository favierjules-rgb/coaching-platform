/**
 * Harnais — correctifs de sécurité pré-production (audit du 26/07/2026,
 * phase 2) : limitation de fréquence distribuée, protection des routes
 * publiques coûteuses, en-têtes HTTP, guards en fail-closed, migration
 * de protection des rôles.
 *
 * Aucun appel réseau réel : le magasin Upstash est simulé en interceptant
 * `globalThis.fetch`. Aucun email, aucun paiement, aucune écriture Supabase.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/security-hardening.mts
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";

import {
  consumeRateLimit,
  getTrustedClientIp,
  isDistributedRateLimitConfigured,
  rateLimitHeaders,
  rateLimitKey,
  resetMemoryRateLimits,
} from "../../lib/security/rate-limit";
import {
  CLAIM_PROGRAM_EMAIL,
  CLAIM_PROGRAM_IP,
  DOUBLE_SUBMIT,
  PASSWORD_RESET_EMAIL,
  PASSWORD_RESET_IP,
  PROGRAM_CHECKOUT_IP,
} from "../../lib/security/rules";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`ÉCHEC - ${name}`);
      console.error(error);
    });
}

/**
 * `process.env.NODE_ENV` est typé en lecture seule et Node refuse
 * `defineProperty` dessus : on passe par l'objet, ce qui fonctionne.
 */
function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

/* ─────────────── 1-5. Limitation de fréquence ─────────────── */

await test("1. quota respecté puis refus avec Retry-After", async () => {
  resetMemoryRateLimits();
  const regle = { name: "test_quota", limit: 3, windowMs: 60_000 };
  for (let i = 1; i <= 3; i += 1) {
    const d = await consumeRateLimit("ip-1", regle);
    assert.equal(d.allowed, true, `appel ${i} autorisé`);
  }
  const refus = await consumeRateLimit("ip-1", regle);
  assert.equal(refus.allowed, false, "4e appel refusé");
  assert.ok(refus.retryAfterMs > 0, "délai d'attente communiqué");

  const headers = rateLimitHeaders(refus);
  assert.ok(Number(headers["Retry-After"]) >= 1, "Retry-After en secondes, au moins 1");
  assert.equal(headers["X-RateLimit-Remaining"], "0");
});

await test("2. les quotas sont cloisonnés par identifiant et par règle", async () => {
  resetMemoryRateLimits();
  const regle = { name: "test_cloison", limit: 1, windowMs: 60_000 };
  assert.equal((await consumeRateLimit("ip-A", regle)).allowed, true);
  assert.equal((await consumeRateLimit("ip-A", regle)).allowed, false, "même identifiant : bloqué");
  assert.equal((await consumeRateLimit("ip-B", regle)).allowed, true, "autre identifiant : indépendant");
  assert.equal(
    (await consumeRateLimit("ip-A", { name: "autre_regle", limit: 1, windowMs: 60_000 })).allowed,
    true,
    "autre règle : compteur distinct",
  );
});

await test("3. clé composée : IP + ressource, insensible à la casse et aux espaces", () => {
  assert.equal(rateLimitKey(["1.2.3.4", "Camille@Exemple.FR"]), "1.2.3.4|camille@exemple.fr");
  assert.equal(rateLimitKey(["  A  ", null, undefined, ""]), "a");
  assert.equal(rateLimitKey([null, undefined]), "unknown", "jamais de clé vide");
});

await test("4. en production, une route coûteuse REFUSE sans magasin partagé (fail-closed)", async () => {
  resetMemoryRateLimits();
  const nodeEnv = process.env.NODE_ENV;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  try {
    setNodeEnv("production");
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.equal(isDistributedRateLimitConfigured(), false);

    const couteuse = await consumeRateLimit("ip-prod", CLAIM_PROGRAM_IP);
    assert.equal(couteuse.allowed, false, "route failClosed refusée");
    assert.equal(couteuse.backend, "unavailable");

    // Une route non critique reste servie, avec la protection mémoire partielle.
    const ordinaire = await consumeRateLimit("ip-prod", { name: "t", limit: 5, windowMs: 60_000 });
    assert.equal(ordinaire.allowed, true);
    assert.equal(ordinaire.backend, "memory");
  } finally {
    setNodeEnv(nodeEnv);
    if (url) process.env.UPSTASH_REDIS_REST_URL = url;
    if (token) process.env.UPSTASH_REDIS_REST_TOKEN = token;
  }
});

await test("5. Upstash utilisé quand il est configuré (magasin simulé)", async () => {
  resetMemoryRateLimits();
  const fetchReel = globalThis.fetch;
  const appels: string[] = [];
  let compteur = 0;
  process.env.UPSTASH_REDIS_REST_URL = "https://exemple.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "jeton-factice-de-test";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    assert.ok(url.startsWith("https://exemple.upstash.io"), `appel inattendu vers ${url}`);
    appels.push(url);
    if (url.includes("/pipeline")) {
      compteur += 1;
      return new Response(JSON.stringify([{ result: compteur }, { result: 30_000 }]), { status: 200 });
    }
    return new Response(JSON.stringify({ result: 1 }), { status: 200 });
  }) as typeof fetch;
  try {
    const regle = { name: "test_upstash", limit: 2, windowMs: 60_000 };
    const un = await consumeRateLimit("ip-u", regle);
    assert.equal(un.backend, "upstash", "le magasin partagé est utilisé");
    assert.equal(un.allowed, true);
    await consumeRateLimit("ip-u", regle);
    const trois = await consumeRateLimit("ip-u", regle);
    assert.equal(trois.allowed, false, "quota Upstash appliqué");
    assert.ok(trois.retryAfterMs > 0, "TTL renvoyé comme délai d'attente");
    assert.ok(appels.length >= 3, "appels réellement émis vers le magasin");
  } finally {
    globalThis.fetch = fetchReel;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
});

/* ─────────────── 6-7. Identification de l'appelant (M-2) ─────────────── */

await test("6. x-forwarded-for forgé est IGNORÉ en production", () => {
  const nodeEnv = process.env.NODE_ENV;
  try {
    setNodeEnv("production");
    const forge = new Request("http://localhost/api/x", {
      headers: { "x-forwarded-for": "6.6.6.6" },
    });
    assert.equal(getTrustedClientIp(forge), "unknown", "en-tête client non fiable rejeté");

    // Les en-têtes posés par la plateforme, eux, font foi.
    const vercel = new Request("http://localhost/api/x", {
      headers: { "x-vercel-forwarded-for": "1.2.3.4", "x-forwarded-for": "6.6.6.6" },
    });
    assert.equal(getTrustedClientIp(vercel), "1.2.3.4", "priorité à l'en-tête plateforme");

    const reel = new Request("http://localhost/api/x", { headers: { "x-real-ip": "5.6.7.8" } });
    assert.equal(getTrustedClientIp(reel), "5.6.7.8");
  } finally {
    setNodeEnv(nodeEnv);
  }
});

await test("7. hors production, x-forwarded-for reste accepté (tests locaux)", () => {
  const requete = new Request("http://localhost/api/x", { headers: { "x-forwarded-for": "9.9.9.9" } });
  assert.equal(getTrustedClientIp(requete), "9.9.9.9");
});

/* ─────────────── 8-11. Routes publiques protégées (H-2) ─────────────── */

await test("8. les quatre routes coûteuses appliquent un quota et une taille maximale", () => {
  const routes = [
    ["app/api/public/programs/[programId]/claim/route.ts", true],
    ["app/api/public/password-reset/route.ts", true],
    ["app/api/public/programs/[programId]/checkout/route.ts", true],
    ["app/api/public/programs/checkout-status/route.ts", false],
  ] as const;

  for (const [chemin, avecTaille] of routes) {
    const source = lire(`../../${chemin}`);
    assert.ok(source.includes("consumeRateLimit"), `${chemin} : aucun quota`);
    assert.ok(source.includes("getTrustedClientIp"), `${chemin} : IP non fiable`);
    assert.ok(!source.includes("getClientIp("), `${chemin} : utilise encore l'ancienne extraction d'IP`);
    if (avecTaille) {
      assert.ok(source.includes("MAX_BODY_BYTES"), `${chemin} : taille du corps non bornée`);
    }
    // Depuis l'arbitrage H-2, le refus passe par le helper commun
    // `refusDeLimite`, qui pose les en-têtes ET distingue 429 (quota) de 503
    // (magasin partagé indisponible). Une route qui poserait encore ses
    // en-têtes à la main aurait forcément oublié cette distinction.
    assert.ok(source.includes("refusDeLimite"), `${chemin} : le refus doit passer par le helper commun`);
  }
});

await test("9. /claim : honeypot, quota par email et garde anti-rejeu", () => {
  const source = lire("../../app/api/public/programs/[programId]/claim/route.ts");
  assert.ok(source.includes("CLAIM_PROGRAM_IP"), "quota par IP");
  assert.ok(source.includes("CLAIM_PROGRAM_EMAIL"), "quota par email");
  assert.ok(source.includes("DOUBLE_SUBMIT"), "garde anti-rejeu");
  assert.ok(source.includes("website"), "honeypot lu");
  // Réponse neutre : un robot ne doit pas apprendre qu'il a été détecté.
  assert.ok(/website[\s\S]{0,200}NextResponse\.json\(\{ ok: true \}\)/.test(source), "réponse neutre au honeypot");

  const schema = lire("../../lib/api/schemas/stripe.ts");
  assert.ok(schema.includes("website: z.string().max(200)"), "honeypot déclaré dans le schéma strict");
});

await test("10. /password-reset : quota par IP ET par adresse visée, réponse neutre", () => {
  const source = lire("../../app/api/public/password-reset/route.ts");
  assert.ok(source.includes("PASSWORD_RESET_IP") && source.includes("PASSWORD_RESET_EMAIL"));
  // Le refus par adresse renvoie { ok: true } : aucune énumération de comptes.
  assert.ok(
    /parEmail\.allowed[\s\S]{0,120}NextResponse\.json\(\{ ok: true \}\)/.test(source),
    "le blocage par email ne révèle rien",
  );
});

await test("11. les règles couvrent les bons risques", () => {
  // Les routes qui créent un compte, envoient un email ou appellent Stripe
  // doivent toutes refuser plutôt que s'ouvrir si le magasin manque.
  for (const regle of [CLAIM_PROGRAM_IP, CLAIM_PROGRAM_EMAIL, PASSWORD_RESET_IP, PASSWORD_RESET_EMAIL, PROGRAM_CHECKOUT_IP]) {
    assert.equal(regle.failClosed, true, `${regle.name} doit être fail-closed`);
    assert.ok(regle.limit > 0 && regle.windowMs > 0, `${regle.name} : bornes valides`);
  }
  assert.equal(DOUBLE_SUBMIT.limit, 1, "la garde anti-rejeu ne laisse passer qu'un appel");
  assert.ok(CLAIM_PROGRAM_EMAIL.windowMs >= 24 * 60 * 60 * 1000, "quota par email sur 24 h au moins");
});

/* ─────────────── 12-14. En-têtes de sécurité (H-1) ─────────────── */

await test("12. en-têtes de sécurité déclarés", async () => {
  const config = await import("../../next.config");
  const headers = await (config.default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }).headers();

  const global = headers.find((h) => h.source === "/:path*");
  assert.ok(global, "règle globale absente");
  const parCle = new Map(global.headers.map((h) => [h.key, h.value]));

  assert.equal(parCle.get("X-Content-Type-Options"), "nosniff");
  assert.equal(parCle.get("X-Frame-Options"), "DENY");
  assert.equal(parCle.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.ok(parCle.get("Permissions-Policy")?.includes("camera=()"), "Permissions-Policy restrictive");

  const csp = parCle.get("Content-Security-Policy-Report-Only");
  assert.ok(csp, "CSP absente");
  assert.ok(csp.includes("frame-ancestors 'none'"), "clickjacking non couvert");
  assert.ok(csp.includes("object-src 'none'"), "object-src non verrouillé");
  assert.ok(csp.includes("https://*.supabase.co"), "Supabase absent de connect-src");
  assert.ok(csp.includes("https://js.stripe.com"), "Stripe absent");
  // Report-Only d'abord : une CSP bloquante non mesurée casse le paiement.
  assert.ok(!parCle.has("Content-Security-Policy"), "la CSP doit rester en Report-Only à ce stade");
});

await test("13. les pages privées et les API ne sont jamais mises en cache partagé", async () => {
  const config = await import("../../next.config");
  const headers = await (config.default as { headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]> }).headers();

  for (const chemin of ["/api/:path*", "/dashboard", "/admin", "/entrainement", "/documents"]) {
    const regle = headers.find((h) => h.source === chemin);
    assert.ok(regle, `aucune règle de cache pour ${chemin}`);
    const cache = regle.headers.find((h) => h.key === "Cache-Control")?.value ?? "";
    assert.ok(cache.includes("private") && cache.includes("no-store"), `${chemin} : cache non privé`);
  }
});

await test("14. aucune clé Upstash exposée au navigateur", () => {
  const source = lire("../../lib/security/rate-limit.ts");
  assert.ok(source.startsWith('import "server-only"'), "module strictement serveur");
  assert.ok(!source.includes("NEXT_PUBLIC_UPSTASH"), "aucune variable publique");
  assert.ok(source.includes("UPSTASH_REDIS_REST_URL") && source.includes("UPSTASH_REDIS_REST_TOKEN"));

  const exemple = lire("../../.env.example");
  assert.ok(exemple.includes("UPSTASH_REDIS_REST_URL="), "variable documentée dans .env.example");
  assert.ok(
    /UPSTASH_REDIS_REST_URL=\s*$/m.test(exemple) && /UPSTASH_REDIS_REST_TOKEN=\s*$/m.test(exemple),
    "les valeurs doivent rester vides dans .env.example",
  );
});

/* ─────────────── 15-16. Guards fail-closed (M-4) ─────────────── */

await test("15. les guards refusent en production sans configuration Supabase", () => {
  const env = lire("../../lib/supabase/env.ts");
  assert.ok(env.includes("export function isMockModeAllowed"), "helper de mode mock absent");
  assert.ok(
    /isMockModeAllowed[\s\S]{0,200}NODE_ENV !== "production"/.test(env),
    "le mode mock doit être interdit en production",
  );

  const guards = lire("../../lib/supabase/guards.ts");
  assert.ok(guards.includes("function shouldSkipGuards"), "garde centralisée absente");
  assert.ok(
    /shouldSkipGuards[\s\S]{0,400}redirect\("\/acces-refuse"\)/.test(guards),
    "aucun refus explicite en production",
  );
  // Plus aucun court-circuit direct : tout passe par la garde centralisée.
  assert.ok(
    !/if \(!isSupabaseConfigured\(\)\) \{\s*return;/.test(guards),
    "un guard court-circuite encore sans passer par shouldSkipGuards",
  );
  assert.equal((guards.match(/if \(shouldSkipGuards\(\)\)/g) ?? []).length, 7, "les 7 guards sont couverts");
});

await test("16. migration C-1/H-3 : is_admin(), trigger, WITH CHECK, policy large supprimée", () => {
  const migration = lire("../../supabase/migrations/20260726220000_fix_profiles_role_escalation.sql");

  // Vérification d'administration DÉDIÉE : is_coach_or_admin() engloberait
  // les coachs, qui pourraient alors se promouvoir mutuellement.
  assert.ok(migration.includes("create or replace function public.is_admin()"), "is_admin() absente");
  assert.ok(/is_admin\(\)[\s\S]{0,400}role = 'admin'/.test(migration), "is_admin() doit exiger le rôle admin");
  assert.ok(
    migration.includes("revoke execute on function public.is_admin() from anon"),
    "anon doit être explicitement révoqué sur is_admin()",
  );
  assert.ok(
    migration.includes("grant execute on function public.is_admin() to authenticated, service_role"),
    "permissions minimales sur is_admin()",
  );
  assert.ok(
    !/new\.role is distinct from old\.role and not public\.is_coach_or_admin\(\)/.test(migration),
    "le changement de rôle ne doit JAMAIS s'appuyer sur is_coach_or_admin()",
  );
  assert.ok(
    /new\.role is distinct from old\.role and not public\.is_admin\(\)/.test(migration),
    "le changement de rôle doit s'appuyer sur is_admin()",
  );

  // Trigger de protection des colonnes.
  assert.ok(migration.includes("create or replace function public.protect_profiles_role_column()"));
  assert.ok(migration.includes("security definer"), "fonction SECURITY DEFINER");
  assert.ok((migration.match(/set search_path = public/g) ?? []).length >= 2, "search_path figé sur les deux fonctions");
  assert.ok(migration.includes("create trigger protect_role_column"), "trigger absent");
  assert.ok(migration.includes("before update on public.profiles"), "trigger mal positionné");

  // user_id immuable pour TOUT utilisateur authentifié, admin compris :
  // aucune exception de rôle ne doit accompagner ce contrôle.
  assert.ok(migration.includes("new.user_id is distinct from old.user_id then"),
    "le contrôle sur user_id doit être inconditionnel pour les utilisateurs authentifiés");
  assert.ok(
    !/new\.user_id is distinct from old\.user_id and not/.test(migration),
    "user_id ne doit dépendre d'aucun rôle",
  );

  assert.ok(migration.includes("with check (user_id = auth.uid() or public.is_coach_or_admin())"), "WITH CHECK absent");
  assert.ok(
    migration.includes('drop policy if exists "profiles_select_authenticated" on public.profiles'),
    "la policy trop large n'est pas supprimée",
  );
  assert.ok(migration.includes("coalesce(auth.role(), '') = 'service_role'"), "le service role doit rester autorisé");
  // Migration additive : aucune écriture de données.
  assert.ok(!/^\s*(update|delete|truncate)\s+/im.test(migration), "la migration ne doit modifier aucune donnée");
  // Tables qualifiées par leur schéma.
  assert.ok(!/\bon profiles\b/.test(migration), "table non qualifiée");
});

await test("17. le script SQL couvre les six rôles et la règle métier retenue", () => {
  const sql = lire("../../scripts/sql/profiles-security-tests.sql");
  assert.ok(sql.includes("rollback;"), "le script doit annuler ses écritures");
  assert.ok(sql.includes("Supabase local"), "avertissement d'usage local absent");

  for (const scenario of [
    "élève modifie son propre nom",
    "élève change son rôle : refusé",
    "élève change son user_id : refusé",
    "élève lit son propre profil",
    "élève ne lit pas les profils des autres élèves",
    "élève ne modifie pas le profil d",
    "9. anon : permission denied sur profiles",
    "coach lit tous les profils",
    "coach modifie le nom d",
    "coach change le rôle d'un élève : refusé".replace("'", "''"),
    "coach promeut un élève admin : refusé",
    "coach ne se promeut pas administrateur",
    "coach change un user_id : refusé",
    "admin passe un élève en coach",
    "admin promeut un compte administrateur",
    "admin change un user_id : refusé",
    "service role crée un profil",
    "service role ajuste un rôle",
    "profiles_select_authenticated absente",
    "is_admin() : search_path figé, anon révoqué",
  ]) {
    assert.ok(sql.includes(scenario), `scénario manquant : ${scenario}`);
  }

  // Les cinq rôles demandés sont incarnés.
  for (const role of ["pg_temp.anonyme()", "pg_temp.service()", "11111111-1111", "22222222-2222", "33333333-3333", "44444444-4444"]) {
    assert.ok(sql.includes(role), `rôle non couvert : ${role}`);
  }
});


/* ─────────────── 18-20. Baseline local (hors migrations) ─────────────── */

await test("18. le baseline est HORS de supabase/migrations — impossible à pousser", () => {
  const racine = new URL("../../", import.meta.url).pathname;

  assert.ok(existsSync(`${racine}supabase/baseline/00_baseline_remote_schema.sql`), "baseline absent");
  assert.ok(existsSync(`${racine}supabase/baseline/01_post_baseline_storage.sql`), "storage post-baseline absent");

  // `supabase db push` ne pousse que supabase/migrations/ : le baseline ne
  // doit jamais s'y trouver, sous aucun nom.
  const migrations = readdirSync(`${racine}supabase/migrations`);
  for (const fichier of migrations) {
    assert.ok(!/baseline/i.test(fichier), `un fichier de baseline traîne dans migrations/ : ${fichier}`);
  }
  // 39 depuis la persistance de l'objectif hebdomadaire des plans v2
  // (migration 20260805090000, feat/nutrition-plan-v2-builder — déclarée
  // dans le manifeste comme le veut la procédure).
  assert.equal(migrations.filter((f) => f.endsWith(".sql")).length, 58, "les 58 migrations doivent rester intactes");
});

await test("19. manifeste : empreintes exactes et borne cohérente", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));

  for (const [nom, meta] of Object.entries(manifeste.fichiers) as [string, { sha256: string }][]) {
    const contenu = readFileSync(new URL(`../../supabase/baseline/${nom}`, import.meta.url));
    const sha = createHash("sha256").update(contenu).digest("hex");
    assert.equal(sha, meta.sha256, `${nom} : empreinte différente du manifeste`);
  }

  assert.equal(manifeste.source.commit, "5bafc50");
  assert.equal(manifeste.borne.derniere_migration_incluse, "20260722120000_save_training_session_blocks_session_patch");
  assert.equal(manifeste.borne.premiere_migration_a_rejouer, "20260724214500_delete_unused_subscription_template_rpc");
  // 27 : recompté le 01/08/2026 — le manifeste disait « 25 » alors que 27
  // fichiers précèdent la borne (chiffre purement documentaire, la borne
  // par NOMS reste l'unique pilote du bootstrap). Corrigé avec validation.
  assert.equal(manifeste.borne.migrations_incluses_dans_le_baseline, 27);

  // Les migrations annoncées existent réellement, et ce sont bien celles
  // qui suivent la borne.
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 31);
  const presentes = readdirSync(new URL("../../supabase/migrations", import.meta.url).pathname)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => f >= "20260724214500")
    .sort();
  assert.deepEqual(attendues.slice().sort(), presentes, "la liste post-baseline ne correspond pas au dossier");

  // Le correctif de sécurité fait partie des migrations rejouées.
  assert.ok(attendues.includes("20260726220000_fix_profiles_role_escalation.sql"));

  // Aucune donnée réelle annoncée ni présente.
  for (const cle of ["insert_de_donnees_metier", "comptes_utilisateurs", "emails_reels", "identifiants_stripe", "secrets"]) {
    assert.equal(manifeste.garanties_de_contenu[cle], 0, `garantie non tenue : ${cle}`);
  }
  const baseline = lire("../../supabase/baseline/00_baseline_remote_schema.sql");
  assert.ok(!/@gmail|favierjules|sk_live|re_[A-Za-z0-9]{16}/i.test(baseline), "donnée ou secret réel dans le baseline");
});

await test("20. le script local ne peut pas viser un environnement distant", () => {
  const script = lire("../../scripts/db-local-init.sh");
  // On ignore les commentaires : seules les lignes exécutables comptent.
  const executables = script
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && l.trim().length > 0)
    .join("\n");

  // La seule occurrence tolérée est la liste des arguments REFUSÉS.
  const lignesSuspectes = executables
    .split("\n")
    .filter((l) => /--linked|migration repair|db reset|supabase\.(co|in)/.test(l))
    .filter((l) => !/abandon|argument interdit|\|--db-url/.test(l));
  assert.deepEqual(lignesSuspectes, [], `commande distante dans le script : ${lignesSuspectes.join(" / ")}`);

  // Protections attendues.
  assert.ok(script.includes("127.0.0.1|localhost|::1"), "aucun contrôle d'hôte local");
  assert.ok(script.includes("ON_ERROR_STOP=1"), "le script doit s'arrêter à la première erreur");
  assert.ok(script.includes("set -euo pipefail"), "mode strict absent");
  assert.ok(script.includes("verifier_sha"), "aucune vérification d'empreinte");
  assert.ok(!/PGPASSWORD|--password|-W\b/.test(script), "aucun mot de passe ne doit figurer");
  assert.ok(script.includes("PREMIERE_A_REJOUER"), "la borne doit venir du manifeste");

  // Le seed reste synthétique.
  const seed = lire("../../supabase/seed.sql");
  assert.ok(!/@gmail|favierjules/i.test(seed), "donnée réelle dans le seed");
  assert.ok(/@example\.test/.test(seed), "le seed doit utiliser @example.test");

  // schema.sql est signalé comme historique, jamais exécuté par le script.
  const schema = lire("../../supabase/schema.sql");
  assert.ok(schema.includes("FICHIER HISTORIQUE"), "schema.sql doit porter un avertissement");
  // Attention au faux positif : `00_baseline_remote_schema.sql` se termine
  // lui aussi par « schema.sql ». On cible le chemin exact du fichier
  // historique.
  assert.ok(
    !/psql[^\n]*supabase\/schema\.sql/.test(script),
    "le script ne doit jamais exécuter supabase/schema.sql",
  );
});


await test("21. le script démarre TOUJOURS depuis un workdir isolé, jamais depuis le dépôt", () => {
  const script = lire("../../scripts/db-local-init.sh");
  const executables = script
    .split("\n")
    .filter((l) => !/^\s*#/.test(l) && l.trim().length > 0);

  // Cause de l'échec du premier essai : `supabase start` lancé depuis le
  // dépôt applique automatiquement supabase/migrations/ et meurt sur la
  // première migration (student_profiles n'existe pas encore).
  const lignesStart = executables.filter((l) => /supabase[^\n]*\bstart\b|SUPABASE_CLI[^\n]*\bstart\b/.test(l));
  assert.ok(lignesStart.length > 0, "aucun démarrage trouvé");
  for (const ligne of lignesStart) {
    assert.ok(
      /--workdir "\$BOOTSTRAP_WORKDIR"/.test(ligne),
      `démarrage sans --workdir isolé : ${ligne.trim()}`,
    );
  }

  // `status` doit interroger EXACTEMENT le même workdir, sinon l'URL lue
  // ne correspond pas à la pile démarrée.
  const lignesStatus = executables.filter((l) => /\bstatus\b[^\n]*-o env/.test(l));
  assert.ok(lignesStatus.length > 0, "aucune lecture de statut trouvée");
  for (const ligne of lignesStatus) {
    assert.ok(
      /--workdir "\$BOOTSTRAP_WORKDIR"/.test(ligne),
      `statut lu sans --workdir isolé : ${ligne.trim()}`,
    );
  }

  // Aucune commande CLI ne doit s'exécuter dans le dépôt principal.
  // (On écarte la ligne qui DÉFINIT la variable : ce n'est pas un appel.)
  const sansWorkdir = executables.filter(
    (l) =>
      /npx supabase|\$SUPABASE_CLI/.test(l) &&
      !/--workdir/.test(l) &&
      !/^\s*SUPABASE_CLI=/.test(l),
  );
  assert.deepEqual(sansWorkdir, [], `commande CLI sans --workdir : ${sansWorkdir.join(" / ")}`);

  // Le workdir est hors du dépôt, et le script le vérifie lui-même.
  assert.ok(script.includes("$HOME/.cache/coaching-platform-supabase-bootstrap"), "workdir par défaut attendu");
  assert.ok(
    /case "\$BOOTSTRAP_WORKDIR" in[\s\S]{0,200}abandon/.test(script),
    "le script doit refuser un workdir situé dans le dépôt",
  );

  // La copie de configuration doit être isolée et sans seed automatique.
  assert.ok(script.includes('PROJECT_ID="coaching-platform-bootstrap"'), "PROJECT_ID isolé absent");
  assert.ok(
    script.includes('s/^project_id = .*/project_id = \\"${PROJECT_ID}\\"/'),
    "la copie de config doit reprendre PROJECT_ID",
  );
  assert.ok(script.includes("dans_seed && /^enabled *=/"), "seed automatique non désactivé");
  assert.ok(
    script.includes('abandon "le workdir isolé contient un dossier migrations."'),
    "absence de migrations non vérifiée",
  );

  // `db reset` reste proscrit : c'est lui qui rejouerait tout.
  const resetExecutable = executables.filter((l) => /\bdb reset\b/.test(l));
  assert.deepEqual(resetExecutable, [], "db reset ne doit jamais être exécuté");
});


await test("22. tout le SQL passe par le conteneur — aucun psql exigé sur la machine", () => {
  const script = lire("../../scripts/db-local-init.sh");
  const lignes = script.split("\n");
  const executables = lignes.filter((l) => !/^\s*#/.test(l) && l.trim().length > 0);

  // Cause du second échec : « psql: command not found ». Le client n'est pas
  // installé sur toutes les machines ; le conteneur PostgreSQL l'embarque.
  // Toute invocation de psql doit donc appartenir à un bloc `docker exec`.
  const indicesPsql = lignes
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /(^|[^\w-])psql\s/.test(l) && !/^\s*#/.test(l));
  assert.ok(indicesPsql.length > 0, "aucune invocation de psql trouvée");

  for (const { l, i } of indicesPsql) {
    // `docker exec` peut être sur la même ligne ou sur l'une des deux
    // précédentes (continuation par \).
    const contexte = lignes.slice(Math.max(0, i - 2), i + 1).join(" ");
    assert.ok(
      /docker exec/.test(contexte),
      `psql exécuté hors docker exec (ligne ${i + 1}) : ${l.trim()}`,
    );
    assert.ok(
      /ON_ERROR_STOP=1/.test(contexte) || /ON_ERROR_STOP=1/.test(l),
      `psql sans ON_ERROR_STOP=1 (ligne ${i + 1}) : ${l.trim()}`,
    );
  }

  // Plus aucun helper qui se connecterait depuis la machine.
  assert.ok(!/psql_local/.test(script), "l'ancien helper psql_local subsiste");
  assert.ok(
    !executables.some((l) => /psql\s+"\$DB_URL"/.test(l)),
    "connexion directe par URL depuis la machine",
  );

  // Les deux helpers attendus existent et sont utilisés partout.
  assert.ok(/run_sql_file\(\) \{/.test(script), "run_sql_file absent");
  assert.ok(/run_sql\(\) \{/.test(script), "run_sql absent");
  for (const cible of [
    '"$BASELINE_DIR/00_baseline_remote_schema.sql"',
    '"$BASELINE_DIR/01_post_baseline_storage.sql"',
    '"$fichier"',
    "supabase/seed.sql",
    "supabase/tests/seed-verification.sql",
  ]) {
    assert.ok(script.includes(`run_sql_file ${cible}`), `run_sql_file non utilisé pour ${cible}`);
  }

  // Le conteneur est détecté par son nom EXACT, puis contrôlé avant usage.
  assert.ok(
    script.includes('grep -- "^supabase_db_${PROJECT_ID}\\$"'),
    "détection du conteneur trop laxiste",
  );
  const positionDetection = script.indexOf("DB_CONTAINER=");
  const positionControle = script.indexOf('if [[ -z "$DB_CONTAINER" ]]');
  const positionUsage = script.indexOf('docker exec -i "$DB_CONTAINER"');
  assert.ok(positionDetection > 0 && positionControle > positionDetection, "DB_CONTAINER non contrôlé après détection");
  assert.ok(positionUsage > positionControle, "DB_CONTAINER utilisé avant d'être contrôlé");
  assert.ok(
    /if \[\[ -z "\$DB_CONTAINER" \]\][\s\S]{0,400}abandon/.test(script),
    "le script doit s'arrêter si le conteneur est introuvable",
  );

  // Le seul prérequis machine reste Docker.
  assert.ok(script.includes('command -v docker'), "vérification de Docker absente");
  assert.ok(!/command -v psql/.test(script), "le script ne doit pas exiger psql sur la machine");
});


await test("23. les fixtures SQL respectent les contraintes CHECK réelles du schéma", () => {
  const sql = lire("../../scripts/sql/profiles-security-tests.sql");
  const baseline = lire("../../supabase/baseline/00_baseline_remote_schema.sql");

  // Extrait les valeurs autorisées par une contrainte CHECK du baseline.
  const valeursAutorisees = (contrainte: string): string[] => {
    const motif = new RegExp(`CONSTRAINT "${contrainte}" CHECK \\(\\("[a-z_]+" = ANY \\(ARRAY\\[([^\\]]+)\\]`);
    const trouve = baseline.match(motif);
    assert.ok(trouve, `contrainte introuvable dans le baseline : ${contrainte}`);
    return [...trouve[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  };

  // Piège rencontré à l'exécution : students.status a pour DEFAULT 'actif'
  // alors que sa contrainte n'accepte que l'anglais. Et coaches.status, lui,
  // n'accepte QUE le français — les deux ne suivent pas la même convention.
  const statutsEleve = valeursAutorisees("students_status_check");
  assert.deepEqual(statutsEleve, ["active", "paused", "completed"]);
  assert.ok(!statutsEleve.includes("actif"), "students.status n'accepte pas « actif »");

  // Chaque valeur insérée dans students doit appartenir à la contrainte.
  const insertsStudents = [...sql.matchAll(/insert into public\.students[\s\S]*?;/g)].map((m) => m[0]);
  assert.ok(insertsStudents.length > 0, "aucune insertion dans students");
  for (const bloc of insertsStudents) {
    for (const valeur of [...bloc.matchAll(/'(actif|active|paused|completed|inactif)'/g)].map((m) => m[1])) {
      assert.ok(
        statutsEleve.includes(valeur),
        `valeur de statut invalide dans une fixture students : « ${valeur} »`,
      );
    }
    // La valeur est fournie explicitement : le DEFAULT violerait la contrainte.
    assert.ok(/status/.test(bloc), "students.status doit être renseigné explicitement");
  }

  // Rôles et types d'accès : mêmes vérifications, contre le schéma réel.
  const roles = valeursAutorisees("profiles_role_check");
  const rolesUtilises = [...sql.matchAll(/'(student|coach|admin)'[,)]/g)].map((m) => m[1]);
  for (const role of new Set(rolesUtilises)) {
    assert.ok(roles.includes(role), `rôle hors contrainte : ${role}`);
  }

  const typesAcces = valeursAutorisees("students_access_type_check");
  for (const type of [...sql.matchAll(/'(coaching|programme_seul)'/g)].map((m) => m[1])) {
    assert.ok(typesAcces.includes(type), `access_type hors contrainte : ${type}`);
  }

  // ── coaches : role et status, vérifiés colonne par colonne ──
  // Cause du dernier échec : la fixture employait role = 'coach', valeur
  // valide pour `profiles.role` mais PAS pour `coaches.role`, dont la
  // contrainte n'accepte que 'admin' et 'assistant'. Les deux colonnes
  // portent le même nom sans désigner la même chose.
  const rolesCoach = valeursAutorisees("coaches_role_check");
  assert.deepEqual(rolesCoach, ["admin", "assistant"]);
  assert.ok(!rolesCoach.includes("coach"), "coaches.role n'accepte pas « coach »");
  const statutsCoach = valeursAutorisees("coaches_status_check");
  assert.deepEqual(statutsCoach, ["actif", "inactif"]);

  // Découpe un tuple VALUES en respectant les littéraux entre apostrophes.
  const champs = (tuple: string): string[] =>
    [...tuple.matchAll(/'((?:[^']|'')*)'|(null)|([^,'\s][^,]*)/g)].map((m) => (m[1] ?? m[2] ?? m[3] ?? "").trim());

  const insertCoaches = sql.match(/insert into public\.coaches \(([^)]+)\)\s*values([\s\S]*?);/);
  assert.ok(insertCoaches, "aucune insertion dans coaches");
  const colonnes = insertCoaches[1].split(",").map((c) => c.trim());
  // Les colonnes NOT NULL sans DEFAULT doivent être fournies.
  assert.ok(colonnes.includes("name"), "coaches.name est NOT NULL sans DEFAULT");

  const tuples = [...insertCoaches[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  assert.ok(tuples.length >= 2, "il faut deux coachs : le sien, et celui d'un autre");
  for (const tuple of tuples) {
    const valeurs = champs(tuple);
    assert.equal(valeurs.length, colonnes.length, `tuple mal formé : ${tuple}`);
    const valeur = (colonne: string) => valeurs[colonnes.indexOf(colonne)];

    assert.ok(rolesCoach.includes(valeur("role")), `coaches.role hors contrainte : « ${valeur("role")} »`);
    assert.ok(statutsCoach.includes(valeur("status")), `coaches.status hors contrainte : « ${valeur("status")} »`);
    // NOT NULL, sans contrainte de valeur : seule leur présence compte.
    for (const obligatoire of ["name", "email", "specialty"]) {
      assert.ok(valeur(obligatoire).length > 0, `coaches.${obligatoire} est NOT NULL et doit être renseigné`);
    }
  }
  // Les deux coachs doivent être distincts, sinon le test « pas le coach
  // d'autrui » serait vrai par vacuité.
  assert.notEqual(champs(tuples[0])[colonnes.indexOf("id")], champs(tuples[1])[colonnes.indexOf("id")]);

  // L'en-tête du script doit décrire la procédure RÉELLE, pas l'ancienne.
  assert.ok(sql.includes("npm run db:local:init"), "en-tête obsolète : db reset y figure encore");
  assert.ok(!/npx supabase db reset/.test(sql), "l'en-tête ne doit plus mentionner db reset");
});


await test("24. policy de lecture stricte + RPC dédiée pour l'identité du coach", () => {
  const migration = lire("../../supabase/migrations/20260726220000_fix_profiles_role_escalation.sql");

  // La clause qui exposait les lignes staff à TOUT LE MONDE, y compris anon,
  // ne doit plus figurer dans la policy.
  const policySelect = migration.slice(
    migration.indexOf('create policy "profiles_select_self_or_staff"'),
    migration.indexOf("revoke all on table public.profiles from anon"),
  );
  assert.ok(policySelect.length > 0, "policy de lecture introuvable");
  assert.ok(!/role in \('coach', 'admin'\)/.test(policySelect), "la clause inconditionnelle subsiste");
  assert.ok(/for select\s+to authenticated/.test(policySelect), "la policy doit cibler le rôle authenticated");
  assert.ok(policySelect.includes("user_id = auth.uid()"), "lecture de sa propre ligne");
  assert.ok(policySelect.includes("public.is_coach_or_admin()"), "accès métier du staff");

  // Privilèges de table retirés à anon, après audit des usages.
  assert.ok(
    migration.includes("revoke all on table public.profiles from anon"),
    "les privilèges d'anon sur profiles ne sont pas révoqués",
  );

  // RPC dédiée : identité minimale, sans paramètre falsifiable.
  assert.ok(
    migration.includes("create or replace function public.get_my_coach_public_profile()"),
    "RPC du coach absente",
  );
  const rpc = migration.slice(migration.indexOf("create or replace function public.get_my_coach_public_profile()"));
  assert.ok(/returns table \(\s*coach_id uuid,\s*first_name text,\s*last_name text,\s*specialty text/.test(rpc),
    "la RPC doit renvoyer exactement l'identité minimale");
  // On inspecte le CORPS de la fonction, pas les commentaires : le mot
  // français « téléphone » contient « phone » et donnerait un faux positif.
  const corps = rpc.slice(rpc.indexOf("as $$"), rpc.indexOf("$$;"));
  for (const interdit of ["email", "phone", "c.role", "c.status", "password"]) {
    assert.ok(!corps.includes(interdit), `la RPC ne doit pas exposer ${interdit}`);
  }
  assert.ok(rpc.includes("where s.user_id = auth.uid()"), "l'association élève→coach doit être vérifiée");
  assert.ok(!/get_my_coach_public_profile\([^)]+\)/.test(rpc.split("as $$")[0]),
    "la RPC ne doit accepter aucun paramètre (sinon IDOR)");
  assert.ok(rpc.includes("set search_path = public"), "search_path explicite");
  assert.ok(
    rpc.includes("revoke execute on function public.get_my_coach_public_profile() from anon"),
    "anon doit être explicitement révoqué",
  );
  assert.ok(
    rpc.includes("grant execute on function public.get_my_coach_public_profile() to authenticated, service_role"),
    "permissions minimales",
  );

  // Le code consommateur ne lit pas le nom du coach depuis profiles.
  const appointments = lire("../../lib/supabase/appointments.ts");
  assert.ok(appointments.includes('from("coaches")'), "getPrimaryCoachInfo lit bien la table coaches");
});

await test("25. les tests SQL couvrent la lecture des profils et la RPC", () => {
  const sql = lire("../../scripts/sql/profiles-security-tests.sql");
  for (const scenario of [
    "9. anon : permission denied sur profiles",
    "9f. catalogue : anon n''a pas SELECT sur profiles",
    "9g. anon : permission denied sur get_my_coach_public_profile()",
    "21. élève ne lit aucun profil coach/admin",
    "22. élève ne voit que sa propre ligne",
    "23. la RPC renvoie le coach associé",
    "24. élève sans coach : la RPC ne renvoie rien",
    "25. la RPC n''expose que l''identité minimale",
    "25b. types de sortie de la RPC",
    "25c. clés réellement renvoyées par la RPC",
    "25d. la RPC n''accepte aucun argument d''entrée",
    "25e. la RPC n''expose ni email, ni téléphone, ni rôle, ni statut, ni note interne",
    "26. anon ne peut pas exécuter la RPC du coach",
    "27. anon n''a plus de privilège sur profiles",
    "28. aucune policy ne contient de clause role in (coach, admin) inconditionnelle",
    "29. profiles_select_self_or_staff ciblée sur authenticated",
    "profiles_select_authenticated absente",
  ]) {
    assert.ok(sql.includes(scenario), `scénario manquant : ${scenario}`);
  }
  // `revoke all ... from anon` fait échouer la lecture AVANT la RLS : le
  // scénario anonyme doit donc attendre « permission denied », et non zéro
  // ligne. Les trois issues sont distinguées — refus, lecture vide (GRANT
  // revenu), lecture non vide (fuite).
  assert.ok(sql.includes("le GRANT est revenu"), "l'issue « lisible mais vide » doit être signalée, pas confondue avec un succès");
  assert.ok(sql.includes("ÉCHEC CRITIQUE — 9. anon lit"), "l'issue « lignes visibles » doit être un échec critique distinct");

  // Piège à éviter : capturer l'exception levée volontairement comme un
  // succès. Le verdict passe par un booléen, et les `raise exception`
  // d'échec sont rendus HORS du bloc `exception when insufficient_privilege`,
  // dont le corps se limite à positionner ce booléen.
  assert.ok(sql.includes("refuse boolean := false"), "le verdict doit passer par un booléen");
  for (const handler of sql.matchAll(/exception when insufficient_privilege then\s*([\s\S]*?)\n  end;/g)) {
    assert.ok(
      !/raise exception/.test(handler[1]),
      "un handler insufficient_privilege ne doit pas contenir le verdict d'échec",
    );
  }

  // Introspection d'une fonction RETURNS TABLE : son type de retour est le
  // pseudo-type `record` (typrelid = 0), donc joindre pg_type à pg_attribute
  // ne renvoie AUCUNE ligne — c'est ce qui rendait la liste de colonnes vide.
  // Les colonnes de sortie se lisent dans proargnames/proargmodes.
  assert.ok(
    !/join pg_attribute[\s\S]{0,200}get_my_coach_public_profile/.test(sql),
    "l'introspection ne doit pas passer par pg_attribute : RETURNS TABLE n'a pas de typrelid",
  );
  assert.ok(sql.includes("unnest(p.proargnames, p.proargmodes) with ordinality"),
    "les noms de colonnes doivent être reconstruits dans leur ordre réel");
  assert.ok(/x\.mode in \('o', 'b', 't'\)/.test(sql),
    "les modes de sortie OUT/INOUT/TABLE doivent être filtrés explicitement");
  // `proallargnames` n'existe pas dans pg_proc — la colonne est `proargnames`.
  assert.ok(!/p\.proallargnames/.test(sql), "pg_proc.proallargnames n'existe pas");
  // Le contrôle ne se limite pas au catalogue : une ligne réelle est observée.
  assert.ok(sql.includes("to_jsonb(f) into ligne from public.get_my_coach_public_profile() f"),
    "la signature doit aussi être prouvée à l'exécution");

  // Le jeu d'essai doit relier l'élève A à un coach, et laisser B sans coach.
  assert.ok(sql.includes("insert into public.coaches"), "fiche coach absente du jeu d'essai");
  assert.ok(/coach_id\)\s*values[\s\S]{0,400}'99999999-9999-9999-9999-999999999999'/.test(sql),
    "l'élève A doit être rattaché au coach");
  assert.ok(/'Bob',   'B'[^\n]*null\)/.test(sql), "l'élève B doit rester sans coach");
});


await test("26. l'orchestration repart d'une base réellement vierge", () => {
  const script = lire("../../scripts/db-local-init.sh");

  // Cause du dernier échec : `docker rm -f` ne supprime pas les volumes
  // nommés. La base survivait donc d'une exécution à l'autre, et le baseline
  // — non idempotent — tentait de recréer une clé primaire existante :
  //   ERROR: multiple primary keys for table "activity_events" are not allowed
  assert.ok(
    script.includes("docker volume ls --format '{{.Name}}'"),
    "volumes non listés",
  );
  assert.ok(/docker volume rm -f \$VOLUMES/.test(script), "volumes non supprimés");

  // Garde-fou explicite : refus d'appliquer le baseline sur une base peuplée.
  assert.ok(script.includes("TABLES_EXISTANTES"), "aucun contrôle de base vierge");
  assert.ok(
    /TABLES_EXISTANTES:-0[\s\S]{0,200}abandon/.test(script),
    "le script doit s'arrêter si la base n'est pas vierge",
  );

  // Journalisation demandée : chaque fichier SQL appliqué est nommé.
  assert.ok(script.includes('echo "  Application SQL : $file"'), "fichier appliqué non journalisé");

  // Contrôles post-installation du correctif de sécurité.
  for (const attendu of ["20260726220000", "is_admin", "get_my_coach_public_profile", "protect_role_column"]) {
    assert.ok(script.includes(attendu), `contrôle manquant : ${attendu}`);
  }
});


await test("27. le nettoyage Docker ne touche QUE le projet local", () => {
  const script = lire("../../scripts/db-local-init.sh");
  const executables = script.split("\n").filter((l) => !/^\s*#/.test(l) && l.trim().length > 0);

  // Filtres proscrits : ils emporteraient les piles d'autres projets.
  for (const dangereux of ["docker volume prune", "docker system prune", "grep '^supabase_'"]) {
    assert.ok(
      !executables.some((l) => l.includes(dangereux)),
      `commande de nettoyage trop large : ${dangereux}`,
    );
  }
  assert.ok(
    !executables.some((l) => /--filter\s+'?name=supabase_'?/.test(l)),
    "filtre Docker par préfixe supabase_ : trop large",
  );

  // Le filtre doit être ancré des DEUX côtés : préfixe supabase_ ET suffixe
  // exact du PROJECT_ID. L'un sans l'autre laisse passer des noms voisins.
  assert.ok(script.includes('PROJECT_ID="coaching-platform-bootstrap"'), "PROJECT_ID absent");
  assert.ok(
    script.includes('MOTIF="^supabase_[^[:space:]]+_${PROJECT_ID}\\$"'),
    "motif de filtrage absent ou non ancré des deux côtés",
  );
  assert.ok(
    /CONTENEURS=.*docker ps -a --format '\{\{\.Names\}\}'.*grep -E -- "\$MOTIF"/.test(script),
    "les conteneurs ne sont pas filtrés par le motif ancré",
  );
  assert.ok(
    /VOLUMES=.*docker volume ls --format '\{\{\.Name\}\}'.*grep -E -- "\$MOTIF"/.test(script),
    "les volumes ne sont pas filtrés par le motif ancré",
  );
  // Le préfixe ne doit jamais être utilisé seul.
  assert.ok(
    !executables.some((l) => /grep[^\n]*"?\^supabase_"?\s*$/.test(l)),
    "préfixe supabase_ utilisé sans le suffixe du projet",
  );

  // La liste est affichée avant suppression.
  assert.ok(script.includes('echo "  Conteneurs supprimés :"'), "conteneurs non listés avant suppression");
  assert.ok(script.includes('echo "  Volumes supprimés :"'), "volumes non listés avant suppression");
  // Absence de volume = on continue.
  assert.ok(script.includes("aucun volume du projet à supprimer"), "l'absence de volume doit être tolérée");

  // Garde-fous sur PROJECT_ID : vide, joker, espace, valeur inattendue.
  assert.ok(/if \[\[ -z "\$\{PROJECT_ID:-\}" \]\][\s\S]{0,120}abandon/.test(script), "PROJECT_ID vide non refusé");
  assert.ok(/\*\[\*\?%\]\*\|\*" "\*/.test(script), "jokers et espaces non refusés");
  assert.ok(
    /PROJECT_ID" != "coaching-platform-bootstrap"[\s\S]{0,120}abandon/.test(script),
    "un PROJECT_ID inattendu doit interrompre le script",
  );
});

await test("28. simulation du filtre : les autres projets sont épargnés", () => {
  // Reproduit exactement `grep -E -- "^supabase_[^[:space:]]+_<project_id>$"`.
  const motif = /^supabase_[^\s]+_coaching-platform-bootstrap$/;
  const selectionne = (nom: string) => motif.test(nom);

  for (const cible of [
    "supabase_db_coaching-platform-bootstrap",
    "supabase_storage_coaching-platform-bootstrap",
    "supabase_auth_coaching-platform-bootstrap",
    "supabase_kong_coaching-platform-bootstrap",
    "supabase_realtime_coaching-platform-bootstrap",
  ]) {
    assert.equal(selectionne(cible), true, `devrait être nettoyé : ${cible}`);
  }

  // Aucune autre pile de la machine ne doit être touchée.
  for (const epargne of [
    "autre_coaching-platform-bootstrap",           // bon suffixe, mauvais préfixe
    "supabase_db_autre-projet",                    // bon préfixe, mauvais suffixe
    "supabase_storage_autre-projet",
    "supabase_db_coaching-platform",               // le projet principal
    "supabase_db_coaching-platform-bootstrap-v2",  // suffixe plus long
    "supabase_coaching-platform-bootstrap",        // sans segment de service
    "mysupabase_db_coaching-platform-bootstrap",   // préfixe non ancré
    "supabase_db_bootstrap",
  ]) {
    assert.equal(selectionne(epargne), false, `ne doit JAMAIS être nettoyé : ${epargne}`);
  }
});


/* ─────────── 29-31. Table coaches fermée aux élèves (H-3 suite) ─────────── */

await test("29. la migration ferme coaches sans casser le staff", () => {
  const migration = lire("../../supabase/migrations/20260726220000_fix_profiles_role_escalation.sql");

  // La policy inconditionnelle disparaît.
  assert.ok(
    migration.includes('drop policy if exists "coaches_select_authenticated" on public.coaches'),
    "coaches_select_authenticated doit être supprimée",
  );
  // Elle est remplacée par une policy réservée au staff, ciblée sur le seul
  // rôle authenticated.
  assert.ok(
    /create policy "coaches_select_staff" on public\.coaches\s+for select\s+to authenticated\s+using \(public\.is_coach_or_admin\(\)\)/.test(migration),
    "coaches_select_staff doit cibler authenticated et is_coach_or_admin()",
  );
  // anon perd tout privilège sur la table.
  assert.ok(migration.includes("revoke all on table public.coaches from anon"), "anon doit perdre ses privilèges sur coaches");
  // Mais SELECT reste accordé à authenticated : c'est la RLS, pas le
  // privilège de table, qui écarte les élèves. Le révoquer casserait
  // /admin/parametres et le calendrier admin.
  assert.ok(
    !/revoke[^;]*on table public\.coaches[^;]*from[^;]*authenticated/i.test(migration),
    "SELECT ne doit PAS être révoqué à authenticated : coachs et admins en ont besoin",
  );
  // Toujours aucune écriture de données.
  assert.ok(!/^\s*(update|delete|truncate)\s+/im.test(migration), "la migration ne doit modifier aucune donnée");
});

await test("30. l'espace élève passe par la RPC, jamais par un select sur coaches", () => {
  const page = lire("../../app/(student)/rendez-vous/page.tsx");
  assert.ok(!page.includes("getPrimaryCoachInfo"), "la page élève ne doit plus appeler getPrimaryCoachInfo");
  assert.ok(page.includes("getMyCoachPublicInfo"), "la page élève doit utiliser la RPC dédiée");

  const appointments = lire("../../lib/supabase/appointments.ts");
  assert.ok(
    /export async function getMyCoachPublicInfo[\s\S]{0,600}\.rpc\("get_my_coach_public_profile"\)/.test(appointments),
    "getMyCoachPublicInfo doit appeler la RPC",
  );
  // Elle ne doit surtout pas retomber sur un select direct.
  const corps = appointments.slice(
    appointments.indexOf("export async function getMyCoachPublicInfo"),
    appointments.indexOf("export async function getPrimaryCoachInfo"),
  );
  assert.ok(!corps.includes('from("coaches")'), "getMyCoachPublicInfo ne doit jamais lire la table coaches");
  // L'email du coach n'est plus exposé au navigateur de l'élève.
  assert.ok(/email: ""/.test(corps), "la RPC ne fournit pas d'email : le champ doit rester vide côté élève");

  // Conséquence : un ORGANIZER sans adresse produirait une ligne .ics
  // invalide — elle est omise.
  const ics = lire("../../lib/ics.ts");
  assert.ok(
    /input\.organizerEmail\s*\n?\s*\?\s*`ORGANIZER/.test(ics),
    "la ligne ORGANIZER doit être omise quand l'email est absent",
  );

  // Les chemins serveur gardent l'accès complet (service role).
  for (const fichier of [
    "../../app/api/email/appointment-notification/route.ts",
    "../../app/api/cron/appointment-reminders/route.ts",
  ]) {
    assert.ok(lire(fichier).includes("createSupabaseAdminClient"), `${fichier} doit rester en service role`);
  }
});

await test("31. les tests SQL couvrent la RLS de coaches pour les six rôles", () => {
  const sql = lire("../../scripts/sql/profiles-security-tests.sql");
  for (const scenario of [
    "30. anon : permission denied sur coaches",
    "31. élève A ne lit aucune ligne de coaches",
    "32. élève A obtient son coach via la RPC",
    "33. élève A n''atteint pas le coach d''autrui",
    "34. élève B sans coach : rien via la RPC ni en direct",
    "35. le coach lit les fiches coaches",
    "36. l''admin lit les fiches coaches",
    "37. le service role lit les fiches coaches",
    "38. coaches_select_authenticated absente",
    "39. coaches_select_staff ciblée sur authenticated avec is_coach_or_admin()",
    "40. aucune policy coaches ne se contente de auth.role() = authenticated",
  ]) {
    assert.ok(sql.includes(scenario), `scénario manquant : ${scenario}`);
  }

  // Un second coach, rattaché à personne, est indispensable au test 33 :
  // sans lui, « ne pas voir le coach d'autrui » serait vrai par vacuité.
  assert.ok(sql.includes("'88888888-8888-8888-8888-888888888888'"), "second coach absent du jeu d'essai");
  assert.ok(/Bruno Autre/.test(sql), "le second coach doit être identifiable dans les traces");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

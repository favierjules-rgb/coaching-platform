/**
 * Tests de non-régression des correctifs H-1, H-2 et H-3
 * (audit de sécurité, seconde passe — 27/07/2026).
 *
 *   npm run test:authz-hardening
 *
 * Ces tests sont STATIQUES : ils lisent le code source plutôt que de lancer
 * un serveur. C'est un choix assumé — ils doivent échouer si quelqu'un
 * réintroduit le motif dangereux, y compris dans une route future, sans
 * dépendre d'une base de données ni d'un compte Stripe. Les scénarios
 * dynamiques (RLS réelle, rôles Postgres) restent couverts par
 * scripts/sql/profiles-security-tests.sql.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ICI = dirname(fileURLToPath(import.meta.url));
const lire = (chemin: string) => readFileSync(join(ICI, chemin), "utf8");
const RACINE = join(ICI, "../..");

/**
 * Retire commentaires de bloc et de ligne. Indispensable ici : les fichiers
 * corrigés DÉCRIVENT la faille supprimée (« ne renvoie plus action_link »),
 * et une recherche naïve retomberait sur ces explications. Un test qui
 * échoue parce qu'on a documenté le correctif serait un mauvais test.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

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

/** Tous les fichiers `route.ts` sous app/api. */
function routesApi(dossier = join(RACINE, "app/api")): string[] {
  const trouvees: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouvees.push(...routesApi(chemin));
    else if (entree === "route.ts") trouvees.push(chemin);
  }
  return trouvees;
}

const TOUTES_LES_ROUTES = routesApi();

/* ═══════════════ H-1 — checkout-status ne délivre plus d'accès ═══════════ */

const CHECKOUT_STATUS = lire("../../app/api/public/programs/checkout-status/route.ts");

await test("1. checkout-status ne génère plus aucun lien d'authentification", () => {
  // Le cœur du correctif : plus aucun appel capable de produire un
  // magiclink, un lien de récupération ou un jeton de session.
  const code = sansCommentaires(CHECKOUT_STATUS);
  assert.ok(!/generateLink/.test(code), "generateLink ne doit plus être appelé");
  assert.ok(!/action_link/.test(code), "action_link ne doit plus être lu");
  assert.ok(!/magiclink|recovery|invite/i.test(code), "aucun type de lien d'authentification");
});

await test("2. la réponse ne contient ni lien, ni jeton, ni URL privilégiée", () => {
  const corpsRenvoyes = [...CHECKOUT_STATUS.matchAll(/reponse\(\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.ok(corpsRenvoyes.length > 0, "aucune réponse trouvée");
  for (const corps of corpsRenvoyes) {
    for (const interdit of ["loginUrl", "access_token", "refresh_token", "token_hash", "action_link", "hashed_token"]) {
      assert.ok(!corps.includes(interdit), `la réponse ne doit jamais contenir « ${interdit} » : ${corps.trim()}`);
    }
  }
  // Seule une destination interne, non privilégiée, est autorisée.
  const destinations = [...CHECKOUT_STATUS.matchAll(/redirectTo:\s*"([^"]*)"/g)].map((m) => m[1]);
  for (const destination of destinations) {
    assert.ok(destination.startsWith("/"), `destination non interne : ${destination}`);
    assert.ok(
      !/reinitialiser-mot-de-passe|dashboard|entrainement/.test(destination),
      `destination privilégiée interdite : ${destination} — un session_id ne doit pas ouvrir d'espace connecté`,
    );
  }
});

await test("3. toutes les réponses portent Cache-Control: no-store", () => {
  assert.ok(/"Cache-Control": "no-store"/.test(CHECKOUT_STATUS), "en-tête no-store absent");
  // Les réponses passent par un helper unique : aucune ne peut l'oublier.
  // Une seule occurrence est attendue — celle du helper lui-même.
  const directes = sansCommentaires(CHECKOUT_STATUS).match(/return NextResponse\.json\(/g) ?? [];
  assert.equal(
    directes.length,
    1,
    "toutes les réponses doivent passer par le helper `reponse()` qui pose no-store",
  );
});

await test("4. le session_id n'est jamais journalisé en entier", () => {
  const logs = [...CHECKOUT_STATUS.matchAll(/console\.(?:error|warn|log)\(([^;]*)\)/g)].map((m) => m[1]);
  for (const log of logs) {
    assert.ok(
      !/\$\{sessionId\}/.test(log),
      `le session_id complet ne doit pas être journalisé : ${log.trim()}`,
    );
  }
  assert.ok(/function traceSession/.test(CHECKOUT_STATUS), "un helper de troncature doit exister");
});

await test("5. l'email provient de la session Stripe vérifiée, jamais du navigateur en priorité", () => {
  const extraction = CHECKOUT_STATUS.match(/const email = \(([\s\S]*?)\)\s*\.trim/);
  assert.ok(extraction, "extraction de l'email introuvable");
  const sources = extraction[1];
  const posStripe = sources.indexOf("customer_details");
  const posMetadata = sources.indexOf("metadata?.email");
  assert.ok(posStripe >= 0, "customer_details.email doit être utilisé");
  assert.ok(
    posMetadata === -1 || posStripe < posMetadata,
    "customer_details.email (source Stripe) doit primer sur metadata.email (origine navigateur)",
  );
});

await test("6. le composant de la page merci ne suit plus d'URL fournie par l'API", () => {
  const composant = sansCommentaires(lire("../../components/sections/ProgrammesMerciStatus.tsx"));
  assert.ok(!/window\.location\.href = body/.test(composant), "plus de redirection vers une URL de la réponse");
  assert.ok(!/loginUrl/.test(composant), "loginUrl ne doit plus être lu");
  assert.ok(/DESTINATIONS_AUTORISEES/.test(composant), "une liste blanche de destinations doit filtrer redirectTo");
});

/* ═══════════════ H-2 — rate limit non contournable ═══════════════════════ */

await test("7. l'ancien limiteur mémoire à IP falsifiable a disparu", () => {
  let existe = true;
  try {
    readFileSync(join(RACINE, "lib/newsletter/rate-limit.ts"), "utf8");
  } catch {
    existe = false;
  }
  assert.equal(existe, false, "lib/newsletter/rate-limit.ts doit être supprimé, pas seulement contourné");
});

await test("8. aucune route ne réimplémente son extraction d'IP", () => {
  for (const chemin of TOUTES_LES_ROUTES) {
    const source = readFileSync(chemin, "utf8");
    const relatif = chemin.replace(`${RACINE}/`, "");
    assert.ok(
      !/getClientIp\b/.test(source),
      `${relatif} : getClientIp (X-Forwarded-For non filtré) ne doit plus être utilisé`,
    );
    // Lecture directe de l'en-tête client, hors du helper central.
    assert.ok(
      !/headers\.get\("x-forwarded-for"\)/i.test(source),
      `${relatif} : l'IP doit venir de getTrustedClientIp, jamais d'une lecture directe`,
    );
  }
});

await test("9. seul lib/security/rate-limit lit les en-têtes de proxy", () => {
  const centrale = lire("../../lib/security/rate-limit.ts");
  assert.ok(/x-vercel-forwarded-for/.test(centrale), "l'en-tête de confiance Vercel doit être privilégié");
  // `X-Forwarded-For` n'est accepté qu'en dehors de la production.
  const extrait = centrale.slice(centrale.indexOf("export function getTrustedClientIp"));
  const bloc = extrait.slice(0, extrait.indexOf("\n}"));
  const posGarde = bloc.indexOf("isProduction()");
  const posForwarded = bloc.indexOf('"x-forwarded-for"');
  assert.ok(posGarde >= 0 && posGarde < posForwarded, "X-Forwarded-For ne doit être lu que hors production");
});

await test("10. les quatre routes publiques utilisent le limiteur partagé", () => {
  for (const relatif of [
    "app/api/business-inquiry/route.ts",
    "app/api/free-assessment/route.ts",
    "app/api/newsletter/subscribe/route.ts",
    "app/api/newsletter/unsubscribe/route.ts",
  ]) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(source.includes("getTrustedClientIp"), `${relatif} : IP de confiance attendue`);
    assert.ok(source.includes("consumeRateLimit"), `${relatif} : compteur partagé attendu`);
    assert.ok(source.includes('from "@/lib/security/rules"'), `${relatif} : quota déclaré centralement attendu`);
  }
});

await test("11bis. toute route publique à effet externe est fail-closed", () => {
  const regles = lire("../../lib/security/rules.ts");
  // Arbitrage Jules du 27/07/2026 : une route qui envoie un email ou crée un
  // contact chez un tiers refuse plutôt que de s'ouvrir si le magasin
  // partagé manque en production.
  for (const nom of [
    "BUSINESS_INQUIRY_IP",
    "FREE_ASSESSMENT_IP",
    "NEWSLETTER_SUBSCRIBE_IP",
    "NEWSLETTER_UNSUBSCRIBE_IP",
    "CLAIM_PROGRAM_IP",
    "CLAIM_PROGRAM_EMAIL",
    "PASSWORD_RESET_IP",
    "PASSWORD_RESET_EMAIL",
    "PROGRAM_CHECKOUT_IP",
  ]) {
    const debut = regles.indexOf(`export const ${nom}`);
    assert.ok(debut >= 0, `règle ${nom} introuvable`);
    const bloc = regles.slice(debut, regles.indexOf("};", debut));
    assert.ok(/failClosed: true/.test(bloc), `${nom} doit être fail-closed : elle produit un effet externe`);
  }
});

await test("11ter. l'indisponibilité du magasin donne un 503 générique, jamais un 429", () => {
  const centrale = lire("../../lib/security/rate-limit.ts");
  const bloc = centrale.slice(centrale.indexOf("export function refusDeLimite"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(/backend === "unavailable"/.test(corps), "le cas magasin indisponible doit être distingué");
  assert.ok(/status: 503/.test(corps), "un magasin indisponible doit donner 503");
  assert.ok(/status: 429/.test(corps), "un quota dépassé doit rester 429");

  // Le message du 503 ne doit rien révéler de l'infrastructure.
  const message = centrale.match(/MESSAGE_INDISPONIBLE\s*=\s*\n?\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(message.length > 0, "message générique introuvable");
  for (const fuite of ["Upstash", "Redis", "quota", "limite", "token"]) {
    assert.ok(
      !message.toLowerCase().includes(fuite.toLowerCase()),
      `le message 503 expose un détail technique : « ${message} »`,
    );
  }

  // Aucune route ne doit reconstruire un 429 à la main.
  for (const chemin of TOUTES_LES_ROUTES) {
    const source = readFileSync(chemin, "utf8");
    assert.ok(
      !/status: 429/.test(source),
      `${chemin.replace(`${RACINE}/`, "")} : le refus doit passer par refusDeLimite`,
    );
  }
});

await test("11. le quota des formulaires publics n'a pas été assoupli", () => {
  const regles = lire("../../lib/security/rules.ts");
  for (const nom of ["BUSINESS_INQUIRY_IP", "FREE_ASSESSMENT_IP"]) {
    const bloc = regles.slice(regles.indexOf(`export const ${nom}`));
    const limite = Number(bloc.match(/limit:\s*(\d+)/)?.[1]);
    assert.equal(limite, 3, `${nom} : la limite historique de 3 par heure doit être conservée`);
  }
});

await test("12. la limitation reste distribuée en production", () => {
  const centrale = lire("../../lib/security/rate-limit.ts");
  assert.ok(/UPSTASH_REDIS_REST_URL/.test(centrale), "magasin Upstash attendu");
  assert.ok(/failClosed/.test(centrale), "comportement fail-closed attendu");
  // Aucune clé Upstash ne doit fuiter vers le navigateur.
  assert.ok(!/NEXT_PUBLIC_UPSTASH/.test(centrale), "aucune variable Upstash publique");
});

/* ═══════════════ H-3 — séparation admin / coach ═════════════════════════ */

const AUTHZ = lire("../../lib/api/authz.ts");

await test("13. le module d'autorisation expose les trois gardes attendues", () => {
  for (const garde of ["requireAdmin", "requireStaff", "requireStaffForStudent"]) {
    assert.ok(new RegExp(`export async function ${garde}`).test(AUTHZ), `${garde} manquante`);
  }
  // requireAdmin ne doit jamais accepter un coach.
  const bloc = AUTHZ.slice(AUTHZ.indexOf("export async function requireAdmin"));
  const corps = bloc.slice(0, bloc.indexOf("\n}"));
  assert.ok(/!ctx\.estAdmin/.test(corps), "requireAdmin doit refuser tout non-administrateur");
  assert.ok(!/coach/.test(corps), "requireAdmin ne doit mentionner aucun coach");
});

await test("14. le contrôle d'affectation ne dépend pas de la RLS", () => {
  const bloc = AUTHZ.slice(AUTHZ.indexOf("export async function requireStaffForStudent"));
  const corps = bloc.slice(0, bloc.indexOf("\n}\n"));
  assert.ok(/createSupabaseAdminClient/.test(corps), "le verdict doit être rendu hors RLS, de façon déterministe");
  assert.ok(/coach_id !== ficheCoach\.id/.test(corps), "l'affectation élève → coach doit être comparée");
  assert.ok(/if \(ctx\.estAdmin\) return ctx;/.test(corps), "l'administrateur passe sans condition");
  // Un coach sans fiche ne doit pas retomber sur un coach « par défaut ».
  assert.ok(/if \(!ficheCoach\) return refus/.test(corps), "un coach sans fiche doit être refusé");
});

/** Routes globales ou destructives : administrateur uniquement. */
const ROUTES_ADMIN_SEUL = [
  "app/api/admin/coaches/route.ts",
  "app/api/admin/coaches/[coachId]/route.ts",
  "app/api/admin/billing/payments/[id]/route.ts",
  "app/api/admin/billing/subscriptions/[id]/route.ts",
  "app/api/admin/newsletter/resync/route.ts",
  "app/api/admin/subscription-templates/route.ts",
  "app/api/admin/students/[studentId]/route.ts",
];

await test("15. gestion des coachs, facturation et suppressions : admin uniquement", () => {
  for (const relatif of ROUTES_ADMIN_SEUL) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(source.includes("requireAdmin()"), `${relatif} : requireAdmin attendu`);
    assert.ok(
      !/role !== "admin" && role !== "coach"/.test(source),
      `${relatif} : l'ancien contrôle admin||coach subsiste`,
    );
  }
});

await test("16. un coach ne peut ni supprimer ni créer un coach", () => {
  for (const relatif of ["app/api/admin/coaches/route.ts", "app/api/admin/coaches/[coachId]/route.ts"]) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(source.includes("requireAdmin()"), `${relatif} : réservé à l'administrateur`);
  }
  // Le garde-fou « cible administrateur » existe et échoue côté fermé.
  assert.ok(/export async function cibleEstAdministrateur/.test(AUTHZ), "helper de protection des admins attendu");
  const bloc = AUTHZ.slice(AUTHZ.indexOf("export async function cibleEstAdministrateur"));
  assert.ok(/return true; \/\/ fail-closed/.test(bloc), "sans certitude, la cible est réputée administrateur");
});

await test("17. un coach ne touche pas aux données de facturation globales", () => {
  for (const relatif of [
    "app/api/admin/billing/payments/[id]/route.ts",
    "app/api/admin/billing/subscriptions/[id]/route.ts",
  ]) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(source.includes("requireAdmin()"), `${relatif} : facturation réservée à l'administrateur`);
  }
});

await test("18. le catalogue d'abonnements : lecture staff, écriture admin", () => {
  const source = lire("../../app/api/admin/subscription-templates/[id]/route.ts");
  // PATCH et DELETE passent par requireAdmin, GET par le helper staff.
  const patch = source.slice(source.indexOf("export async function PATCH"), source.indexOf("export async function GET"));
  assert.ok(patch.includes("requireAdmin()"), "PATCH doit être réservé à l'administrateur");
  const del = source.slice(source.indexOf("export async function DELETE"));
  assert.ok(del.includes("requireAdmin()"), "DELETE doit être réservé à l'administrateur");
  const get = source.slice(source.indexOf("export async function GET"), source.indexOf("export async function DELETE"));
  assert.ok(get.includes("sessionStaff()"), "GET reste ouvert au staff (lecture non destructive)");
  // Le helper local délègue la décision, il ne la réimplémente pas.
  assert.ok(/const acces = await requireStaff\(\);/.test(source), "sessionStaff doit déléguer à lib/api/authz");
});

await test("19. toute action visant un élève désigné vérifie l'affectation", () => {
  for (const relatif of [
    "app/api/email/welcome/route.ts",
    "app/api/email/content-assigned/route.ts",
    "app/api/email/subscription-assigned/route.ts",
    "app/api/email/appointment-notification/route.ts",
    "app/api/stripe/create-checkout-session/route.ts",
    "app/api/stripe/create-customer-portal-session/route.ts",
  ]) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(
      source.includes("requireStaffForStudent("),
      `${relatif} : un coach pourrait agir sur un élève qui ne lui est pas affecté`,
    );
  }
});

await test("20. l'élève garde l'accès à sa propre fiche, et à elle seule", () => {
  for (const relatif of [
    "app/api/email/welcome/route.ts",
    "app/api/stripe/create-checkout-session/route.ts",
    "app/api/stripe/create-customer-portal-session/route.ts",
  ]) {
    const source = readFileSync(join(RACINE, relatif), "utf8");
    assert.ok(/role === "student"/.test(source), `${relatif} : le chemin élève doit subsister`);
    assert.ok(
      /ownStudentId !== studentId/.test(source),
      `${relatif} : l'élève ne doit agir que sur sa propre fiche`,
    );
  }
});

await test("21. la création d'élève rattache au coach demandeur, sans champ de coach exposé", () => {
  const schema = lire("../../lib/api/schemas/students.ts");
  const bloc = schema.slice(schema.indexOf("createStudentBodySchema"), schema.indexOf(".strict()"));
  assert.ok(!/coachId|coach_id/.test(bloc), "aucun champ de coach ne doit être accepté du client");
  const provisioning = lire("../../lib/supabase/coach-student-provisioning.ts");
  assert.ok(/resolveCoachId\(supabase, input\.requestingUserId\)/.test(provisioning), "rattachement au demandeur attendu");
});

await test("22. aucune route admin ne conserve le motif admin||coach sans contrôle", () => {
  for (const chemin of TOUTES_LES_ROUTES.filter((c) => c.includes("/api/admin/"))) {
    const source = readFileSync(chemin, "utf8");
    const relatif = chemin.replace(`${RACINE}/`, "");
    if (/role !== "admin" && role !== "coach"/.test(source)) {
      assert.ok(
        source.includes("requireStaffForStudent("),
        `${relatif} : motif admin||coach conservé sans contrôle d'affectation`,
      );
    }
  }
});

await test("23. les refus n'exposent pas la raison du refus", () => {
  // Un coach et un élève doivent recevoir le même message : la réponse ne
  // doit pas confirmer qu'il « manque juste un rôle ».
  const messages = [...AUTHZ.matchAll(/refus\("([^"]+)",\s*(\d+)\)/g)].map((m) => ({ message: m[1], code: m[2] }));
  const refus403 = messages.filter((m) => m.code === "403").map((m) => m.message);
  assert.ok(refus403.length > 0, "aucun refus 403 trouvé");
  assert.equal(new Set(refus403).size, 1, `tous les 403 doivent partager le même message : ${refus403.join(" / ")}`);
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

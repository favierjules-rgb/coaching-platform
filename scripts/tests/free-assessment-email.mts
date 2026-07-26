/**
 * Harnais — logique serveur des demandes « Mon bilan offert » (chantier
 * feat/free-assessment-form, juillet 2026) : validation, progression,
 * anti-spam, contenu et échappement de l'email, route HTTP de bout en bout.
 *
 * AUCUN email réel n'est envoyé : le transport est injecté (double) et le
 * destinataire passé explicitement. Pour les tests de la route, qui utilise
 * le vrai transport, `globalThis.fetch` est intercepté — toute requête vers
 * un autre hôte que api.resend.com fait échouer le test.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/free-assessment-email.mts
 * (la condition est requise par `server-only`, importé par la couche email.)
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildFreeAssessmentLines,
  buildFreeAssessmentSubject,
  sendFreeAssessmentEmail,
} from "../../lib/free-assessment/email";
import {
  GOAL_OPTIONS,
  MAX_LENGTHS,
  MIN_FRUSTRATION_LENGTH,
  QUESTION_COUNT,
  QUESTION_FIELDS,
  allQuestionsComplete,
  countPhoneDigits,
  firstIncompleteQuestion,
  freeAssessmentSchema,
  looksAutomated,
} from "../../lib/free-assessment/schema";
import { getPublicAppUrl } from "../../lib/email/templates/base";
import { checkRateLimit } from "../../lib/newsletter/rate-limit";
import type { EmailTransport, RawEmailInput } from "../../lib/email/send-raw-email";

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

const FRUSTRATION =
  "Je n'arrive pas à tenir dans la durée : je reprends deux semaines puis j'abandonne.";

function validAssessment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lastName: "Martin",
    firstName: "Camille",
    phone: "06 12 34 56 78",
    email: "camille.martin@exemple.fr",
    goal: "remise-en-forme",
    otherGoal: "",
    frustration: FRUSTRATION,
    privacyAccepted: true,
    website: "",
    ...overrides,
  };
}

/** Transport factice : capture les envois, n'appelle jamais Resend. */
function captureTransport() {
  const sent: RawEmailInput[] = [];
  const transport: EmailTransport = async (input) => {
    sent.push(input);
    return { status: "sent" };
  };
  return { sent, transport };
}

/* ─── 1-8. Validation des six questions ─── */

await test("1. nom obligatoire, longueur et caractères contrôlés", () => {
  for (const invalide of ["", "  ", "A"]) {
    const result = freeAssessmentSchema.safeParse(validAssessment({ lastName: invalide }));
    assert.equal(result.success, false, `« ${invalide} » doit être refusé`);
    assert.ok(result.error?.issues.some((i) => i.path[0] === "lastName"));
  }
  assert.equal(
    freeAssessmentSchema.safeParse(validAssessment({ lastName: "x".repeat(MAX_LENGTHS.lastName + 1) })).success,
    false,
    "nom trop long refusé",
  );
  assert.equal(
    freeAssessmentSchema.safeParse(validAssessment({ lastName: "<script>alert(1)</script>" })).success,
    false,
    "caractères inattendus refusés",
  );
  // Noms légitimes acceptés (accents, apostrophes, traits d'union).
  for (const valide of ["Dupont", "O'Connor", "Étienne-Blanc", "Müller", "N’Diaye"]) {
    assert.equal(
      freeAssessmentSchema.safeParse(validAssessment({ lastName: valide })).success,
      true,
      `« ${valide} » doit être accepté`,
    );
  }
  // Espaces superflus nettoyés.
  assert.equal(freeAssessmentSchema.parse(validAssessment({ lastName: "  Martin  " })).lastName, "Martin");
});

await test("2. prénom obligatoire", () => {
  for (const invalide of ["", " ", "C"]) {
    const result = freeAssessmentSchema.safeParse(validAssessment({ firstName: invalide }));
    assert.equal(result.success, false, `« ${invalide} » doit être refusé`);
    assert.ok(result.error?.issues.some((i) => i.path[0] === "firstName"));
  }
  assert.equal(freeAssessmentSchema.safeParse(validAssessment({ firstName: "Camille" })).success, true);
});

await test("3. téléphone : formats français et internationaux acceptés, saisies invalides refusées", () => {
  const valides = [
    "0612345678",
    "06 12 34 56 78",
    "06.12.34.56.78",
    "06-12-34-56-78",
    "+33 6 12 34 56 78",
    "+33 (0)6 12 34 56 78",
    "+1 415 555 0132",
    "+49 30 123456",
  ];
  for (const numero of valides) {
    assert.equal(
      freeAssessmentSchema.safeParse(validAssessment({ phone: numero })).success,
      true,
      `« ${numero} » doit être accepté`,
    );
  }

  const invalides = ["", "06 12", "123", "abcdefghij", "06 12 34 56 78 90 12 34", "06/12/34"];
  for (const numero of invalides) {
    const result = freeAssessmentSchema.safeParse(validAssessment({ phone: numero }));
    assert.equal(result.success, false, `« ${numero} » doit être refusé`);
    assert.ok(result.error?.issues.some((i) => i.path[0] === "phone"));
  }

  // Nettoyage : espaces multiples réduits, séparateurs conservés.
  assert.equal(freeAssessmentSchema.parse(validAssessment({ phone: "  06   12 34 56 78 " })).phone, "06 12 34 56 78");
  // 33 + 0 + 6 + les huit chiffres restants.
  assert.equal(countPhoneDigits("+33 (0)6 12 34 56 78"), 12);
});

await test("4. email : validation stricte, minuscules et espaces nettoyés", () => {
  for (const invalide of ["", "pas-un-email", "a@b", "@exemple.fr", "camille@"]) {
    const result = freeAssessmentSchema.safeParse(validAssessment({ email: invalide }));
    assert.equal(result.success, false, `« ${invalide} » doit être refusé`);
  }
  const parsed = freeAssessmentSchema.parse(validAssessment({ email: "  Camille.MARTIN@Exemple.FR  " }));
  assert.equal(parsed.email, "camille.martin@exemple.fr", "email normalisé en minuscules, sans espaces");
});

await test("5. objectif obligatoire, valeur inconnue refusée", () => {
  assert.equal(freeAssessmentSchema.safeParse(validAssessment({ goal: "" })).success, false);
  assert.equal(freeAssessmentSchema.safeParse(validAssessment({ goal: "objectif-inconnu" })).success, false);
  for (const option of GOAL_OPTIONS) {
    const extra = option.value === "autre" ? { otherGoal: "Préparer un trail" } : {};
    assert.equal(
      freeAssessmentSchema.safeParse(validAssessment({ goal: option.value, ...extra })).success,
      true,
      `« ${option.label} » doit être accepté`,
    );
  }
  assert.equal(GOAL_OPTIONS.length, 7, "sept objectifs proposés");
});

await test("6. « Autre » exige une précision", () => {
  const sansPrecision = freeAssessmentSchema.safeParse(validAssessment({ goal: "autre", otherGoal: "" }));
  assert.equal(sansPrecision.success, false);
  assert.ok(sansPrecision.error?.issues.some((i) => i.path[0] === "otherGoal"));
  assert.equal(
    freeAssessmentSchema.safeParse(validAssessment({ goal: "autre", otherGoal: "Préparer un trail" })).success,
    true,
  );
});

await test("7. frustration obligatoire, minimum utile et limite de caractères", () => {
  assert.equal(freeAssessmentSchema.safeParse(validAssessment({ frustration: "" })).success, false);
  assert.equal(
    freeAssessmentSchema.safeParse(validAssessment({ frustration: "x".repeat(MIN_FRUSTRATION_LENGTH - 1) })).success,
    false,
    "réponse trop courte refusée",
  );
  assert.equal(
    freeAssessmentSchema.safeParse(validAssessment({ frustration: "x".repeat(MIN_FRUSTRATION_LENGTH) })).success,
    true,
  );

  const tropLong = freeAssessmentSchema.safeParse(
    validAssessment({ frustration: "x".repeat(MAX_LENGTHS.frustration + 1) }),
  );
  assert.equal(tropLong.success, false, "réponse trop longue refusée");
  const issue = tropLong.error?.issues.find((i) => i.path[0] === "frustration");
  assert.ok(
    /^Ce champ est limité à .+ caractères\.$/.test(issue?.message ?? ""),
    `message non francisé : « ${issue?.message} »`,
  );
  assert.equal(MAX_LENGTHS.frustration, 1500, "limite de 1 500 caractères");
});

await test("8. consentement obligatoire, clés inconnues refusées", () => {
  const sansConsentement = freeAssessmentSchema.safeParse({ ...validAssessment(), privacyAccepted: false });
  assert.equal(sansConsentement.success, false);
  assert.ok(sansConsentement.error?.issues.some((i) => i.path[0] === "privacyAccepted"));

  assert.equal(
    freeAssessmentSchema.safeParse({ ...validAssessment(), champInconnu: "x" }).success,
    false,
    "clé superflue refusée (.strict)",
  );
});

/* ─── 9. Progression ─── */

await test("9. progression : chaque question se débloque une fois la précédente remplie", () => {
  const vide = {
    lastName: "",
    firstName: "",
    phone: "",
    email: "",
    goal: "",
    otherGoal: "",
    frustration: "",
    privacyAccepted: false,
    website: "",
  };
  assert.equal(firstIncompleteQuestion(vide), 1, "formulaire vierge : question 1");

  const etapes: [Record<string, unknown>, number, string][] = [
    [{ lastName: "Martin" }, 2, "nom renseigné ⇒ question 2"],
    [{ firstName: "Camille" }, 3, "prénom renseigné ⇒ question 3"],
    [{ phone: "06 12 34 56 78" }, 4, "téléphone valide ⇒ question 4"],
    [{ email: "camille@exemple.fr" }, 5, "email valide ⇒ question 5"],
    [{ goal: "remise-en-forme" }, 6, "objectif choisi ⇒ question 6"],
    [{ frustration: FRUSTRATION }, 7, "frustration renseignée ⇒ parcours terminé"],
  ];
  let etat: Record<string, unknown> = { ...vide };
  for (const [ajout, attendu, description] of etapes) {
    etat = { ...etat, ...ajout };
    assert.equal(firstIncompleteQuestion(etat), attendu, description);
  }

  // Une saisie invalide ne débloque pas la suite.
  assert.equal(
    firstIncompleteQuestion({ ...vide, lastName: "Martin", firstName: "Camille", phone: "06 12" }),
    3,
    "téléphone incomplet : on reste à la question 3",
  );
  assert.equal(
    firstIncompleteQuestion({ ...vide, lastName: "Martin", firstName: "Camille", phone: "0612345678", email: "pas-un-email" }),
    4,
    "email invalide : on reste à la question 4",
  );

  // « Autre » sans précision retient la question 5, même si le consentement
  // n'est pas encore coché (piège du superRefine).
  const autreSansPrecision = { ...etat, goal: "autre", otherGoal: "", privacyAccepted: false };
  assert.equal(firstIncompleteQuestion(autreSansPrecision), 5, "« Autre » sans précision ⇒ question 5");
  assert.equal(firstIncompleteQuestion({ ...autreSansPrecision, otherGoal: "Trail" }), 7, "précision fournie ⇒ terminé");

  // Le consentement n'appartient à aucune question : il ne retient pas le parcours.
  assert.equal(allQuestionsComplete({ ...etat, privacyAccepted: false }), true);

  // Chaque champ appartient à une question et une seule.
  const tousLesChamps = QUESTION_FIELDS.flat();
  assert.equal(new Set(tousLesChamps).size, tousLesChamps.length, "aucun champ rattaché à deux questions");
  assert.equal(QUESTION_COUNT, 6, "six questions");
});

/* ─── 10-12. Anti-spam ─── */

await test("10. honeypot rempli ⇒ soumission considérée comme automatisée", () => {
  assert.equal(looksAutomated({ website: "http://spam.test" }), true);
  assert.equal(looksAutomated({ website: "" }), false);
  assert.equal(looksAutomated({}), false);
  // Le schéma accepte le champ : c'est la route qui décide (réponse neutre).
  assert.equal(freeAssessmentSchema.safeParse(validAssessment({ website: "http://spam.test" })).success, true);
});

await test("11. limitation de fréquence : 3 demandes par fenêtre, la 4e est refusée", () => {
  const cle = `test_free_assessment_${Date.now()}`;
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(checkRateLimit(cle, 3, 60_000).allowed, true, `demande ${i} autorisée`);
  }
  const quatrieme = checkRateLimit(cle, 3, 60_000);
  assert.equal(quatrieme.allowed, false, "4e demande refusée");
  assert.ok(quatrieme.retryAfterMs > 0, "délai d'attente communiqué");
});

await test("12. double soumission : deux envois rapprochés, un seul passe", () => {
  const cle = `test_free_burst_${Date.now()}`;
  assert.equal(checkRateLimit(cle, 1, 20_000).allowed, true);
  assert.equal(checkRateLimit(cle, 1, 20_000).allowed, false, "second envoi immédiat bloqué");
});

/* ─── 13-16. Contenu de l'email ─── */

await test("13. l'email contient toutes les informations de la demande", async () => {
  const { sent, transport } = captureTransport();
  const result = await sendFreeAssessmentEmail(
    freeAssessmentSchema.parse(validAssessment()),
    { transport, recipient: "coach@exemple.test", now: new Date("2026-07-26T17:30:00Z") },
  );
  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1, "un seul email");
  const email = sent[0];

  for (const attendu of [
    "26 juillet 2026",
    "Martin",
    "Camille",
    "06 12 34 56 78",
    "camille.martin@exemple.fr",
    "Me remettre en forme",
    FRUSTRATION,
    "Accepté",
  ]) {
    assert.ok(email.text.includes(attendu), `texte : « ${attendu} » manquant`);
    assert.ok(
      email.html.includes(attendu) || email.html.includes(attendu.replace(/'/g, "&#39;")),
      `html : « ${attendu} » manquant`,
    );
  }

  // « Autre » : la précision remplace le libellé générique.
  const { sent: sentAutre, transport: transportAutre } = captureTransport();
  await sendFreeAssessmentEmail(
    freeAssessmentSchema.parse(validAssessment({ goal: "autre", otherGoal: "Préparer un trail" })),
    { transport: transportAutre, recipient: "coach@exemple.test" },
  );
  assert.ok(sentAutre[0].text.includes("Autre : Préparer un trail"), "précision de l'objectif reportée");
});

await test("13bis. les huit lignes du récapitulatif, dans l'ordre des questions", () => {
  const lines = buildFreeAssessmentLines(
    freeAssessmentSchema.parse(validAssessment()),
    new Date("2026-07-26T17:30:00Z"),
  );
  assert.deepEqual(
    lines.map((l) => l.label),
    ["Reçue le", "Nom", "Prénom", "Téléphone", "Email", "Objectif principal", "Plus grande frustration", "Consentement"],
  );
  assert.ok(lines.every((l) => l.value.trim().length > 0), "aucune ligne vide");
  // Horodatage lisible, fuseau métier du projet.
  assert.match(lines[0].value, /dimanche 26 juillet 2026 à 19:30/);
});

await test("14. sujet et Reply-To corrects", async () => {
  const input = freeAssessmentSchema.parse(validAssessment());
  assert.equal(
    buildFreeAssessmentSubject(input),
    "[Nouveau bilan offert] Camille Martin — Me remettre en forme",
  );

  const { sent, transport } = captureTransport();
  await sendFreeAssessmentEmail(input, { transport, recipient: "coach@exemple.test" });
  assert.equal(sent[0].to, "coach@exemple.test", "destinataire = variable serveur");
  assert.equal(sent[0].replyTo, "camille.martin@exemple.fr", "Reply-To = email du prospect");
  assert.match(sent[0].subject, /^\[Nouveau bilan offert\] /);
});

await test("15. les données du prospect sont échappées dans le HTML", async () => {
  const { sent, transport } = captureTransport();
  await sendFreeAssessmentEmail(
    freeAssessmentSchema.parse(
      validAssessment({
        frustration: "<script>alert('xss')</script> J'ai essayé plein de régimes & rien ne tient.",
        otherGoal: "",
      }),
    ),
    { transport, recipient: "coach@exemple.test" },
  );
  const html = sent[0].html;
  assert.ok(!html.includes("<script>"), "balise script non échappée");
  assert.ok(html.includes("&lt;script&gt;"), "balise script échappée");
  assert.ok(html.includes("&amp;"), "esperluette échappée");
  assert.ok(html.includes("&#39;"), "apostrophe échappée");
});

await test("16. pied de page propre au bilan offert, sans mention de compte ni adresse locale", async () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  try {
    for (const valeur of ["http://localhost:3000", "http://127.0.0.1:3000", "", "pas-une-url"]) {
      process.env.NEXT_PUBLIC_APP_URL = valeur;
      assert.equal(getPublicAppUrl(), null, `« ${valeur} » ne doit pas être affichée`);

      const { sent, transport } = captureTransport();
      await sendFreeAssessmentEmail(freeAssessmentSchema.parse(validAssessment()), {
        transport,
        recipient: "coach@exemple.test",
      });
      for (const contenu of [sent[0].html, sent[0].text]) {
        assert.ok(
          contenu.includes("Cette demande a été envoyée depuis le formulaire « Mon bilan offert » de SETH Coaching."),
          "mention spécifique absente",
        );
        assert.ok(!/action sur ton compte/i.test(contenu), "formulation liée au compte présente");
        assert.ok(!/email transactionnel/i.test(contenu), "mention « email transactionnel » présente");
        assert.ok(!/localhost/i.test(contenu), `« localhost » présent avec ${valeur}`);
        assert.ok(!/127\.0\.0\.1/.test(contenu), `« 127.0.0.1 » présent avec ${valeur}`);
      }
    }

    // URL publique : le lien est affiché.
    process.env.NEXT_PUBLIC_APP_URL = "https://sethcoaching.fr";
    const { sent, transport } = captureTransport();
    await sendFreeAssessmentEmail(freeAssessmentSchema.parse(validAssessment()), {
      transport,
      recipient: "coach@exemple.test",
    });
    assert.ok(sent[0].html.includes('href="https://sethcoaching.fr"'), "lien public affiché");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  }
});

await test("17. destinataire non configuré : « skipped », aucun envoi", async () => {
  const { sent, transport } = captureTransport();
  const result = await sendFreeAssessmentEmail(freeAssessmentSchema.parse(validAssessment()), {
    transport,
    recipient: null,
  });
  assert.equal(result.status, "skipped");
  assert.equal(sent.length, 0, "aucun email tenté sans destinataire");
});

await test("18. échec d'envoi : statut « failed », détail technique non destiné au prospect", async () => {
  const transport: EmailTransport = async () => ({ status: "failed", error: "Resend: domain not verified" });
  const result = await sendFreeAssessmentEmail(freeAssessmentSchema.parse(validAssessment()), {
    transport,
    recipient: "coach@exemple.test",
  });
  assert.equal(result.status, "failed");
  const routeSource = readFileSync(new URL("../../app/api/free-assessment/route.ts", import.meta.url), "utf8");
  assert.ok(routeSource.includes("const ERROR_MESSAGE"), "message générique défini");
  assert.ok(!/error:\s*result\.error/.test(routeSource), "le détail technique n'est jamais renvoyé au client");
  assert.ok(
    routeSource.includes("Une erreur est survenue pendant l'envoi. Réessaie dans quelques instants."),
    "message d'erreur exact attendu",
  );
});

await test("19. aucun email réel ne peut partir depuis les tests", () => {
  assert.equal(process.env.EMAILS_ENABLED, "false", "coupe-circuit global posé");
  const emailSource = readFileSync(new URL("../../lib/free-assessment/email.ts", import.meta.url), "utf8");
  assert.ok(emailSource.includes("options.transport ?? resendTransport"), "transport injectable");
  assert.ok(emailSource.includes("FREE_ASSESSMENT_RECIPIENT_EMAIL"), "destinataire lu depuis l'environnement");
  assert.ok(!emailSource.includes("@gmail.com"), "aucune adresse en dur");
  assert.ok(emailSource.startsWith('import "server-only"'), "module strictement serveur");

  const formSource = readFileSync(
    new URL("../../components/sections/FreeAssessmentForm.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!formSource.includes("RESEND"), "le composant client ne référence aucune clé");
  assert.ok(!formSource.includes("FREE_ASSESSMENT_RECIPIENT_EMAIL"), "le composant client ignore le destinataire");
  assert.ok(!formSource.includes("@gmail.com"), "aucune adresse en dur dans le composant");
  assert.ok(formSource.includes('fetch("/api/free-assessment"'), "l'envoi passe par la route serveur");
});

/* ─── 20-23. Route HTTP de bout en bout ─── */

/**
 * La route appelle `sendFreeAssessmentEmail` SANS transport injecté : elle
 * passe donc par `resendTransport`, puis par le SDK Resend, qui émet une
 * requête HTTP. On simule le fournisseur en interceptant `globalThis.fetch` :
 * la chaîne complète est exercée et AUCUNE requête ne peut sortir.
 */
const requetesSortantes: { url: string; corps: unknown }[] = [];
const fetchReel = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  assert.ok(
    url.startsWith("https://api.resend.com/"),
    `requête sortante inattendue vers ${url} — aucun appel réseau ne doit quitter le harnais`,
  );
  let corps: unknown = null;
  try {
    corps = JSON.parse(String(init?.body ?? "null"));
  } catch {
    corps = String(init?.body ?? "");
  }
  requetesSortantes.push({ url, corps });
  return new Response(JSON.stringify({ id: "email_simule_0001" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

process.env.EMAILS_ENABLED = "true";
process.env.RESEND_API_KEY = "re_cle_factice_de_test";
process.env.RESEND_FROM_EMAIL = "Coaching <contact@exemple.test>";
process.env.FREE_ASSESSMENT_RECIPIENT_EMAIL = "destinataire@exemple.test";

const { POST } = await import("../../app/api/free-assessment/route");

function requeteHttp(corps: unknown, ip: string): Request {
  return new Request("http://localhost/api/free-assessment", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(corps),
  });
}

await test("20. route : demande valide ⇒ 200 et UN email composé (fournisseur simulé)", async () => {
  requetesSortantes.length = 0;
  const response = await POST(requeteHttp(validAssessment(), "198.51.100.11"));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { message?: string };
  assert.equal(
    payload.message,
    "Ta demande a bien été envoyée. Je te recontacte personnellement pour échanger sur ton objectif.",
  );

  assert.equal(requetesSortantes.length, 1, "exactement un envoi");
  const envoi = requetesSortantes[0].corps as {
    to: string | string[];
    reply_to?: string | string[];
    subject: string;
    text: string;
  };
  assert.deepEqual([envoi.to].flat(), ["destinataire@exemple.test"], "destinataire = variable serveur");
  assert.deepEqual([envoi.reply_to].flat(), ["camille.martin@exemple.fr"], "Reply-To = email du prospect");
  assert.match(envoi.subject, /^\[Nouveau bilan offert\] Camille Martin — /);
  for (const attendu of ["Martin", "Camille", "06 12 34 56 78", FRUSTRATION]) {
    assert.ok(envoi.text.includes(attendu), `« ${attendu} » absent du corps`);
  }
});

await test("21. route : demande invalide ⇒ refus AVANT tout envoi", async () => {
  requetesSortantes.length = 0;
  const response = await POST(requeteHttp({ ...validAssessment(), email: "pas-un-email" }, "198.51.100.12"));
  assert.ok(response.status >= 400, "statut d'erreur attendu");
  assert.equal(requetesSortantes.length, 0, "aucun email pour une demande invalide");
});

await test("22. route : honeypot rempli ⇒ 200 neutre, AUCUN email", async () => {
  requetesSortantes.length = 0;
  const response = await POST(requeteHttp({ ...validAssessment(), website: "http://spam.test" }, "198.51.100.13"));
  assert.equal(response.status, 200, "réponse indiscernable d'un succès, pour ne rien apprendre au robot");
  assert.equal(requetesSortantes.length, 0, "aucun email pour une soumission automatisée");
});

await test("23. route : double soumission et limite de fréquence", async () => {
  requetesSortantes.length = 0;
  const premiere = await POST(requeteHttp(validAssessment(), "198.51.100.14"));
  const seconde = await POST(requeteHttp(validAssessment(), "198.51.100.14"));
  assert.equal(premiere.status, 200);
  assert.equal(seconde.status, 200, "celui qui double-clique voit un succès");
  assert.equal(requetesSortantes.length, 1, "un seul email malgré deux requêtes");

  await POST(requeteHttp(validAssessment(), "198.51.100.14"));
  const quatrieme = await POST(requeteHttp(validAssessment(), "198.51.100.14"));
  assert.equal(quatrieme.status, 429, "limite de fréquence appliquée");
  assert.equal(requetesSortantes.length, 1, "aucun envoi supplémentaire");
});

await test("24. route : corps surdimensionné refusé avant lecture", async () => {
  requetesSortantes.length = 0;
  const enorme = JSON.stringify(validAssessment({ frustration: "x".repeat(20_000) }));
  // `content-length` explicite : c'est l'en-tête que lit la garde de taille,
  // et `new Request` ne le pose pas de lui-même sur un corps en mémoire.
  const response = await POST(
    new Request("http://localhost/api/free-assessment", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(enorme)),
        "x-forwarded-for": "198.51.100.15",
      },
      body: enorme,
    }),
  );
  assert.equal(response.status, 413, "corps trop volumineux refusé avant parsing");
  assert.equal(requetesSortantes.length, 0, "aucun envoi");

  // Sans en-tête de taille, la validation Zod prend le relais : refusé aussi.
  const sansEntete = await POST(
    requeteHttp(validAssessment({ frustration: "x".repeat(20_000) }), "198.51.100.16"),
  );
  assert.ok(sansEntete.status >= 400, "refusé par la validation à défaut de l'en-tête");
  assert.equal(requetesSortantes.length, 0, "toujours aucun envoi");
});

globalThis.fetch = fetchReel;

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

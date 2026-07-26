/**
 * Harnais — logique serveur des demandes « Services aux entreprises »
 * (chantier feat/business-services-contact, juillet 2026) : validation,
 * anti-spam, contenu et échappement de l'email.
 *
 * AUCUN email réel n'est envoyé : le transport est injecté (double) et le
 * destinataire passé explicitement — ni `RESEND_API_KEY` ni
 * `B2B_CONTACT_RECIPIENT_EMAIL` ne sont lus. `EMAILS_ENABLED=false` est posé
 * en plus par sécurité.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/business-inquiry-email.mts
 * (la condition est requise par `server-only`, importé par la couche email.)
 */
process.env.TZ = "Europe/Paris";
process.env.EMAILS_ENABLED = "false";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildBusinessInquiryLines,
  buildBusinessInquirySubject,
  sendBusinessInquiryEmail,
} from "../../lib/business-inquiry/email";
import { getPublicAppUrl } from "../../lib/email/templates/base";
import {
  allQuestionsComplete,
  businessInquirySchema,
  firstIncompleteQuestion,
  looksAutomated,
  FORMAT_OPTIONS,
  MAX_LENGTHS,
  QUESTION_COUNT,
  QUESTION_FIELDS,
  type BusinessInquiryInput,
} from "../../lib/business-inquiry/schema";
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

function validInquiry(overrides: Partial<BusinessInquiryInput> = {}): Record<string, unknown> {
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

await test("4. champs obligatoires : entreprise, contact, fonction", () => {
  for (const champ of ["companyName", "contactName", "contactRole"]) {
    const result = businessInquirySchema.safeParse(validInquiry({ [champ]: "  " } as never));
    assert.equal(result.success, false, `${champ} vide doit être refusé`);
    assert.ok(result.error?.issues.some((i) => i.path[0] === champ));
  }
});

await test("5. email invalide refusé, email valide accepté", () => {
  for (const email of ["pas-un-email", "a@b", "@acme.test", ""]) {
    assert.equal(businessInquirySchema.safeParse(validInquiry({ email })).success, false, `« ${email} » doit être refusé`);
  }
  assert.equal(businessInquirySchema.safeParse(validInquiry({ email: "camille.martin@acme.test" })).success, true);
});

await test("6. effectif manquant ou inconnu refusé", () => {
  assert.equal(businessInquirySchema.safeParse(validInquiry({ headcount: "" })).success, false);
  assert.equal(businessInquirySchema.safeParse(validInquiry({ headcount: "12345" })).success, false);
});

await test("7. aucun besoin sélectionné refusé ; « autre » exige une précision", () => {
  assert.equal(businessInquirySchema.safeParse(validInquiry({ needs: [] })).success, false);

  const sansPrecision = businessInquirySchema.safeParse(validInquiry({ needs: ["autre"], otherNeed: "" }));
  assert.equal(sansPrecision.success, false, "« autre » sans précision doit être refusé");
  assert.ok(sansPrecision.error?.issues.some((i) => i.path[0] === "otherNeed"));

  assert.equal(businessInquirySchema.safeParse(validInquiry({ needs: ["autre"], otherNeed: "Séminaire" })).success, true);
});

await test("8. ville requise sur site et en hybride, facultative à distance", () => {
  for (const format of ["sur-site", "hybride"]) {
    const result = businessInquirySchema.safeParse(validInquiry({ format, city: "" }));
    assert.equal(result.success, false, `ville requise pour « ${format} »`);
    assert.ok(result.error?.issues.some((i) => i.path[0] === "city"));
  }
  assert.equal(businessInquirySchema.safeParse(validInquiry({ format: "a-distance", city: "" })).success, true);
});

await test("9. consentement absent refusé", () => {
  const result = businessInquirySchema.safeParse({ ...validInquiry(), privacyAccepted: false });
  assert.equal(result.success, false);
  assert.ok(result.error?.issues.some((i) => i.path[0] === "privacyAccepted"));
});

await test("9bis. espaces superflus supprimés, longueurs maximales appliquées, clés inconnues refusées", () => {
  const parsed = businessInquirySchema.parse(validInquiry({ companyName: "  Acme  ", city: "  Lyon " }));
  assert.equal(parsed.companyName, "Acme");
  assert.equal(parsed.city, "Lyon");

  assert.equal(
    businessInquirySchema.safeParse(validInquiry({ projectDetails: "x".repeat(MAX_LENGTHS.projectDetails + 1) })).success,
    false,
    "description trop longue refusée",
  );
  assert.equal(
    businessInquirySchema.safeParse({ ...validInquiry(), champInconnu: "x" }).success,
    false,
    "clé superflue refusée (.strict)",
  );
});

await test("9ter. les messages de dépassement de longueur sont en français", () => {
  // Régression observée en validation live : Zod renvoyait son texte anglais
  // par défaut (« Too big: expected string to have <=2000 characters »), qui
  // s'affichait tel quel sous le champ.
  for (const [champ, max] of [
    ["projectDetails", MAX_LENGTHS.projectDetails],
    ["companyName", MAX_LENGTHS.companyName],
    ["contactName", MAX_LENGTHS.contactName],
    ["contactRole", MAX_LENGTHS.contactRole],
    ["city", MAX_LENGTHS.city],
    ["otherNeed", MAX_LENGTHS.otherNeed],
  ] as const) {
    const result = businessInquirySchema.safeParse(validInquiry({ [champ]: "x".repeat(max + 1) }));
    assert.equal(result.success, false, `${champ} : dépassement non détecté`);
    const issue = result.error?.issues.find((i) => i.path[0] === champ);
    assert.ok(issue, `${champ} : aucune erreur rattachée au champ`);
    assert.ok(
      /^Ce champ est limité à .+ caractères\.$/.test(issue.message),
      `${champ} : message non francisé (« ${issue.message} »)`,
    );
    assert.ok(!/[A-Za-z]{2,} too big|expected string/i.test(issue.message), `${champ} : texte Zod brut exposé`);
  }
});

await test("9quater. progression : chaque question se débloque une fois la précédente remplie", () => {
  const vide = {
    companyName: "",
    contactName: "",
    contactRole: "",
    email: "",
    phone: "",
    headcount: "",
    needs: [] as string[],
    otherNeed: "",
    format: "",
    city: "",
    projectDetails: "",
    privacyAccepted: false,
    website: "",
  };
  assert.equal(firstIncompleteQuestion(vide), 1, "formulaire vierge : on est à la question 1");

  const etapes: [Record<string, unknown>, number, string][] = [
    [{ companyName: "Acme" }, 2, "entreprise renseignée ⇒ question 2"],
    [{ contactName: "Camille Martin", contactRole: "RH" }, 3, "contact renseigné ⇒ question 3"],
    [{ email: "camille@acme.test" }, 4, "email valide ⇒ question 4 (téléphone facultatif)"],
    [{ headcount: "26-50" }, 5, "effectif choisi ⇒ question 5"],
    [{ needs: ["qvt"] }, 6, "besoin choisi ⇒ question 6"],
    [{ format: "a-distance" }, 8, "format à distance sans ville ⇒ parcours terminé"],
  ];
  let etat: Record<string, unknown> = { ...vide };
  for (const [ajout, attendu, description] of etapes) {
    etat = { ...etat, ...ajout };
    assert.equal(firstIncompleteQuestion(etat), attendu, description);
  }

  // Un email mal formé ne débloque pas la suite.
  assert.equal(
    firstIncompleteQuestion({ ...vide, companyName: "Acme", contactName: "Camille Martin", contactRole: "RH", email: "pas-un-email" }),
    3,
    "email invalide : on reste bloqué à la question 3",
  );

  // En présentiel, la ville manquante retient la question 6.
  const presentielSansVille = { ...etat, format: "sur-site", city: "" };
  assert.equal(firstIncompleteQuestion(presentielSansVille), 6, "présentiel sans ville ⇒ question 6");
  assert.equal(firstIncompleteQuestion({ ...presentielSansVille, city: "Lyon" }), 8, "ville fournie ⇒ terminé");

  // « Autre » sans précision retient la question 5.
  assert.equal(
    firstIncompleteQuestion({ ...etat, needs: ["autre"], otherNeed: "" }),
    5,
    "« autre » sans précision ⇒ question 5",
  );

  // La question 7 est facultative : elle ne retient jamais le parcours.
  assert.equal(allQuestionsComplete({ ...etat, projectDetails: "" }), true, "détails vides : parcours complet");
  assert.equal(
    allQuestionsComplete({ ...etat, projectDetails: "x".repeat(MAX_LENGTHS.projectDetails + 1) }),
    false,
    "détails trop longs : parcours incomplet",
  );

  // Chaque champ appartient à une question et une seule.
  const tousLesChamps = QUESTION_FIELDS.flat();
  assert.equal(new Set(tousLesChamps).size, tousLesChamps.length, "aucun champ rattaché à deux questions");
  assert.equal(QUESTION_COUNT, 7, "sept questions");
});

await test("9quinquies. les formats nomment explicitement le présentiel", () => {
  const libelles = FORMAT_OPTIONS.map((o) => o.label);
  assert.ok(
    libelles.filter((l) => /présentiel/i.test(l)).length >= 2,
    "le présentiel doit apparaître dans les choix cliquables",
  );
  // Les valeurs, elles, ne changent pas : elles circulent dans l'email.
  assert.deepEqual(
    FORMAT_OPTIONS.map((o) => o.value),
    ["sur-site", "a-distance", "hybride"],
    "valeurs stables",
  );
});

/* ─── 10-12. Anti-spam ─── */

await test("10. honeypot rempli ⇒ soumission considérée comme automatisée", () => {
  assert.equal(looksAutomated({ website: "http://spam.test" }), true);
  assert.equal(looksAutomated({ website: "" }), false);
  assert.equal(looksAutomated({}), false);
  // Le schéma accepte quand même la valeur : c'est la route qui répond
  // neutrement, sans apprendre au robot qu'il a été repéré.
  assert.equal(businessInquirySchema.safeParse(validInquiry({ website: "spam" })).success, true);
});

await test("11. limitation de fréquence : 3 demandes par fenêtre, la 4e est refusée", () => {
  const key = `test_business_inquiry_${Math.random()}`;
  for (let i = 0; i < 3; i += 1) {
    assert.equal(checkRateLimit(key, 3, 60_000).allowed, true, `demande ${i + 1} autorisée`);
  }
  const quatrieme = checkRateLimit(key, 3, 60_000);
  assert.equal(quatrieme.allowed, false, "la 4e demande doit être refusée");
  assert.ok(quatrieme.retryAfterMs > 0, "un délai d'attente est indiqué");
});

await test("12. double soumission : deux envois rapprochés, un seul passe", () => {
  const key = `test_business_burst_${Math.random()}`;
  assert.equal(checkRateLimit(key, 1, 20_000).allowed, true);
  assert.equal(checkRateLimit(key, 1, 20_000).allowed, false, "le doublon immédiat est bloqué");
});

/* ─── 13-14. Contenu de l'email et échappement ─── */

await test("13. l'email contient toutes les informations de la demande", async () => {
  const { sent, transport } = captureTransport();
  const input = businessInquirySchema.parse(validInquiry({ phone: "0601020304" }));
  const result = await sendBusinessInquiryEmail(input, {
    transport,
    recipient: "destinataire@test.local",
    now: new Date("2026-07-26T15:30:00+02:00"),
  });

  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1);
  const email = sent[0];

  assert.equal(email.to, "destinataire@test.local", "destinataire = variable serveur, pas une adresse en dur");
  assert.equal(email.replyTo, "camille.martin@acme.test", "Reply-To = email du prospect");
  assert.equal(email.subject, "[Demande entreprise] Acme Industries — 26 à 50");

  for (const attendu of [
    "26 juillet 2026",
    "Acme Industries",
    "Camille Martin",
    "Responsable RH",
    "camille.martin@acme.test",
    "0601020304",
    "26 à 50",
    "Prévention des TMS",
    "Qualité de vie au travail",
    "En présentiel, dans vos locaux",
    "Lyon",
    "Deux séances par semaine",
    "Acceptée par le prospect",
  ]) {
    assert.ok(email.text.includes(attendu), `texte : « ${attendu} » manquant`);
    assert.ok(email.html.includes(attendu) || email.html.includes(attendu.replace(/'/g, "&#39;")), `html : « ${attendu} » manquant`);
  }

  // Téléphone non fourni : mention explicite plutôt qu'un vide.
  const lignesSansTel = buildBusinessInquiryLines(
    businessInquirySchema.parse(validInquiry({ phone: "" })),
    new Date(),
  );
  assert.ok(lignesSansTel.some((l) => l.label === "Téléphone" && l.value === "Non communiqué"));
});

await test("14. les données du prospect sont échappées dans le HTML", async () => {
  const { sent, transport } = captureTransport();
  const input = businessInquirySchema.parse(
    validInquiry({
      companyName: '<script>alert("xss")</script>',
      projectDetails: "Objectif <b>ambitieux</b> & rapide",
    }),
  );
  await sendBusinessInquiryEmail(input, { transport, recipient: "destinataire@test.local" });

  const { html } = sent[0];
  assert.ok(!html.includes("<script>"), "aucune balise script injectée");
  assert.ok(html.includes("&lt;script&gt;"), "les chevrons sont échappés");
  assert.ok(html.includes("&lt;b&gt;ambitieux&lt;/b&gt;"), "le HTML utilisateur est neutralisé");
  assert.ok(html.includes("&amp;"), "les esperluettes sont échappées");
  // Le sujet n'est pas du HTML : il conserve la valeur brute.
  assert.ok(buildBusinessInquirySubject(input).includes("<script>"));
});

/* ─── 14bis-14quater. Pied de page ─── */

await test("14bis. pied de page : texte propre aux demandes entreprise, sans mention de compte", async () => {
  const { sent, transport } = captureTransport();
  await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
    transport,
    recipient: "coach@exemple.test",
  });
  const email = sent[0];

  const attendu = "Cette demande a été envoyée depuis le formulaire Services aux entreprises de SETH Coaching.";
  assert.ok(email.html.includes(attendu), "mention interne absente du HTML");
  assert.ok(email.text.includes(attendu), "mention interne absente du texte");

  // L'ancienne formulation ne doit plus apparaître dans CET email.
  for (const contenu of [email.html, email.text]) {
    assert.ok(!/action sur ton compte/i.test(contenu), "formulation « action sur ton compte » encore présente");
    assert.ok(!/email transactionnel/i.test(contenu), "mention « email transactionnel » encore présente");
    // Répondre écrit au prospect (Reply-To), pas au support : la ligne
    // « Réponds directement à cet email » serait trompeuse ici.
    assert.ok(!/Réponds (directement )?à cet email/i.test(contenu), "ligne de réponse au support encore présente");
  }
});

await test("14ter. aucune adresse locale dans l'email, quelle que soit la configuration", async () => {
  const valeursLocales = [
    "http://localhost:3000",
    "https://localhost",
    "http://127.0.0.1:3000",
    "http://127.0.0.2",
    "http://0.0.0.0:8080",
    "http://[::1]:3000",
    "http://app.localhost:3000",
    "pas-une-url",
    "",
  ];
  const original = process.env.NEXT_PUBLIC_APP_URL;
  try {
    for (const valeur of valeursLocales) {
      process.env.NEXT_PUBLIC_APP_URL = valeur;
      assert.equal(getPublicAppUrl(), null, `« ${valeur} » ne doit pas être affichée`);

      const { sent, transport } = captureTransport();
      await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
        transport,
        recipient: "coach@exemple.test",
      });
      for (const contenu of [sent[0].html, sent[0].text]) {
        assert.ok(!/localhost/i.test(contenu), `« localhost » présent avec NEXT_PUBLIC_APP_URL=${valeur}`);
        assert.ok(!/127\.0\.0\.1/.test(contenu), `« 127.0.0.1 » présent avec NEXT_PUBLIC_APP_URL=${valeur}`);
        assert.ok(!/0\.0\.0\.0|\[::1\]/.test(contenu), `adresse locale présente avec NEXT_PUBLIC_APP_URL=${valeur}`);
      }
    }
    // Aucune URL de production n'est devinée : sans configuration, pas de lien.
    process.env.NEXT_PUBLIC_APP_URL = "";
    const { sent, transport } = captureTransport();
    await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
      transport,
      recipient: "coach@exemple.test",
    });
    assert.ok(!/href="https?:\/\/[^"]*"/.test(sent[0].html.split("Cette demande a été envoyée")[0].split("<td class=\"email-padding\" style=\"padding: 24px 32px").pop() ?? ""),
      "aucun lien de site dans le pied de page sans configuration");
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  }
});

await test("14quater. une URL publique valide est bien affichée", async () => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  try {
    for (const url of ["https://sethcoaching.fr", "https://www.exemple.fr", "http://exemple.fr"]) {
      process.env.NEXT_PUBLIC_APP_URL = url;
      assert.equal(getPublicAppUrl(), url, `« ${url} » doit être considérée comme publique`);

      const { sent, transport } = captureTransport();
      await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
        transport,
        recipient: "coach@exemple.test",
      });
      assert.ok(sent[0].html.includes(`href="${url}"`), `lien manquant pour ${url}`);
      // Affiché sans le protocole, comme pour les autres emails.
      assert.ok(
        sent[0].html.includes(url.replace(/^https?:\/\//, "")),
        `libellé du lien manquant pour ${url}`,
      );
      assert.ok(sent[0].text.includes(url), `URL absente de la version texte pour ${url}`);
    }
  } finally {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  }
});

await test("14quinquies. les autres emails transactionnels gardent leur pied de page", () => {
  // Garde-fou : le gabarit est partagé, la personnalisation ne doit
  // s'appliquer QU'aux appels qui la demandent explicitement.
  const source = readFileSync(new URL("../../lib/email/templates/base.ts", import.meta.url), "utf8");
  assert.ok(source.includes("DEFAULT_FOOTER_NOTE"), "mention par défaut conservée");
  assert.ok(
    source.includes("input.footer?.note ?? DEFAULT_FOOTER_NOTE"),
    "la mention d'origine reste appliquée sans option",
  );
  const templatesSource = readFileSync(new URL("../../lib/email/templates/index.ts", import.meta.url), "utf8");
  assert.ok(!templatesSource.includes("footer:"), "aucun autre template ne personnalise son pied de page");
  const appointmentsSource = readFileSync(new URL("../../lib/email/appointment-emails.ts", import.meta.url), "utf8");
  assert.ok(!appointmentsSource.includes("footer:"), "emails de rendez-vous inchangés");
});

/* ─── 15-17. Envoi ─── */

await test("15. succès d'envoi : statut « sent » et un seul appel au transport", async () => {
  const { sent, transport } = captureTransport();
  const result = await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
    transport,
    recipient: "destinataire@test.local",
  });
  assert.equal(result.status, "sent");
  assert.equal(sent.length, 1);
});

await test("16. échec d'envoi : statut « failed », message technique non destiné au prospect", async () => {
  const transport: EmailTransport = async () => ({ status: "failed", error: "Resend 500 (détail interne)" });
  const result = await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
    transport,
    recipient: "destinataire@test.local",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.error, "Resend 500 (détail interne)");

  // Le message montré à l'utilisateur vient de la route, pas de result.error.
  const routeSource = readFileSync(new URL("../../app/api/business-inquiry/route.ts", import.meta.url), "utf8");
  assert.ok(routeSource.includes("const ERROR_MESSAGE"), "message générique défini");
  assert.ok(!/error:\s*result\.error/.test(routeSource), "le détail technique n'est jamais renvoyé au client");
});

await test("16bis. destinataire non configuré : « skipped », aucun envoi", async () => {
  const { sent, transport } = captureTransport();
  const result = await sendBusinessInquiryEmail(businessInquirySchema.parse(validInquiry()), {
    transport,
    recipient: null,
  });
  assert.equal(result.status, "skipped");
  assert.equal(sent.length, 0, "aucun email tenté sans destinataire");
});

await test("17. aucun email réel ne peut partir depuis les tests", () => {
  assert.equal(process.env.EMAILS_ENABLED, "false", "coupe-circuit global posé");
  assert.equal(process.env.RESEND_API_KEY, undefined, "aucune clé Resend dans l'environnement de test");
  // Toutes les fonctions d'envoi de ce harnais reçoivent un transport double :
  // `resendTransport` n'est jamais appelé.
  const emailSource = readFileSync(new URL("../../lib/business-inquiry/email.ts", import.meta.url), "utf8");
  assert.ok(emailSource.includes("options.transport ?? resendTransport"), "transport injectable");
  assert.ok(emailSource.includes("B2B_CONTACT_RECIPIENT_EMAIL"), "destinataire lu depuis l'environnement serveur");
  assert.ok(!emailSource.includes("@gmail.com"), "aucune adresse en dur");
  assert.ok(emailSource.startsWith('import "server-only"'), "module strictement serveur");
});

/* ─── 18-21. Route HTTP de bout en bout ─── */

/**
 * La route appelle `sendBusinessInquiryEmail` SANS transport injecté : elle
 * passe donc par `resendTransport`, puis par le SDK Resend, qui émet une
 * requête HTTP. On simule le fournisseur en interceptant `globalThis.fetch` :
 * la chaîne complète (validation → anti-spam → composition → transport) est
 * exercée, et AUCUNE requête ne peut sortir de la machine — toute tentative
 * vers un autre hôte que api.resend.com fait échouer le test.
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
process.env.B2B_CONTACT_RECIPIENT_EMAIL = "destinataire@exemple.test";

const { POST } = await import("../../app/api/business-inquiry/route");

function requeteHttp(corps: unknown, ip: string): Request {
  return new Request("http://localhost/api/business-inquiry", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(corps),
  });
}

await test("18. route : demande valide ⇒ 200 et UN email composé (fournisseur simulé)", async () => {
  requetesSortantes.length = 0;
  const response = await POST(requeteHttp(validInquiry(), "198.51.100.1"));
  assert.equal(response.status, 200);
  const payload = (await response.json()) as { message?: string };
  assert.match(String(payload.message), /bien été envoyée/);

  assert.equal(requetesSortantes.length, 1, "exactement un envoi");
  const envoi = requetesSortantes[0].corps as {
    to: string | string[];
    reply_to?: string | string[];
    subject: string;
    html: string;
    text: string;
  };
  assert.deepEqual([envoi.to].flat(), ["destinataire@exemple.test"], "destinataire = variable serveur");
  assert.deepEqual([envoi.reply_to].flat(), ["camille.martin@acme.test"], "Reply-To = adresse du prospect");
  assert.match(envoi.subject, /^\[Demande entreprise\] /);
  for (const attendu of ["Acme Industries", "Camille Martin", "camille.martin@acme.test", "Lyon"]) {
    assert.ok(envoi.text.includes(attendu), `« ${attendu} » absent du corps texte`);
  }
});

await test("19. route : demande invalide ⇒ refus AVANT tout envoi", async () => {
  requetesSortantes.length = 0;
  const response = await POST(requeteHttp({ ...validInquiry(), email: "pas-un-email" }, "198.51.100.2"));
  assert.ok(response.status >= 400, "statut d'erreur attendu");
  assert.equal(requetesSortantes.length, 0, "aucun email pour une demande invalide");
});

await test("20. route : honeypot rempli ⇒ 200 neutre, AUCUN email", async () => {
  requetesSortantes.length = 0;
  const response = await POST(
    requeteHttp({ ...validInquiry(), website: "http://spam.test" }, "198.51.100.3"),
  );
  assert.equal(response.status, 200, "réponse indiscernable d'un succès, pour ne rien apprendre au robot");
  assert.equal(requetesSortantes.length, 0, "aucun email pour une soumission automatisée");
});

await test("21. route : double soumission rapprochée ⇒ un seul email", async () => {
  requetesSortantes.length = 0;
  const premiere = await POST(requeteHttp(validInquiry(), "198.51.100.4"));
  const seconde = await POST(requeteHttp(validInquiry(), "198.51.100.4"));
  assert.equal(premiere.status, 200);
  assert.equal(seconde.status, 200, "le prospect qui double-clique voit un succès");
  assert.equal(requetesSortantes.length, 1, "un seul email malgré deux requêtes");

  // 3 demandes par heure : la 4e est refusée sans envoi.
  await POST(requeteHttp(validInquiry(), "198.51.100.4"));
  const quatrieme = await POST(requeteHttp(validInquiry(), "198.51.100.4"));
  assert.equal(quatrieme.status, 429, "limite de fréquence appliquée");
  assert.equal(requetesSortantes.length, 1, "aucun envoi supplémentaire");
});

globalThis.fetch = fetchReel;

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

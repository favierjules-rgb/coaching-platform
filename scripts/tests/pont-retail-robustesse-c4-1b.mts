/**
 * COURSES C4.1b — ROBUSTESSE ET HONNÊTETÉ FACE AUX PANNES OPEN FOOD FACTS.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT QUE CE HARNAIS INTERDIT DE REVENIR
 * ════════════════════════════════════════════════════════════════════════════
 * Mesuré le 18/08/2026, deux fois, depuis la Preview :
 *
 *   [OFF_CIQUAL] upstream_non_ok code=32140 status=503 durationMs=607
 *                contentType=text/html contentLength=25281
 *
 * …à la minute où le MÊME code Ciqual répondait 200 en 0,389 s depuis un poste
 * de travail. L'écran, lui, disait « La recherche de candidats a échoué. » —
 * une phrase qui ne dit ni ce qui s'est passé, ni quoi faire, ni surtout que
 * RIEN n'a été enregistré.
 *
 * ⚠️ LA RÈGLE QUE TOUT CE FICHIER PROTÈGE : une panne de l'amont ne doit
 * JAMAIS devenir une absence de candidats. Confondre les deux ferait poser à
 * un administrateur une décision de curation — `unsupported`, `needs_review` —
 * sur une liste vide POUR CAUSE DE PANNE. La décision serait fausse, écrite en
 * base, et parfaitement indiscernable d'une vraie plus tard.
 *
 * ⚠️ AUCUN APPEL RÉSEAU. Le transport est injecté.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { chercherProduitsParCodeCiqual } from "../../lib/open-food-facts/recherche-ciqual";
import { MESSAGE_PANNE_OFF, messagePanneOff } from "../../lib/nutrition/pont-retail";
import { FOOD_BRIDGE_SEARCH } from "../../lib/security/rules";

process.env.OPENFOODFACTS_USER_AGENT = "SethTest/9.9 (test@exemple.fr)";

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");
const UI = lire("../../components/admin/PontRetailAdmin.tsx");
const ROUTE = lire("../../app/api/admin/food-bridge/candidates/route.ts");
const ADAPTATEUR = lire("../../lib/open-food-facts/recherche-ciqual.ts");
const REGLES = lire("../../lib/security/rules.ts");

/** On assertionne du CODE, jamais de la prose : ce dépôt documente ses refus. */
const sansCommentaires = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

const CODE = "32140";

const reponseJson = (corps: unknown, status = 200) =>
  new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json" } });

const ficheValide = (gtin: string) => ({
  code: gtin,
  product_name: "Flocons d'avoine",
  nutrition_data_per: "100g",
  nutriments: { proteins_100g: 11.4, carbohydrates_100g: 57.7, fat_100g: 7.82 },
});

async function attraper(fn: () => Promise<unknown>): Promise<{ code?: string }> {
  try {
    await fn();
    return {};
  } catch (erreur) {
    return { code: (erreur as { code?: string }).code };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   A — SUCCÈS ET ABSENCE : DEUX RÉUSSITES, PAS DEUX PANNES
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-R01 — 200 avec candidats : le succès est inchangé", async () => {
  const r = await chercherProduitsParCodeCiqual(CODE, {
    journal: () => {},
    transport: async () => reponseJson({ count: 3, products: [ficheValide("3017620422003")] }),
  });
  assert.equal(r.importables.length, 1);
  assert.equal(r.totalOff, 3);
});

await test("C4.1b-R02 — 200 avec products vide : AUCUN CANDIDAT, et c'est un SUCCÈS", async () => {
  // ⚠️ LE CAS 22000 — l'œuf cru, mesuré à `count 0` en direct. Un référentiel
  // qui ne contient rien pour ce code n'est PAS une panne : c'est une réponse,
  // et elle est exacte. La curation doit pouvoir la voir et décider.
  const r = await chercherProduitsParCodeCiqual("22000", {
    journal: () => {},
    transport: async () => reponseJson({ count: 0, products: [] }),
  });
  assert.equal(r.importables.length, 0);
  assert.equal(r.nonImportables.length, 0);
  assert.equal(r.totalOff, 0, "zéro annoncé par la source, et rendu tel quel");
});

/* ══════════════════════════════════════════════════════════════════════════
   B — LES DEUX PANNES SE DISENT DIFFÉREMMENT
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-R03 — 429 : limitation temporaire, message propre, RIEN d'écrit", async () => {
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: () => {},
      transport: async () => new Response("", { status: 429 }),
    }),
  );
  assert.equal(echec.code, "OFF_RATE_LIMITED", "le contrat serveur ne change pas");

  const message = messagePanneOff("OFF_RATE_LIMITED") ?? "";
  assert.match(message, /temporairement/i, "l'état doit être dit TEMPORAIRE");
  assert.match(message, /réessa/i, "et l'élève de la curation doit savoir quoi faire");
  assert.match(
    message,
    /aucune nouvelle décision n[’']a été enregistrée/i,
    "l'absence d'écriture doit être dite, et dite JUSTE : « nouvelle » est obligatoire",
  );
});

await test("C4.1b-R04 — 503 : indisponibilité temporaire, message DISTINCT du 429", async () => {
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: () => {},
      transport: async () =>
        new Response("<html>gateway</html>", { status: 503, headers: { "content-type": "text/html" } }),
    }),
  );
  assert.equal(echec.code, "OFF_UNAVAILABLE", "aucun nouveau code d'erreur n'a été inventé");

  const message = messagePanneOff("OFF_UNAVAILABLE") ?? "";
  assert.match(message, /Open Food Facts/, "la source doit être nommée");
  assert.match(message, /temporairement indisponible/i);
  assert.match(message, /aucune nouvelle décision n[’']a été enregistrée/i);
  assert.match(message, /réessa/i);

  // ⚠️ DEUX PANNES, DEUX PHRASES. Les confondre effacerait la seule
  // information actionnable : « attends une minute » n'est pas « reviens plus
  // tard, la source est en panne ».
  assert.notEqual(
    messagePanneOff("OFF_UNAVAILABLE"),
    messagePanneOff("OFF_RATE_LIMITED"),
    "429 et 503 ne doivent pas se dire pareil",
  );
});

await test("C4.1b-R05 — une panne ne dit JAMAIS « aucun candidat »", () => {
  // ⚠️ LE CŒUR DU LOT. Chercher les tournures d'ABSENCE dans les messages de
  // PANNE : si l'une s'y trouve, l'administrateur croira le référentiel vide.
  for (const code of ["OFF_UNAVAILABLE", "OFF_RATE_LIMITED", "OFF_INVALID_RESPONSE"] as const) {
    const message = messagePanneOff(code) ?? "";
    for (const tournureDAbsence of ["aucun candidat", "aucun produit", "0 candidat", "rien trouvé"]) {
      assert.ok(
        !message.toLowerCase().includes(tournureDAbsence),
        `le message de panne ${code} parle d'absence : « ${message} »`,
      );
    }
    // ⚠️ ET L'AFFIRMATION ABSOLUE EST INTERDITE, DÉFINITIVEMENT.
    //
    // « Aucune décision n'a été enregistrée » serait FAUX : un aliment peut
    // porter une décision de curation ANTÉRIEURE et valide. Ce que nous
    // savons est plus étroit — CETTE tentative n'a rien écrit — et le mot
    // « nouvelle » est ce qui fait la différence entre les deux. Ce contrôle
    // existe pour qu'il ne disparaisse pas à la faveur d'une relecture.
    assert.match(
      message,
      /aucune nouvelle décision n[’']a été enregistrée/i,
      `le message ${code} doit dire « aucune NOUVELLE décision » : « ${message} »`,
    );
    assert.ok(
      !/(?<!nouvelle )décision n[’']a été enregistrée/i.test(
        message.replace(/aucune nouvelle décision n[’']a été enregistrée/gi, ""),
      ),
      `le message ${code} affirme l'absence absolue de décision : « ${message} »`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   C — L'ÉCRAN SAIT DISTINGUER LES CINQ ÉTATS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-R06 — l'écran choisit son message sur le CODE, pas sur le texte du serveur", () => {
  const ui = sansCommentaires(UI);
  assert.match(ui, /\bmessagePanneOff\b/, "l'écran doit utiliser la table de messages partagée");
  assert.match(ui, /corps\.code/, "le code d'erreur du serveur doit être lu");
  // Le repli générique existe toujours pour les erreurs non prévues (cas E).
  assert.match(ui, /Recherche impossible\./, "un message générique doit rester pour l'inattendu");
});

await test("C4.1b-R06b — 200 avec zéro candidat : l'écran le DIT, et ne parle pas de panne", () => {
  // ⚠️ CAS B. Sans cet état, un référentiel vide se manifestait par une liste
  // vide et un discret « 0 affiché(s) » — indiscernable, pour l'œil, d'un
  // écran qui n'a pas fini de charger. Le dire explicitement est ce qui rend
  // la décision de curation possible ET honnête.
  const ui = sansCommentaires(UI);
  assert.match(ui, /donnees\.candidats\.length === 0/, "l'absence doit avoir sa propre garde");

  const debut = ui.indexOf("donnees.candidats.length === 0");
  const bloc = ui.slice(debut, debut + 900);
  assert.match(bloc, /aucun candidat/i, "l'absence doit être nommée");
  // Et elle ne doit surtout pas emprunter le vocabulaire de la panne.
  for (const motDePanne of ["indisponible", "échoué", "erreur", "réessa"]) {
    assert.ok(
      !bloc.toLowerCase().includes(motDePanne),
      `l'état « aucun candidat » emploie le vocabulaire de la panne : ${motDePanne}`,
    );
  }
});

await test("C4.1b-R07 — l'écran n'écrit RIEN quand la recherche échoue", () => {
  const ui = sansCommentaires(UI);
  // Le bloc d'échec de `charger` remet les données à null et ne déclenche
  // aucun appel d'écriture.
  const bloc = ui.slice(ui.indexOf("const charger"), ui.indexOf("const choisirAliment"));
  for (const ecriture of ["food-bridge/match", "food-bridge/review", "method: \"POST\"", "method: \"DELETE\""]) {
    assert.ok(!bloc.includes(ecriture), `le chargement des candidats déclenche ${ecriture}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   D — LE QUOTA INTERNE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-R08 — FOOD_BRIDGE_SEARCH est abaissé à 6 par minute", () => {
  assert.equal(FOOD_BRIDGE_SEARCH.limit, 6, "le quota de curation doit être conservateur");
  assert.equal(FOOD_BRIDGE_SEARCH.windowMs, 60_000);
  assert.equal(FOOD_BRIDGE_SEARCH.name, "food_bridge_search");
  // ⚠️ `failClosed` RESTE FAUX, et ce n'est pas un oubli : refuser une
  // curation quand le compteur est injoignable ne protège pas Open Food Facts,
  // ça empêche seulement de travailler.
  assert.notEqual(FOOD_BRIDGE_SEARCH.failClosed, true);
});

await test("C4.1b-R09 — la PORTÉE réelle du quota est documentée, pas surestimée", () => {
  // ⚠️ CE CONTRÔLE EXISTE PARCE QU'UN QUOTA MAL DÉCRIT EST PIRE QU'AUCUN.
  // `consumeRateLimit` utilise Upstash SI configuré, sinon un compteur EN
  // MÉMOIRE, donc par instance. Prétendre qu'il protège globalement Open Food
  // Facts serait faux dès qu'Upstash manque — et faux de toute façon vis-à-vis
  // des protections amont, qui ne sont pas bornées par notre compteur local.
  const bloc = REGLES.slice(
    REGLES.indexOf("COURSES C4.1"),
    REGLES.indexOf("export const FOOD_BRIDGE_SEARCH") + 200,
  );
  // Les trois limites que la documentation DOIT énoncer.
  assert.match(bloc, /par administrateur/i, "la portée par administrateur doit être dite");
  assert.match(bloc, /par instance|en mémoire/i, "la portée mémoire doit être dite");
  assert.match(bloc, /upstash/i, "la dépendance au magasin partagé doit être dite");
  assert.match(
    bloc,
    /ne (garantit|borne) donc pas|ne borne pas toutes les protections/i,
    "l'incapacité du quota à garantir l'acceptation amont doit être dite",
  );
  assert.match(
    bloc,
    /protections globales|indépendantes de l'appelant/i,
    "les protections amont distinctes du compteur local doivent être dites",
  );

  // ⚠️ ET LA DOCUMENTATION NE DOIT PAS INVENTER LA CAUSE DU 503.
  //
  // Une première rédaction attribuait le 503 à la nature de l'adresse de
  // sortie. C'était une HYPOTHÈSE plausible, pas une mesure : ce que nous
  // avons observé est un 503 sur le chemin Vercel → Open Food Facts, rien de
  // plus. Une hypothèse écrite en commentaire finit toujours par être relue
  // comme un fait, et enverrait le prochain diagnostic dans une direction que
  // personne n'a vérifiée. Les tournures proscrites sont listées ci-dessous —
  // c'est le SEUL endroit du lot où elles ont le droit d'apparaître.
  for (const affirmationNonProuvee of [
    "adresse de sortie est partagée",
    "adresse de sortie partagée",
    "partagent l'adresse",
    "IP d'un déploiement Vercel est mutualisée",
    "IP partagée",
    "IP mutualisée",
    // ⚠️ AJOUTÉES APRÈS COUP, et pour la même raison : elles supposent un
    // compteur amont unique et une adresse unique côté sortie. Ni l'un ni
    // l'autre n'a été mesuré.
    "quota du serveur",
    "quota d'open food facts est celui du serveur",
    "partagé par tous les élèves",
  ]) {
    assert.ok(
      !bloc.toLowerCase().includes(affirmationNonProuvee.toLowerCase()),
      `la documentation affirme une cause non prouvée : « ${affirmationNonProuvee} »`,
    );
  }
  assert.match(bloc, /reste inconnue/i, "l'inconnue doit être nommée comme telle");

  // ⚠️ ET LA DOCUMENTATION NE DOIT PAS SURESTIMER LA PORTÉE DU COMPTEUR.
  //
  // Sabotage S10, sorti VERT au premier essai : remplacer « LA PORTÉE EST PAR
  // ADMINISTRATEUR, PAS GLOBALE » par « LA PORTÉE EST TOTALE » laissait le
  // contrôle passer, parce que la formule « par administrateur » subsistait
  // ailleurs dans le bloc. Vérifier qu'une vérité est PRÉSENTE ne suffit pas :
  // il faut aussi qu'aucun mensonge ne le soit.
  for (const surestimation of [
    "portée est totale",
    "portée est globale",
    "quota global",
    "protège open food facts",
    "garantit que l",
  ]) {
    assert.ok(
      !bloc.toLowerCase().includes(surestimation),
      `la documentation surestime le quota : « ${surestimation} »`,
    );
  }
  assert.match(bloc, /pas globale/i, "la NON-globalité doit être dite explicitement");
});

/* ══════════════════════════════════════════════════════════════════════════
   E — NI CACHE MENSONGER, NI RÉESSAI AUTOMATIQUE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-R10 — deux appels identiques rapprochés font DEUX appels amont", async () => {
  // ⚠️ CE TEST FIGE UNE DÉCISION, il ne constate pas un manque : AUCUN CACHE
  // N'A ÉTÉ INTRODUIT. Un cache mémoire sous Vercel serait par instance et
  // mourrait avec elle ; il ne réduirait pas la charge amont de façon fiable,
  // mais donnerait un faux sentiment de cohérence — deux administrateurs
  // verraient deux vérités selon l'instance qui les sert. Le jour où un cache
  // arrivera, ce test devra être RÉÉCRIT sciemment, pas contourné.
  let appels = 0;
  const transport = async () => {
    appels += 1;
    return reponseJson({ count: 1, products: [ficheValide("3017620422003")] });
  };
  await chercherProduitsParCodeCiqual(CODE, { journal: () => {}, transport });
  await chercherProduitsParCodeCiqual(CODE, { journal: () => {}, transport });
  assert.equal(appels, 2, "aucun cache caché ne doit servir une réponse périmée");
});

await test("C4.1b-R11 — AUCUN réessai automatique : un appel par recherche, quel que soit l'échec", async () => {
  for (const reponse of [
    () => new Response("", { status: 503 }),
    () => new Response("", { status: 429 }),
    () => new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } }),
  ]) {
    let appels = 0;
    await attraper(() =>
      chercherProduitsParCodeCiqual(CODE, {
        journal: () => {},
        transport: async () => {
          appels += 1;
          return reponse();
        },
      }),
    );
    assert.equal(appels, 1, "un échec amont ne doit jamais déclencher un second appel");
  }
  // Et le source ne contient aucune boucle de réessai.
  const code = sansCommentaires(ADAPTATEUR);
  const corps = code.slice(code.indexOf("export async function chercherProduitsParCodeCiqual"));
  for (const boucle of ["while (", "for (", "setTimeout(() => transport", "backoff"]) {
    assert.ok(!corps.includes(boucle), `l'adaptateur contient ${boucle}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   F — C4.1b-PERIMETRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-PERIMETRE-R — ni migration, ni matching élargi, ni délai touché", () => {
  assert.match(ADAPTATEUR, /options\.timeoutMs \?\? OFF_TIMEOUT_MS/, "le délai reste celui de C4.1");
  assert.ok(!/30000|20000|15000/.test(sansCommentaires(ADAPTATEUR)), "aucun délai élargi en dur");

  const code = sansCommentaires(ADAPTATEUR).toLowerCase();
  for (const interdit of ["search.openfoodfacts.org", "nominatim", "fuzzy", "levenshtein", "similarity"]) {
    assert.ok(!code.includes(interdit), `l'adaptateur nomme ${interdit}`);
  }
  // Le filtre Ciqual n'a pas bougé.
  assert.match(ADAPTATEUR, /categories_properties_tags: `\$\{CIQUAL_TAG_PREFIX\}\$\{code\}`/);
  // ⚠️ L'INSTRUMENTATION COMMITÉE EST INTACTE — ET ON VÉRIFIE L'APPEL, PAS LE
  // MOT. Une première version cherchait `"upstream_non_ok"` n'importe où dans
  // le fichier : le nom vit aussi dans l'union de types `EvenementOffCiqual`,
  // si bien que supprimer l'APPEL au journal laissait le contrôle au vert.
  // Sabotage S6, sorti vert, puis resserré ici. C'est la trace émise qui
  // compte, pas le vocabulaire déclaré.
  for (const evenement of [
    "upstream_non_ok",
    "upstream_rate_limited",
    "timeout",
    "fetch_error",
    "invalid_json",
    "invalid_envelope",
    "unexpected_error",
    "success",
  ]) {
    assert.ok(
      sansCommentaires(ADAPTATEUR).includes(`ligneTraceOffCiqual("${evenement}"`) ||
        sansCommentaires(ADAPTATEUR).includes(`? "${evenement}" :`) ||
        sansCommentaires(ADAPTATEUR).includes(`: "${evenement}",`),
      `l'ÉMISSION de la trace ${evenement} a disparu`,
    );
  }
  // La route continue de refuser un candidat hors recherche structurée.
  assert.match(ROUTE, /CANDIDAT_HORS_RECHERCHE|MESSAGE_REFUS/, "les garde-fous C4.1 restent");
  // Aucun message de panne ne contient de tournure d'absence — table figée.
  assert.equal(Object.keys(MESSAGE_PANNE_OFF).length, 3, "trois codes, trois messages");
});

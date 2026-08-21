/**
 * COURSES C4.1b — L'INSTRUMENTATION DU CHEMIN DE RECHERCHE CIQUAL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CE QUE CE HARNAIS PROUVE, ET CE QU'IL NE PROUVE PAS
 * ════════════════════════════════════════════════════════════════════════════
 * Il prouve que les HUIT sorties du chemin Open Food Facts produisent chacune
 * une trace distincte et reconnaissable, et qu'AUCUNE de ces traces ne laisse
 * fuir un secret. Il ne prouve rien sur la cause du défaut de production : à
 * cette étape, la cause racine est TOUJOURS INCONNUE, et cette passe n'a
 * d'autre but que de la rendre nommable.
 *
 * ⚠️ AUCUN APPEL RÉSEAU. Le transport est injecté ; l'API Open Food Facts
 * réelle n'est jamais sollicitée, ni ici ni en intégration continue.
 *
 * ⚠️ ET LE CONTRAT DE C4.1 EST VÉRIFIÉ EN MÊME TEMPS : chaque test contrôle
 * que le code d'erreur rendu n'a PAS bougé. Une trace qui changerait le
 * comportement ne serait plus une trace.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  OFF_CIQUAL_TAG,
  chercherProduitsParCodeCiqual,
  ligneTraceOffCiqual,
} from "../../lib/open-food-facts/recherche-ciqual";

const SOURCE = readFileSync(
  new URL("../../lib/open-food-facts/recherche-ciqual.ts", import.meta.url),
  "utf8",
);

/**
 * ⚠️ ON BALAIE DU CODE, JAMAIS DE LA PROSE. L'en-tête de l'adaptateur EXPLIQUE
 * longuement pourquoi il ne faut pas utiliser `search.openfoodfacts.org` — et
 * un balayage naïf accuserait ce fichier de faire exactement ce qu'il
 * interdit. Le réflexe suivant serait de retirer le mot de la liste, donc de
 * perdre la garantie. On dépouille les commentaires à la place.
 */
const CODE_SEUL = SOURCE.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");

/** Le User-Agent de test : une valeur RECONNAISSABLE, qu'on cherchera ensuite. */
const UA_SECRET = "SethTest/9.9 (secret-a-ne-jamais-journaliser@exemple.fr)";
process.env.OPENFOODFACTS_USER_AGENT = UA_SECRET;

const CODE = "32140";

/** Recueille les lignes de trace au lieu de les écrire. */
function journalDeTest(): { lignes: string[]; ecrire: (l: string) => void } {
  const lignes: string[] = [];
  return { lignes, ecrire: (l) => lignes.push(l) };
}

const reponseJson = (corps: unknown, status = 200, entetes: Record<string, string> = {}) =>
  new Response(JSON.stringify(corps), {
    status,
    headers: { "content-type": "application/json", ...entetes },
  });

/** Une fiche OFF minimale mais IMPORTABLE : les trois macros y sont. */
const ficheValide = (codeBarres: string) => ({
  code: codeBarres,
  product_name: "Flocons d'avoine",
  nutrition_data_per: "100g",
  nutriments: { proteins_100g: 11.4, carbohydrates_100g: 57.7, fat_100g: 7.82 },
});

async function attraper(fn: () => Promise<unknown>): Promise<{ code?: string; nom?: string }> {
  try {
    await fn();
    return {};
  } catch (erreur) {
    const e = erreur as { code?: string; name?: string };
    return { code: e.code, nom: e.name };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   A — LES HUIT SORTIES, UNE TRACE CHACUNE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-01 — G · succès : la trace dit le statut, la durée et les comptes", async () => {
  const j = journalDeTest();
  const resultat = await chercherProduitsParCodeCiqual(CODE, {
    journal: j.ecrire,
    transport: async () =>
      reponseJson({ count: 3, products: [ficheValide("3017620422003"), { code: "x", product_name: "sans macros" }] }),
  });

  assert.equal(j.lignes.length, 1, "une recherche, une trace");
  const ligne = j.lignes[0];
  assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} success`), `trace inattendue : ${ligne}`);
  assert.match(ligne, /\bcode=32140\b/);
  assert.match(ligne, /\bstatus=200\b/);
  assert.match(ligne, /\bdurationMs=\d+\b/);
  assert.match(ligne, /\bcount=3\b/, "le total amont doit figurer");
  assert.match(ligne, /\bimportables=1\b/);
  assert.match(ligne, /\bnonImportables=1\b/);
  // ⚠️ LE CONTRAT N'A PAS BOUGÉ : les candidats sont toujours rendus.
  assert.equal(resultat.importables.length, 1);
  assert.equal(resultat.totalOff, 3);
});

await test("C4.1b-02 — C · 429 : rate_limited, et le code d'erreur reste OFF_RATE_LIMITED", async () => {
  const j = journalDeTest();
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      transport: async () => new Response("", { status: 429, headers: { "content-type": "text/html" } }),
    }),
  );
  assert.equal(echec.code, "OFF_RATE_LIMITED", "le contrat C4.1 ne change pas");
  const ligne = j.lignes[0] ?? "";
  assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} upstream_rate_limited`), `trace inattendue : ${ligne}`);
  assert.match(ligne, /\bstatus=429\b/);
  assert.match(ligne, /\bdurationMs=\d+\b/);
  assert.match(ligne, /contentType=text\/html/);
});

await test("C4.1b-03 — D · non-OK autre : upstream_non_ok PORTE LE STATUT", async () => {
  // ⚠️ LE CAS EXACTEMENT OBSERVÉ EN PRODUCTION LE 18/08/2026 : une passerelle
  // qui rend 503 et une page HTML. Sans cette trace, il était indiscernable
  // d'un abandon au bout de huit secondes — les deux donnaient
  // OFF_UNAVAILABLE et rien d'autre.
  for (const status of [500, 502, 503, 403]) {
    const j = journalDeTest();
    const echec = await attraper(() =>
      chercherProduitsParCodeCiqual(CODE, {
        journal: j.ecrire,
        transport: async () =>
          new Response("<html><title>error</title></html>", {
            status,
            headers: { "content-type": "text/html", "content-length": "25281" },
          }),
      }),
    );
    assert.equal(echec.code, "OFF_UNAVAILABLE", `${status} doit rester OFF_UNAVAILABLE`);
    const ligne = j.lignes[0] ?? "";
    assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} upstream_non_ok`), `trace inattendue : ${ligne}`);
    assert.match(ligne, new RegExp(`\\bstatus=${status}\\b`));
    assert.match(ligne, /contentType=text\/html/);
    assert.match(ligne, /\bcontentLength=25281\b/);
  }
});

await test("C4.1b-04 — B · AbortError : timeout, DISTINCT de fetch_error", async () => {
  const j = journalDeTest();
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      timeoutMs: 5,
      transport: (_url, init) =>
        new Promise((_resoudre, rejeter) => {
          const signal = init.signal as AbortSignal | undefined;
          signal?.addEventListener("abort", () => {
            const e = new Error("The operation was aborted.");
            e.name = "AbortError";
            rejeter(e);
          });
        }),
    }),
  );
  assert.equal(echec.code, "OFF_UNAVAILABLE", "le contrat C4.1 ne change pas");
  const ligne = j.lignes[0] ?? "";
  assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} timeout`), `trace inattendue : ${ligne}`);
  assert.match(ligne, /\bname=AbortError\b/);
  assert.match(ligne, /\bdurationMs=\d+\b/);
  assert.ok(!/\bstatus=/.test(ligne), "aucune réponse n'existe : pas de statut à inventer");
});

await test("C4.1b-05 — A · fetch rejeté : fetch_error, avec la CLASSE et non le message", async () => {
  const j = journalDeTest();
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      transport: async () => {
        const e = new TypeError("fetch failed https://interne.exemple/secret?token=abc");
        throw e;
      },
    }),
  );
  assert.equal(echec.code, "OFF_UNAVAILABLE");
  const ligne = j.lignes[0] ?? "";
  assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} fetch_error`), `trace inattendue : ${ligne}`);
  assert.match(ligne, /\bname=TypeError\b/);
  // ⚠️ LE MESSAGE D'EXCEPTION NE DOIT PAS ENTRER DANS LA TRACE. Il contient
  // ici une URL interne et un jeton — c'est précisément ce qu'on refuse.
  assert.ok(!ligne.includes("token"), "le message d'exception ne doit pas être journalisé");
  assert.ok(!ligne.includes("interne.exemple"), "aucun hôte ne doit fuiter");
});

await test("C4.1b-06 — E · corps illisible : invalid_json", async () => {
  const j = journalDeTest();
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      transport: async () =>
        new Response("<html>maintenance</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    }),
  );
  assert.equal(echec.code, "OFF_INVALID_RESPONSE");
  const ligne = j.lignes[0] ?? "";
  assert.ok(ligne.startsWith(`${OFF_CIQUAL_TAG} invalid_json`), `trace inattendue : ${ligne}`);
  assert.match(ligne, /\bstatus=200\b/);
  assert.match(ligne, /contentType=text\/html/);
});

await test("C4.1b-07 — F · JSON lisible mais enveloppe inexploitable : invalid_envelope", async () => {
  for (const corps of [{ error: "oops" }, { products: "pas un tableau" }, 42]) {
    const j = journalDeTest();
    const echec = await attraper(() =>
      chercherProduitsParCodeCiqual(CODE, { journal: j.ecrire, transport: async () => reponseJson(corps) }),
    );
    assert.equal(echec.code, "OFF_INVALID_RESPONSE", JSON.stringify(corps));
    const ligne = j.lignes[0] ?? "";
    assert.ok(
      ligne.startsWith(`${OFF_CIQUAL_TAG} invalid_envelope`),
      `trace inattendue pour ${JSON.stringify(corps)} : ${ligne}`,
    );
    assert.match(ligne, /\bstatus=200\b/);
    assert.match(ligne, /\bname=OffErreur\b/);
  }
});

await test("C4.1b-04b — AbortError SUBI, signal NON déclenché : fetch_error, jamais timeout", async () => {
  // ⚠️ LE POINT EXACT DE LA CORRECTION. Un abandon peut venir d'ailleurs que
  // de nous — signal amont, coupure de plateforme, client qui raccroche.
  // L'appeler « timeout » ferait chercher une lenteur d'Open Food Facts qui
  // n'a jamais existé, et pousserait à élargir un délai qui n'y est pour rien.
  const j = journalDeTest();
  let signalVu: AbortSignal | undefined;
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      // Délai large : notre minuteur ne déclenchera PAS pendant ce test.
      timeoutMs: 30_000,
      transport: async (_url, init) => {
        signalVu = init.signal as AbortSignal | undefined;
        const e = new Error("aborted by someone else");
        e.name = "AbortError";
        throw e;
      },
    }),
  );

  assert.equal(signalVu?.aborted, false, "notre signal ne doit PAS avoir déclenché");
  assert.equal(echec.code, "OFF_UNAVAILABLE", "le contrat C4.1 ne change pas");

  const ligne = j.lignes[0] ?? "";
  assert.ok(
    ligne.startsWith(`${OFF_CIQUAL_TAG} fetch_error`),
    `un AbortError subi doit être un fetch_error, vu : ${ligne}`,
  );
  assert.ok(!ligne.includes("timeout"), "il ne doit surtout pas être appelé timeout");
  assert.match(ligne, /\bname=AbortError\b/, "la classe reste dite, telle quelle");
  assert.match(ligne, /\baborted=false\b/, "l'état de NOTRE signal doit être lisible");
});

await test("C4.1b-07b — exception INATTENDUE après enveloppe valide : jamais invalid_envelope", async () => {
  // ⚠️ `invalid_envelope` EST UNE ACCUSATION CONTRE L'AMONT. Ici la réponse
  // est parfaite — 200, JSON lisible, `products` bien un tableau — et c'est
  // notre propre traitement qui lève. Le ranger sous `invalid_envelope`
  // enverrait chercher la panne du mauvais côté.
  //
  // On provoque l'exception par une fiche dont la lecture fait exploser le
  // normaliseur : un `nutriments` piégé qui lève à l'accès.
  const fichePiegee = {
    code: "3017620422003",
    product_name: "Piège",
    nutrition_data_per: "100g",
    get nutriments(): never {
      throw new RangeError("défaut de programmation, pas un défaut de la source");
    },
  };
  // ⚠️ LE PIÈGE EST POSÉ SUR `json()`, PAS SUR LE CORPS SÉRIALISÉ. Une
  // première version le passait à `JSON.stringify`, qui déclenchait le getter
  // AVANT même que le transport ne rende — l'exception naissait alors dans le
  // `fetch` et la trace disait `fetch_error`, ce qui était exact mais ne
  // testait pas ce qu'on voulait. Ici la réponse est bel et bien reçue, le
  // corps est bel et bien lu, et c'est le NORMALISEUR qui explose.
  const j = journalDeTest();
  const echec = await attraper(() =>
    chercherProduitsParCodeCiqual(CODE, {
      journal: j.ecrire,
      transport: async () => {
        const reponse = reponseJson({ count: 1, products: [] });
        Object.defineProperty(reponse, "json", {
          value: async () => ({ count: 1, products: [fichePiegee] }),
        });
        return reponse;
      },
    }),
  );

  const ligne = j.lignes[0] ?? "";
  assert.ok(ligne !== "", "une exception inattendue doit tout de même laisser une trace");
  assert.ok(
    !ligne.includes("invalid_envelope"),
    `une exception inattendue ne doit pas accuser l'amont, vu : ${ligne}`,
  );
  assert.ok(
    ligne.startsWith(`${OFF_CIQUAL_TAG} unexpected_error`),
    `événement attendu : unexpected_error, vu : ${ligne}`,
  );
  assert.match(ligne, /\bstatus=200\b/, "la réponse ÉTAIT bonne, et la trace le dit");
  assert.match(ligne, /\bname=RangeError\b/, "la classe réelle, pas OffErreur");
  // ⚠️ ET LE CONTRAT DE C4.1 NE BOUGE PAS : l'exception est relancée telle
  // quelle, elle n'est pas convertie en erreur métier.
  assert.notEqual(echec.code, "OFF_INVALID_RESPONSE", "aucune conversion en erreur métier");
  assert.equal(echec.nom, "RangeError", "l'exception d'origine est relancée intacte");
});

/* ══════════════════════════════════════════════════════════════════════════
   B — LES HUIT ÉVÉNEMENTS SONT DISTINCTS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-08 — les huit événements portent huit noms différents", () => {
  const noms = [
    "success",
    "upstream_rate_limited",
    "upstream_non_ok",
    "timeout",
    "fetch_error",
    "invalid_json",
    "invalid_envelope",
    "unexpected_error",
  ];
  assert.equal(new Set(noms).size, 8, "aucun doublon");
  for (const nom of noms) {
    assert.ok(
      SOURCE.includes(`"${nom}"`),
      `l'événement ${nom} doit exister dans l'adaptateur`,
    );
  }
  // Le préfixe est unique et grepable.
  assert.equal(OFF_CIQUAL_TAG, "[OFF_CIQUAL]");
});

await test("C4.1b-09 — un champ absent ne s'écrit pas « undefined »", () => {
  const ligne = ligneTraceOffCiqual("timeout", "22000", { durationMs: 8001, status: undefined });
  assert.equal(ligne, "[OFF_CIQUAL] timeout code=22000 durationMs=8001");
  assert.ok(!ligne.includes("undefined"), "une trace ne doit jamais afficher undefined");
});

/* ══════════════════════════════════════════════════════════════════════════
   C — AUCUN SECRET NE FUITE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-10 — les HUIT sorties tracent, et AUCUNE ne laisse fuir un secret", async () => {
  // ⚠️ CE TEST EXERCE LES HUIT CHEMINS, PAS SIX. Une version antérieure
  // prétendait « protéger toutes les traces » en n'en produisant que six :
  // `timeout` et `unexpected_error` n'étaient jamais atteints, donc jamais
  // balayés. Un contrôle anti-fuite qui ne passe pas par un chemin ne protège
  // pas ce chemin — il donne seulement l'impression de le faire.
  const j = journalDeTest();

  /** La fiche qui fait exploser le NORMALISEUR, pas le transport. */
  const fichePiegee = {
    code: "3017620422003",
    product_name: "Piège",
    nutrition_data_per: "100g",
    get nutriments(): never {
      throw new RangeError("fetch failed https://interne.exemple/x?token=abc");
    },
  };

  const scenarios: ReadonlyArray<{
    readonly evenement: string;
    readonly options: Parameters<typeof chercherProduitsParCodeCiqual>[1];
  }> = [
    {
      evenement: "success",
      options: {
        transport: async () => reponseJson({ count: 1, products: [ficheValide("3017620422003")] }),
      },
    },
    {
      evenement: "upstream_rate_limited",
      options: { transport: async () => new Response("", { status: 429 }) },
    },
    {
      evenement: "upstream_non_ok",
      options: { transport: async () => new Response("", { status: 503 }) },
    },
    {
      // ⚠️ MÊME MONTAGE QUE C4.1b-04 : petit délai injecté, transport qui ne
      // rend jamais. C'est NOTRE minuteur qui coupe, donc bien un `timeout`.
      evenement: "timeout",
      options: {
        timeoutMs: 5,
        transport: (_url, init) =>
          new Promise((_resoudre, rejeter) => {
            const signal = init.signal as AbortSignal | undefined;
            signal?.addEventListener("abort", () => {
              const e = new Error("The operation was aborted.");
              e.name = "AbortError";
              rejeter(e);
            });
          }),
      },
    },
    {
      evenement: "fetch_error",
      options: {
        transport: async () => {
          throw new TypeError("fetch failed https://interne.exemple/x?token=abc");
        },
      },
    },
    {
      evenement: "invalid_json",
      options: {
        transport: async () =>
          new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } }),
      },
    },
    {
      evenement: "invalid_envelope",
      options: { transport: async () => reponseJson({ error: "oops" }) },
    },
    {
      // ⚠️ MÊME PRINCIPE QUE C4.1b-07b : le piège est posé sur `json()`, de
      // sorte que la réponse soit reçue et le corps lu avant l'explosion.
      evenement: "unexpected_error",
      options: {
        transport: async () => {
          const reponse = reponseJson({ count: 1, products: [] });
          Object.defineProperty(reponse, "json", {
            value: async () => ({ count: 1, products: [fichePiegee] }),
          });
          return reponse;
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    await attraper(() =>
      chercherProduitsParCodeCiqual(CODE, { ...scenario.options, journal: j.ecrire }),
    );
  }

  // ⚠️ LE COMPTE EXACT, PAS « AU MOINS ». Un `>=` laisserait passer un chemin
  // muet : huit scénarios doivent produire huit traces, ni plus ni moins.
  assert.equal(j.lignes.length, scenarios.length, `huit traces attendues, vues : ${j.lignes.length}`);

  // Et chaque scénario a produit SON événement, dans l'ordre.
  for (const [i, scenario] of scenarios.entries()) {
    assert.ok(
      j.lignes[i].startsWith(`${OFF_CIQUAL_TAG} ${scenario.evenement}`),
      `scénario ${scenario.evenement} : trace inattendue « ${j.lignes[i]} »`,
    );
  }

  const INTERDITS = [
    UA_SECRET,
    "SethTest",
    "secret-a-ne-jamais-journaliser",
    "openfoodfacts.org",
    "categories_properties_tags",
    "page_size",
    "User-Agent",
    "Authorization",
    "Bearer",
    "cookie",
    "apikey",
    "supabase",
  ];
  for (const ligne of j.lignes) {
    for (const interdit of INTERDITS) {
      assert.ok(
        !ligne.toLowerCase().includes(interdit.toLowerCase()),
        `la trace « ${ligne} » contient « ${interdit} »`,
      );
    }
  }
});

await test("C4.1b-11 — le journal n'est JAMAIS appelé avec l'URL ni les en-têtes, par lecture du source", () => {
  // ⚠️ CONTRÔLE DE SOURCE ASSUMÉ, EN COMPLÉMENT DU COMPORTEMENT. Les tests
  // ci-dessus prouvent que les traces observées sont propres ; celui-ci
  // interdit qu'une future ligne journalise `url` ou `entete` — deux
  // variables qui existent dans la fonction et qu'il serait tentant d'ajouter.
  // Six APPELS pour huit événements : le premier `catch` choisit entre
  // `timeout` et `fetch_error`, le dernier entre `invalid_envelope` et
  // `unexpected_error`.
  const appels = CODE_SEUL.match(/journal\([\s\S]*?\);/g) ?? [];
  assert.ok(appels.length >= 6, `au moins six appels au journal attendus, vus : ${appels.length}`);
  for (const appel of appels) {
    for (const variable of ["url", "entete", "headers"]) {
      assert.ok(
        !new RegExp(`\\b${variable}\\b`).test(appel),
        `un appel au journal nomme « ${variable} » : ${appel.slice(0, 120)}`,
      );
    }
    // ⚠️ `signal` MÉRITE UNE RÈGLE PLUS FINE QU'UNE INTERDICTION, et c'est un
    // resserrement, pas un relâchement. Journaliser l'OBJET signal serait
    // opaque et inutile ; journaliser `controleur.signal.aborted` est un
    // BOOLÉEN, et c'est précisément ce qui distingue un timeout que nous avons
    // provoqué d'un abandon que nous avons subi. On autorise donc cette forme
    // EXACTE, et elle seule.
    for (const mention of appel.match(/[A-Za-z_.]*\bsignal\b[A-Za-z_.]*/g) ?? []) {
      assert.equal(
        mention,
        "controleur.signal.aborted",
        `seul « controleur.signal.aborted » est admis dans une trace, vu : ${mention}`,
      );
    }
    assert.ok(
      !/erreur\.message|\.message\b/.test(appel),
      `un appel au journal utilise le MESSAGE d'une exception : ${appel.slice(0, 120)}`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   D — C4.1b-PERIMETRE : OBSERVABILITÉ SEULE
   ══════════════════════════════════════════════════════════════════════════ */

await test("C4.1b-PERIMETRE — le contrat de C4.1 est intact", () => {
  // Le délai n'a pas bougé.
  assert.match(SOURCE, /options\.timeoutMs \?\? OFF_TIMEOUT_MS/, "le délai reste celui de C4.1");
  // Les paramètres sortants n'ont pas bougé.
  assert.match(SOURCE, /page_size: String\(CIQUAL_TAILLE_PAGE\)/);
  assert.match(SOURCE, /page: "1"/);
  assert.match(SOURCE, /countries_tags_en: CIQUAL_PAYS/);
  assert.match(SOURCE, /categories_properties_tags: `\$\{CIQUAL_TAG_PREFIX\}\$\{code\}`/);
  // Les trois codes d'erreur sont toujours les seuls levés.
  const codes = [...SOURCE.matchAll(/new OffErreur\(\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(codes)].sort(),
    ["OFF_INVALID_RESPONSE", "OFF_RATE_LIMITED", "OFF_UNAVAILABLE"],
    "aucun nouveau code d'erreur",
  );
  // ⚠️ AUCUN REPLI PAR NOM, AUCUN SECOND FOURNISSEUR : C4.1b n'élargit rien.
  for (const mot of ["search.openfoodfacts.org", "nominatim", "google", "fuzzy", "levenshtein"]) {
    assert.ok(!CODE_SEUL.toLowerCase().includes(mot), `le CODE de l'adaptateur nomme ${mot}`);
  }
});

/**
 * Harnais — STABILISATION B1 et B2.
 *
 * Ce que ce fichier prouve, et comment :
 *
 *  1. B2 — la migration 20261119090000 révoque `anon` sur les TROIS fonctions
 *     ajoutées par M1, avec les signatures d'identité exactes, et retire en
 *     plus `authenticated` de la seule fonction qu'aucun code applicatif
 *     n'appelle. Les signatures ne sont pas recopiées à la main : elles sont
 *     relues dans M1 et comparées.
 *  2. B1 — la migration 20261119091000 remplace l'expression de découpage de
 *     `get_my_coach_public_profile` et la nouvelle ne peut plus rendre deux
 *     fois un nom sans espace. Le contrat des trois cas (composé, un seul mot,
 *     vide) est figé.
 *  3. La CHAÎNE APPLICATIVE est rejouée POUR DE VRAI, avec les fonctions
 *     importées de `lib/ics-intitules.ts` et la recomposition exacte de
 *     `lib/supabase/appointments.ts:170`, sur les sorties MESURÉES de la RPC
 *     avant et après correction.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Aucune base n'est touchée. La sémantique
 * SQL réelle — l'ACL obtenue et le découpage rendu par la fonction installée —
 * est vérifiée par `supabase/tests/stabilisation_b1_b2_checklist.sql`, qui
 * s'exécute sur une base de test et finit par un ROLLBACK. Les sorties de RPC
 * utilisées ci-dessous sont celles MESURÉES sur PostgreSQL 16.15 le 19/11/2026,
 * pas des valeurs supposées.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/stabilisation-b1-b2.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { construireIntituleIcs, formaterIdentiteCoach, INTITULE_SECOURS_ELEVE } from "../../lib/ics-intitules";

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

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ⚠️ LES ASSERTIONS D'ABSENCE SE FONT SUR LE CODE, PAS SUR LA PROSE. Les deux
 * migrations CITENT en commentaire l'expression fautive qu'elles suppriment et
 * les ACL qu'elles ferment. Chercher ces chaînes dans le texte brut les
 * trouverait dans les commentaires et rendrait l'assertion toujours verte.
 */
function sansCommentairesSql(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}
/** Espaces, retours à la ligne et tabulations réduits à un espace unique. */
function aplati(source: string): string {
  return source.replace(/\s+/g, " ");
}

const MIGRATION_B2 = "../../supabase/migrations/20261119090000_b2_revoquer_anon_fonctions_m1.sql";
const MIGRATION_B1 = "../../supabase/migrations/20261119091000_b1_decoupage_nom_coach.sql";
const MIGRATION_M1 = "../../supabase/migrations/20261115090000_lot1_multi_coach_ajout.sql";
const MIGRATION_ORIGINE_RPC = "../../supabase/migrations/20260726220000_fix_profiles_role_escalation.sql";
const MIGRATION_PRECEDENT_ACL = "../../supabase/migrations/20260726121000_calendar_atomic_booking.sql";

const B2 = lire(MIGRATION_B2);
const B2_CODE = aplati(sansCommentairesSql(B2));
const B1 = lire(MIGRATION_B1);
const B1_CODE = aplati(sansCommentairesSql(B1));
const M1_CODE = aplati(sansCommentairesSql(lire(MIGRATION_M1)));
const APPOINTMENTS = lire("../../lib/supabase/appointments.ts");
const INTITULES = lire("../../lib/ics-intitules.ts");

/* ════════════════════════════════════════════════════════════════════════════
 * B2 — LES PRIVILÈGES
 * ════════════════════════════════════════════════════════════════════════════ */

/** Les trois signatures d'identité, telles que relevées en base le 19/11/2026. */
const SIGNATURES = {
  conflit: "public.calendar_has_conflict_pour_coach( uuid, timestamptz, timestamptz, uuid, uuid )",
  eleve: "public.reserver_creneau_eleve( uuid, timestamptz, timestamptz, text )",
  staff: "public.creer_rendez_vous_staff( uuid, text, text, text, timestamptz, timestamptz, text, text, text, text )",
} as const satisfies Record<"conflit" | "eleve" | "staff", string>;

await test("ACL-01 — `anon` est révoqué NOMMÉMENT sur les trois fonctions", () => {
  for (const [cle, signature] of Object.entries(SIGNATURES)) {
    assert.ok(
      B2_CODE.includes(`revoke execute on function ${signature} from anon;`),
      `la révocation de anon manque pour ${cle} (${signature})`,
    );
  }
});

await test("ACL-02 — `authenticated` perd la fonction de conflit, et RIEN D'AUTRE", () => {
  assert.ok(
    B2_CODE.includes(`revoke execute on function ${SIGNATURES.conflit} from authenticated;`),
    "authenticated doit perdre calendar_has_conflict_pour_coach",
  );
  /*
   * ⚠️ L'ASSERTION QUI COMPTE EST CELLE DE L'ABSENCE. Révoquer `authenticated`
   * sur les deux RPC de réservation casserait le parcours élève et la création
   * staff : ce sont les deux seules fonctions de ce lot appelées depuis le
   * navigateur.
   */
  for (const signature of [SIGNATURES.eleve, SIGNATURES.staff]) {
    assert.equal(
      B2_CODE.includes(`revoke execute on function ${signature} from authenticated;`),
      false,
      `authenticated ne doit PAS perdre ${signature}`,
    );
  }
});

await test("ACL-03 — `service_role` ne perd rien", () => {
  assert.equal(/revoke[^;]*from[^;]*service_role/.test(B2_CODE), false, "aucune révocation ne doit viser service_role");
});

await test("ACL-04 — aucune réattribution à `anon` ne vient défaire la révocation", () => {
  assert.equal(/grant[^;]*to[^;]*\banon\b/.test(B2_CODE), false, "la migration ne doit rien accorder à anon");
});

await test("ACL-05 — aucun corps de fonction n'est touché", () => {
  assert.equal(
    /create\s+(or\s+replace\s+)?function/.test(B2_CODE),
    false,
    "la migration B2 ne doit contenir aucun create/replace de fonction",
  );
});

await test("ACL-06 — aucune donnée n'est touchée", () => {
  for (const verbe of ["insert into", "update public.", "delete from", "truncate"]) {
    assert.equal(B2_CODE.includes(verbe), false, `la migration B2 ne doit contenir aucun \`${verbe}\``);
  }
});

await test("ACL-07 — les signatures utilisées sont CELLES DE M1, pas une recopie approximative", () => {
  /*
   * ⚠️ ON COMPARE À LA SOURCE, PAS À UNE CONSTANTE DE TEST. Si M1 changeait une
   * signature, une révocation écrite sur l'ancienne porterait dans le vide et
   * PostgreSQL lèverait `function … does not exist` — mais seulement à
   * l'application. Ici, le désaccord rougit avant.
   */
  const attendues = {
    conflit: "public.calendar_has_conflict_pour_coach(uuid, timestamptz, timestamptz, uuid, uuid)",
    eleve: "public.reserver_creneau_eleve(uuid, timestamptz, timestamptz, text)",
  } as const;
  for (const [cle, signature] of Object.entries(attendues)) {
    assert.ok(M1_CODE.includes(signature), `M1 ne déclare plus ${cle} avec la signature ${signature}`);
  }
  // `creer_rendez_vous_staff` est écrite sur plusieurs lignes dans M1 : on
  // compare la liste de types, aplatie, telle que M1 l'énumère.
  assert.ok(
    M1_CODE.includes(
      "public.creer_rendez_vous_staff( uuid, text, text, text, timestamptz, timestamptz, text, text, text, text )",
    ),
    "M1 ne déclare plus creer_rendez_vous_staff avec ses dix paramètres dans cet ordre",
  );
});

await test("ACL-08 — la migration porte une garde d'arrivée sur les TROIS rôles", () => {
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.ok(
      B2_CODE.includes(`has_function_privilege('${role}'`),
      `la garde d'arrivée doit interroger le rôle ${role}`,
    );
  }
  assert.ok(B2_CODE.includes("raise exception"), "la garde doit refuser, pas seulement constater");
});

await test("ACL-09 — aucun code applicatif n'appelle la fonction de conflit", () => {
  /*
   * C'est la MESURE qui autorise à retirer `authenticated`. Relevé du
   * 19/11/2026 : zéro occurrence dans app/, lib/ et components/. Ses seuls
   * appelants sont les trois RPC `SECURITY DEFINER` de M1, dont l'appel interne
   * ne consulte pas l'ACL de l'appelant.
   */
  const appels = [
    ...APPOINTMENTS.matchAll(/\.rpc\(\s*"calendar_has_conflict_pour_coach"/g),
    ...INTITULES.matchAll(/calendar_has_conflict_pour_coach/g),
  ];
  assert.deepEqual(appels.map((m) => m[0]), [], "un appel applicatif est apparu : la révocation casserait ce parcours");
  /*
   * Et M1 l'appelle bien TROIS fois, depuis ses trois RPC.
   *
   * ⚠️ ON COMPTE LES APPELS, PAS LES MENTIONS. Une première rédaction de cette
   * assertion comptait toutes les occurrences de
   * `public.calendar_has_conflict_pour_coach(` et attendait 4 (la déclaration
   * plus trois appels) : elle en trouvait 6, parce que le `revoke` et le
   * `grant` de M1 citent eux aussi la signature. Les appels internes, eux,
   * s'écrivent tous `if public.…(`.
   */
  assert.equal(
    (M1_CODE.match(/if public\.calendar_has_conflict_pour_coach\(/g) ?? []).length,
    3,
    "M1 doit appeler la fonction de conflit depuis ses trois RPC",
  );
  assert.ok(
    M1_CODE.includes("create or replace function public.calendar_has_conflict_pour_coach("),
    "M1 doit toujours déclarer la fonction de conflit",
  );
});

await test("ACL-10 — les deux RPC de réservation sont bien appelées sous `authenticated`", () => {
  /*
   * Symétrique d'ACL-09 : si ces appels disparaissaient, retirer
   * `authenticated` deviendrait légitime — et le laisser le serait moins. Les
   * deux assertions se tiennent ensemble.
   */
  const code = sansCommentairesTs(APPOINTMENTS);
  assert.ok(code.includes('.rpc("reserver_creneau_eleve"'), "l'appel navigateur à reserver_creneau_eleve a disparu");
  assert.ok(code.includes('.rpc("creer_rendez_vous_staff"'), "l'appel navigateur à creer_rendez_vous_staff a disparu");
});

await test("ACL-11 — la convention suivie est celle de 20260726121000", () => {
  const precedent = aplati(sansCommentairesSql(lire(MIGRATION_PRECEDENT_ACL)));
  assert.ok(
    precedent.includes("revoke execute on function public.calendar_has_conflict(timestamptz, timestamptz, uuid, uuid) from anon, authenticated;"),
    "le précédent de référence a changé : revérifier la convention avant de s'y appuyer",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * B1 — LE DÉCOUPAGE DU NOM
 * ════════════════════════════════════════════════════════════════════════════ */

await test("TEXTE-B1-01 — la RPC est redéfinie, avec la même signature et le même périmètre", () => {
  assert.ok(B1_CODE.includes("create or replace function public.get_my_coach_public_profile()"));
  for (const invariant of [
    "returns table ( coach_id uuid, first_name text, last_name text, specialty text )",
    "security definer",
    "set search_path = public",
    "where s.user_id = auth.uid() and auth.uid() is not null",
    "limit 1",
  ]) {
    assert.ok(B1_CODE.includes(invariant), `l'invariant « ${invariant} » a disparu de la RPC`);
  }
});

await test("TEXTE-B1-02 — l'expression fautive a disparu du CODE", () => {
  /*
   * ⚠️ LA FAUTE EXACTE : `substr(…, strpos(…) + 1)` SANS test préalable de
   * `strpos`. Quand le séparateur est absent, `strpos` rend 0 et `substr(x, 1)`
   * rend la chaîne entière. La migration d'origine la cite en commentaire :
   * l'assertion porte donc sur le code nu.
   */
  assert.equal(
    B1_CODE.includes("nullif(trim(substr(coalesce(c.name, ''), strpos(coalesce(c.name, ''), ' ') + 1)), '') as last_name"),
    false,
    "l'ancienne expression de patronyme est encore dans le corps",
  );
  // Et elle est toujours bien celle de la migration d'origine : si cette
  // dernière changeait, cette assertion ne prouverait plus rien.
  const origine = aplati(sansCommentairesSql(lire(MIGRATION_ORIGINE_RPC)));
  assert.ok(
    origine.includes("nullif(trim(substr(coalesce(c.name, ''), strpos(coalesce(c.name, ''), ' ') + 1)), '') as last_name"),
    "la migration d'origine ne porte plus l'expression fautive : revérifier B1",
  );
});

await test("TEXTE-B1-03 — le patronyme est conditionné à l'existence du séparateur", () => {
  assert.match(
    B1_CODE,
    /case when strpos\(nom\.valeur, ' '\) = 0 then null else nullif\(trim\(substr\(nom\.valeur, strpos\(nom\.valeur, ' '\) \+ 1\)\), ''\) end as last_name/,
    "le garde-fou `strpos = 0 then null` est absent du corps",
  );
  assert.ok(B1_CODE.includes("btrim(coalesce(c.name, '')) as valeur"), "le nom doit être débarrassé de ses espaces de bord");
});

await test("TEXTE-B1-04 — la garde d'arrivée utilise LA MÊME expression que le corps", () => {
  /*
   * ⚠️ UNE GARDE QUI TESTE AUTRE CHOSE QUE LE CORPS NE PROUVE RIEN. Les deux
   * expressions sont écrites deux fois dans la migration — une fois dans la
   * fonction, une fois dans le bloc `do` qui la vérifie. Cette assertion fige
   * leur correspondance ; sans elle, le corps pourrait régresser en laissant la
   * garde verte.
   */
  const occurrences = B1_CODE.match(/strpos\((nom\.valeur|v_valeur), ' '\) = 0 then null/g) ?? [];
  assert.ok(
    occurrences.length >= 2,
    `le corps et la garde doivent porter la même condition (${occurrences.length} occurrence(s) trouvée(s))`,
  );
  assert.ok(B1_CODE.includes("raise exception"), "la garde doit refuser, pas seulement constater");
});

await test("TEXTE-B1-05 — aucune règle `first_name === last_name` n'a été introduite", () => {
  /*
   * ⚠️ RÈGLE EXPLICITEMENT ÉCARTÉE. Elle effacerait le patronyme des homonymes
   * réels — « Doublon Doublon ». La correction est dans la RPC, pas dans une
   * comparaison des deux champs.
   */
  const code = sansCommentairesTs(APPOINTMENTS);
  assert.equal(/first_name\s*===\s*\w*\.?last_name/.test(code), false, "une comparaison des deux champs est apparue");
  assert.equal(/last_name\s*===\s*\w*\.?first_name/.test(code), false, "une comparaison des deux champs est apparue");
});

await test("TEXTE-B1-06 — la migration B1 ne touche aucune donnée et n'invente aucune identité", () => {
  for (const verbe of ["insert into", "update public.", "delete from", "truncate"]) {
    assert.equal(B1_CODE.includes(verbe), false, `la migration B1 ne doit contenir aucun \`${verbe}\``);
  }
  // Aucune identité déduite d'une adresse : ni email, ni split sur '@'.
  assert.equal(/c\.email|'@'/.test(B1_CODE), false, "aucune identité ne doit être dérivée d'une adresse électronique");
  /*
   * ⚠️ AUCUNE IDENTITÉ RÉELLE, NI DANS LE CODE NI DANS LES COMMENTAIRES. Une
   * migration part au dépôt et à la production ; le nom de remplacement proposé
   * pour `coaches.name` relève d'une opération de DONNÉE, présentée à part.
   *
   * Cette assertion a servi : sa première version ne regardait que le code nu
   * et a tout de même rougi, parce que le bloc de garde portait un nom réel
   * dans ses cas d'essai. Les cas sont depuis fictifs — « Alpha Beta »,
   * « Doublon Doublon », « Monomot », « identifiant.sans.espace » — et la
   * portée de l'assertion a été élargie au FICHIER ENTIER.
   */
  /*
   * ⚠️ AUCUNE IDENTITÉ RÉELLE, NULLE PART — ni dans la migration, ni dans la
   * checklist, ni dans ce harnais. La revue du 19/11/2026 a relevé 11
   * occurrences du nom du coach et de son adresse technique dans la checklist,
   * et 8 dans ce fichier. Elles ont été remplacées par des exemples
   * synthétiques, et l'assertion couvre désormais les TROIS fichiers : c'est la
   * CLASSE de problème qui doit être reproduite, jamais l'identité.
   */
  const FICHIERS_DU_LOT = {
    "migration B1": B1,
    "migration B2": B2,
    checklist: lire("../../supabase/tests/stabilisation_b1_b2_checklist.sql"),
    "ce harnais": lire("./stabilisation-b1-b2.mts"),
  } as const;
  /*
   * ⚠️ LES MOTIFS SONT ASSEMBLÉS PAR FRAGMENTS, ET CE N'EST PAS UNE COQUETTERIE.
   * Écrits en clair, ils figureraient dans CE fichier — qui fait partie des
   * fichiers contrôlés : l'assertion se dénoncerait elle-même et serait
   * éternellement rouge. Les fragments font que le motif n'existe qu'à
   * l'exécution. La comparaison est insensible à la casse, pour attraper aussi
   * la forme criée que produisait la duplication.
   */
  const IDENTITES_INTERDITES = [
    ["ju", "les"],
    ["fav", "ier"],
    ["53c7", "6658"],
    ["f5df", "a5ae"],
  ].map((fragments) => fragments.join(""));
  for (const [ou, contenu] of Object.entries(FICHIERS_DU_LOT)) {
    const minuscules = contenu.toLowerCase();
    for (const identite of IDENTITES_INTERDITES) {
      assert.equal(
        minuscules.includes(identite),
        false,
        `une identité réelle (fragment « ${identite} ») figure dans ${ou}, commentaires compris`,
      );
    }
  }
  // Et la classe de problème reste couverte, sur une valeur synthétique.
  assert.equal(
    titreEleve("identifiant.sans.espace", "identifiant.sans.espace"),
    "Séance de coaching — identifiant.sans.espace IDENTIFIANT.SANS.ESPACE",
    "la duplication d'un nom sans espace doit rester reproduite quelque part",
  );
});

await test("TEXTE-B1-07 — la recomposition applicative est INCHANGÉE", () => {
  /*
   * La correction est volontairement dans la RPC seule. Si quelqu'un modifiait
   * aussi `appointments.ts`, il y aurait deux corrections pour un défaut, et
   * l'une des deux deviendrait du code mort invérifiable.
   */
  assert.ok(
    sansCommentairesTs(APPOINTMENTS).includes(
      'const nom = [ligne.first_name, ligne.last_name].filter(Boolean).join(" ").trim();',
    ),
    "la ligne de recomposition a changé : la correction n'est plus au seul endroit prévu",
  );
});

/* ════════════════════════════════════════════════════════════════════════════
 * LA CHAÎNE APPLICATIVE, REJOUÉE SUR LES SORTIES MESURÉES DE LA RPC
 * ════════════════════════════════════════════════════════════════════════════ */

const SECOURS_NOM_COACH = "Ton coach";

/** Recomposition exacte de `lib/supabase/appointments.ts` l. 157-158. */
function recomposer(first: string | null, last: string | null): string {
  const nom = [first, last].filter(Boolean).join(" ").trim();
  return nom || SECOURS_NOM_COACH;
}
/** Titre tel que l'élève le télécharge, propriétaire connu. */
function titreEleve(first: string | null, last: string | null): string {
  return construireIntituleIcs({
    destinataire: "eleve",
    identiteEleve: "",
    identiteCoach: formaterIdentiteCoach(recomposer(first, last)),
  });
}

/**
 * Sorties MESURÉES de la RPC corrigée, sur PostgreSQL 16.15, le 19/11/2026.
 * Chaque ligne est un couple (first_name, last_name) rendu par la fonction.
 */
const APRES_CORRECTION = [
  { nom: "Alpha Beta", rpc: ["Alpha", "Beta"], titre: "Séance de coaching — Alpha BETA" },
  { nom: "Alpha-Beta Gamma Delta", rpc: ["Alpha-Beta", "Gamma Delta"], titre: "Séance de coaching — Alpha-Beta GAMMA DELTA" },
  { nom: "Monomot", rpc: ["Monomot", null], titre: "Séance de coaching — Monomot" },
  { nom: "Doublon Doublon", rpc: ["Doublon", "Doublon"], titre: "Séance de coaching — Doublon DOUBLON" },
  { nom: "identifiant.sans.espace", rpc: ["identifiant.sans.espace", null], titre: "Séance de coaching — identifiant.sans.espace" },
  { nom: "(vide)", rpc: [null, null], titre: "Séance de coaching — Ton COACH" },
] as const satisfies readonly { nom: string; rpc: readonly [string | null, string | null]; titre: string }[];

await test("CHAINE-01 — chaque sortie de la RPC corrigée produit le titre attendu", () => {
  for (const cas of APRES_CORRECTION) {
    assert.equal(titreEleve(cas.rpc[0], cas.rpc[1]), cas.titre, `titre inattendu pour ${cas.nom}`);
  }
});

await test("CHAINE-02 — le nom d'un seul mot n'est plus jamais crié en double", () => {
  for (const cas of APRES_CORRECTION) {
    const [first, last] = cas.rpc;
    if (last !== null) continue;
    assert.equal(
      cas.titre.includes(String(first).toLocaleUpperCase("fr-FR")),
      false,
      `le titre de ${cas.nom} contient encore une version criée du prénom`,
    );
  }
});

await test("CHAINE-03 — l'homonymie réelle garde son patronyme", () => {
  /*
   * ⚠️ C'EST LA CONTRAINTE QUI INTERDIT LA RÈGLE `first === last`. « Doublon
   * Doublon » doit rester deux champs, et le titre doit porter le patronyme en
   * majuscules comme n'importe quel autre nom composé. Une personne peut
   * réellement porter deux fois le même nom ; c'est pour elle que la règle a
   * été écartée.
   */
  assert.equal(titreEleve("Doublon", "Doublon"), "Séance de coaching — Doublon DOUBLON");
  assert.equal(recomposer("Doublon", "Doublon"), "Doublon Doublon");
});

await test("CHAINE-04 — le secours reste strictement identique à l'avant-correction", () => {
  /*
   * Mesuré : l'ancienne RPC rendait `('', NULL)` pour un nom vide, la nouvelle
   * rend `(NULL, NULL)`. `filter(Boolean)` écarte `''` comme `null` : la
   * recomposition est vide dans les deux cas, donc le repli est le même.
   */
  assert.equal(recomposer("", null), SECOURS_NOM_COACH);
  assert.equal(recomposer(null, null), SECOURS_NOM_COACH);
  assert.equal(titreEleve("", null), titreEleve(null, null));
});

await test("CHAINE-05 — un propriétaire inconnu reste l'intitulé de secours du lot 2", () => {
  assert.equal(
    construireIntituleIcs({ destinataire: "eleve", identiteEleve: "", identiteCoach: "" }),
    INTITULE_SECOURS_ELEVE,
  );
  assert.equal(INTITULE_SECOURS_ELEVE, "Séance de coaching — coach non identifié");
});

/* ════════════════════════════════════════════════════════════════════════════
 * CONTRE-ÉPREUVES — chaque test ci-dessus doit pouvoir rougir
 * ════════════════════════════════════════════════════════════════════════════ */

await test("CONTRE-B2-01 — un `revoke all … from public` au lieu de `from anon` : ACL-01 rougit", () => {
  const abime = B2_CODE.replace(
    `revoke execute on function ${SIGNATURES.eleve} from anon;`,
    `revoke all on function ${SIGNATURES.eleve} from public;`,
  );
  assert.equal(
    abime.includes(`revoke execute on function ${SIGNATURES.eleve} from anon;`),
    false,
    "la contre-épreuve n'a rien remplacé : ACL-01 ne prouverait rien",
  );
});

await test("CONTRE-B2-02 — une signature approximative : ACL-01 rougit", () => {
  /*
   * ⚠️ LE DANGER EST SILENCIEUX EN APPARENCE SEULEMENT. Une signature fausse
   * fait lever `function … does not exist` à l'application — mais on ne
   * l'apprendrait qu'au déploiement. Ici, le texte diverge et le test le voit.
   */
  const approximative = SIGNATURES.staff.replace(", text )", " )");
  assert.equal(
    B2_CODE.includes(`revoke execute on function ${approximative} from anon;`),
    false,
    "une signature à neuf paramètres ne doit pas satisfaire l'assertion",
  );
});

await test("CONTRE-B2-03 — `authenticated` révoqué sur la réservation élève : ACL-02 rougit", () => {
  const abime = `${B2_CODE} revoke execute on function ${SIGNATURES.eleve} from authenticated;`;
  assert.ok(
    abime.includes(`revoke execute on function ${SIGNATURES.eleve} from authenticated;`),
    "la contre-épreuve doit effectivement introduire la révocation fautive",
  );
});

await test("CONTRE-B1-01 — l'ancienne sortie de RPC reproduit le défaut observé sur Apple", () => {
  /*
   * ⚠️ LA PREUVE QUE LA CHAÎNE DE TESTS DÉTECTE BIEN B1. L'ANCIENNE RPC rendait
   * DEUX FOIS tout nom sans espace — mesuré sur la base jetable le 19/11/2026,
   * en réinstallant l'expression de 20260726220000 :
   *   ('identifiant.sans.espace', 'identifiant.sans.espace')
   * La chaîne applicative, inchangée, en tire un titre où le même mot est écrit
   * deux fois, la seconde en majuscules. C'est la forme exacte du titre constaté
   * dans Apple Calendrier, reproduite sur une valeur SYNTHÉTIQUE : c'est la
   * classe de problème qui est figée ici, pas l'identité du coach.
   */
  assert.equal(
    titreEleve("identifiant.sans.espace", "identifiant.sans.espace"),
    "Séance de coaching — identifiant.sans.espace IDENTIFIANT.SANS.ESPACE",
  );
  // Et la correction change bien ce titre-là, pas un autre.
  assert.notEqual(
    titreEleve("identifiant.sans.espace", null),
    titreEleve("identifiant.sans.espace", "identifiant.sans.espace"),
  );
});

await test("CONTRE-B1-02 — le défaut touchait TOUT nom d'un seul mot", () => {
  /*
   * Le défaut n'était pas propre à une adresse technique : un prénom seul y
   * passait aussi. Mesuré sur l'ancienne expression : ('Monomot', 'Monomot').
   */
  assert.equal(titreEleve("Monomot", "Monomot"), "Séance de coaching — Monomot MONOMOT");
  assert.equal(titreEleve("Monomot", null), "Séance de coaching — Monomot");
});

await test("CONTRE-B1-03 — un corps sans le `case` laisserait TEXTE-B1-03 rouge", () => {
  const abime = B1_CODE.replace(
    /case when strpos\(nom\.valeur, ' '\) = 0 then null else (nullif\(trim\(substr\(nom\.valeur, strpos\(nom\.valeur, ' '\) \+ 1\)\), ''\)) end as last_name/,
    "$1 as last_name",
  );
  assert.equal(
    /case when strpos\(nom\.valeur, ' '\) = 0 then null/.test(abime),
    false,
    "la contre-épreuve n'a pas retiré le garde-fou : TEXTE-B1-03 ne prouverait rien",
  );
});

await test("CONTRE-B1-04 — la règle `first === last` casserait l'homonymie", () => {
  /*
   * Démonstration chiffrée du motif de refus de cette règle : appliquée, elle
   * transformerait « Doublon DOUBLON » en « Doublon », donc effacerait un vrai
   * patronyme. La RPC corrigée, elle, ne touche pas ce cas.
   */
  const regleRefusee = (first: string, last: string) => (first === last ? first : `${first} ${last}`);
  assert.equal(regleRefusee("Doublon", "Doublon"), "Doublon");
  assert.notEqual(regleRefusee("Doublon", "Doublon"), recomposer("Doublon", "Doublon"));
});

/* ════════════════════════════════════════════════════════════════════════════
 * LE DISPOSITIF DE VÉRIFICATION LUI-MÊME
 *
 * ⚠️ CES CONTRÔLES EXISTENT PARCE QUE LA CHECKLIST NE S'EXÉCUTAIT PAS. Revue du
 * 19/11/2026 : son insert d'élève omettait `first_name` et `last_name`, `not
 * null` sans défaut sur `public.students`, et son contrôle du nom NUL tentait
 * d'insérer `coaches.name = null`, également `not null`. Les deux défauts
 * venaient d'un décor écrit à la main, plus permissif que le schéma réel. Ce
 * sont donc le FICHIER de checklist et le BANC qui sont figés ici.
 * ════════════════════════════════════════════════════════════════════════════ */

const CHECKLIST = lire("../../supabase/tests/stabilisation_b1_b2_checklist.sql");
const CHECKLIST_CODE = aplati(sansCommentairesSql(CHECKLIST));
const BANC = lire("./sql/b1b2-base-jetable.sh");

await test("DISPO-01 — l'insert d'élève renseigne les colonnes obligatoires du schéma réel", () => {
  /*
   * Les colonnes `not null` SANS défaut sont relevées sur le baseline, pas
   * supposées : `students.first_name`, `students.last_name`, `coaches.name`.
   * `status` s'y ajoute pour une autre raison, vérifiée juste après.
   */
  assert.match(
    CHECKLIST_CODE,
    /insert into public\.students \(user_id, coach_id, first_name, last_name, status\)/,
    "l'insert d'élève doit nommer first_name, last_name et status",
  );
  assert.match(
    CHECKLIST_CODE,
    /insert into public\.coaches \(name, user_id, status\)/,
    "l'insert de coach doit nommer name",
  );
});

await test("DISPO-02 — le défaut incohérent de `students.status` est pris en compte", () => {
  /*
   * ⚠️ ANOMALIE DU SCHÉMA, ANTÉRIEURE À CE CHANTIER, ET MESURÉE. Le baseline
   * déclare `status text default 'actif' not null` avec
   * `students_status_check check (status in ('active','paused','completed'))` :
   * le défaut VIOLE sa propre contrainte, donc tout insert qui omet `status`
   * échoue. La checklist le fournit explicitement. Si le baseline était un jour
   * corrigé, ce test rougirait et inviterait à relire — c'est voulu.
   */
  const baseline = lire("../../supabase/baseline/00_baseline_remote_schema.sql");
  assert.ok(
    baseline.includes(`"status" "text" DEFAULT 'actif'::"text" NOT NULL`),
    "le défaut de students.status a changé dans le baseline : relire DISPO-02",
  );
  assert.ok(
    baseline.includes(`CONSTRAINT "students_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'completed'::"text"])))`),
    "la contrainte students_status_check a changé : relire DISPO-02",
  );
  assert.match(CHECKLIST_CODE, /'active'\)/, "la checklist doit fournir un status valide au regard du CHECK");
});

await test("DISPO-03 — aucun insert de `coaches.name` nul : la contrainte est contrôlée à la place", () => {
  // Le test impossible a disparu…
  assert.equal(
    /b1b2_decoupage\(\s*null\s*\)/.test(CHECKLIST_CODE),
    false,
    "la checklist ne doit plus tenter d'insérer un coach au nom NULL",
  );
  // …et il est remplacé par un contrôle de la contrainte réelle.
  assert.match(
    CHECKLIST_CODE,
    /from information_schema\.columns where table_schema = 'public' and table_name = 'coaches' and column_name = 'name'/,
    "le contrôle de la contrainte coaches.name NOT NULL est absent",
  );
  assert.match(CHECKLIST_CODE, /if v_nullable <> 'NO' then/, "le contrôle doit rougir si la colonne devient nullable");
  // Et la défense en profondeur reste exigée dans le corps de la RPC.
  assert.ok(CHECKLIST_CODE.includes("coalesce(c.name"), "la checklist doit exiger le coalesce du corps");
});

await test("DISPO-04 — une RPC sans résultat est distinguée d'un nom vide", () => {
  /*
   * A7 : `select … into` laisse les variables à NULL quand aucune ligne ne
   * remonte. Sans contrôle de `found`, « coach au nom vide » et « session
   * absente » donnaient le même symptôme.
   */
  assert.match(CHECKLIST_CODE, /if not found then/, "le contrôle de FOUND est absent de b1b2_decoupage");
  assert.ok(CHECKLIST_CODE.includes("B1-00"), "l'échec de session doit porter son propre code de cas");
  assert.ok(
    CHECKLIST.includes("session, jointure students/coaches ou auth.uid() en cause"),
    "le message doit nommer la cause réelle, pas le découpage",
  );
  // Et un cas dédié l'exerce à chaque exécution.
  assert.ok(CHECKLIST_CODE.includes("B1-10"), "le cas « absence de session » doit être exercé");
});

await test("DISPO-05 — une session vide s'efface, elle ne se fabrique pas avec un `sub` vide", () => {
  /*
   * ⚠️ MESURÉ SUR LE BANC JETABLE. `{"sub": ""}` fait lever
   * `invalid input syntax for type uuid: ""` à `auth.uid()` : ce n'est pas
   * « pas de session », c'est une session malformée. La première version de la
   * checklist en souffrait, et le banc l'a attrapée.
   */
  assert.match(
    CHECKLIST_CODE,
    /if p_user is null then perform set_config\('request\.jwt\.claims', '', true\);/,
    "b1b2_endosser doit effacer le réglage quand aucun élève n'est endossé",
  );
  assert.equal(
    /json_build_object\('sub', coalesce\(p_user::text, ''\)/.test(CHECKLIST_CODE),
    false,
    "le `sub` vide est de retour : auth.uid() lèvera une erreur de cast",
  );
});

await test("DISPO-06 — la checklist se termine par ROLLBACK et ne contient aucun COMMIT", () => {
  const instructions = sansCommentairesSql(CHECKLIST)
    .split(/\s+/)
    .filter((m) => m.length > 0);
  assert.equal(instructions[instructions.length - 1], "rollback;", "la dernière instruction doit être rollback;");
  assert.equal(/(^|\s)commit\s*;/i.test(sansCommentairesSql(CHECKLIST)), false, "aucun commit dans une checklist");
});

await test("DISPO-07 — le banc SQL jetable existe, et il n'utilise aucun identifiant de production", () => {
  assert.ok(BANC.includes("unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE"), "le banc doit effacer les variables de connexion");
  assert.ok(BANC.includes("DATABASE_URL SUPABASE_DB_URL"), "le banc doit aussi effacer les URL de base");
  assert.ok(BANC.includes("listen_addresses=''"), "le cluster jetable ne doit écouter aucun port TCP");
  assert.ok(BANC.includes("$BIN/initdb"), "le banc doit créer son propre cluster");
  assert.ok(BANC.includes("rm -rf \"$TMP\""), "le banc doit détruire son cluster");
  // Il applique les deux migrations, exécute la checklist et rejoue les contre-épreuves.
  for (const attendu of ["MIGRATION_B2", "MIGRATION_B1", "CHECKLIST", "contre_epreuve", "aucun résidu"]) {
    assert.ok(BANC.includes(attendu), `le banc doit comporter « ${attendu} »`);
  }
});

await test("DISPO-08 — le décor du banc est EXTRAIT du dépôt, pas réécrit à la main", () => {
  /*
   * C'est la correction de fond de A1 et A2 : un décor recopié divergeait du
   * schéma réel. Les tables et la RPC fautive sont désormais extraites des
   * fichiers du dépôt à chaque exécution.
   */
  assert.ok(BANC.includes('awk -v t="$t"'), "les tables doivent être extraites du baseline");
  assert.ok(BANC.includes("$BASELINE"), "le baseline doit être la source des tables");
  assert.ok(BANC.includes("$MIGRATION_RPC_ORIGINE"), "la RPC fautive doit être extraite de sa migration d'origine");
});

await test("DISPO-09 — ce harnais ne prétend pas prouver les ACL", () => {
  /*
   * ⚠️ LE PIÈGE QUE CE TEST FERME. 22 des assertions de ce fichier lisent des
   * FICHIERS : elles prouvent que les bonnes lignes sont écrites, jamais que
   * les privilèges sont retirés. Prendre le vert de ce harnais pour une preuve
   * d'ACL, c'est l'erreur que la revue du 19/11/2026 a nommée.
   */
  const moi = lire("./stabilisation-b1-b2.mts");
  /*
   * ⚠️ MOTIFS ASSEMBLÉS, MÊME RAISON QU'EN TEXTE-B1-06. Écrits en clair, ils
   * apparaîtraient dans ce fichier et le test se dénoncerait lui-même — c'est
   * exactement ce qui s'est produit à la première rédaction, qui cherchait
   * « create » + « Client » par une expression régulière contenant le motif.
   */
  const SIGNES_DE_BASE = [
    ["create", "Client("],
    ["new ", "Client("],
    ["from \"", "pg\""],
    ["require(\"", "pg\")"],
  ].map((fragments) => fragments.join(""));
  for (const signe of SIGNES_DE_BASE) {
    assert.equal(
      moi.includes(signe),
      false,
      `ce harnais semble ouvrir une base (« ${signe} ») : revoir alors cet avertissement`,
    );
  }
  assert.ok(
    moi.includes("AVERTISSEMENT"),
    "le pied de ce harnais doit rappeler ce qu'il ne prouve pas",
  );
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
console.log(
  "\nAVERTISSEMENT — NATURE DES CONTRÔLES CI-DESSUS.\n" +
    "  · tests STATIQUES de fichiers : ils prouvent que les bonnes lignes sont ÉCRITES.\n" +
    "  · tests COMPORTEMENTAUX : ils exécutent lib/ics-intitules.ts pour de vrai.\n" +
    "  · les PRIVILÈGES SQL et le découpage rendu par la RPC ne sont PAS prouvés ici :\n" +
    "    ce harnais n'ouvre aucune base. Lancer `npm run test:stabilisation-b1-b2-sql`\n" +
    "    (banc PostgreSQL jetable) pour les vérifier réellement.",
);
if (failed > 0) process.exit(1);

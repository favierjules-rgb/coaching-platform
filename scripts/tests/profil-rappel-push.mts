/**
 * Harnais — RAPPEL DE RÉACTIVATION DES NOTIFICATIONS PUSH (profil élève).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST EXÉCUTÉ ICI, ET CE QUI NE PEUT PAS L'ÊTRE — SANS FAIRE SEMBLANT
 * ────────────────────────────────────────────────────────────────────────────
 * 1. LA TABLE DE VÉRITÉ EST EXÉCUTÉE. `deciderEtatPush` est appelée sur les
 *    SIX situations du cahier des charges, et sur toutes les combinaisons de
 *    (permission × abonnement × réponse serveur). C'est une fonction pure :
 *    il n'y a aucune raison de la deviner.
 * 2. LE PARCOURS D'ACTIVATION EST EXÉCUTÉ. `activerNotifications` reçoit des
 *    dépendances injectées et la SÉQUENCE réelle est jouée : permission
 *    demandée ou non, abonnement réutilisé ou créé, serveur confirmé ou non.
 *    Les appels sont comptés — c'est ainsi qu'on prouve qu'aucun second
 *    abonnement n'est créé et qu'un `denied` n'est jamais redemandé.
 * 3. LA DÉCISION D'OUVRIR LA FENÊTRE EST EXÉCUTÉE (`doitProposerRappel`),
 *    y compris la non-réouverture après « Plus tard ».
 * 4. LES GARDES SERVEUR ET LES RÈGLES DE SÉCURITÉ sont vérifiées sur les
 *    sources : session exigée, identité jamais lue dans le corps, aucune clé
 *    privée côté client, aucune migration, aucune policy touchée.
 *
 * ⚠️ CE QUI N'EST PAS EXÉCUTÉ ICI : LE CLIC RÉEL ET LE RENDU REACT. Ce dépôt
 * n'a ni jsdom ni moteur de navigateur installé pour cette suite ; les cas de
 * navigateur vivent dans `profil-rappel-push-render.mts` (Playwright), qui
 * exige un Chromium. Ce fichier-ci ne les remplace pas et ne prétend pas le
 * faire.
 *
 * Lancement : npm run test:profil-rappel-push
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  activerNotifications,
  lireStatutServeur,
  messageActivation,
  type AbonnementNavigateur,
  type DependancesActivation,
  type ResultatActivation,
} from "../../lib/push/activation";
import {
  activationPossible,
  deciderEtatPush,
  doitProposerRappel,
  type FaitsPush,
} from "../../lib/push/etat";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const CODE_HOOK = sansProse(lire("../../hooks/useNotificationsPush.ts"));
const CODE_SECTION = sansProse(lire("../../components/student/NotificationsSection.tsx"));
const CODE_MODALE = sansProse(lire("../../components/student/RappelNotificationsPush.tsx"));
const SOURCE_MODALE = lire("../../components/student/RappelNotificationsPush.tsx");
const CODE_ROUTE_STATUT = lire("../../app/api/push/status/route.ts");
const CODE_SW = lire("../../public/sw.js");
const CODE_PROFIL = lire("../../components/student/ProfilPageContent.tsx");

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — un parcours d'activation instrumenté
   ══════════════════════════════════════════════════════════════════════════ */

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/JETON-APPAREIL";
const CLE = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

function abonnement(endpoint = ENDPOINT): AbonnementNavigateur {
  return { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }) };
}

interface Banc {
  readonly deps: DependancesActivation;
  readonly journal: string[];
}

interface OptionsBanc {
  permission?: NotificationPermission;
  /** Ce que rend `requestPermission()` — par défaut, la permission demandée. */
  reponsePermission?: NotificationPermission;
  abonnementDeja?: AbonnementNavigateur | null;
  clePublique?: string | null;
  /** `false` = le serveur refuse ; `"rejette"` = panne réseau. */
  serveur?: boolean | "rejette";
  /** `creerAbonnement` échoue (quota, stockage). */
  creationRejette?: boolean;
}

function banc(options: OptionsBanc = {}): Banc {
  const journal: string[] = [];
  let permission = options.permission ?? "default";
  const deps: DependancesActivation = {
    permissionActuelle: () => permission,
    demanderPermission: async () => {
      journal.push("demanderPermission");
      permission = options.reponsePermission ?? "granted";
      return permission;
    },
    clePublique: options.clePublique === undefined ? CLE : options.clePublique,
    abonnementExistant: async () => {
      journal.push("abonnementExistant");
      return options.abonnementDeja ?? null;
    },
    creerAbonnement: async (cle) => {
      journal.push(`creerAbonnement:${cle.slice(0, 6)}`);
      if (options.creationRejette) throw new Error("quota");
      return abonnement();
    },
    enregistrerAuServeur: async (a) => {
      journal.push(`enregistrerAuServeur:${a.endpoint.slice(-14)}`);
      if (options.serveur === "rejette") throw new Error("réseau");
      return options.serveur !== false;
    },
  };
  return { deps, journal };
}

function faits(partiel: Partial<FaitsPush> = {}): FaitsPush {
  return {
    supporte: true,
    permission: "granted",
    abonnementPresent: true,
    serveur: "actif",
    ...partiel,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   A — LES SIX ÉTATS DU CAHIER DES CHARGES, EXÉCUTÉS
   ══════════════════════════════════════════════════════════════════════════ */

await test("A-1. (état 6) environnement sans Push → `non_supporte`, et rien d'autre ne compte", () => {
  for (const permission of ["default", "granted", "denied"] as const) {
    for (const abonnementPresent of [true, false]) {
      assert.equal(
        deciderEtatPush(faits({ supporte: false, permission, abonnementPresent })),
        "non_supporte",
        `supporte=false doit primer (permission=${permission}, abonnement=${abonnementPresent})`,
      );
    }
  }
  assert.equal(activationPossible("non_supporte"), false, "aucune action proposée");
});

await test("A-2. (état 3) permission `denied` → `refuse`, même avec un abonnement présent", () => {
  assert.equal(deciderEtatPush(faits({ permission: "denied" })), "refuse");
  assert.equal(deciderEtatPush(faits({ permission: "denied", abonnementPresent: false })), "refuse");
  assert.equal(activationPossible("refuse"), false, "⚠️ aucun bouton d'activation après un refus");
});

await test("A-3. (état 2) permission `default` sans abonnement → `inactif`", () => {
  assert.equal(
    deciderEtatPush(faits({ permission: "default", abonnementPresent: false, serveur: "absent" })),
    "inactif",
  );
  assert.equal(activationPossible("inactif"), true, "l'activation est possible");
});

await test("A-4. (état 4a) permission accordée mais AUCUN abonnement → `a_reactiver`", () => {
  // ⚠️ C'EST LE CAS QUE `permission === "granted"` FAISAIT PASSER POUR ACTIF.
  assert.equal(
    deciderEtatPush(faits({ permission: "granted", abonnementPresent: false, serveur: "absent" })),
    "a_reactiver",
  );
  assert.equal(activationPossible("a_reactiver"), true);
});

await test("A-5. (état 4b) abonnement présent mais serveur qui ne le connaît plus → `a_reactiver`", () => {
  // La perte « après une mise à jour » : rotation d'abonnement, 404/410, clé
  // VAPID changée. Le navigateur dit oui, le serveur dit non.
  assert.equal(deciderEtatPush(faits({ serveur: "absent" })), "a_reactiver");
  assert.equal(deciderEtatPush(faits({ serveur: "desactive" })), "a_reactiver");
});

await test("A-6. (état 5) abonné ET confirmé par le serveur → `active`", () => {
  assert.equal(deciderEtatPush(faits({ serveur: "actif" })), "active");
  assert.equal(activationPossible("active"), false, "rien à activer");
});

await test("A-7. (état 1) préférence désactivée : aucun abonnement, serveur muet", () => {
  // Dans cette application, « préférence push » = la ligne `push_subscriptions`
  // de cet appareil. Pas de ligne et pas d'abonnement local = désactivé.
  for (const permission of ["default", "granted"] as const) {
    const etat = deciderEtatPush(faits({ permission, abonnementPresent: false, serveur: "absent" }));
    assert.ok(
      etat === "inactif" || etat === "a_reactiver",
      `désactivé doit se voir (permission=${permission}, obtenu ${etat})`,
    );
    assert.equal(doitProposerRappel(etat, false, false), true, "…et la fenêtre doit s'ouvrir");
  }
});

await test("A-8. ⚠️ UN SERVEUR INJOIGNABLE NE FAIT PAS CROIRE À UNE PERTE", () => {
  // `inconnu` ≠ `absent`. Confondre les deux ferait proposer une réactivation
  // inutile à chaque coupure réseau.
  assert.equal(deciderEtatPush(faits({ serveur: "inconnu" })), "active");
  assert.equal(doitProposerRappel("active", false, false), false, "et aucune fenêtre");
});

await test("A-9. un abonnement présent prime sur une permission remise à `default`", () => {
  // Un `PushSubscription` ne peut pas exister sans permission accordée :
  // `default` + abonnement décrit une permission réinitialisée après coup,
  // pas un appareil qui n'a jamais décidé.
  assert.equal(deciderEtatPush(faits({ permission: "default", serveur: "actif" })), "active");
  assert.equal(deciderEtatPush(faits({ permission: "default", serveur: "absent" })), "a_reactiver");
});

await test("A-10. la réponse du serveur est lue sans rien inventer", () => {
  assert.equal(lireStatutServeur({ connu: true, actif: true }), "actif");
  assert.equal(lireStatutServeur({ connu: true, actif: false }), "desactive");
  assert.equal(lireStatutServeur({ connu: false, actif: false }), "absent");
  for (const illisible of [null, undefined, {}, { connu: 1, actif: 1 }, "ok", { connu: true }]) {
    assert.equal(
      lireStatutServeur(illisible),
      "inconnu",
      `une réponse illisible doit rendre « inconnu » : ${JSON.stringify(illisible)}`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   B — L'OUVERTURE DE LA FENÊTRE : JAMAIS EN BOUCLE, JAMAIS QUAND C'EST ACTIF
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-1. (test 1) notifications actives → AUCUNE fenêtre", () => {
  assert.equal(doitProposerRappel("active", false, false), false);
  assert.equal(doitProposerRappel("chargement", false, false), false, "ni pendant le chargement");
  assert.equal(doitProposerRappel("non_supporte", false, false), false, "ni sans Push");
});

await test("B-2. (test 2) préférence désactivée → fenêtre affichée", () => {
  assert.equal(doitProposerRappel("inactif", false, false), true);
  assert.equal(doitProposerRappel("a_reactiver", false, false), true);
  assert.equal(doitProposerRappel("refuse", false, false), true, "un refus mérite les instructions");
});

await test("B-3. (test 10) ⚠️ AUCUNE BOUCLE : une fois proposée, elle ne se repropose pas", () => {
  for (const etat of ["inactif", "a_reactiver", "refuse"] as const) {
    assert.equal(doitProposerRappel(etat, true, false), false, `${etat} : déjà proposée`);
    assert.equal(doitProposerRappel(etat, false, true), false, `${etat} : fermée par l'élève`);
    assert.equal(doitProposerRappel(etat, true, true), false);
  }
});

await test("B-4. (test 10) ⚠️ L'AFFICHAGE EST DÉRIVÉ, PAS STOCKÉ : la boucle est impossible", () => {
  // Il n'y a pas d'état « ouvert » à synchroniser, donc pas de cycle à
  // boucler — et aucun `setState` dans un effet, ce que le linter refuse à
  // juste titre. La décision est réévaluée à chaque rendu, c'est tout.
  assert.ok(
    /const rappelAffiche = doitProposerRappel\(etat, false, ferme\);/.test(CODE_SECTION),
    "l'affichage est calculé depuis l'état et la fermeture",
  );
  assert.ok(/\{rappelAffiche \? \(/.test(CODE_SECTION), "…et c'est lui qui monte la fenêtre");
  assert.ok(
    !/useEffect/.test(CODE_SECTION),
    "⚠️ AUCUN effet dans la section : rien à synchroniser, donc rien qui puisse boucler",
  );
  assert.ok(!/setOuvert/.test(CODE_SECTION), "aucun état d'ouverture stocké");
  assert.ok(
    !/localStorage|sessionStorage/.test(CODE_SECTION),
    "⚠️ rien de persistant : le rappel doit pouvoir revenir à la prochaine visite",
  );
  // Et la fermeture vit DANS le composant, donc dans la visite.
  assert.ok(/const \[ferme, setFerme\] = useState\(false\)/.test(CODE_SECTION), "`ferme` est local");
});

await test("B-5. (test 7) une activation réussie fait DISPARAÎTRE la fenêtre, sans code de fermeture", () => {
  // La fenêtre n'est montée que si `doitProposerRappel` le dit. Sur `active`
  // il dit non : il n'y a donc aucune fermeture à écrire, et aucun risque
  // qu'elle survive à un succès.
  assert.equal(doitProposerRappel("active", false, false), false);
  assert.equal(doitProposerRappel("active", false, true), false);
  // Et `active` n'est posé qu'après relecture du serveur — voir D-2.
  assert.ok(
    !/setEtat\("active"\)/.test(CODE_HOOK),
    "⚠️ `active` ne se décrète pas : il vient de la relecture de /api/push/status",
  );
});

await test("B-6. (test 9) « Plus tard » ne touche à AUCUNE préférence", () => {
  const i = CODE_SECTION.indexOf("onFermer=");
  assert.ok(i > 0, "le gestionnaire de fermeture existe");
  const corps = CODE_SECTION.slice(i, i + 120);
  assert.ok(
    /onFermer=\{\(\) => setFerme\(true\)\}/.test(corps),
    "fermer ne fait qu'une chose : marquer la visite comme fermée",
  );
  for (const interdit of ["desactiver", "fetch", "unsubscribe", "api/push"]) {
    assert.ok(!corps.includes(interdit), `⚠️ fermer ne doit pas « ${interdit} »`);
  }
  // Le bouton existe, et il est bien secondaire.
  assert.ok(/Plus tard/.test(CODE_MODALE), "le bouton « Plus tard » est présent");
  assert.ok(/<OutlineButton onClick=\{onFermer\}>Plus tard/.test(CODE_MODALE), "en style secondaire");
});

/* ══════════════════════════════════════════════════════════════════════════
   C — LE PARCOURS D'ACTIVATION, EXÉCUTÉ POUR DE VRAI
   ══════════════════════════════════════════════════════════════════════════ */

await test("C-1. (test 4) permission `default` : la demande part, UNE fois, et depuis l'appel", async () => {
  const b = banc({ permission: "default" });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "active");
  assert.equal(
    b.journal.filter((l) => l === "demanderPermission").length,
    1,
    "une seule demande de permission",
  );
});

await test("C-2. ⚠️ LA PERMISSION N'EST JAMAIS DEMANDÉE AU CHARGEMENT", () => {
  // Le hook ne doit l'appeler que depuis `activer`, et la collecte d'état ne
  // doit pas la toucher du tout.
  const iActiver = CODE_HOOK.indexOf("const activer = useCallback");
  const iCollecter = CODE_HOOK.indexOf("const collecter = useCallback");
  assert.ok(iActiver > 0 && iCollecter > 0, "les deux fonctions existent");
  const collecte = CODE_HOOK.slice(iCollecter, iActiver > iCollecter ? iActiver : undefined);
  assert.ok(
    !collecte.includes("requestPermission"),
    "⚠️ la collecte d'état ne demande JAMAIS la permission",
  );
  assert.equal(
    (CODE_HOOK.match(/requestPermission/g) ?? []).length,
    1,
    "une seule mention, dans les dépendances passées à `activerNotifications`",
  );
  assert.ok(
    CODE_HOOK.indexOf("requestPermission") > iActiver,
    "…et elle est APRÈS le début d'`activer`",
  );
});

await test("C-3. (test 5) permission `denied` : AUCUNE demande, aucune tentative", async () => {
  const b = banc({ permission: "denied", abonnementDeja: abonnement() });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "refuse");
  assert.deepEqual(b.journal, [], "⚠️ rien ne doit partir : ni demande, ni abonnement, ni serveur");
  const message = messageActivation(r);
  assert.ok(message && /réglages/i.test(message), "le message renvoie aux réglages");
});

await test("C-4. un refus prononcé PENDANT la demande ne boucle pas non plus", async () => {
  const b = banc({ permission: "default", reponsePermission: "denied" });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "refuse");
  assert.equal(b.journal.filter((l) => l === "demanderPermission").length, 1, "une seule demande");
  assert.ok(!b.journal.some((l) => l.startsWith("creerAbonnement")), "aucun abonnement tenté");
  assert.ok(!b.journal.some((l) => l.startsWith("enregistrerAuServeur")), "aucun appel serveur");
});

await test("C-5. demande fermée sans réponse : rien n'est acquis, rien n'est perdu", async () => {
  const b = banc({ permission: "default", reponsePermission: "default" });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "sans_reponse");
  assert.ok(!b.journal.some((l) => l.startsWith("enregistrerAuServeur")), "aucun faux succès");
});

await test("C-6. (test 3) abonnement manquant malgré une permission accordée : il est CRÉÉ", async () => {
  const b = banc({ permission: "granted", abonnementDeja: null });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "active");
  assert.deepEqual(b.journal, [
    "abonnementExistant",
    `creerAbonnement:${CLE.slice(0, 6)}`,
    "enregistrerAuServeur:JETON-APPAREIL",
  ]);
  assert.equal(b.journal.filter((l) => l === "demanderPermission").length, 0, "déjà accordée");
});

await test("C-7. (test 10) ⚠️ AUCUN SECOND ABONNEMENT quand il en existe un valide", async () => {
  const b = banc({ permission: "granted", abonnementDeja: abonnement() });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "active");
  assert.ok(
    !b.journal.some((l) => l.startsWith("creerAbonnement")),
    "⚠️ `subscribe()` ne doit PAS être appelé : l'abonnement existant est réutilisé",
  );
  assert.ok(
    b.journal.some((l) => l.startsWith("enregistrerAuServeur")),
    "…mais il est RÉENREGISTRÉ au serveur, qui l'avait perdu",
  );
});

await test("C-8. (test 8) le serveur refuse → échec explicite, et AUCUN faux succès", async () => {
  const b = banc({ permission: "granted", abonnementDeja: abonnement(), serveur: false });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "echec_serveur");
  const message = messageActivation(r);
  assert.ok(message, "un message est affiché");
  // ⚠️ ON MESURE LA NÉGATION, PAS L'ABSENCE DU MOT « actif ». Le message dit
  // justement « ne sont pas encore actives » : chercher à bannir le mot
  // ferait rougir le contrôle sur la formulation correcte.
  assert.match(
    message ?? "",
    /ne sont pas encore actives/,
    "⚠️ le message doit dire que les notifications NE sont PAS actives",
  );
  assert.ok(
    !/activ[ée]es? avec succès|sont bien activ/i.test(message ?? ""),
    "⚠️ et surtout jamais annoncer un succès",
  );
});

await test("C-9. (test 8) panne réseau → échec technique réessayable, jamais un succès", async () => {
  const b = banc({ permission: "granted", abonnementDeja: abonnement(), serveur: "rejette" });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "echec_technique");
  assert.match(messageActivation(r) ?? "", /connexion/i, "le message parle de la connexion");
});

await test("C-10. serveur VAPID non configuré : refus net, et aucune demande de permission", async () => {
  const b = banc({ permission: "default", clePublique: null });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "non_configure");
  assert.deepEqual(b.journal, [], "⚠️ on ne brûle pas la permission pour rien");
  assert.match(messageActivation(r) ?? "", /configur/i);
});

await test("C-11. une création d'abonnement qui échoue reste un échec technique", async () => {
  const b = banc({ permission: "granted", abonnementDeja: null, creationRejette: true });
  const r = await activerNotifications(b.deps);
  assert.equal(r.issue, "echec_technique");
  assert.ok(!b.journal.some((l) => l.startsWith("enregistrerAuServeur")), "rien n'est annoncé");
});

await test("C-12. aucun résultat d'échec ne porte de message de succès", () => {
  const issues: ResultatActivation[] = [
    { issue: "refuse" },
    { issue: "sans_reponse" },
    { issue: "non_configure" },
    { issue: "echec_serveur" },
    { issue: "echec_technique" },
  ];
  for (const r of issues) {
    const m = messageActivation(r);
    assert.ok(m && m.length > 20, `${r.issue} doit avoir un message explicite`);
    assert.ok(!/^Notifications activ/i.test(m ?? ""), `${r.issue} ne doit pas annoncer un succès`);
  }
  assert.equal(messageActivation({ issue: "active", endpoint: ENDPOINT }), null, "le succès est muet");
});

/* ══════════════════════════════════════════════════════════════════════════
   D — LA SYNCHRONISATION, LE DOUBLE CLIC, ET LE RETOUR SUR LE PROFIL
   ══════════════════════════════════════════════════════════════════════════ */

await test("D-1. (test 7) une seule instance du hook : la fenêtre et le bloc ne peuvent pas diverger", () => {
  assert.equal(
    (CODE_SECTION.match(/useNotificationsPush\(\)/g) ?? []).length,
    1,
    "⚠️ un seul appel : deux instances produiraient deux états indépendants",
  );
  assert.ok(
    !/useNotificationsPush/.test(CODE_MODALE),
    "la fenêtre n'a pas d'état à elle : elle reçoit celui du parent",
  );
  // Les deux lisent les mêmes variables.
  for (const prop of ["etat", "message", "enCours"]) {
    assert.ok(
      new RegExp(`${prop}=\\{${prop}\\}`).test(CODE_SECTION),
      `${prop} est transmis tel quel à la fenêtre`,
    );
  }
});

await test("D-2. l'état affiché est RELU après une activation réussie", () => {
  const i = CODE_HOOK.indexOf("const activer = useCallback");
  const corps = CODE_HOOK.slice(i);
  assert.ok(
    /if \(resultat\.issue === "active"\) \{[\s\S]{0,200}?await revalider\(\);/.test(corps),
    "⚠️ `active` n'est pas posé d'autorité : on repasse par /api/push/status",
  );
  assert.ok(
    !/setEtat\("active"\)/.test(CODE_HOOK),
    "⚠️ aucun endroit ne doit déclarer `active` sans relecture",
  );
});

await test("D-3. (test 10) double clic impossible : verrou SYNCHRONE, pas un état React", () => {
  assert.ok(/const enVol = useRef\(false\)/.test(CODE_HOOK), "le verrou est une référence");
  assert.ok(
    /if \(enVol\.current\) return;\s*enVol\.current = true;/.test(CODE_HOOK),
    "…posé immédiatement, avant tout `await`",
  );
  assert.equal(
    (CODE_HOOK.match(/enVol\.current = false;/g) ?? []).length,
    2,
    "relâché dans `activer` ET dans `desactiver`, par un `finally`",
  );
  // ⚠️ FONCTION PAR FONCTION, PAS UN COMPTE GLOBAL. Un `finally` de plus
  // ailleurs dans le fichier (l'interrogation du serveur en a un, pour son
  // `clearTimeout`) ferait rougir un compte global sans rien dire du verrou.
  for (const nom of ["const activer = useCallback", "const desactiver = useCallback"]) {
    const i = CODE_HOOK.indexOf(nom);
    assert.ok(i > 0, `${nom} doit exister`);
    const suite = CODE_HOOK.slice(i);
    const iFinally = suite.indexOf("finally {");
    assert.ok(iFinally > 0, `${nom} doit relâcher le verrou dans un \`finally\``);
    assert.ok(
      suite.slice(iFinally, iFinally + 200).includes("enVol.current = false;"),
      `${nom} : le verrou doit être relâché même sur un échec`,
    );
  }
  // Et l'interface le reflète.
  assert.ok(/disabled=\{enCours\}/.test(CODE_SECTION), "les boutons du bloc sont désactivés");
  assert.ok(/disabled=\{enCours\}/.test(CODE_MODALE), "celui de la fenêtre aussi");
  assert.ok(/animate-spin/.test(CODE_MODALE), "…avec un état de chargement visible");
});

await test("D-4. (test 11) le retour sur le profil relit l'état réel", () => {
  assert.ok(
    /document\.addEventListener\("visibilitychange", auRetour\)/.test(CODE_HOOK),
    "un retour sur l'onglet déclenche une relecture",
  );
  assert.ok(
    /document\.removeEventListener\("visibilitychange", auRetour\)/.test(CODE_HOOK),
    "…et l'écouteur est retiré au démontage",
  );
  assert.ok(
    /if \(document\.visibilityState === "visible"\) void revalider\(\);/.test(CODE_HOOK),
    "…seulement quand l'onglet est visible : aucun sondage périodique",
  );
  assert.ok(!/setInterval/.test(CODE_HOOK), "⚠️ aucun sondage : pas de requête en boucle");
});

await test("D-5. les quatre faits sont relus, pas seulement une version stockée", () => {
  const i = CODE_HOOK.indexOf("const collecter = useCallback");
  const corps = CODE_HOOK.slice(i, CODE_HOOK.indexOf("const revalider", i));
  assert.ok(/supporte\(\)/.test(corps), "1. le support de l'environnement");
  assert.ok(/Notification\.permission/.test(corps), "2. la permission du navigateur");
  assert.ok(/pushManager\.getSubscription\(\)/.test(corps), "3. l'abonnement local");
  assert.ok(/interrogerServeur\(/.test(corps), "4. ce que le SERVEUR en dit");
  assert.ok(/deciderEtatPush\(\{/.test(corps), "…puis la décision, par la fonction pure");
  assert.ok(
    !/localStorage|sessionStorage|version/i.test(corps),
    "⚠️ aucune version stockée en local ne sert de source de vérité",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   E — SÉCURITÉ, FIABILITÉ, ET PÉRIMÈTRE
   ══════════════════════════════════════════════════════════════════════════ */

await test("E-1. la route de statut exige une session, et ne lit jamais l'identité du corps", () => {
  assert.ok(CODE_ROUTE_STATUT.includes("supabase.auth.getUser()"), "la session est vérifiée");
  assert.ok(CODE_ROUTE_STATUT.includes("401"), "un appel non authentifié est refusé");
  assert.ok(
    !/user_id\s*:\s*(corps|body)/.test(CODE_ROUTE_STATUT),
    "l'identité vient de la session",
  );
  assert.ok(/etatAbonnement\(admin, user\.id, endpoint\)/.test(CODE_ROUTE_STATUT), "…et elle filtre");
});

await test("E-2. ⚠️ LA ROUTE DE STATUT N'ÉCRIT RIEN", () => {
  for (const interdit of ["upsert", "insert", ".update(", ".delete(", "enregistrerAbonnement", "retirerAbonnement"]) {
    assert.ok(
      !CODE_ROUTE_STATUT.includes(interdit),
      `⚠️ « ${interdit} » ne doit pas apparaître : elle ne peut pas modifier une préférence`,
    );
  }
});

await test("E-3. la lecture serveur est filtrée sur l'utilisateur ET l'endpoint", () => {
  const depot = lire("../../lib/push/depot-abonnements.ts");
  const i = depot.indexOf("export async function etatAbonnement");
  const corps = depot.slice(i, depot.indexOf("\n}", i));
  assert.ok(corps.includes('.eq("endpoint", endpoint)'), "l'endpoint désigne l'appareil");
  assert.ok(corps.includes('.eq("user_id", userId)'), "⚠️ et user_id garantit qu'il est à lui");
  assert.ok(corps.includes('.select("disabled_at")'), "aucune clé n'est lue");
  for (const interdit of ["p256dh", "auth,", "endpoint,"]) {
    assert.ok(!corps.includes(interdit), `« ${interdit} » ne doit pas sortir de la base`);
  }
});

await test("E-4. aucune clé privée ne s'approche du navigateur", () => {
  for (const [nom, source] of [
    ["hook", CODE_HOOK],
    ["section", CODE_SECTION],
    ["modale", CODE_MODALE],
    ["service worker", CODE_SW],
    ["lib/push/etat.ts", lire("../../lib/push/etat.ts")],
    ["lib/push/activation.ts", lire("../../lib/push/activation.ts")],
  ] as const) {
    assert.ok(!source.includes("VAPID_PRIVATE_KEY"), `${nom} mentionne la clé privée`);
    assert.ok(!source.includes("vapid.ts"), `${nom} importe la configuration serveur`);
    assert.ok(
      !/NEXT_PUBLIC_[A-Z_]*PRIVATE/.test(source),
      `${nom} exposerait une clé privée au navigateur`,
    );
  }
});

await test("E-5. le renouvellement du service worker réutilise la clé de l'ANCIEN abonnement", () => {
  assert.ok(
    /addEventListener\("pushsubscriptionchange"/.test(CODE_SW),
    "⚠️ l'évènement est écouté : c'est la cause première de la perte silencieuse",
  );
  const i = CODE_SW.indexOf('addEventListener("pushsubscriptionchange"');
  const corps = CODE_SW.slice(i);
  assert.ok(/options\.applicationServerKey/.test(corps), "la clé vient de l'ancien abonnement");
  assert.ok(/userVisibleOnly: true/.test(corps), "le drapeau obligatoire est posé");
  assert.ok(/\/api\/push\/subscribe/.test(corps), "le nouvel abonnement est envoyé au serveur");
  assert.ok(/credentials: "same-origin"/.test(corps), "…avec le cookie de session");
  // Aucun second abonnement : on cherche l'existant avant de créer.
  const iCreate = corps.indexOf("pushManager.subscribe(");
  const iGet = corps.indexOf("pushManager.getSubscription()");
  assert.ok(iGet > 0 && iGet < iCreate, "⚠️ on cherche l'abonnement existant AVANT d'en créer un");
});

await test("E-6. aucune migration, aucune policy, aucune table nouvelle", () => {
  // Le mécanisme existant suffit : `push_subscriptions` porte déjà
  // `disabled_at`, et la lecture passe par le client admin côté serveur.
  const nouveaux = [
    "../../lib/push/etat.ts",
    "../../lib/push/activation.ts",
    "../../app/api/push/status/route.ts",
    "../../components/student/RappelNotificationsPush.tsx",
  ];
  for (const chemin of nouveaux) {
    const source = lire(chemin);
    for (const interdit of ["create policy", "alter policy", "create table", "alter table", "grant ", "revoke "]) {
      assert.ok(
        !source.toLowerCase().includes(interdit),
        `${chemin} contient « ${interdit} » : ce lot ne doit toucher ni schéma ni RLS`,
      );
    }
  }
});

await test("E-7. le Push n'a aucun droit de veto sur l'affichage du profil (régression 10/08/2026)", () => {
  // Même invariant que PROFILPUSH2, revérifié ici parce que ce lot ajoute du
  // Push au profil : le hook doit rester DANS `NotificationsSection`.
  const avantLeRendu = CODE_PROFIL.slice(0, CODE_PROFIL.indexOf("<NotificationsSection"));
  for (const interdit of [
    "useNotificationsPush",
    "RappelNotificationsPush",
    "doitProposerRappel",
    "Notification.permission",
  ]) {
    assert.ok(
      !avantLeRendu.includes(interdit),
      `ProfilPageContent lit « ${interdit} » avant de rendre le profil`,
    );
  }
  assert.ok(
    CODE_PROFIL.indexOf("<NotificationsSection") > CODE_PROFIL.lastIndexOf("Chargement du profil…"),
    "NotificationsSection reste monté APRÈS les sorties anticipées",
  );
  assert.ok(
    !CODE_PROFIL.includes("RappelNotificationsPush"),
    "la fenêtre est montée par la section, jamais par la page",
  );
});

await test("E-8. (test 6) un environnement non compatible masque les actions impossibles", () => {
  assert.equal(activationPossible("non_supporte"), false);
  assert.equal(activationPossible("refuse"), false);
  // Et le bloc explique, au lieu de rester muet.
  assert.ok(/ne gère pas les notifications/.test(CODE_SECTION), "le message « non supporté » existe");
  assert.ok(/bloquées pour ce site/.test(SOURCE_MODALE), "la fenêtre explique un refus");
  for (const plateforme of ["iPhone", "Android", "Ordinateur"]) {
    assert.ok(SOURCE_MODALE.includes(plateforme), `les instructions couvrent « ${plateforme} »`);
  }
});

await test("E-9. le message demandé par le cahier des charges est présent, au mot près", () => {
  const attendu =
    "Suite à une mise à jour, pense à réactiver les notifications push pour continuer à\n            recevoir tes rappels et notifications.";
  assert.ok(
    SOURCE_MODALE.includes(attendu),
    "le texte exact du rappel doit figurer dans la fenêtre",
  );
  assert.ok(/Réactiver les notifications/.test(SOURCE_MODALE), "bouton principal");
  assert.ok(/Plus tard/.test(SOURCE_MODALE), "bouton secondaire");
  // La croix, le piège de focus et Échap viennent du socle de modale partagé.
  assert.ok(
    /from "@\/components\/admin\/Modal"/.test(SOURCE_MODALE),
    "⚠️ la fenêtre réutilise le socle de modale, elle n'en réécrit pas un second",
  );
  const socle = lire("../../components/admin/Modal.tsx");
  assert.ok(/aria-label="Fermer"/.test(socle), "le socle fournit une croix accessible");
  assert.ok(/role="dialog"/.test(socle) && /aria-modal="true"/.test(socle), "…et le rôle dialogue");
});

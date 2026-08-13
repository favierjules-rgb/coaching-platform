/**
 * Harnais — ALIMENTS A4 PHASE 2 : CAMÉRA ARRIÈRE ET MOTEUR DE SCAN.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET CE QUI NE PEUT PAS L'ÊTRE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * Il n'y a ni caméra ni navigateur dans un conteneur Linux. Ce harnais ne
 * prétend donc RIEN savoir des performances réelles : il éprouve les RÈGLES —
 * quelle contrainte est demandée, quand, combien de fois, ce qui est arrêté et
 * dans quel ordre — avec un `mediaDevices` injecté qui compte tout ce qu'on lui
 * demande.
 *
 * La vitesse de décodage sur iPhone se mesure sur un iPhone. C'est l'objet du
 * banc d'essai `/dev/scan-benchmark`, et personne d'autre que Jules ne peut la
 * produire.
 *
 * Lancement : npm run test:aliments-a4-scan
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CONTRAINTE_ARRIERE,
  arreterCamera,
  contrainteParPeripherique,
  etatDepuisMotif,
  facingModeDeLaSession,
  motifDepuisErreur,
  ouvrirCameraArriere,
  torcheDisponible,
  trouverCameraArriere,
} from "../../lib/scan/camera";
import { GtinInvalide, exigerGtin, gtinEstValide, lireGtin, normaliserGtin } from "../../lib/scan/gtin";
import {
  CADENCE_PAR_SECONDE,
  FORMATS_A4,
  FORMATS_WASM,
  INTERVALLE_MS,
  type MoteurScan,
  formatWasmVersA4,
  nouvelEtatBoucle,
  tenterUneImage,
} from "../../lib/scan/moteur";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const CODE_BANC = sansProse(lire("../../components/dev/BancDEssaiScan.tsx"));
const CODE_CAMERA = sansProse(lire("../../lib/scan/camera.ts"));
const CODE_ADAPTATEURS = sansProse(lire("../../lib/scan/adaptateurs.ts"));

/* ── Faux matériel ─────────────────────────────────────────────────────── */

/** Une fausse piste qui SAIT si on l'a arrêtée, et combien de fois. */
function faussePiste(reglages: Record<string, unknown> = {}, capacites: Record<string, unknown> = {}) {
  const état = { arrets: 0 };
  return {
    état,
    piste: {
      kind: "video",
      stop() {
        état.arrets += 1;
      },
      getSettings: () => reglages,
      getCapabilities: () => capacites,
    },
  };
}

function fauxStream(pistes: { piste: unknown }[]) {
  const toutes = pistes.map((p) => p.piste);
  return {
    getTracks: () => toutes,
    getVideoTracks: () => toutes,
  } as unknown as MediaStream;
}

/** Un `mediaDevices` de test : il journalise CHAQUE contrainte demandée. */
function fauxMediaDevices(options: {
  reponses?: (MediaStream | Error)[];
  peripheriques?: MediaDeviceInfo[];
}) {
  const journal = { contraintes: [] as MediaStreamConstraints[], enumerations: 0 };
  const file = [...(options.reponses ?? [])];
  return {
    journal,
    devices: {
      async getUserMedia(contraintes: MediaStreamConstraints) {
        journal.contraintes.push(contraintes);
        const suivante = file.shift();
        if (suivante instanceof Error) throw suivante;
        if (!suivante) throw Object.assign(new Error("plus de réponse"), { name: "NotFoundError" });
        return suivante;
      },
      async enumerateDevices() {
        journal.enumerations += 1;
        return options.peripheriques ?? [];
      },
    },
  };
}

function erreur(nom: string): Error {
  return Object.assign(new Error(nom), { name: nom });
}

/** Un moteur de test : il rend ce qu'on lui dit, et compte ses appels. */
function fauxMoteur(lectures: (string | null)[]): MoteurScan & { appels: () => number } {
  let n = 0;
  const file = [...lectures];
  return {
    nom: "zxing-wasm",
    appels: () => n,
    async initialiser() {},
    async decoder() {
      n += 1;
      const v = file.shift() ?? null;
      return v === null ? null : { rawValue: v, format: "ean_13" };
    },
    detruire() {},
  };
}

const IMAGE = { width: 2, height: 2, data: new Uint8ClampedArray(16) } as unknown as ImageData;

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN1..5 + REAR — LA CAMÉRA
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN1. aucune permission n'est demandée avant une action de l'utilisateur", () => {
  // La preuve tient en deux faits, et aucun n'est une relecture d'intention.
  //
  // 1. `ouvrirCameraArriere` n'est appelée QUE depuis `demarrer()`, qui est
  //    elle-même branchée sur un `onClick`.
  const posOuvrir = CODE_BANC.indexOf("await ouvrirCameraArriere(");
  const posDemarrer = CODE_BANC.indexOf("async function demarrer()");
  const posEffet = CODE_BANC.indexOf("useEffect(");
  assert.ok(posDemarrer > 0 && posOuvrir > posDemarrer, "l'ouverture vit dans demarrer()");
  assert.ok(CODE_BANC.includes("onClick={() => void demarrer()}"), "et demarrer() est un onClick");

  // 2. Le SEUL `useEffect` du composant est un nettoyage de démontage : il ne
  //    peut rien ouvrir. Un effet qui appellerait la caméra au montage
  //    demanderait la permission sans que personne n'ait rien tapé.
  const effet = CODE_BANC.slice(posEffet, CODE_BANC.indexOf(";", posEffet) + 1);
  assert.ok(effet.includes("() => toutArreter()"), effet);
  assert.ok(!effet.includes("demarrer"), "aucun effet ne démarre la caméra");
  assert.equal((CODE_BANC.match(/useEffect\(/g) ?? []).length, 1, "un seul effet, et c'est le nettoyage");
});

await test("A4-SCAN2 · REAR1. la contrainte demandée privilégie la caméra arrière", async () => {
  assert.deepEqual(CONTRAINTE_ARRIERE, {
    video: { facingMode: { ideal: "environment" } },
    audio: false,
  });

  const { journal, devices } = fauxMediaDevices({
    reponses: [fauxStream([faussePiste({ facingMode: "environment" })])],
  });
  const r = await ouvrirCameraArriere({ mediaDevices: devices });

  assert.equal(r.ok, true);
  assert.equal(journal.contraintes.length, 1, "une seule ouverture quand la bonne caméra répond");
  assert.deepEqual(journal.contraintes[0], CONTRAINTE_ARRIERE);
  assert.equal(journal.enumerations, 0, "aucune énumération inutile");
});

await test("A4-SCAN3 · REAR2. la caméra frontale n'est JAMAIS choisie volontairement", () => {
  // Ni dans la contrainte d'ouverture, ni ailleurs dans la couche caméra.
  const contrainte = JSON.stringify(CONTRAINTE_ARRIERE);
  assert.ok(!contrainte.includes("user"), contrainte);
  assert.ok(!/facingMode:\s*\{?\s*(ideal|exact)?:?\s*"user"/.test(CODE_CAMERA), "aucun 'user' demandé");

  // ⚠️ `exact` est absent DE LA CONTRAINTE D'OUVERTURE, et c'est délibéré :
  // `{ exact: "environment" }` lève OverconstrainedError sur un appareil sans
  // caméra arrière, ce qui transformerait un cas gérable en échec sec.
  assert.ok(!contrainte.includes("exact"), "l'ouverture initiale n'utilise jamais exact");
  // Il n'apparaît que pour cibler un périphérique précis, en seconde intention.
  assert.deepEqual(contrainteParPeripherique("abc"), {
    video: { deviceId: { exact: "abc" } },
    audio: false,
  });
});

await test("A4-SCAN4. une permission refusée est distinguée, et n'est pas une panne", async () => {
  const { devices } = fauxMediaDevices({ reponses: [erreur("NotAllowedError")] });
  const r = await ouvrirCameraArriere({ mediaDevices: devices });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.motif, "permission_refusee");
    assert.equal(etatDepuisMotif(r.motif), "permission_refusee");
  }

  // Chaque nom de la spécification est traduit, et aucun ne tombe dans « erreur ».
  assert.equal(motifDepuisErreur(erreur("NotAllowedError")), "permission_refusee");
  assert.equal(motifDepuisErreur(erreur("PermissionDeniedError")), "permission_refusee");
  assert.equal(motifDepuisErreur(erreur("NotFoundError")), "aucune_camera");
  assert.equal(motifDepuisErreur(erreur("NotReadableError")), "camera_occupee");
  assert.equal(motifDepuisErreur(erreur("OverconstrainedError")), "contrainte_impossible");
  assert.equal(motifDepuisErreur(erreur("SecurityError")), "contexte_non_securise");
  assert.equal(motifDepuisErreur(erreur("QuelqueChoseDeNeuf")), "inconnu");
  assert.equal(motifDepuisErreur(null), "inconnu");
});

await test("A4-SCAN5. l'absence de caméra et le contexte non sécurisé sont distingués", async () => {
  const { devices } = fauxMediaDevices({ reponses: [erreur("NotFoundError")] });
  const sansCamera = await ouvrirCameraArriere({ mediaDevices: devices });
  assert.equal(sansCamera.ok, false);
  if (!sansCamera.ok) assert.equal(etatDepuisMotif(sansCamera.motif), "camera_indisponible");

  // `mediaDevices` absent = page en HTTP, ou navigateur trop ancien. Ce n'est
  // NI un refus NI une panne matérielle, et le message doit le dire.
  const nonSecurise = await ouvrirCameraArriere({ mediaDevices: null });
  assert.equal(nonSecurise.ok, false);
  if (!nonSecurise.ok) assert.equal(nonSecurise.motif, "contexte_non_securise");
});

await test("REAR3. caméra frontale obtenue + arrière identifiable → UNE seconde acquisition", async () => {
  const frontale = faussePiste({ facingMode: "user" });
  const arrière = faussePiste({ facingMode: "environment" });
  const { journal, devices } = fauxMediaDevices({
    reponses: [fauxStream([frontale]), fauxStream([arrière])],
    peripheriques: [
      { kind: "videoinput", deviceId: "av", label: "Front Camera" },
      { kind: "videoinput", deviceId: "ar", label: "Back Camera" },
    ] as MediaDeviceInfo[],
  });

  const r = await ouvrirCameraArriere({ mediaDevices: devices });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  assert.equal(journal.contraintes.length, 2, "exactement deux ouvertures, jamais trois");
  assert.deepEqual(journal.contraintes[1], contrainteParPeripherique("ar"));
  assert.equal(r.session.facingModeObtenu, "environment");
  assert.equal(r.session.secondeTentative, true);
  // La PREMIÈRE session est rendue : sans cela deux flux resteraient ouverts et
  // le téléphone garderait sa caméra allumée.
  assert.equal(frontale.état.arrets, 1, "la première caméra est arrêtée avant d'être remplacée");
});

await test("REAR3bis. sans caméra arrière identifiable, on garde ce qu'on a — sans boucler", async () => {
  const frontale = faussePiste({ facingMode: "user" });
  const { journal, devices } = fauxMediaDevices({
    reponses: [fauxStream([frontale])],
    peripheriques: [{ kind: "videoinput", deviceId: "av", label: "FaceTime HD" }] as MediaDeviceInfo[],
  });
  const r = await ouvrirCameraArriere({ mediaDevices: devices });

  assert.equal(r.ok, true);
  assert.equal(journal.contraintes.length, 1, "aucune seconde tentative sans cible");
  if (r.ok) {
    assert.equal(r.session.facingModeObtenu, "user");
    assert.equal(r.session.secondeTentative, false);
  }
  // L'appelant SAIT que c'est la frontale, et peut le signaler à l'élève.
  assert.equal(frontale.état.arrets, 0, "on ne coupe pas la seule caméra disponible");
});

await test("REAR4. plusieurs caméras arrière → aucune question posée à l'utilisateur", async () => {
  // Un iPhone expose grand-angle, ultra grand-angle et téléobjectif. Aucun
  // sélecteur : `facingMode: environment` laisse le système choisir, ce qui est
  // exactement ce qu'attend quelqu'un qui veut scanner une boîte de céréales.
  const { journal, devices } = fauxMediaDevices({
    reponses: [fauxStream([faussePiste({ facingMode: "environment" })])],
    peripheriques: [
      { kind: "videoinput", deviceId: "a1", label: "Back Camera" },
      { kind: "videoinput", deviceId: "a2", label: "Back Ultra Wide Camera" },
      { kind: "videoinput", deviceId: "a3", label: "Back Telephoto Camera" },
    ] as MediaDeviceInfo[],
  });
  const r = await ouvrirCameraArriere({ mediaDevices: devices });

  assert.equal(r.ok, true);
  assert.equal(journal.contraintes.length, 1);
  assert.equal(journal.enumerations, 0, "on n'énumère même pas : la bonne caméra a répondu");
  assert.ok(!CODE_BANC.includes("sélecteur") && !CODE_BANC.includes("choisirCamera"));

  // Et quand il faut choisir, la règle est déterministe et tolère les libellés
  // hétérogènes d'iOS et d'Android.
  assert.equal(
    trouverCameraArriere([
      { kind: "videoinput", deviceId: "x", label: "camera2 0, facing back" },
    ] as MediaDeviceInfo[])?.deviceId,
    "x",
  );
  assert.equal(trouverCameraArriere([] as MediaDeviceInfo[]), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN6..8 — LE GTIN
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN6. un GTIN est et reste une CHAÎNE", () => {
  const gtin = exigerGtin("3017620422003");
  assert.equal(typeof gtin, "string");

  // Aucune conversion numérique nulle part dans la couche de scan : un
  // `Number()` détruirait l'identité d'un code à zéros de tête.
  for (const fichier of ["../../lib/scan/gtin.ts", "../../lib/scan/moteur.ts", "../../lib/scan/camera.ts"]) {
    const code = sansProse(lire(fichier));
    for (const interdit of ["Number(", "parseInt(", "parseFloat(", "+gtin", "* 1"]) {
      assert.ok(!code.includes(interdit), `« ${interdit} » dans ${fichier}`);
    }
  }
  assert.ok(!CODE_BANC.includes("Number(") && !CODE_BANC.includes("parseInt("));
});

await test("A4-SCAN7. les zéros de tête sont conservés, caractère pour caractère", () => {
  assert.equal(exigerGtin("0000000000017"), "0000000000017");
  assert.notEqual(exigerGtin("0000000000017"), "17");
  assert.equal(normaliserGtin("  0000000000017  "), "0000000000017");
  // Deux codes qui ne diffèrent que par un zéro sont deux produits.
  assert.notEqual(exigerGtin("00000000000017"), exigerGtin("0000000000017"));
  // Les quatre longueurs légitimes, et rien d'autre.
  for (const bon of ["20000015", "012345678905", "3017620422003", "10012345678902"]) {
    assert.ok(gtinEstValide(bon), bon);
  }
  for (const mauvais of ["12345", "123456789", "12345678901", "301762042200X", ""]) {
    assert.ok(!gtinEstValide(mauvais), mauvais);
  }
});

await test("A4-SCAN8. une lecture rejetée ne déclenche AUCUN lookup et n'arrête pas le scan", async () => {
  const etat = nouvelEtatBoucle();
  // Un code de rayon, un Code 128 de logistique : la caméra les lit, c'est
  // normal. Ce qui ne serait pas normal, c'est de s'arrêter dessus.
  const moteur = fauxMoteur(["RAYON-42", "12345", "3017620422003"]);

  const a = await tenterUneImage(etat, moteur, IMAGE);
  assert.equal(a.type, "lecture_rejetee");
  assert.equal(etat.verrouillee, false, "une lecture rejetée ne verrouille rien");

  const b = await tenterUneImage(etat, moteur, IMAGE);
  assert.equal(b.type, "lecture_rejetee");
  assert.equal(etat.verrouillee, false);

  const c = await tenterUneImage(etat, moteur, IMAGE);
  assert.equal(c.type, "gtin");
  assert.equal(etat.verrouillee, true);
  assert.equal(etat.lecturesRejetees, 2);
  assert.equal(lireGtin("RAYON-42"), null);
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN9..10, 14 — LE VERROU ET LA CADENCE
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN9 · A4-SCAN10. le premier GTIN valide verrouille : un scan = un lookup", async () => {
  const etat = nouvelEtatBoucle();
  // Le même code reste visible une vingtaine d'images. Sans verrou, ce sont
  // vingt appels à /api/food-products/{gtin}.
  const moteur = fauxMoteur(Array.from({ length: 20 }, () => "3017620422003"));

  const issues = [];
  for (let i = 0; i < 20; i += 1) issues.push(await tenterUneImage(etat, moteur, IMAGE));

  const acceptés = issues.filter((i) => i.type === "gtin");
  assert.equal(acceptés.length, 1, "UN seul GTIN accepté sur vingt images");
  assert.equal(moteur.appels(), 1, "et le décodeur n'est même plus appelé après le verrou");
  assert.deepEqual(
    issues.slice(1).map((i) => (i.type === "ignoree" ? i.raison : i.type)),
    Array.from({ length: 19 }, () => "verrouillee"),
  );
});

await test("A4-SCAN14. jamais deux décodages concurrents : l'image est SAUTÉE, pas mise en file", async () => {
  const etat = nouvelEtatBoucle();
  let enCours = 0;
  let maxSimultanes = 0;
  const moteur: MoteurScan = {
    nom: "zxing-wasm",
    async initialiser() {},
    async decoder() {
      enCours += 1;
      maxSimultanes = Math.max(maxSimultanes, enCours);
      await new Promise((r) => setTimeout(r, 5));
      enCours -= 1;
      return null;
    },
    detruire() {},
  };

  // Dix images lancées ensemble, comme le ferait un intervalle trop rapide.
  const issues = await Promise.all(
    Array.from({ length: 10 }, () => tenterUneImage(etat, moteur, IMAGE)),
  );

  assert.equal(maxSimultanes, 1, "un seul décodage à la fois, mesuré");
  const sautées = issues.filter((i) => i.type === "ignoree" && i.raison === "occupee");
  assert.equal(sautées.length, 9, "les neuf autres sont sautées, pas empilées");
  assert.equal(etat.tentatives, 1);

  // Et la cadence est bornée : pas soixante images par seconde.
  assert.equal(CADENCE_PAR_SECONDE, 8);
  assert.equal(INTERVALLE_MS, 125);
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN11..13 — L'ARRÊT DE LA CAMÉRA
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN11 · REAR5. arrêter la caméra arrête TOUTES les pistes, et c'est idempotent", () => {
  const p1 = faussePiste();
  const p2 = faussePiste();
  const stream = fauxStream([p1, p2]);

  arreterCamera(stream);
  assert.equal(p1.état.arrets, 1);
  assert.equal(p2.état.arrets, 1, "toutes les pistes, pas seulement la première");

  // Idempotence : six endroits appellent cette fonction, et plusieurs peuvent
  // se déclencher dans la même milliseconde.
  arreterCamera(stream);
  arreterCamera(null);
  arreterCamera(undefined);
  assert.equal(p1.état.arrets, 2, "un second appel ne lève pas, il rearrête");

  // Une piste qui lève ne doit pas empêcher d'arrêter les suivantes.
  const fautive = {
    piste: {
      kind: "video",
      stop() {
        throw new Error("déjà détachée");
      },
    },
  };
  const p3 = faussePiste();
  arreterCamera(fauxStream([fautive, p3]));
  assert.equal(p3.état.arrets, 1, "la piste suivante est arrêtée malgré l'exception");
});

await test("A4-SCAN12 · A4-SCAN13. l'arrêt est branché sur les six sorties", () => {
  // La fonction centrale existe, et elle fait les trois choses : couper la
  // cadence, rendre les pistes, détruire le moteur.
  const bloc = CODE_BANC.slice(
    CODE_BANC.indexOf("const toutArreter = useCallback"),
    CODE_BANC.indexOf("useEffect("),
  );
  assert.ok(bloc.includes("clearInterval"), "la boucle de décodage est coupée");
  assert.ok(bloc.includes("arreterCamera(streamRef.current)"), "les pistes sont rendues");
  assert.ok(bloc.includes("srcObject = null"), "l'élément vidéo est détaché");
  assert.ok(bloc.includes("moteurRef.current?.detruire()"), "le moteur est détruit");

  // Elle est appelée depuis : le démontage, le bouton fermer, la détection, et
  // les deux chemins d'échec.
  assert.ok(CODE_BANC.includes("useEffect(() => () => toutArreter(), [toutArreter])"), "démontage");
  assert.ok(CODE_BANC.includes("onClick={() => {\n          toutArreter();"), "bouton fermer");
  const détection = CODE_BANC.slice(CODE_BANC.indexOf('issue.type === "gtin"'));
  assert.ok(
    détection.indexOf("toutArreter()") < détection.indexOf("setEtat(\"detecte\")"),
    "à la détection, la caméra est coupée AVANT l'affichage",
  );
  assert.equal((CODE_BANC.match(/toutArreter\(\)/g) ?? []).length >= 5, true);
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN15..16 — VIE PRIVÉE ET CHARGEMENT PARESSEUX
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN15. aucune image ne quitte l'appareil", () => {
  // La couche de scan ne connaît pas le réseau. Pas un `fetch`, pas un
  // `FormData`, pas un `toBlob`, pas un `toDataURL`.
  for (const fichier of [
    "../../lib/scan/gtin.ts",
    "../../lib/scan/camera.ts",
    "../../lib/scan/moteur.ts",
    "../../lib/scan/adaptateurs.ts",
  ]) {
    const code = sansProse(lire(fichier));
    for (const interdit of ["fetch(", "XMLHttpRequest", "FormData", "toBlob", "toDataURL", "navigator.sendBeacon"]) {
      assert.ok(!code.includes(interdit), `« ${interdit} » dans ${fichier}`);
    }
  }
  // Le banc d'essai non plus : il MESURE, il n'envoie rien — pas même le GTIN.
  for (const interdit of ["fetch(", "toBlob", "toDataURL", "sendBeacon", "/api/"]) {
    assert.ok(!CODE_BANC.includes(interdit), `« ${interdit} » dans le banc d'essai`);
  }
  // CONTRÔLE NÉGATIF du dépouillement : les fichiers ne sont pas vides.
  assert.ok(sansProse(lire("../../lib/scan/camera.ts")).includes("ouvrirCameraArriere"));
  assert.ok(CODE_BANC.length > 3000, `banc trop court (${CODE_BANC.length})`);
});

await test("A4-SCAN16. le moteur est chargé PARESSEUSEMENT, jamais dans le bundle principal", () => {
  // 1. Les deux bibliothèques ne sont atteintes que par `import()` dynamique.
  const adaptateurs = sansProse(lire("../../lib/scan/adaptateurs.ts"));
  assert.ok(adaptateurs.includes('await import("zxing-wasm/reader")'));
  assert.ok(adaptateurs.includes('await import("@zxing/library")'));
  assert.ok(
    !/^import .*(zxing-wasm|@zxing\/library)/m.test(adaptateurs),
    "aucune importation statique d'une bibliothèque de décodage",
  );

  // 2. Le module d'adaptateurs lui-même est chargé dynamiquement : c'est ce qui
  //    empêche le bundler de tirer les deux chunks dès l'ouverture de l'écran.
  assert.ok(CODE_BANC.includes('await import("@/lib/scan/adaptateurs")'));
  assert.ok(!/^import .*adaptateurs/m.test(CODE_BANC), "pas d'import statique des adaptateurs");

  // 3. Et AUCUN fichier de l'application hors de la couche scan ne les nomme.
  for (const fichier of [
    "../../components/student/AddFoodSheet.tsx",
    "../../lib/nutrition/produits-client.ts",
    "../../lib/supabase/consumed-meals.ts",
  ]) {
    const code = sansProse(lire(fichier));
    assert.ok(!code.includes("zxing"), `« zxing » dans ${fichier}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   A4-SCAN17..20 — LE RACCORD AVEC A3, ET LA NON-RÉGRESSION
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SCAN17 · A4-SCAN18. le scanner ne connaît QUE le GTIN — le reste est A3", () => {
  // La couche de scan ne nomme ni Open Food Facts, ni une route, ni un produit.
  // Elle produit une chaîne ; c'est le pipeline A3 qui en fait un aliment.
  for (const fichier of ["../../lib/scan/gtin.ts", "../../lib/scan/camera.ts", "../../lib/scan/moteur.ts"]) {
    const code = sansProse(lire(fichier));
    for (const interdit of ["openfoodfacts", "food-products", "food_products", "ajouter_aliment"]) {
      assert.ok(!code.toLowerCase().includes(interdit.toLowerCase()), `${interdit} dans ${fichier}`);
    }
  }
  // Et la validation métier est bien celle d'A3 : une seule implémentation,
  // réexportée. `contrat.ts` ne redéfinit pas la règle, il traduit l'exception.
  const contrat = lire("../../lib/open-food-facts/contrat.ts");
  assert.ok(contrat.includes('from "@/lib/scan/gtin"'), "A3 importe la règle, ne la recopie pas");
  assert.ok(!/function\s+gtinEstValide/.test(contrat), "aucune seconde validation dans A3");
  assert.ok(!/\[0-9\]\{8\}/.test(contrat), "aucune seconde expression régulière de GTIN");
});

await test("A4-SCAN19 · A4-SCAN20. A3 et A2 sont intacts", () => {
  // Le déplacement du GTIN a changé la FORME de l'exception côté scan : la
  // frontière A3 la retraduit, sinon la route rendrait 503 au lieu de 400.
  // Mesuré en écrivant ce déplacement — c'est pourquoi ce contrôle existe.
  const erreurScan = (() => {
    try {
      exigerGtin("12345");
      return null;
    } catch (e) {
      return e;
    }
  })();
  assert.ok(erreurScan instanceof GtinInvalide);
  assert.equal((erreurScan as GtinInvalide).code, "INVALID_GTIN");

  const contrat = lire("../../lib/open-food-facts/contrat.ts");
  assert.ok(
    contrat.includes('throw new OffErreur("INVALID_GTIN"'),
    "la frontière A3 retraduit dans son vocabulaire fermé",
  );

  // Et l'écran d'ajout d'A3 phase 5 n'a pas été touché par cette phase.
  const feuille = lire("../../components/student/AddFoodSheet.tsx");
  assert.ok(feuille.includes("searchCatalogFoods") && feuille.includes("searchCachedProducts"));
  assert.ok(feuille.includes("lireMacroPour100"), "la saisie manuelle A2 est intacte");
  assert.ok(!feuille.includes("scan"), "aucun scanner n'est encore branché dans l'écran d'élève");
});

await test("A4-SUP. les formats sont bornés aux quatre utiles, et ITF-14 en est exclu", () => {
  assert.deepEqual([...FORMATS_A4], ["ean_13", "ean_8", "upc_a", "upc_e"]);
  // ITF-14 code un CARTON de regroupement, pas une unité consommateur : le
  // rendre lisible ferait scanner des palettes, avec un chiffre indicateur
  // différent — donc un autre produit chez Open Food Facts.
  assert.ok(!(FORMATS_A4 as readonly string[]).includes("itf"));
  assert.ok(!(FORMATS_A4 as readonly string[]).includes("qr_code"));
  assert.ok(!(FORMATS_A4 as readonly string[]).includes("data_matrix"));
});

await test("A4-SUP. la torche n'est proposée que si la piste l'expose vraiment", () => {
  assert.equal(torcheDisponible(fauxStream([faussePiste({}, { torch: true })])), true);
  assert.equal(torcheDisponible(fauxStream([faussePiste({}, {})])), false);
  assert.equal(torcheDisponible(fauxStream([])), false);
  // Un `getCapabilities` absent (navigateur ancien) n'est pas un « oui ».
  const sansCapacites = { piste: { kind: "video", stop() {}, getSettings: () => ({}) } };
  assert.equal(torcheDisponible(fauxStream([sansCapacites])), false);
  // Et l'écran ne montre le bouton que dans ce cas.
  assert.ok(CODE_BANC.includes("torcheDisponible("));
});

await test("A4-SUP. le facingMode réellement obtenu est relu quand le navigateur l'expose", () => {
  assert.equal(facingModeDeLaSession(fauxStream([faussePiste({ facingMode: "environment" })])), "environment");
  assert.equal(facingModeDeLaSession(fauxStream([faussePiste({})])), null);
  assert.equal(facingModeDeLaSession(fauxStream([])), null);
  // Ne pas savoir n'est PAS une raison de rouvrir la caméra : c'est ce que dit
  // le code, et c'est ce que REAR2/REAR3 mesurent.
  assert.ok(CODE_CAMERA.includes('if (facing !== "user" || !deps.mediaDevices.enumerateDevices)'));
});

/* ══════════════════════════════════════════════════════════════════════════
   §12 — LE `.wasm` EST SERVI PAR NOTRE DÉPLOIEMENT, PAS PAR UN CDN
   ══════════════════════════════════════════════════════════════════════════ */

await test("A4-SUP §12. le WebAssembly est un asset de NOTRE build, jamais un CDN tiers", () => {
  // Ce que fait la bibliothèque si on ne lui dit rien : `zxing-wasm@3.1.2`
  // embarque un `locateFile` par défaut qui pointe sur jsDelivr. Le laisser
  // faire, ce serait un appel réseau vers un tiers à chaque premier scan —
  // hors `connect-src`, donc mort le jour où la CSP passe bloquante.
  assert.ok(
    CODE_ADAPTATEURS.includes(
      'new URL("zxing-wasm/reader/zxing_reader.wasm", import.meta.url)',
    ),
    "le chemin du .wasm passe par le bundler, qui l'émet dans /_next/static/",
  );
  assert.ok(
    /prepareZXingModule\(\{\s*overrides:/.test(CODE_ADAPTATEURS),
    "les surcharges sont RÉELLEMENT passées : sans elles, le défaut CDN s'applique",
  );

  // ⚠️ SUR LE CODE, PAS SUR LA PROSE. Les commentaires ci-dessus nomment
  // `fastly.jsdelivr.net` pour expliquer POURQUOI on le refuse : un contrôle
  // qui lirait le fichier brut échouerait sur son propre exposé des motifs.
  for (const fichier of ["adaptateurs.ts", "moteur.ts", "camera.ts", "gtin.ts"]) {
    const code = sansProse(lire(`../../lib/scan/${fichier}`));
    assert.ok(!/jsdelivr|unpkg|cdn\./i.test(code), `aucun CDN dans lib/scan/${fichier}`);
    assert.ok(!/https?:\/\//.test(code), `aucune URL absolue dans lib/scan/${fichier}`);
  }

  // CONTRÔLE NÉGATIF DU DÉCAPAGE : si `sansProse` vidait le fichier, les deux
  // assertions ci-dessus passeraient sur du vide et ne prouveraient rien.
  assert.ok(CODE_ADAPTATEURS.includes("fabriquerMoteurWasm"), "le décapage n'a pas vidé le code");
  assert.ok(CODE_ADAPTATEURS.length > 1500, "le décapage n'a pas vidé le code");
  assert.ok(
    !CODE_ADAPTATEURS.includes("LE FICHIER `.wasm` EST SERVI"),
    "le décapage a bien retiré la prose",
  );
});

await test("A4-SUP §12. les surcharges sont un objet STABLE, sinon le module est réinstancié", () => {
  // `prepareZXingModule` réutilise le module en cache si les surcharges reçues
  // sont égales en surface à celles déjà connues. Un littéral reconstruit à
  // chaque appel contiendrait une NOUVELLE fonction `locateFile` : jamais
  // égale, cache toujours invalidé, WebAssembly réinstancié à chaque ouverture
  // du scanner. L'objet doit donc être nommé, hors de la fabrique.
  assert.ok(
    /overrides: SURCHARGES_WASM/.test(CODE_ADAPTATEURS),
    "les surcharges sont passées par identifiant, pas par littéral",
  );
  assert.ok(
    /^const SURCHARGES_WASM = \{/m.test(CODE_ADAPTATEURS),
    "et elles sont construites UNE fois, au niveau du module",
  );
});

await test("A4-SUP. les noms de formats de la bibliothèque ne fuitent pas dans le vocabulaire A4", () => {
  // MESURÉ hors navigateur sur cinq EAN-13 de synthèse : `zxing-wasm@3.1.2`
  // ACCEPTE « EAN-13 » en entrée mais RENVOIE « EAN13 ». Une table qui ne
  // connaîtrait qu'une seule orthographe laisserait remonter le nom brut.
  assert.equal(formatWasmVersA4("EAN13"), "ean_13");
  assert.equal(formatWasmVersA4("EAN-13"), "ean_13");
  assert.equal(formatWasmVersA4("EAN8"), "ean_8");
  assert.equal(formatWasmVersA4("EAN-8"), "ean_8");
  assert.equal(formatWasmVersA4("UPCA"), "upc_a");
  assert.equal(formatWasmVersA4("UPC-A"), "upc_a");
  assert.equal(formatWasmVersA4("UPCE"), "upc_e");
  assert.equal(formatWasmVersA4("UPC-E"), "upc_e");

  // Ce que la table demande EST ce que la bibliothèque renvoie : sans cet
  // aller-retour, on pourrait demander un format et ne jamais savoir le relire.
  for (const f of FORMATS_A4) {
    assert.equal(formatWasmVersA4(FORMATS_WASM[f]), f, `aller-retour pour ${f}`);
  }

  // Un format inconnu n'est pas inventé : il ressort tel quel, et se voit.
  assert.equal(formatWasmVersA4("QRCode"), "QRCode");
});

await test("A4-SUP. l'interopérabilité CJS/ESM de @zxing/library est traitée, pas supposée", () => {
  // `@zxing/library@0.23.0` n'a pas de champ `exports` : `main` désigne le
  // build CommonJS, `module` le build ES. Un bundler navigateur prend le
  // second — les exportations nommées existent. Node prend le premier, et
  // `MultiFormatReader` n'est alors accessible que sous `default`. Mesuré :
  // sans cette précaution, `new MultiFormatReader()` lève « is not a
  // constructor », et le message ne dit pas pourquoi.
  assert.ok(
    /"MultiFormatReader" in importé/.test(CODE_ADAPTATEURS),
    "la forme du module est TESTÉE avant d'être déstructurée",
  );
  assert.ok(
    /\{ default: typeof importé \}/.test(CODE_ADAPTATEURS),
    "et la forme CommonJS est traitée",
  );
});

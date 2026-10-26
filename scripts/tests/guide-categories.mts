/*
 * ════════════════════════════════════════════════════════════════════════════
 * VISITES D'ESPACE — RÉSOLUTION DE ROUTE, MÉMORISATION, ET ANCRES RÉELLES
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ LE CONTRÔLE QUI COMPTE EST C1 : chaque étape doit viser un `data-guide`
 * RÉELLEMENT posé dans le code. Une étape orpheline ne lève pas d'erreur à
 * l'exécution — le guide saute la cible absente, par conception — donc elle
 * passerait inaperçue, et la visite se terminerait aussitôt sans rien montrer.
 * C'est le seul défaut de cette fonctionnalité qui soit à la fois probable et
 * silencieux : il a son test.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import {
  ESPACES_GUIDES,
  PREFIXE_CLE_ESPACE,
  cleEspace,
  espaceDejaVu,
  espaceGuidePour,
  marquerEspaceVu,
} from "../../lib/guide-categories";
import {
  CLE_GUIDE_TERMINE,
  ETAPES_ELEVE as ETAPES_ELEVE_IMPORT,
  ETAPES_STAFF as ETAPES_STAFF_IMPORT,
  prochaineEtapeAtteignable,
} from "../../lib/guide-decouverte";

const RACINE = new URL("../../", import.meta.url).pathname;

/**
 * Le code sans les commentaires.
 *
 * ⚠️ INDISPENSABLE AVANT TOUTE ASSERTION « CE MOT N'APPARAÎT PAS ». Les
 * fichiers de ce dépôt expliquent longuement ce qu'ils NE font pas :
 * `StudentAdaptiveRecipes` écrit noir sur blanc qu'il « n'expose ni
 * "Enregistrer", ni "Appliquer" ». Chercher ces mots dans la source brute fait
 * échouer le test sur la phrase qui dit précisément la bonne chose — et pousse
 * à supprimer la documentation pour faire passer le test. On compare donc le
 * code, pas la prose.
 */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

/** Toutes les valeurs `data-guide="…"` posées dans le code de l'application. */
function ancresPosees(): Set<string> {
  const trouvees = new Set<string>();
  const parcourir = (dossier: string) => {
    for (const entree of readdirSync(dossier)) {
      if (entree === "node_modules" || entree === ".next" || entree.startsWith(".")) continue;
      const chemin = `${dossier}/${entree}`;
      if (statSync(chemin).isDirectory()) {
        parcourir(chemin);
        continue;
      }
      if (!entree.endsWith(".tsx")) continue;
      const source = readFileSync(chemin, "utf8");
      /*
       * DEUX FORMES DE DÉCLARATION, et les deux comptent.
       *   · `data-guide="x"` — l'attribut posé directement sur un élément ;
       *   · `dataGuide="x"`  — la prop d'un composant partagé qui le repose
       *     sur sa racine (StatCard : l'envelopper casserait la grille) ;
       *   · `{...(cond ? { "data-guide": "x" } : {})}` — l'attribut posé
       *     CONDITIONNELLEMENT, seule façon de n'ancrer que la première série
       *     d'un exercice sans dupliquer l'attribut sur toutes les lignes.
       * N'en connaître qu'une partie ferait échouer ce contrôle sur des ancres
       * pourtant bien réelles — et inciterait à affaiblir l'assertion.
       */
      for (const m of source.matchAll(/data-guide="([^"]+)"/g)) trouvees.add(m[1]!);
      for (const m of source.matchAll(/dataGuide="([^"]+)"/g)) trouvees.add(m[1]!);
      for (const m of source.matchAll(/"data-guide":\s*"([^"]+)"/g)) trouvees.add(m[1]!);
    }
  };
  parcourir(`${RACINE}app`);
  parcourir(`${RACINE}components`);
  return trouvees;
}

/* ═══════════════ A. RÉSOLUTION DE ROUTE ═══════════════ */

await test("A1. la route la plus spécifique l'emporte", () => {
  assert.equal(espaceGuidePour("/entrainement")?.id, "entrainement-accueil");
  assert.equal(espaceGuidePour("/entrainement/seance/abc")?.id, "entrainement-seance",
    "une séance ouverte ne doit PAS recevoir la visite de l'accueil");
  assert.equal(espaceGuidePour("/entrainement/historique")?.id, "entrainement-accueil");
});

await test("A2. une route sans visite ne propose rien", () => {
  assert.equal(espaceGuidePour("/profil"), null);
  assert.equal(espaceGuidePour("/admin/paiements"), null);
  assert.equal(espaceGuidePour(null), null);
  assert.equal(espaceGuidePour(undefined), null);
  assert.equal(espaceGuidePour(""), null);
});

await test("A3. l'ordre de déclaration ne change pas le résultat", () => {
  /* La règle est « le préfixe le plus long gagne », pas « le premier déclaré » :
     réarranger le tableau ne doit donc rien casser. */
  const parLongueur = [...ESPACES_GUIDES].sort((a, b) => a.route.length - b.route.length);
  const plusLong = parLongueur[parLongueur.length - 1]!;
  assert.equal(espaceGuidePour(`${plusLong.route}/quelque-chose`)?.id, plusLong.id);
});

await test("A4. une page sous un identifiant variable est reconnue par son suffixe", () => {
  /*
   * `/nutrition/<id>/recettes` correspond au préfixe `/nutrition/` comme la
   * page du plan : seul le suffixe les distingue. Sans lui, la visite des
   * recettes serait inatteignable — et personne ne s'en apercevrait, puisque
   * la visite du plan s'afficherait à sa place, avec des cibles absentes.
   */
  assert.equal(espaceGuidePour("/nutrition/abc-123/recettes")?.id, "nutrition-recettes");
  assert.equal(espaceGuidePour("/nutrition/abc-123")?.id, "nutrition-plan");
  assert.equal(espaceGuidePour("/nutrition/abc-123/recettes/detail")?.id, "nutrition-plan",
    "le suffixe est une CONDITION : une page plus profonde ne l'emprunte pas");
});

await test("A5. un suffixe déclaré est exigé, jamais seulement préféré", () => {
  for (const espace of ESPACES_GUIDES) {
    if (!espace.routeSuffixe) continue;
    const sansSuffixe = `${espace.route}quelque-chose`;
    assert.notEqual(espaceGuidePour(sansSuffixe)?.id, espace.id,
      `${espace.id} ne doit pas s'appliquer à une route qui ne finit pas par ${espace.routeSuffixe}`);
  }
});

/* ═══════════════ B. MÉMORISATION, PAR ESPACE ═══════════════ */

function stockageFactice() {
  const donnees = new Map<string, string>();
  return {
    getItem: (c: string) => donnees.get(c) ?? null,
    setItem: (c: string, v: string) => void donnees.set(c, v),
    taille: () => donnees.size,
  };
}

await test("B1. chaque espace a sa propre mémoire", () => {
  const stockage = stockageFactice();
  assert.equal(espaceDejaVu(stockage, "nutrition-plan"), false);
  marquerEspaceVu(stockage, "nutrition-plan");
  assert.equal(espaceDejaVu(stockage, "nutrition-plan"), true);
  assert.equal(espaceDejaVu(stockage, "entrainement-accueil"), false,
    "avoir vu la nutrition ne doit pas masquer la visite de l'entraînement");
});

await test("B2. la clé d'espace ne touche JAMAIS celle de la visite des menus", () => {
  for (const espace of ESPACES_GUIDES) {
    assert.ok(cleEspace(espace.id).startsWith(PREFIXE_CLE_ESPACE));
    assert.notEqual(cleEspace(espace.id), CLE_GUIDE_TERMINE,
      "partager la clé ferait disparaître toutes les propositions d'un coup");
  }
  const stockage = stockageFactice();
  marquerEspaceVu(stockage, "nutrition-plan");
  assert.equal(stockage.getItem(CLE_GUIDE_TERMINE), null, "la visite des menus reste intacte");
});

await test("B3. un stockage refusé ne fait pas planter", () => {
  const refus = {
    getItem: () => {
      throw new Error("mode privé");
    },
    setItem: () => {
      throw new Error("mode privé");
    },
  };
  assert.doesNotThrow(() => espaceDejaVu(refus, "x"));
  assert.equal(espaceDejaVu(refus, "x"), false);
  assert.doesNotThrow(() => marquerEspaceVu(refus, "x"));
  assert.equal(espaceDejaVu(null, "x"), false);
  assert.doesNotThrow(() => marquerEspaceVu(null, "x"));
});

/* ═══════════════ C. ANCRES ET CONTENU ═══════════════ */

await test("C1. chaque étape vise une ancre `data-guide` RÉELLEMENT posée", () => {
  const posees = ancresPosees();
  const manquantes: string[] = [];
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!posees.has(etape.cible)) manquantes.push(`${espace.id}/${etape.id} → ${etape.cible}`);
    }
  }
  assert.deepEqual(manquantes, [],
    "une étape sans ancre serait sautée en silence et la visite se terminerait sans rien montrer");
});

await test("C2. aucun espace vide, aucun identifiant ni aucune cible en double", () => {
  const ids: string[] = [];
  const cibles: string[] = [];
  for (const espace of ESPACES_GUIDES) {
    assert.ok(espace.etapes.length > 0, `${espace.id} a au moins une étape`);
    assert.ok(espace.route.startsWith("/"), `${espace.id} a une route`);
    assert.ok(espace.titre.length > 0, `${espace.id} a un titre`);
    for (const etape of espace.etapes) {
      ids.push(etape.id);
      cibles.push(etape.cible);
      assert.ok(etape.titre.length > 0, `${etape.id} a un titre`);
      assert.ok(etape.texte.length > 20, `${etape.id} explique réellement quelque chose`);
    }
  }
  assert.equal(new Set(ids).size, ids.length, "identifiants d'étape uniques");
  assert.equal(new Set(cibles).size, cibles.length, "cibles uniques");
});

await test("C3. la visite d'espace n'altère pas celle des menus", () => {
  const lire = (c: string) => readFileSync(`${RACINE}${c}`, "utf8");
  const categories = lire("lib/guide-categories.ts");
  const composant = lire("components/guide/GuideEspace.tsx");
  // Elle REPREND le composant existant, elle ne le redéfinit pas.
  assert.ok(/from "@\/components\/guide\/GuideDecouverte"/.test(composant),
    "GuideEspace réutilise GuideDecouverte tel quel");
  assert.ok(!/ETAPES_STAFF|ETAPES_ELEVE|etapesStaffVisibles|etapesEleveVisibles/.test(categories),
    "le catalogue d'espaces ne touche pas aux parcours de menus");
  assert.ok(!/marquerGuideVu|guideDejaVu\(/.test(categories),
    "ni à leur mémorisation");
});

await test("C4. l'alimentation couvre bien les trois façons d'ajouter un aliment", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition, "la visite de l'alimentation existe");
  const repas = nutrition.etapes.find((e) => e.id === "nut-repas");
  assert.ok(repas, "l'étape d'enregistrement d'un repas existe");
  for (const mot of [/chercher|banque/i, /main/i, /scanner|code-barres/i]) {
    assert.match(repas.texte, mot, `l'explication mentionne ${mot}`);
  }
});

/* ═══════════ D. LE MOTEUR ÉTENDU : OUVERTURE, ATTENTE, SÛRETÉ ═══════════ */

await test("D1. `ouvrirVia` ne désigne JAMAIS une validation ou un enregistrement", () => {
  /*
   * ⚠️ L'INTERDIT CENTRAL. Le guide presse lui-même le déclencheur déclaré :
   * si une étape y mettait un bouton d'enregistrement, le guide écrirait à la
   * place de l'élève. Ce contrôle refuse tout identifiant qui ressemble à une
   * action d'écriture, plutôt que de faire confiance à l'auteur de l'étape.
   */
  const interdits = /enregistr|valider|confirm|supprim|envoyer|soumettre|terminer|submit|save|delete/i;
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!etape.ouvrirVia) continue;
      assert.doesNotMatch(etape.ouvrirVia, interdits,
        `${espace.id}/${etape.id} : « ${etape.ouvrirVia} » ressemble à une action d'écriture`);
    }
  }
});

await test("D2. toute étape qui ouvre une interface déclare aussi par où la refermer", () => {
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!etape.ouvrirVia) continue;
      assert.ok(etape.fermerVia,
        `${espace.id}/${etape.id} ouvre une interface sans dire comment la refermer : quitter le guide laisserait l'élève dedans`);
    }
  }
});

await test("D3. une attente est toujours BORNÉE", () => {
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (etape.attenteMs === undefined) continue;
      assert.ok(Number.isFinite(etape.attenteMs) && etape.attenteMs > 0,
        `${espace.id}/${etape.id} : attente non finie`);
      assert.ok(etape.attenteMs <= 5000,
        `${espace.id}/${etape.id} : ${etape.attenteMs} ms, c'est trop long pour un écran qui attend`);
    }
  }
});

await test("D4. les nouveaux champs restent OPTIONNELS : les parcours existants n'en ont pas", () => {
  const menus = [...ETAPES_STAFF_IMPORT, ...ETAPES_ELEVE_IMPORT];
  for (const etape of menus) {
    assert.equal(etape.ouvrirVia, undefined, `${etape.id} : la visite des menus n'ouvre rien`);
    assert.equal(etape.attenteMs, undefined, `${etape.id} : ni n'attend`);
    assert.equal(etape.gesteAttendu, undefined,
      `${etape.id} : la découpe des menus reste fermée aux clics, sans quoi cliquer un menu changerait de route en pleine visite`);
  }
});

await test("D5. le moteur ouvre au plus une fois par étape et ne reste jamais bloqué", () => {
  const composant = readFileSync(`${RACINE}components/guide/GuideDecouverte.tsx`, "utf8");
  assert.match(composant, /ouvertePour\.current !== etape\.id/, "une ouverture par étape, pas une par image");
  assert.match(composant, /ouvertePour\.current = etape\.id/, "le déclencheur est marqué avant d'être pressé");
  assert.match(composant, /Date\.now\(\) < echeance\.current/, "l'attente est comparée à une échéance");
  assert.match(composant, /prochaineEtapeAtteignable\(etapes, index \+ 1, 1, cibleExiste\)/,
    "délai écoulé : on saute à l'étape suivante");
  assert.match(composant, /attenteEnCours\.current = false;\s*\n\s*cancelAnimationFrame/,
    "la boucle d'attente est arrêtée au démontage");
  /*
   * ⚠️ CONTRAT RENFORCÉ, PAS ASSOUPLI. La version précédente ne refermait que si
   * l'étape COURANTE était celle qui avait ouvert. Une interface ouverte à
   * l'étape 2 et quittée à l'étape 5 restait donc ouverte — et c'est à l'étape
   * 5 qu'on quitte, puisqu'on a lu ce qu'on voulait. La commande de fermeture
   * est maintenant retenue au moment de l'ouverture et vaut pour toute la
   * suite du parcours.
   *
   * La garantie « seulement ce que le guide a ouvert » est préservée : `aFermer`
   * n'est renseigné que dans la branche qui presse réellement le déclencheur.
   */
  assert.match(composant, /if \(etape\.fermerVia\) aFermer\.current = etape\.fermerVia;/,
    "la commande de fermeture est mémorisée AU MOMENT de l'ouverture");
  assert.match(composant, /if \(aFermer\.current\) \{\s*\n\s*elementCible\(aFermer\.current\)\?\.click\(\);/,
    "et pressée à la sortie, depuis n'importe quelle étape");
  assert.doesNotMatch(composant, /ouvertePour\.current === etape\.id/,
    "l'ancienne condition, trop étroite, ne doit pas revenir");
});

/* ═══════════ E. NUTRITION : OBJECTIFS, CONSOMMÉ, RESTANT ═══════════ */

await test("E1. les quatre objectifs sont ciblés INDIVIDUELLEMENT", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const cibles = nutrition.etapes.map((e) => e.cible);
  for (const attendue of [
    "nutrition-objectif-kcal",
    "nutrition-objectif-proteines",
    "nutrition-objectif-glucides",
    "nutrition-objectif-lipides",
  ]) {
    assert.ok(cibles.includes(attendue), `${attendue} a son étape propre`);
  }
  assert.equal(new Set(cibles).size, cibles.length, "aucune cible partagée : chaque chiffre est montré pour lui-même");
});

await test("E2. le bilan distingue objectif, consommé et restant", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  const bilan = nutrition?.etapes.find((e) => e.cible === "nutrition-bilan-jour");
  assert.ok(bilan, "l'étape de bilan existe");
  for (const mot of [/objectif/i, /consomm/i, /rest/i]) {
    assert.match(bilan.texte, mot, `le texte nomme ${mot}`);
  }
});

await test("E3. aucune valeur n'est présentée comme une recommandation médicale", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  /*
   * ⚠️ LA DÉNÉGATION EST LA BONNE FORMULATION, PAS UNE INFRACTION. Un texte
   * qui dit « ce n'est PAS une prescription médicale » fait exactement ce
   * qu'on demande ; le motif ne doit donc attraper que l'affirmation. D'où la
   * recherche arrière sur la négation, plutôt qu'un mot interdit en vrac —
   * qui aurait poussé à retirer le garde-fou du texte pour faire passer le test.
   */
  const interdits = /tu dois manger|il faut manger|ordonnance|régime prescrit|(?<!pas une |n'est pas une |pas de )(prescription|recommandation médicale)/i;
  for (const etape of nutrition.etapes) {
    assert.doesNotMatch(etape.texte, interdits, `${etape.id} : formulation trop prescriptive`);
  }
});

/* ═══════ F. LE GESTE RÉEL : QUI APPUIE, ET SUR QUOI ═══════ */

/**
 * Les verbes qui dénoncent une action d'écriture dans un identifiant d'ancre.
 *
 * ⚠️ UNE SEULE LISTE POUR `ouvrirVia` ET `gesteAttendu`. La dupliquer aurait
 * garanti sa divergence : le jour où un verbe est ajouté d'un côté, l'autre
 * contrôle deviendrait silencieusement plus faible.
 */
const ANCRE_ECRITURE = /enregistr|valider|confirm|supprim|envoyer|soumettre|terminer|submit|save|delete/i;

await test("F1. `gesteAttendu` n'ouvre JAMAIS la découpe sur une validation", () => {
  /*
   * Ouvrir la découpe rend la cible réellement cliquable. Le faire sur un
   * bouton « Enregistrer » inviterait à enregistrer au milieu d'une visite,
   * avec le voile encore à l'écran — l'inverse de ce que cette fonctionnalité
   * promet.
   */
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!etape.gesteAttendu) continue;
      assert.doesNotMatch(etape.cible, ANCRE_ECRITURE,
        `${espace.id}/${etape.id} : « ${etape.cible} » ressemble à une action d'écriture`);
    }
  }
});

await test("F2. une étape ne peut pas à la fois presser et laisser presser", () => {
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      if (!etape.gesteAttendu) continue;
      assert.equal(etape.ouvrirVia, undefined,
        `${espace.id}/${etape.id} : `
        + "`ouvrirVia` presse à la place de l'utilisateur, `gesteAttendu` lui laisse la main — déclarer les deux rendrait le geste imprévisible");
    }
  }
});

await test("F3. l'ouverture de la feuille d'ajout est laissée à l'élève, car elle écrit", () => {
  /*
   * ⚠️ LE CONTRÔLE LE PLUS IMPORTANT DE CE LOT. `ouvrirAjout()` dans
   * `ConsumedMealSection` appelle `onOuvrirConteneur()` quand aucun repas
   * n'existe encore pour le créneau : presser ce bouton CRÉE une ligne en base.
   * Une visite qui le presserait écrirait dans le journal alimentaire d'un
   * élève pour illustrer une explication. L'étape doit donc déclarer
   * `gesteAttendu`, et surtout pas `ouvrirVia`.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const ouvrir = nutrition.etapes.find((e) => e.cible === "nutrition-ajout-ouvrir");
  assert.ok(ouvrir, "l'étape d'ouverture de la feuille d'ajout existe");
  assert.equal(ouvrir.gesteAttendu, true, "l'élève appuie lui-même");
  assert.equal(ouvrir.ouvrirVia, undefined, "le guide ne presse pas ce bouton");
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      assert.notEqual(etape.ouvrirVia, "nutrition-ajout-ouvrir",
        `${espace.id}/${etape.id} presserait un bouton qui crée un repas en base`);
    }
  }

  // Et la raison de cette règle est bien dans le code, pas seulement ici.
  const section = sansProse(readFileSync(`${RACINE}components/student/ConsumedMealSection.tsx`, "utf8"));
  assert.match(section, /onOuvrirConteneur\(\)/,
    "si l'ouverture n'écrit plus rien, cette contrainte doit être rediscutée — pas contournée");
});

await test("F4. la visite n'allume jamais la caméra", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const camera = nutrition.etapes.find((e) => e.cible === "nutrition-scan-camera");
  assert.ok(camera, "l'étape du bouton d'ouverture de la caméra existe");
  assert.equal(camera.gesteAttendu, undefined,
    "ce bouton est montré et expliqué, pas rendu cliquable à travers le voile");
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      assert.notEqual(etape.ouvrirVia, "nutrition-scan-camera",
        `${espace.id}/${etape.id} allumerait la caméra de l'élève`);
      assert.notEqual(etape.ouvrirVia, "nutrition-ajout-scanner",
        `${espace.id}/${etape.id} ouvrirait l'écran du scanner sans geste de l'élève`);
    }
  }
  // La promesse affichée par le composant et celle du guide doivent coïncider.
  const scanner = sansProse(readFileSync(`${RACINE}components/student/ScannerCodeBarres.tsx`, "utf8"));
  assert.match(scanner, /La caméra ne s&apos;ouvre qu&apos;à ta/,
    "le guide reprend une phrase réellement affichée par l'écran du scanner");
});

await test("F5. le moteur n'ouvre la découpe que sur demande explicite de l'étape", () => {
  const composant = readFileSync(`${RACINE}components/guide/GuideDecouverte.tsx`, "utf8");
  assert.match(composant, /etape\?\.gesteAttendu && decoupe \?/,
    "les bandes de sortie ne remplacent le voile plein que sur une étape `gesteAttendu`");
  assert.match(composant, /className="absolute inset-0 h-full w-full cursor-default"/,
    "le voile plein — comportement de tous les parcours déjà livrés — reste la branche par défaut");
  assert.match(composant, /if \(etape\?\.gesteAttendu\) \{\s*\n\s*const cible = elementCible\(etape\.cible\);/,
    "sur une étape `gesteAttendu`, la cible rejoint l'anneau de tabulation : sinon l'étape serait un cul-de-sac au clavier");
  assert.match(composant, /className="pointer-events-none absolute inset-0 h-full w-full"/,
    "le voile SVG ne doit rien intercepter, sans quoi la découpe resterait fermée malgré les bandes");
});

/* ═══════ G. SÉLECTIONNER, DOSER, ENREGISTRER : TROIS GESTES DISTINCTS ═══════ */

await test("G1. la quantité et la confirmation sont ciblées SÉPARÉMENT", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const cibles = nutrition.etapes.map((e) => e.cible);
  for (const attendue of [
    "nutrition-ajout-recherche",
    "nutrition-ajout-resultats",
    "nutrition-ajout-quantite",
    "nutrition-ajout-confirmer",
  ]) {
    assert.ok(cibles.includes(attendue), `${attendue} a son étape propre`);
  }
  /* Choisir un aliment, le doser, puis l'enregistrer sont trois gestes : les
     réunir sous une seule étape est précisément la confusion à éviter. */
  const resultats = nutrition.etapes.find((e) => e.cible === "nutrition-ajout-resultats")!;
  assert.match(resultats.texte, /n'enregistre rien/i,
    "appuyer sur un résultat ne fait qu'ouvrir l'étape de quantité");
  const confirmer = nutrition.etapes.find((e) => e.cible === "nutrition-ajout-confirmer")!;
  assert.match(confirmer.texte, /journal/i, "l'étape dit OÙ la ligne est écrite");
  assert.match(confirmer.texte, /ne le presse pas|pas la visite/i,
    "et que la visite ne le presse pas");
});

await test("G2. les listes montrées sont celles qui existent vraiment", () => {
  /*
   * ⚠️ AUCUNE CATÉGORIE INVENTÉE. La feuille d'ajout n'offre que quatre
   * ensembles : les aliments génériques, les produits, les favoris et les
   * récents. Une étape qui parlerait de « rayons » ou de « catégories »
   * promettrait un écran qui n'existe pas.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const posees = ancresPosees();
  for (const liste of ["nutrition-liste-favoris", "nutrition-liste-recents"]) {
    assert.ok(posees.has(liste), `${liste} est posée dans le code`);
    assert.ok(nutrition.etapes.some((e) => e.cible === liste), `${liste} a son étape`);
  }
  const recents = nutrition.etapes.find((e) => e.cible === "nutrition-liste-recents")!;
  assert.match(recents.texte, /seules listes/i,
    "le texte borne explicitement ce qui existe, au lieu de laisser imaginer le reste");
});

await test("G3. la page des recettes n'enregistre rien, et la visite le dit", () => {
  const recettes = ESPACES_GUIDES.find((e) => e.id === "nutrition-recettes");
  assert.ok(recettes, "la visite des recettes existe");
  const franc = recettes.etapes.filter((e) => /rien n'est enregistré|n'écrit ni/i.test(e.texte));
  assert.ok(franc.length > 0,
    "sans cette phrase, un élève pourrait croire son repas noté alors que son journal reste vide");

  /*
   * ⚠️ ET C'EST VÉRIFIÉ SUR LE COMPOSANT, PAS SEULEMENT SUR LE TEXTE. Le jour
   * où cette page gagnerait une écriture, la phrase ci-dessus deviendrait un
   * mensonge : ce contrôle échouerait alors, et c'est exactement ce qu'on
   * attend de lui.
   */
  const composant = sansProse(readFileSync(`${RACINE}components/student/StudentAdaptiveRecipes.tsx`, "utf8"));
  assert.doesNotMatch(composant, /from "@\/lib\/supabase/,
    "le composant des recettes n'importe rien de la base");
  for (const promesse of [/Enregistrer/, /Appliquer/, /Ajouter au plan/, /Marquer comme consommé/]) {
    assert.doesNotMatch(composant, promesse, `aucun bouton ${promesse} sur cette page`);
  }
});

await test("G4. la visite des recettes ne parle pas de portions, qui n'existent pas ici", () => {
  const recettes = ESPACES_GUIDES.find((e) => e.id === "nutrition-recettes");
  assert.ok(recettes);
  const composant = sansProse(readFileSync(`${RACINE}components/student/StudentAdaptiveRecipes.tsx`, "utf8"));
  const parlePortions = /portion/i.test(composant);
  for (const etape of recettes.etapes) {
    if (parlePortions) break;
    assert.doesNotMatch(etape.texte, /portion/i,
      `${etape.id} : le composant adapte des QUANTITÉS par ingrédient et n'expose aucun nombre de parts`);
  }
});

/* ═══════ H. SÉANCE : CHARGE, RÉPÉTITIONS, CHRONOMÈTRE ═══════ */

await test("H1. la charge et les répétitions sont ciblées INDIVIDUELLEMENT", () => {
  /*
   * ⚠️ PAS LA CARTE, LES CHAMPS. Une ligne de série porte trois champs côte à
   * côte — charge, répétitions, RPE — sans libellé visible. Mettre en lumière
   * la carte entière laisserait l'élève devant la question qu'il se pose :
   * lequel des trois est la charge ?
   */
  const seance = ESPACES_GUIDES.find((e) => e.id === "entrainement-seance");
  assert.ok(seance);
  const cibles = seance.etapes.map((e) => e.cible);
  for (const attendue of ["seance-exercice", "seance-serie", "seance-charge", "seance-reps"]) {
    assert.ok(cibles.includes(attendue), `${attendue} a son étape propre`);
  }
  const charge = seance.etapes.find((e) => e.cible === "seance-charge")!;
  const reps = seance.etapes.find((e) => e.cible === "seance-reps")!;
  assert.notEqual(charge.cible, reps.cible, "deux cibles distinctes, pas une enveloppe commune");
  assert.notEqual(charge.cible, "seance-exercice");
  assert.notEqual(reps.cible, "seance-exercice");
});

await test("H2. le RPE d'une série n'est pas le RPE global de la séance", () => {
  const seance = ESPACES_GUIDES.find((e) => e.id === "entrainement-seance");
  assert.ok(seance);
  const globale = seance.etapes.find((e) => e.cible === "seance-rpe");
  const serie = seance.etapes.find((e) => e.cible === "seance-rpe-serie");
  assert.ok(globale, "l'étape du RPE global existe toujours");
  assert.ok(serie, "celle du RPE de série aussi");
  assert.notEqual(globale.cible, serie.cible);
  assert.match(serie.texte, /global/i, "l'étape de série écarte explicitement la confusion");
});

await test("H3. les ancres d'exercice vivent sur la carte de MUSCULATION", () => {
  /*
   * C'est ce qui donne la dégradation voulue : une séance uniquement cardio ne
   * monte aucune de ces cartes, les cibles n'existent pas, et le moteur saute
   * les étapes. Si ces ancres migraient un jour vers un conteneur commun aux
   * deux types de bloc, les étapes se mettraient à parler de charge et de
   * répétitions sur une séance qui n'en a pas.
   */
  const carte = sansProse(readFileSync(`${RACINE}components/student/ExerciseFeedbackCard.tsx`, "utf8"));
  for (const ancre of ["seance-exercice", "seance-prescription", "seance-charge", "seance-reps"]) {
    assert.ok(carte.includes(ancre), `${ancre} est posée par ExerciseFeedbackCard`);
  }
  const section = sansProse(readFileSync(`${RACINE}components/student/SessionFeedbackSection.tsx`, "utf8"));
  assert.match(section, /renderStrengthExercise=\{\(exercise, index\) => \(\s*<ExerciseFeedbackCard/,
    "la carte reste montée par le rendu MUSCULATION du carrousel");
});

await test("H4. les étapes du chronomètre correspondent aux commandes réelles", () => {
  const seance = ESPACES_GUIDES.find((e) => e.id === "entrainement-seance");
  assert.ok(seance);
  const chrono = seance.etapes.filter((e) => e.cible.startsWith("chrono-"));
  assert.ok(chrono.length >= 4, "ouvrir, cadran, marche/pause, réglage de la durée");
  const posees = ancresPosees();
  for (const etape of chrono) {
    assert.ok(posees.has(etape.cible), `${etape.cible} est posée dans le chronomètre`);
  }
  // Et les commandes nommées existent bien dans le composant.
  const composant = sansProse(readFileSync(`${RACINE}components/student/ChronometreSeance.tsx`, "utf8"));
  for (const libelle of [/Pause/, /Démarrer/, /Reprendre/, /−30 s/, /\+30 s/, /Minutes/, /Secondes/]) {
    assert.match(composant, libelle, `le chronomètre expose bien ${libelle}`);
  }
});

await test("H5. le chronomètre n'est jamais DÉMARRÉ par la visite", () => {
  /*
   * ⚠️ OUVRIR LE PANNEAU N'EST PAS LANCER LE DÉCOMPTE. Le guide presse
   * `chrono-ouvrir`, qui ne fait qu'afficher le panneau et ne touche à aucune
   * donnée. Aucune étape ne doit désigner la commande de marche, ni comme
   * déclencheur, ni comme geste rendu cliquable à travers le voile.
   */
  for (const espace of ESPACES_GUIDES) {
    for (const etape of espace.etapes) {
      assert.notEqual(etape.ouvrirVia, "chrono-marche",
        `${espace.id}/${etape.id} lancerait le minuteur à la place de l'élève`);
      if (etape.cible === "chrono-marche") {
        assert.notEqual(etape.gesteAttendu, true,
          "la commande de marche est montrée, pas rendue cliquable à travers le voile");
      }
    }
  }
});

await test("H6. le chronomètre de repos n'est pas présenté comme la durée de la séance", () => {
  /*
   * Le composant le documente : il ne mesure pas la séance, n'écrit dans aucun
   * champ de retour et ne persiste rien. La durée de séance est DÉCLARÉE par
   * l'élève, et la durée d'un bloc cardio se saisit sous le bloc.
   */
  const seance = ESPACES_GUIDES.find((e) => e.id === "entrainement-seance");
  assert.ok(seance);
  const ouvrir = seance.etapes.find((e) => e.cible === "chrono-ouvrir")!;
  assert.match(ouvrir.texte, /repos/i, "l'étape nomme ce qu'il est");
  assert.match(ouvrir.texte, /ne mesure pas la séance|pas la durée/i,
    "et ce qu'il n'est pas");
  assert.match(ouvrir.texte, /cardio/i, "y compris face à la durée d'un bloc cardio");

  const composant = sansProse(readFileSync(`${RACINE}components/student/ChronometreSeance.tsx`, "utf8"));
  assert.doesNotMatch(composant, /from "@\/lib\/supabase/,
    "si le chronomètre se mettait à écrire, ces explications deviendraient fausses");
});

/* ═══════ I. LES NOUVEAUX ESPACES ÉLÈVE ═══════ */

await test("I1. chaque nouvel espace a sa route, ses étapes et sa mémoire", () => {
  for (const id of ["dashboard", "progression", "documents"]) {
    const espace = ESPACES_GUIDES.find((e) => e.id === id);
    assert.ok(espace, `l'espace ${id} existe`);
    assert.equal(espaceGuidePour(espace.route)?.id, id, `${espace.route} mène à ${id}`);
    assert.ok(espace.etapes.length >= 5, `${id} explique plus d'un élément`);
    assert.notEqual(cleEspace(id), CLE_GUIDE_TERMINE);
  }
  // Mémoires indépendantes : avoir vu l'une ne masque aucune autre.
  const stockage = stockageFactice();
  marquerEspaceVu(stockage, "dashboard");
  assert.equal(espaceDejaVu(stockage, "progression"), false);
  assert.equal(espaceDejaVu(stockage, "documents"), false);
  assert.equal(espaceDejaVu(stockage, "dashboard"), true);
});

await test("I2. une route exacte ne déborde pas sur ses sous-pages", () => {
  /*
   * `/documents/<id>` est la FICHE d'un document : ni recherche, ni filtres, ni
   * liste. Y proposer la visite de la bibliothèque ouvrirait un parcours dont
   * aucune cible n'existe, qui se refermerait sans rien montrer.
   */
  assert.equal(espaceGuidePour("/documents")?.id, "documents");
  assert.equal(espaceGuidePour("/documents/abc-123"), null);
  assert.equal(espaceGuidePour("/dashboard")?.id, "dashboard");
  assert.equal(espaceGuidePour("/progression")?.id, "progression");
});

await test("I3. le tableau de bord ne présente AUCUNE donnée d'exemple comme réelle", () => {
  /*
   * ⚠️ LE CONTRÔLE LE PLUS UTILE DE CE GROUPE. La page passe encore des données
   * d'exemple (`@/data/student`) pour les notifications et les documents
   * récents, et la première vignette est écrite en dur avec le mot
   * « (exemple) ». Aucune étape ne doit porter sur ces éléments : un élève qui
   * prendrait « 3 / 5 séances » pour son propre suivi cesserait de croire au
   * reste de la page.
   */
  const dashboard = ESPACES_GUIDES.find((e) => e.id === "dashboard");
  assert.ok(dashboard);
  const contenu = sansProse(readFileSync(`${RACINE}components/student/DashboardContent.tsx`, "utf8"));
  // La vignette d'exemple existe toujours, et n'est toujours pas ancrée.
  assert.match(contenu, /Séances cette semaine \(exemple\)/,
    "si ce libellé disparaît parce que la vignette devient réelle, cette règle doit être rediscutée");
  const posees = ancresPosees();
  for (const interdite of ["dashboard-seances-semaine", "dashboard-notifications", "dashboard-documents"]) {
    assert.ok(!posees.has(interdite), `${interdite} ne doit pas être ancrée : son contenu est un exemple`);
    assert.ok(!dashboard.etapes.some((e) => e.cible === interdite), `ni avoir d'étape`);
  }
});

await test("I4. les documents ne promettent pas une action qui peut ne pas exister", () => {
  /*
   * Selon le document, l'action réelle est « Ouvrir le PDF », « Voir la
   * vidéo », « Ouvrir » ou « Télécharger » — et sur un document verrouillé,
   * aucune. Une étape qui annoncerait « télécharger » tomberait à faux une fois
   * sur deux.
   */
  const documents = ESPACES_GUIDES.find((e) => e.id === "documents");
  assert.ok(documents);
  const actions = documents.etapes.find((e) => e.cible === "documents-actions")!;
  assert.match(actions.texte, /selon/i, "l'étape dit que l'action dépend du document");
  assert.match(actions.texte, /verrouill/i, "et qu'un document verrouillé n'en propose aucune");
  const bibliotheque = sansProse(readFileSync(`${RACINE}components/student/RealDocumentLibrary.tsx`, "utf8"));
  for (const libelle of [/Ouvrir le PDF/, /Voir la vidéo/, /Télécharger/]) {
    assert.match(bibliotheque, libelle, `la bibliothèque expose bien ${libelle}`);
  }
});

await test("I5. la progression distingue l'instantané de l'historique", () => {
  const progression = ESPACES_GUIDES.find((e) => e.id === "progression");
  assert.ok(progression);
  const resume = progression.etapes.find((e) => e.cible === "progression-resume")!;
  assert.match(resume.texte, /instantané/i, "le résumé est un état, pas une histoire");
  const poids = progression.etapes.find((e) => e.cible === "progression-poids")!;
  assert.match(poids.texte, /objectif/i, "l'évolution est distinguée de l'objectif visé");
  const nutrition = progression.etapes.find((e) => e.cible === "progression-nutrition")!;
  assert.match(nutrition.texte, /sept jours|semaine/i, "la fenêtre de la section nutrition est dite");
});

/* ═══════ J. ORDRE, NAVIGATION, RELANCE ═══════ */

await test("J1. l'ordre des étapes suit le geste réel, pas l'ordre d'écriture", () => {
  const rang = (id: string, cible: string) => {
    const espace = ESPACES_GUIDES.find((e) => e.id === id)!;
    const i = espace.etapes.findIndex((e) => e.cible === cible);
    assert.notEqual(i, -1, `${id} : ${cible} introuvable`);
    return i;
  };
  // Nutrition : on ouvre, on cherche, on dose, et on enregistre en dernier.
  assert.ok(rang("nutrition-plan", "nutrition-ajout-ouvrir") < rang("nutrition-plan", "nutrition-ajout-recherche"));
  assert.ok(rang("nutrition-plan", "nutrition-ajout-recherche") < rang("nutrition-plan", "nutrition-ajout-resultats"));
  assert.ok(rang("nutrition-plan", "nutrition-ajout-resultats") < rang("nutrition-plan", "nutrition-ajout-quantite"));
  assert.ok(rang("nutrition-plan", "nutrition-ajout-quantite") < rang("nutrition-plan", "nutrition-ajout-confirmer"),
    "doser vient AVANT enregistrer : l'inverse enseignerait le mauvais geste");
  // Séance : la carte, puis la consigne, puis la série, puis ses champs.
  assert.ok(rang("entrainement-seance", "seance-exercice") < rang("entrainement-seance", "seance-serie"));
  assert.ok(rang("entrainement-seance", "seance-serie") < rang("entrainement-seance", "seance-charge"));
  assert.ok(rang("entrainement-seance", "seance-charge") < rang("entrainement-seance", "seance-reps"));
  // Le chronomètre s'ouvre avant qu'on explique son cadran.
  assert.ok(rang("entrainement-seance", "chrono-ouvrir") < rang("entrainement-seance", "chrono-cadran"));
  // Et l'enregistrement du retour reste la DERNIÈRE étape de la séance.
  const seance = ESPACES_GUIDES.find((e) => e.id === "entrainement-seance")!;
  assert.equal(seance.etapes[seance.etapes.length - 1]!.cible, "seance-enregistrer");
  // Recettes : jour → créneau → liste → quantités.
  assert.ok(rang("nutrition-recettes", "recettes-jour") < rang("nutrition-recettes", "recettes-creneau"));
  assert.ok(rang("nutrition-recettes", "recettes-creneau") < rang("nutrition-recettes", "recettes-liste"));
  assert.ok(rang("nutrition-recettes", "recettes-liste") < rang("nutrition-recettes", "recettes-quantites"));
});

await test("J2. Suivant et Précédent franchissent les cibles absentes, dans les deux sens", () => {
  /*
   * ⚠️ LE CAS QUI COMPTE : une feuille d'ajout fermée. La moitié des étapes de
   * nutrition n'ont alors pas de cible. Le parcours doit continuer à avancer et
   * à reculer sans jamais s'arrêter sur une étape invisible, et sans boucler.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan")!;
  const surLaPage = new Set([
    "nutrition-objectif-kcal",
    "nutrition-objectif-proteines",
    "nutrition-objectif-glucides",
    "nutrition-objectif-lipides",
    "espace-nutrition-repas",
    "nutrition-ajout-ouvrir",
    "espace-nutrition-courses",
  ]);
  const existe = (cible: string) => surLaPage.has(cible);

  // En avant depuis la première étape : on ne s'arrête que sur du visible.
  const vus: number[] = [];
  let position = prochaineEtapeAtteignable(nutrition.etapes, 0, 1, existe);
  let garde = 0;
  while (position !== null && garde++ < 100) {
    vus.push(position);
    assert.ok(existe(nutrition.etapes[position]!.cible),
      `l'étape ${nutrition.etapes[position]!.id} n'a pas de cible et ne devrait pas être montrée`);
    position = prochaineEtapeAtteignable(nutrition.etapes, position + 1, 1, existe);
  }
  assert.ok(garde < 100, "la recherche d'étape atteignable se termine toujours");
  assert.equal(vus.length, surLaPage.size, "toutes les étapes visibles, et elles seules");
  assert.deepEqual(vus, [...vus].sort((a, b) => a - b), "l'ordre est préservé");

  // En arrière depuis la dernière : même garantie.
  const retour: number[] = [];
  let arriere = prochaineEtapeAtteignable(nutrition.etapes, nutrition.etapes.length - 1, -1, existe);
  garde = 0;
  while (arriere !== null && garde++ < 100) {
    retour.push(arriere);
    arriere = prochaineEtapeAtteignable(nutrition.etapes, arriere - 1, -1, existe);
  }
  assert.ok(garde < 100, "et dans l'autre sens aussi");
  assert.deepEqual(retour, [...vus].reverse(), "Précédent repasse exactement par où Suivant est venu");
});

await test("J3. aucune cible visible : le parcours ne reste pas ouvert sur du vide", () => {
  for (const espace of ESPACES_GUIDES) {
    assert.equal(prochaineEtapeAtteignable(espace.etapes, 0, 1, () => false), null,
      `${espace.id} : sans aucune cible, aucune étape n'est atteignable — le guide se referme`);
  }
});

await test("J4. une visite d'espace écartée reste relançable", () => {
  /*
   * ⚠️ DÉFAUT RÉEL CORRIGÉ ICI. La bannière de `GuideEspace` ne propose la
   * visite qu'une fois : `fermer()` écrit la clé « déjà vu », et plus rien ne
   * revient. Le commentaire du fichier affirmait pourtant qu'elle restait
   * relançable depuis la navigation — ce qui était faux, `LanceurGuide` ne
   * jouant que la visite des MENUS. Il rend maintenant un second bouton, sur
   * les routes qui ont une visite d'espace.
   */
  const lanceur = sansProse(readFileSync(`${RACINE}components/guide/LanceurGuide.tsx`, "utf8"));
  assert.match(lanceur, /espaceGuidePour\(pathname\)/,
    "le lanceur sait quelle visite correspond à la page courante");
  assert.match(lanceur, /etapes=\{espaceCourant\.etapes\}/,
    "et il sait la jouer, en réutilisant GuideDecouverte");
  assert.match(lanceur, /espaceCourant \?/,
    "le bouton n'est rendu que là où une visite existe");
  // Et il ne rejoue pas la visite des menus à la place.
  assert.match(lanceur, /etapesEleveVisibles|etapesStaffVisibles/,
    "la visite des menus reste disponible, inchangée");
});

await test("J5. les visites d'espace restent cantonnées à l'espace élève", () => {
  /*
   * Le filtrage par rôle de ces visites n'est pas réécrit : il est porté par
   * l'arborescence. Toutes les routes couvertes vivent sous `app/(student)`,
   * déjà protégée par les gardes serveur — un coach n'y accède pas, et la
   * question « faut-il masquer l'étape ? » ne se pose donc jamais.
   */
  for (const espace of ESPACES_GUIDES) {
    assert.doesNotMatch(espace.route, /^\/admin/, `${espace.id} ne vise pas une route d'administration`);
    for (const etape of espace.etapes) {
      assert.doesNotMatch(etape.href, /^\/admin/, `${espace.id}/${etape.id}`);
    }
    assert.equal(espaceGuidePour(`/admin${espace.route}`), null,
      `${espace.id} ne doit pas s'activer sous /admin`);
  }
});

/* ═══════ K. ENREGISTRER UN REPAS : CE QUI EXISTE, ET CE QUI N'EXISTE PAS ═══════ */

await test("K1. aucune étape ne promet une validation différée du repas", () => {
  /*
   * ⚠️ L'ERREUR LA PLUS TENTANTE DE CE CHANTIER. Par analogie avec le retour de
   * séance — qu'on remplit puis qu'on enregistre d'un bouton final — on écrirait
   * volontiers « puis validez votre repas ». Or chaque aliment part en base dès
   * « Ajouter cet aliment », et il n'existe nulle part de bouton
   * « Enregistrer le repas ». Promettre ce bouton ferait chercher l'introuvable,
   * et ferait croire un repas perdu alors qu'il est déjà écrit.
   */
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const journal = nutrition.etapes.find((e) => e.cible === "nutrition-journal")!;
  assert.match(journal.texte, /pas de bouton|aucun bouton/i, "l'étape dit que ce bouton n'existe pas");
  assert.match(journal.texte, /tout de suite|déjà/i, "et que l'enregistrement a déjà eu lieu");

  // Vérifié sur le code : si un bouton de validation du repas apparaissait un
  // jour, ces explications deviendraient fausses et ce test tomberait.
  const section = sansProse(readFileSync(`${RACINE}components/student/ConsumedMealSection.tsx`, "utf8"));
  assert.doesNotMatch(section, /Enregistrer le repas|Valider le repas/i,
    "aucun enregistrement différé du repas dans le composant");
  const semaine = sansProse(readFileSync(`${RACINE}components/student/StudentPrescribedWeek.tsx`, "utf8"));
  assert.doesNotMatch(semaine, /Enregistrer le repas|Valider le repas/i);
});

await test("K2. la correction d'un aliment passe par la ligne du journal", () => {
  const nutrition = ESPACES_GUIDES.find((e) => e.id === "nutrition-plan");
  assert.ok(nutrition);
  const ligne = nutrition.etapes.find((e) => e.cible === "nutrition-journal-ligne")!;
  for (const mot of [/quantité/i, /supprim/i]) {
    assert.match(ligne.texte, mot, `l'étape annonce ${mot}`);
  }
  // Et la feuille de détail offre bien les deux.
  const detail = sansProse(readFileSync(`${RACINE}components/student/ConsumedFoodDetailSheet.tsx`, "utf8"));
  assert.match(detail, /Supprimer/, "la suppression existe réellement");
  assert.match(detail, /onSupprimer/, "et elle est câblée");
});

await test("K3. le journal alimentaire n'existe que sur le chemin RÉEL, et c'est documenté", () => {
  /*
   * ⚠️ LIMITE ASSUMÉE, PAS OUBLI. `app/(student)/nutrition/[planId]/page.tsx` a
   * deux branches exclusives : celle de Supabase (`supabaseNutrition.active`),
   * qui monte `StudentPrescribedWeek` — donc `ConsumedMealSection`, donc tout le
   * parcours d'ajout —, et celle de la démonstration locale, qui monte
   * `NutritionPlanWorkspace` et ne contient aucune de ces ancres.
   *
   * Les étapes d'ajout ne se jouent donc que sur un vrai plan assigné. C'est le
   * cas de tout élève réel ; sur le chemin de démonstration, le moteur les saute.
   * Ce test fixe cette structure : si le journal déménageait, il faudrait revoir
   * ce que la visite affirme.
   */
  const semaine = sansProse(readFileSync(`${RACINE}components/student/StudentPrescribedWeek.tsx`, "utf8"));
  assert.match(semaine, /<ConsumedMealSection/, "le journal est bien monté par la semaine prescrite");
  const page = sansProse(readFileSync(`${RACINE}app/(student)/nutrition/[planId]/page.tsx`, "utf8"));
  assert.match(page, /if \(supabaseNutrition\.active\)/, "la branche réelle existe toujours");
  assert.match(page, /<StudentPrescribedWeek/, "et c'est elle qui monte la semaine prescrite");
  const atelier = sansProse(readFileSync(`${RACINE}components/student/NutritionPlanWorkspace.tsx`, "utf8"));
  assert.doesNotMatch(atelier, /data-guide="nutrition-ajout|data-guide="nutrition-journal/,
    "le chemin de démonstration ne fait PAS semblant d'avoir ces ancres : les étapes y sont sautées");
});

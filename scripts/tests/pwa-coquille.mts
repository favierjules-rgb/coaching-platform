import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

/**
 * `usePathname` est le SEUL point du fournisseur de thème qui exige le
 * contexte de l'App Router. Sur un vrai serveur ce contexte existe ; ici on
 * le fournit, sans rien remplacer d'autre — la coquille rendue reste celle
 * des vrais composants.
 */
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/entrainement",
    useParams: () => ({ sessionId: "11111111-1111-4111-8111-111111111111" }),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(),
    redirect: () => {},
    notFound: () => {},
  },
});

const { StudentShell } = await import("../../components/student/StudentShell");
const { ThemeProvider } = await import("../../components/theme/ThemeProvider");

/**
 * PWA — CE QUE CONTIENT VRAIMENT LA COQUILLE MISE EN CACHE.
 *
 * Le service worker garde le HTML des pages élève. Toute la sûreté de ce
 * choix repose sur une seule affirmation : CES DOCUMENTS NE CONTIENNENT
 * AUCUNE DONNÉE. Une affirmation dans un commentaire ne vaut rien — ce
 * fichier la vérifie.
 *
 * Il MONTE la vraie coquille avec le vrai React et regarde ce qui sort. Si
 * quelqu'un déplace un jour une donnée du navigateur vers le serveur — un
 * prénom dans la barre latérale, un compteur de séances dans le menu — le
 * HTML mis en cache se mettra à contenir cette donnée, et ce test le dira.
 *
 * SUITE SÉPARÉE (sans la condition `react-server`), comme
 * `coach-reply-video-render.mts` : `renderToString` n'existe pas sous cette
 * condition.
 */

const RACINE = fileURLToPath(new URL("../..", import.meta.url));

let réussis = 0;
let échecs = 0;

function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

const lire = (relatif: string) => readFileSync(new URL(relatif, `file://${RACINE}`), "utf8");

/**
 * La coquille telle que le serveur la rend : `ThemeProvider` (posé par le
 * layout racine) + `StudentShell` + un enfant en attente de chargement.
 * C'est exactement l'arbre que Next.js sérialise dans le document.
 */
function rendreCoquille(): string {
  return renderToString(
    createElement(
      ThemeProvider,
      null,
      createElement(StudentShell, null, createElement("p", null, "Chargement…")),
    ),
  );
}

const COQUILLE = rendreCoquille();

/* ════════════════════════════════════════════════════════════════════════
 * I. LE HTML MIS EN CACHE EST VIDE DE DONNÉES
 * ════════════════════════════════════════════════════════════════════════ */

test("C1. LE MENU EST COMPLET DANS LE HTML — donc identique hors ligne", () => {
  // Le rendu serveur porte les SEPT entrées de la barre latérale, liens
  // compris. C'est ce qui garantit que la coquille mise en cache ouvre
  // l'application avec exactement la même navigation qu'en ligne.
  //
  // Ce qui le rend vrai : `useSupabaseAccessType()` s'initialise à
  // "coaching" (hooks/useSupabaseAccessType.ts) et ne fait que RETIRER des
  // entrées pour un compte "programme_seul". Un hook qui ne répond jamais —
  // le cas hors ligne — laisse donc le menu entier.
  for (const libelle of [
    "Dashboard",
    "Entraînement",
    "Nutrition",
    "Rendez-vous",
    "Progression",
    "Documents",
    "Profil",
    "Déconnexion",
  ]) {
    assert.ok(COQUILLE.includes(libelle), `entrée de menu absente de la coquille : ${libelle}`);
  }

  // Les libellés seuls ne suffiraient pas : ce sont les LIENS qui font la
  // navigation. Un menu rendu sans href serait visuellement identique et
  // inerte.
  const liens = COQUILLE.match(/href="\/(dashboard|entrainement|nutrition|rendez-vous|progression|documents|profil)"/g) ?? [];
  assert.equal(new Set(liens).size, 7, `liens de navigation trouvés : ${JSON.stringify(liens)}`);
});

test("C2. AUCUNE DONNÉE D'ÉLÈVE DANS LA COQUILLE", () => {
  // Ce que le serveur pourrait laisser fuiter s'il rendait des données :
  // une identité, un chiffre d'entraînement, une adresse.
  const suspects: [RegExp, string][] = [
    [/\b\d+\s?kg\b/i, "une charge"],
    [/\b\d+\s?(?:séries?|reps?|répétitions?)\b/i, "un volume d'entraînement"],
    [/\bRPE\s?\d/i, "un RPE"],
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "une adresse email"],
    [/eyJ[A-Za-z0-9_-]{10,}/, "un jeton JWT"],
    [/https?:\/\/[a-z0-9-]+\.supabase\.co/i, "une URL Supabase"],
  ];
  for (const [motif, quoi] of suspects) {
    const trouve = COQUILLE.match(motif);
    assert.ok(!trouve, `${quoi} dans la coquille : « ${trouve?.[0]} »`);
  }
});

test("C3. la coquille ne dépend d'aucune donnée passée par le serveur", () => {
  // `StudentShell` n'accepte que `children`. S'il recevait un jour un
  // profil ou une liste de séances, le HTML mis en cache deviendrait
  // personnel — et le cache, une fuite.
  assert.equal(StudentShell.length, 1, "StudentShell doit n'accepter qu'un seul argument (les props)");
  const layout = lire("app/(student)/layout.tsx");

  // La balise ouvrante ne porte AUCUN attribut : c'est ce qui garantit
  // qu'aucune donnée du serveur n'entre dans la coquille mise en cache.
  const ouvrante = layout.match(/<StudentShell(\s[^>]*)?>/);
  assert.ok(ouvrante, "le layout élève doit rendre <StudentShell>");
  assert.equal(
    (ouvrante[1] ?? "").trim(),
    "",
    "le layout élève ne doit passer AUCUNE prop à la coquille",
  );

  // Ce qu'il y a DEDANS : `{children}`, et rien d'autre que des composants
  // PWA inertes (ils rendent `null`). Le motif d'origine exigeait
  // `<StudentShell>{children}</StudentShell>` mot pour mot — il est devenu
  // faux dès qu'un de ces composants a été monté, sans que la propriété
  // qu'il protégeait ait bougé d'un pouce. On vérifie donc la propriété,
  // pas la mise en page.
  const interieur = layout.slice(layout.indexOf(ouvrante[0]) + ouvrante[0].length, layout.indexOf("</StudentShell>"));
  assert.ok(interieur.includes("{children}"), "la coquille doit contenir {children}");
  const expressions = interieur.match(/\{(?!\/\*)[^}]*\}/g) ?? [];
  assert.deepEqual(
    Array.from(new Set(expressions)),
    ["{children}"],
    "aucune valeur autre que `children` ne doit descendre dans la coquille",
  );
  const montes = Array.from(interieur.matchAll(/<([A-Z][A-Za-z0-9]*)/g)).map((m) => m[1]);
  for (const nom of montes) {
    assert.match(
      layout,
      new RegExp(`import \\{ ${nom} \\} from "@/components/pwa/`),
      `${nom} est monté dans la coquille sans venir de components/pwa — il pourrait y injecter des données`,
    );
  }
});

test("C4. le rendu de la coquille est déterministe", () => {
  // Deux rendus identiques : rien d'aléatoire, rien de daté, rien qui vienne
  // d'une session. Un document mis en cache doit rester vrai demain.
  assert.equal(rendreCoquille(), COQUILLE);
});

/* ════════════════════════════════════════════════════════════════════════
 * II. LA LISTE BLANCHE NE DOIT PAS DÉRIVER
 * ════════════════════════════════════════════════════════════════════════ */

const SW = lire("public/sw.js");

/** Les motifs de la liste blanche, relus depuis `public/sw.js`. */
function motifsListeBlanche(): RegExp[] {
  const debut = SW.indexOf("const COQUILLES_ELEVE = [");
  const fin = SW.indexOf("];", debut);
  assert.ok(debut !== -1 && fin !== -1, "liste blanche introuvable dans public/sw.js");
  return SW.slice(debut, fin)
    .split("\n")
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.startsWith("/^"))
    .map((ligne) => new RegExp(ligne.replace(/,$/, "").slice(1, -1)));
}

const LISTE = motifsListeBlanche();
const couvert = (chemin: string) => LISTE.some((motif) => motif.test(chemin));

test("C5. toutes les sections élève réelles sont couvertes", () => {
  // Une section ajoutée demain et oubliée ici retomberait sur l'écran
  // « Pas de connexion » au premier trajet en métro, sans que personne ne
  // fasse le lien avec cette liste.
  const sections = readdirSync(new URL("app/(student)", `file://${RACINE}`), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `/${e.name}`);
  assert.ok(sections.length >= 7, `sections trouvées : ${sections.join(", ")}`);
  for (const section of sections) {
    assert.ok(couvert(section), `section élève non couverte par la liste blanche : ${section}`);
  }
});

test("C6. LA PAGE DE SÉANCE est couverte, avec son identifiant", () => {
  // C'est LA route qui doit rouvrir après un redémarrage complet hors ligne.
  assert.ok(couvert("/entrainement/seance/11111111-1111-4111-8111-111111111111"));
  assert.ok(couvert("/entrainement/11111111-1111-4111-8111-111111111111"), "détail d'un programme");
});

test("C7. RIEN d'autre que l'espace élève n'entre dans la liste", () => {
  // La demande est explicite : une liste blanche, pas une règle générale.
  for (const chemin of [
    "/",
    "/admin",
    "/admin/eleves",
    "/programmes",
    "/connexion",
    "/inscription",
    "/cgv",
    "/mentions-legales",
    "/paiement/success",
    "/api/student/workout-feedback",
    "/onboarding",
  ]) {
    assert.ok(!couvert(chemin), `ne doit PAS être mis en cache : ${chemin}`);
  }
});

test("C8. un identifiant qui n'est pas un UUID n'ouvre pas la liste", () => {
  // Sans cette borne, n'importe quel chemin sous /entrainement/ deviendrait
  // cacheable — y compris une route ajoutée plus tard sans y penser.
  assert.ok(!couvert("/entrainement/seance/../../admin"));
  assert.ok(!couvert("/entrainement/seance/"));
  assert.ok(!couvert("/entrainement/seance/12"));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);

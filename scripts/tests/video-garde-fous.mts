/**
 * LES GARDE-FOUS DU LECTEUR VIDÉO — CSP, SORTIES EXTERNES, NON-RÉGRESSION.
 *
 * Inspection de source, exécutée dans Node. Elle répond à des questions que
 * seul le code peut trancher : reste-t-il une sortie externe ? la CSP
 * autorise-t-elle exactement ce qu'il faut, et rien de plus ? les lecteurs
 * déjà intégrés ont-ils été laissés tranquilles ?
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RACINE = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const lire = (relatif: string) => readFileSync(join(RACINE, relatif), "utf8");

/**
 * Le CODE seul, commentaires retirés.
 *
 * Ces fichiers expliquent précisément ce qu'ils s'interdisent — « ni
 * localStorage, ni IndexedDB » — et une recherche naïve prendrait ce récit
 * pour la pratique qu'il décrit.
 */
const lireCode = (relatif: string) =>
  lire(relatif).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

let réussis = 0;
let échecs = 0;
async function testAsync(nom: string, fn: () => Promise<void>) {
  try {
    await fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}
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

/**
 * La CSP RÉELLEMENT ÉMISE — pas une lecture du texte source.
 *
 * `frame-src` est maintenant COMPOSÉ au build (l'origine Supabase est
 * dérivée de `NEXT_PUBLIC_SUPABASE_URL`). Relire le fichier à la main
 * reviendrait à réimplémenter cette composition dans le test, donc à tester
 * ma propre copie plutôt que la politique envoyée au navigateur. On importe
 * la configuration et on lui demande ses en-têtes.
 */
const ORIGINE_PROJET = "https://yesuolzfmxgnaznhbcnw.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINE_PROJET;

const config = (await import("../../next.config")).default as {
  headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>;
};
const { origineSupabase } = (await import("../../next.config")) as unknown as {
  origineSupabase: (brut?: string) => string | null;
};

const enTetes = await config.headers();
const politique =
  enTetes
    .flatMap((e) => e.headers)
    .find((h) => h.key.startsWith("Content-Security-Policy"))?.value ?? "";

/** Les sources de `frame-src`, telles qu'elles partent réellement. */
function sourcesFrameSrc(): string[] {
  const directive = politique.split(";").map((d) => d.trim()).find((d) => d.startsWith("frame-src"));
  assert.ok(directive, "la directive frame-src doit exister dans la politique émise");
  return directive.replace("frame-src", "").trim().split(/\s+/).filter(Boolean);
}

/* ════════════════════════════ CSP ════════════════════════════ */

test("CSP1. youtube-nocookie et l'origine EXACTE du projet sont autorisés — et rien d'autre", () => {
  const sources = sourcesFrameSrc();

  assert.ok(
    sources.includes("https://www.youtube-nocookie.com"),
    "sans cette source, la CSP passée en mode bloquant afficherait un cadre vide",
  );
  // C'est bien le domaine SANS cookie que le lecteur charge : les deux
  // doivent parler du même hôte, sinon la CSP autorise autre chose que ce
  // qui est réellement demandé.
  assert.ok(lire("lib/video/source.ts").includes("https://www.youtube-nocookie.com/embed/"));

  // L'ORIGINE DU PROJET, précisément — pas un motif qui l'engloberait.
  assert.ok(sources.includes(ORIGINE_PROJET), `frame-src doit contenir ${ORIGINE_PROJET}`);

  // Et la dérivation elle-même refuse tout ce qui n'est pas une origine https
  // propre : c'est elle qui empêche d'injecter une directive par la variable.
  assert.equal(origineSupabase("https://abc.supabase.co/rest/v1"), "https://abc.supabase.co");
  for (const mauvaise of [
    "http://abc.supabase.co",
    "https://*.supabase.co",
    "https://abc.supabase.co ; frame-ancestors *",
    "pas-une-url",
    "",
  ]) {
    assert.equal(origineSupabase(mauvaise), null, `${String(mauvaise)} aurait dû être refusée`);
  }
  // Variable absente : aucune source Supabase, plutôt qu'un joker de repli.
  const sansVariable = { ...process.env };
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  assert.equal(origineSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL), null);
  Object.assign(process.env, sansVariable);
});

test("CSP2. AUCUN joker dans frame-src, et rien de plus que le strict nécessaire", () => {
  const sources = sourcesFrameSrc();

  // La version précédente de ce test ne rejetait qu'un jeton STRICTEMENT égal
  // à « * » — elle laissait donc passer `https://*.supabase.co`, c'est-à-dire
  // l'autorisation de TOUS les projets Supabase du monde. Le contrôle porte
  // maintenant sur le caractère lui-même, où qu'il se trouve.
  for (const jeton of sources) {
    assert.ok(!jeton.includes("*"), `joker interdit dans frame-src : « ${jeton} »`);
    assert.notEqual(jeton, "https:", "aucun schéma ouvert");
    assert.notEqual(jeton, "data:", "aucun schéma de données");
    assert.ok(
      /^https:\/\/[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(jeton),
      `source frame-src suspecte : « ${jeton} »`,
    );
  }

  // Ce test doit ÉCHOUER si l'un de ces motifs réapparaît un jour.
  for (const joker of ["*", "*.example.com", "https://*.supabase.co", "https://*"]) {
    assert.ok(joker.includes("*"), "garde du garde-fou");
    assert.ok(!sources.includes(joker), `${joker} ne doit pas être autorisé`);
  }

  // Rien de plus que Stripe (antérieur au chantier) + les deux ajouts.
  const attendues = new Set([
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://checkout.stripe.com",
    "https://www.youtube-nocookie.com",
    ORIGINE_PROJET,
  ]);
  for (const jeton of sources) {
    assert.ok(attendues.has(jeton), `domaine frame-src inattendu : « ${jeton} »`);
  }
  assert.equal(sources.length, attendues.size, "ni ajout, ni disparition");

  const config = lire("next.config.ts");
  // Les directives que ce chantier n'avait aucune raison de toucher.
  assert.ok(config.includes("`frame-ancestors 'none'`"), "le site reste non encadrable");
  assert.ok(config.includes("`object-src 'none'`"), "object-src reste fermé");
  assert.ok(config.includes("`base-uri 'self'`"));
  assert.ok(config.includes("`default-src 'self'`"));
  // La CSP reste en Report-Only : ce chantier ne bascule pas la politique.
  assert.ok(
    config.includes('key: "Content-Security-Policy-Report-Only"'),
    "le passage en mode bloquant reste une décision séparée",
  );
});

/* ════════════════════ LES QUATRE SORTIES FERMÉES ════════════════════ */

test("VIDEO6. plus aucune sortie externe sur les quatre chemins audités", () => {
  const carte = lire("components/student/ExerciseFeedbackCard.tsx");
  assert.ok(!/href=\{videoAffichee\}/.test(carte), "la démo de séance ne doit plus être un lien");
  assert.ok(carte.includes("<VideoPlayerModal"), "elle ouvre le lecteur intégré");
  assert.ok(carte.includes('type="button"'), "un bouton dans le formulaire de séance ne doit pas envoyer");

  const admin = lire("components/admin/ExerciseLibraryManager.tsx");
  assert.ok(!/href=\{item\.videoUrl/.test(admin), "la démo admin ne doit plus être un lien");
  assert.ok(admin.includes("<VideoPlayerModal"));

  const documents = lire("components/student/RealDocumentLibrary.tsx");
  assert.ok(!documents.includes("window.open"), "aucun nouvel onglet pour un document");
  assert.ok(!/href=\{document\.videoUrl\}/.test(documents), "la vidéo de document passe par le lecteur");
  assert.ok(documents.includes("<VideoPlayerModal"));
  assert.ok(documents.includes("<FileViewerModal"));

  // Les seuls `target="_blank"` restants visent `externalUrl` : une adresse
  // arbitraire saisie par le coach. L'encadrer serait exactement l'« iframe
  // arbitraire externe » que la règle de sécurité interdit — elle reste donc
  // un lien, et c'est un choix, pas un oubli.
  for (const bloc of documents.split('target="_blank"').slice(1)) {
    void bloc;
  }
  const liens = (documents.match(/target="_blank"/g) ?? []).length;
  const externes = (documents.match(/href=\{document\.externalUrl\}/g) ?? []).length;
  assert.equal(liens, externes, "tout lien externe restant vise externalUrl, et rien d'autre");
});

test("PDF4. aucune redirection automatique — l'issue est un geste volontaire", () => {
  const visionneuse = lire("components/shared/FileViewerModal.tsx");
  assert.ok(!visionneuse.includes("window.open"), "jamais d'ouverture programmatique");
  assert.ok(!visionneuse.includes("location.href"), "jamais de navigation programmatique");
  assert.ok(!/window\.location/.test(visionneuse));
  // L'issue existe, mais c'est un `<a>` que l'utilisateur doit viser.
  assert.ok(visionneuse.includes('data-issue="ouvrir-document"'));
  assert.ok(visionneuse.includes("Ouvrir le document"));
});

test("PDF2. l'URL signée reste temporaire : jamais stockée, jamais republiée", () => {
  for (const fichier of [
    "components/shared/FileViewerModal.tsx",
    "components/shared/VideoPlayerModal.tsx",
    "components/student/RealDocumentLibrary.tsx",
  ]) {
    const source = lireCode(fichier);
    assert.ok(!/localStorage/.test(source), `${fichier} ne doit pas conserver d'URL signée`);
    assert.ok(!/sessionStorage/.test(source), fichier);
    assert.ok(!/indexedDB|IDBDatabase|caches\.open/.test(source), fichier);
    assert.ok(!/object\/public/.test(source), `${fichier} ne fabrique aucune URL publique`);
  }
  // Le rafraîchissement passe par le mécanisme de signature EXISTANT.
  const documents = lire("components/student/RealDocumentLibrary.tsx");
  assert.ok(documents.includes("getSignedDocumentFileUrl"), "la signature existante reste la seule source");
  assert.ok(documents.includes("onRafraichir={signer}"), "« Réessayer » redemande une URL fraîche");
});

/* ═════════════ LES LECTEURS DÉJÀ INTÉGRÉS N'ONT PAS BOUGÉ ═════════════ */

test("VIDEO11. la vidéo de feedback élève reste lisible dans SETH, par le même chemin", () => {
  // Côté admin, les vidéos d'élève sont lues en ligne dans la fiche de
  // retour, à partir d'une URL signée d'une heure.
  const modale = lire("components/admin/FeedbackDetailModal.tsx");
  assert.ok(modale.includes("<video"), "le lecteur natif est toujours là");
  assert.ok(modale.includes("video.videoUrl"), "il lit toujours l'URL signée du lot");
  assert.ok(!modale.includes("window.open"), "et n'ouvre aucun onglet");

  // Côté élève, capture et aperçu sont inchangés.
  const champ = lire("components/student/ExerciseVideoField.tsx");
  assert.ok(champ.includes("playsInline"), "l'aperçu reste dans la page");
  assert.ok(champ.includes('preload="metadata"'));
  assert.ok(!champ.includes("VideoPlayerModal"), "ce lecteur fonctionnait : il n'a pas été réécrit");
});

test("VIDEO12. la réponse vidéo du coach reste lisible, annotations comprises", () => {
  const historique = lire("app/(student)/entrainement/historique/page.tsx");
  assert.ok(historique.includes("AnnotatedVideoPlayer"), "le lecteur annoté est toujours monté");
  assert.ok(historique.includes("parseAnnotations"), "les annotations sont toujours lues");

  const lecteur = lire("components/shared/AnnotatedVideoPlayer.tsx");
  assert.ok(lecteur.includes("<video"), "toujours un lecteur natif");
  assert.ok(!lecteur.includes("VideoPlayerModal"), "il n'a pas été réécrit");

  // Capture et envoi de la réponse coach : intouchés.
  const capture = lire("components/admin/CoachReplyVideoField.tsx");
  assert.ok(capture.includes("<video"));
  assert.ok(!capture.includes("VideoPlayerModal"));
});

/* ════════════════════ NON-RÉGRESSION PWA / OFFLINE ════════════════════ */

test("VIDEO14. rien du chantier ne touche au hors-ligne ni au service worker", () => {
  // Aucun des nouveaux modules ne parle de stockage local. Les vidéos
  // restent EN LIGNE UNIQUEMENT — c'était la consigne, et c'est vérifiable.
  for (const fichier of [
    "lib/video/source.ts",
    "components/shared/MediaModal.tsx",
    "components/shared/VideoPlayerModal.tsx",
    "components/shared/FileViewerModal.tsx",
    "components/shared/video/YouTubeEmbed.tsx",
    "components/shared/video/NativeVideoPlayer.tsx",
  ]) {
    const source = lire(fichier);
    for (const interdit of ["caches.open", "indexedDB", "DepotOffline", "MoteurIndexedDB", "serviceWorker"]) {
      assert.ok(!source.includes(interdit), `${fichier} ne doit pas parler de ${interdit}`);
    }
  }

  // Le service worker n'a pas été retouché.
  const sw = lire("public/sw.js");
  assert.ok(sw.includes('const VERSION = "seth-pwa-v4"'), "la génération de cache ne change pas");
  assert.ok(!/youtube|youtu\.be/i.test(sw), "aucune vidéo n'entre dans le cache");

  // Et le lecteur ne monte rien tant qu'on est hors ligne.
  const lecteur = lire("components/shared/VideoPlayerModal.tsx");
  assert.ok(lecteur.includes("navigator.onLine"), "l'état réseau est consulté avant de monter quoi que ce soit");
  assert.ok(lecteur.includes("Une connexion est nécessaire pour lire cette vidéo."));
});

test("VIDEO-CENTRAL. un seul parseur d'URL YouTube dans tout le dépôt", () => {
  const fichiers = [
    "components/shared/VideoPlayerModal.tsx",
    "components/shared/video/YouTubeEmbed.tsx",
    "components/shared/FileViewerModal.tsx",
    "components/student/ExerciseFeedbackCard.tsx",
    "components/admin/ExerciseLibraryManager.tsx",
    "components/student/RealDocumentLibrary.tsx",
  ];
  for (const fichier of fichiers) {
    const source = lireCode(fichier);
    // Aucun composant métier ne reconnaît un HÔTE YouTube ni ne reconstruit
    // une adresse d'intégration. Le mot « YouTube » dans un nom de composant
    // ou une valeur de type est légitime ; un nom de domaine ne l'est pas.
    assert.ok(
      !/(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)/.test(source),
      `${fichier} ne doit pas connaître de domaine YouTube : c'est le rôle de lib/video/source.ts`,
    );
    assert.ok(!/\/embed\//.test(source), `${fichier} ne doit pas fabriquer d'URL d'intégration`);
  }
});

/* ═════════ L'ORIGINE D'UNE URL SIGNÉE, PROUVÉE PAR LA VRAIE LIBRAIRIE ═════════ */

await (async () => {
  await testAsync(
    "PDF-CSP. une URL signée du Storage a bien l'origine autorisée par frame-src",
    async () => {
      // On n'affirme pas que supabase-js préfixe l'URL du projet : on le lui
      // fait FAIRE. Le réseau est remplacé par une réponse conforme à celle
      // de l'API Storage ; l'URL rendue est donc construite par la librairie
      // réelle, pas par une supposition du test.
      const { createClient } = await import("@supabase/supabase-js");
      const vraiFetch = globalThis.fetch;
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ signedURL: "/object/sign/documents/x.pdf?token=abc.def" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })) as typeof globalThis.fetch;
      try {
        const client = createClient(ORIGINE_PROJET, "cle-anonyme-de-test");
        const { data } = await client.storage.from("documents").createSignedUrl("x.pdf", 3600);
        assert.ok(data?.signedUrl, "la librairie doit rendre une URL signée");

        const origine = new URL(data!.signedUrl).origin;
        assert.equal(origine, ORIGINE_PROJET, "l'URL signée vient bien de l'origine du projet");
        // Et c'est EXACTEMENT celle que la CSP autorise.
        assert.ok(sourcesFrameSrc().includes(origine), "frame-src autorise cette origine, précisément");
        // Le résolveur vidéo l'accepte aussi — même origine, même règle.
        const { resoudreSource } = await import("../../lib/video/source");
        assert.deepEqual(resoudreSource(data!.signedUrl), { type: "file", url: data!.signedUrl });
      } finally {
        globalThis.fetch = vraiFetch;
      }
    },
  );
})();

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

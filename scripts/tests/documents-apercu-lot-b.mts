/**
 * Harnais — DOCUMENTS, LOT B : CLASSIFICATION, APERÇU ET MINIATURES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT — TROIS NIVEAUX, HONNÊTEMENT DISTINGUÉS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. `documentKind` est APPELÉE POUR DE VRAI : c'est une fonction pure, il n'y
 *    a aucune raison de la deviner. La table de vérité complète est exécutée.
 * 2. `RealDocumentLibrary` est RENDUE POUR DE VRAI (`renderToString`) et le
 *    balisage produit est inspecté : badge de consultation, repli de
 *    miniature, icône de type. `MediaModal` renvoie `null` sans `document`
 *    (components/shared/MediaModal.tsx:101), donc le rendu serveur traverse
 *    les cartes sans toucher aux modales.
 * 3. `FileViewerModal` est vérifiée SUR LE TEXTE, et c'est une limite assumée.
 *    Elle s'ouvre dans un portail (`createPortal`), que `renderToString` ne
 *    sait pas rendre : le rendu serveur produirait du vide, et un test sur du
 *    vide ne prouve rien. On fige donc la STRUCTURE de la branche — ternaire
 *    sur `kind`, `<img>` d'un côté, `<iframe>` de l'autre — plutôt que de
 *    prétendre l'avoir rendue. Le rendu réel de cette modale appartient aux
 *    suites navigateur existantes.
 *
 * ⚠️ TOUTE OPÉRATION NON IMPLÉMENTÉE DANS LE DOUBLE LÈVE. Un faux qui laisse
 * passer silencieusement un appel inconnu ne prouve rien.
 *
 * Lancement : npm run test:documents-apercu
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { RealDocumentLibrary } from "../../components/student/RealDocumentLibrary";
import { documentKind, type DocumentKind } from "../../lib/documents";
import type { StudentDocumentWithAvailability } from "../../lib/supabase/documents";
import {
  DOCUMENTS_BUCKET,
  getSignedDocumentFileUrl,
} from "../../lib/supabase/storage-documents";
import type { AdminDocument } from "../../types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const SOURCE_VISIONNEUSE = lire("../../components/shared/FileViewerModal.tsx");
const CODE_VISIONNEUSE = sansProse(SOURCE_VISIONNEUSE);
const SOURCE_BIBLIO = lire("../../components/student/RealDocumentLibrary.tsx");
const CODE_BIBLIO = sansProse(SOURCE_BIBLIO);
const CODE_MODALE_COACH = sansProse(lire("../../components/admin/DocumentModal.tsx"));
const CODE_CHAMP_UPLOAD = sansProse(lire("../../components/admin/DocumentFileUploadField.tsx"));
const CODE_NOUVEAU = sansProse(lire("../../app/admin/documents/nouveau/page.tsx"));
const CODE_DOCUMENTS_LIB = sansProse(lire("../../lib/documents.ts"));

/* ══════════════════════════════════════════════════════════════════════════
   LE DOUBLE STORAGE — il trace les chemins visés, et lève sur l'inconnu
   ══════════════════════════════════════════════════════════════════════════ */

interface OrdreStorage {
  readonly bucket: string;
  readonly action: string;
  readonly chemin: string;
}

function fauxStorage(options: { echecSignature?: boolean } = {}) {
  const ordres: OrdreStorage[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          createSignedUrl(path: string, expiresIn: number) {
            ordres.push({ bucket, action: "sign", chemin: path });
            if (options.echecSignature) {
              return Promise.resolve({ data: null, error: { message: "refus (test)" } });
            }
            return Promise.resolve({
              data: { signedUrl: `https://exemple.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=JETON&exp=${expiresIn}` },
              error: null,
            });
          },
          getPublicUrl() {
            throw new Error(
              "fauxStorage.getPublicUrl : INTERDITE dans ce lot — une miniature ne se sert jamais d'une URL publique",
            );
          },
          upload() {
            throw new Error("fauxStorage.upload : non implémentée dans le lot B");
          },
          remove() {
            throw new Error("fauxStorage.remove : non implémentée dans le lot B");
          },
        };
      },
    },
    from() {
      throw new Error("fauxStorage.from : non implémentée dans le lot B");
    },
    rpc() {
      throw new Error("fauxStorage.rpc : non implémentée dans le lot B");
    },
  } as never;
  return { client, ordres };
}

/* ── Le banc ────────────────────────────────────────────────────────────── */

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";

function document_(partiel: Partial<AdminDocument> = {}): AdminDocument {
  return {
    id: DOC,
    title: "Morphologie",
    type: "pdf",
    category: "entrainement",
    level: 1,
    difficulty: "intermédiaire",
    shortDescription: "Un aperçu",
    fullDescription: "",
    contentText: "",
    externalUrl: "",
    videoUrl: "",
    fileName: "morpho.pdf",
    storagePath: `${DOC}/1-morpho.pdf`,
    fileSizeBytes: 1024,
    fileMimeType: "application/pdf",
    status: "publié",
    important: false,
    // ⚠️ DIVERGENCE PRÉEXISTANTE, SIGNALÉE ET NON CORRIGÉE ICI :
    // `documents.distribution_mode` a pour défaut `'disponible-immediatement'`
    // en base, tandis que `DocumentDistributionMode` ne connaît que
    // "immediat" | "deblocage-auto" | "deblocage-manuel" | "deblocage-date"
    // (types/index.ts:1452). `mapDocumentRow` masque l'écart par un cast.
    // Hors périmètre de ce lot : on utilise ici la valeur TYPÉE.
    distributionMode: "immediat",
    unlockAfterWeeks: 0,
    unlockAt: null,
    visibility: "assigned",
    tags: [],
    assignedStudentIds: [],
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...partiel,
  };
}

function item(
  partiel: Partial<AdminDocument>,
  options: { disponible?: boolean; viewedAt?: string | null } = {},
): StudentDocumentWithAvailability {
  const disponible = options.disponible !== false;
  return {
    document: document_(partiel),
    availability: {
      available: disponible,
      unlockDate: disponible ? null : "2026-12-01",
      manuallyUnlocked: false,
    },
    viewedAt: options.viewedAt ?? null,
  };
}

/** Rend la bibliothèque réelle en balisage statique. */
function rendre(documents: StudentDocumentWithAvailability[], studentId: string | null = null): string {
  // `createElement`, jamais un appel direct : un composant appelé à la main
  // n'a pas de dispatcher React et ses hooks lèvent.
  return renderToString(createElement(RealDocumentLibrary, { documents, studentId }));
}

/* ══════════════════════════════════════════════════════════════════════════
   B — CLASSIFICATION (exécution réelle, table de vérité complète)
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-1. `image/jpeg` → image", () => {
  assert.equal(documentKind({ type: "pdf", fileMimeType: "image/jpeg" }), "image");
});

await test("B-2. `image/png` → image", () => {
  assert.equal(documentKind({ type: "texte", fileMimeType: "image/png" }), "image");
});

await test("B-3. `image/webp` → image", () => {
  assert.equal(documentKind({ type: "lien", fileMimeType: "image/webp" }), "image");
  // Casse et espaces parasites ne doivent pas changer un fait.
  assert.equal(documentKind({ type: "pdf", fileMimeType: " IMAGE/WEBP " }), "image");
});

await test("B-4. `application/pdf` → pdf", () => {
  assert.equal(documentKind({ type: "image", fileMimeType: "application/pdf" }), "pdf");
});

await test("B-5. MIME absent (`null`) + type image → image", () => {
  assert.equal(documentKind({ type: "image", fileMimeType: null }), "image");
  assert.equal(documentKind({ type: "pdf", fileMimeType: null }), "pdf");
  assert.equal(documentKind({ type: "vidéo", fileMimeType: null }), "video");
  assert.equal(documentKind({ type: "guide", fileMimeType: null }), "autre");
  assert.equal(documentKind({ type: "lien", fileMimeType: null }), "autre");
  assert.equal(documentKind({ type: "texte", fileMimeType: null }), "autre");
});

await test("B-6. MIME vide (`\"\"`) traité EXACTEMENT comme absent", () => {
  assert.equal(documentKind({ type: "image", fileMimeType: "" }), "image");
  assert.equal(documentKind({ type: "pdf", fileMimeType: "" }), "pdf");
  // `"   "` aussi : une chaîne d'espaces n'est pas un MIME.
  assert.equal(documentKind({ type: "image", fileMimeType: "   " }), "image");
  // Et `application/octet-stream`, qui est le marqueur « MIME inconnu » posé
  // par `uploadDocumentFile` quand `file.type` est vide.
  assert.equal(documentKind({ type: "image", fileMimeType: "application/octet-stream" }), "image");
  assert.equal(documentKind({ type: "pdf", fileMimeType: "application/octet-stream" }), "pdf");
  // Contrôle : les trois formes d'absence donnent le MÊME résultat.
  const resultats = new Set<DocumentKind>(
    [null, "", "   ", "application/octet-stream"].map((m) =>
      documentKind({ type: "image", fileMimeType: m }),
    ),
  );
  assert.equal(resultats.size, 1, "les trois absences doivent être équivalentes");
});

await test("B-7. le MIME est PRIORITAIRE sur `type`, dans les deux sens", () => {
  // Le cas qui a motivé le lot : un type modifié après l'upload.
  assert.equal(documentKind({ type: "pdf", fileMimeType: "image/jpeg" }), "image", "type dit pdf, le fichier est une image");
  assert.equal(documentKind({ type: "image", fileMimeType: "application/pdf" }), "pdf", "type dit image, le fichier est un PDF");
  assert.equal(documentKind({ type: "image", fileMimeType: "video/mp4" }), "video");
  assert.equal(documentKind({ type: "pdf", fileMimeType: "video/webm" }), "video");
  // Un MIME d'une autre famille est un fait lui aussi : on ne retombe pas
  // sur `type` pour le contredire.
  assert.equal(documentKind({ type: "image", fileMimeType: "application/zip" }), "autre");
  // Et la priorité est écrite dans le code, pas seulement observée.
  const i = CODE_DOCUMENTS_LIB.indexOf("export function documentKind");
  assert.ok(i > 0, "documentKind doit exister");
  // ⚠️ `"\n}"` NE SUFFIT PAS : le paramètre est un type littéral qui se ferme
  // lui aussi sur `}` en début de ligne. On borne sur la ligne de fermeture
  // COMPLÈTE de la fonction.
  const iFin = CODE_DOCUMENTS_LIB.indexOf("\n}\n", i);
  assert.ok(iFin > i, "la fonction doit se fermer");
  const corps = CODE_DOCUMENTS_LIB.slice(i, iFin);
  const iMime = corps.indexOf("fileMimeType");
  const iType = corps.indexOf("document.type");
  assert.ok(iMime > 0 && iType > 0, "les deux sources doivent être lues");
  assert.ok(iMime < iType, "⚠️ le MIME doit être consulté AVANT `type`");
});

/* ══════════════════════════════════════════════════════════════════════════
   B — VISIONNEUSE (structure de la branche, limite assumée)
   ══════════════════════════════════════════════════════════════════════════ */

/** Les deux branches du rendu de `FileViewerModal`, découpées sur le ternaire. */
function branchesVisionneuse(): { image: string; autre: string } {
  const iTernaire = CODE_VISIONNEUSE.indexOf('kind === "image" ?');
  assert.ok(iTernaire > 0, "le ternaire sur `kind` doit exister");
  const iSinon = CODE_VISIONNEUSE.indexOf(") : (", iTernaire);
  const iFin = CODE_VISIONNEUSE.indexOf("          )}", iSinon);
  assert.ok(iSinon > iTernaire && iFin > iSinon, "les deux branches doivent être délimitées");
  return {
    image: CODE_VISIONNEUSE.slice(iTernaire, iSinon),
    autre: CODE_VISIONNEUSE.slice(iSinon, iFin),
  };
}

await test("B-8. `FileViewerModal` rend un `<img>` pour une image", () => {
  const { image } = branchesVisionneuse();
  assert.ok(image.includes("<img"), "la branche image rend un `<img>`");
  assert.ok(image.includes("alt={titre}"), "avec un `alt` pertinent");
  assert.ok(image.includes("object-contain"), "sans recadrage destructif");
  assert.ok(image.includes("max-h-[70vh]"), "et une hauteur maximale raisonnable");
  assert.ok(image.includes("src={urlCourante}"), "sur l'URL signée courante");
  assert.ok(image.includes('data-visionneuse="image"'), "repérable dans le DOM");
  assert.ok(!image.includes("<iframe"), "⚠️ et PAS d'iframe dans cette branche");
});

await test("B-9. `FileViewerModal` conserve l'`<iframe>` pour un PDF", () => {
  const { autre } = branchesVisionneuse();
  assert.ok(autre.includes("<iframe"), "⚠️ l'iframe EXISTE TOUJOURS");
  assert.ok(autre.includes("src={urlCourante}"), "sur la même URL signée");
  assert.ok(autre.includes("title={titre}"), "avec son `title`");
  assert.ok(autre.includes('data-visionneuse="document"'), "et son marqueur d'origine, inchangé");
  assert.ok(autre.includes("h-[70vh]"), "et sa hauteur d'origine");
  assert.ok(!autre.includes("<img"), "⚠️ aucun `<img>` ne doit remplacer l'iframe");
});

await test("B-10. `video` et `autre` gardent le comportement existant", () => {
  // La branche n'est atteinte QUE sur `kind === "image"` : tout le reste
  // tombe dans l'iframe, y compris un `kind` absent.
  assert.ok(
    /kind = "autre" \}: FileViewerModalProps/.test(CODE_VISIONNEUSE),
    "⚠️ `kind` par défaut vaut \"autre\" : un appelant qui l'ignore garde l'iframe",
  );
  assert.ok(
    !/kind === "(pdf|video|autre)"/.test(CODE_VISIONNEUSE),
    "aucune autre branche par `kind` n'a été introduite",
  );
  // Les quatre états partagés sont intacts.
  for (const marqueur of [
    'data-etat="hors-ligne"',
    'data-etat="erreur"',
    "Réessayer",
    'data-issue="ouvrir-document"',
    "Une connexion est nécessaire pour ouvrir ce document.",
    "Ce document n&apos;est pas disponible. Le lien a peut-être expiré.",
  ]) {
    assert.ok(SOURCE_VISIONNEUSE.includes(marqueur), `état existant perdu : ${marqueur}`);
  }
  // Et `reessayer` reste branché sur `onRafraichir`, pour les deux branches.
  assert.ok(CODE_VISIONNEUSE.includes("onRafraichir ? await onRafraichir() : urlCourante"));
  // Le lecteur vidéo n'est pas concerné : il a sa propre modale.
  assert.ok(CODE_BIBLIO.includes("VideoPlayerModal"), "le chemin vidéo est inchangé");
  assert.ok(
    CODE_BIBLIO.includes('genre === "video" ?'),
    "l'aiguillage vidéo/fichier d'origine subsiste",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   B — MINIATURES
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-11. la miniature passe par une URL SIGNÉE", async () => {
  // Exécution réelle de la primitive de signature utilisée par la miniature.
  const { client, ordres } = fauxStorage();
  const url = await getSignedDocumentFileUrl(client, `${DOC}/photo.jpg`);
  assert.ok(url, "une URL doit être produite");
  assert.equal(ordres.length, 1, "une seule signature");
  assert.equal(ordres[0]?.bucket, DOCUMENTS_BUCKET, "sur le bucket documents");
  assert.equal(ordres[0]?.chemin, `${DOC}/photo.jpg`, "et sur le chemin exact");
  assert.match(String(url), /\/object\/sign\//, "c'est bien une URL signée");
  assert.match(String(url), /token=/, "elle porte un jeton");

  // Et c'est CETTE fonction que la miniature appelle.
  const i = CODE_BIBLIO.indexOf("function MiniatureImage");
  assert.ok(i > 0, "MiniatureImage doit exister");
  const corps = CODE_BIBLIO.slice(i, CODE_BIBLIO.indexOf("\nfunction ", i + 10));
  assert.ok(corps.includes("getSignedDocumentFileUrl(supabase, storagePath)"), "signature à la demande");
});

await test("B-12. AUCUNE signature pour un document verrouillé", () => {
  const i = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corps = CODE_BIBLIO.slice(i, CODE_BIBLIO.indexOf("\nfunction ", i + 10));
  // Garde DANS le composant : l'effet sort avant toute signature.
  const iEffet = corps.indexOf("useEffect(() => {");
  const iGarde = corps.indexOf("if (!disponible) return;", iEffet);
  const iSignature = corps.indexOf("getSignedDocumentFileUrl", iEffet);
  assert.ok(iEffet > 0 && iGarde > iEffet, "l'effet doit commencer par la garde");
  assert.ok(iGarde < iSignature, "⚠️ la garde précède la signature");
  assert.ok(corps.includes("[storagePath, disponible]"), "et `disponible` est dans les dépendances");

  // Garde EN AMONT : le composant n'est même pas monté pour un verrouillé.
  assert.ok(
    /kind === "image" && document\.storagePath && availability\.available &&/.test(CODE_BIBLIO),
    "⚠️ double garde : la carte ne monte la miniature que si le document est disponible",
  );

  // Rendu réel : un document image VERROUILLÉ ne produit aucune balise image.
  const htmlVerrouille = rendre([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg` }, { disponible: false }),
  ]);
  assert.ok(!htmlVerrouille.includes('data-miniature="image"'), "aucune miniature rendue");
  assert.ok(!htmlVerrouille.includes("<img"), "aucune balise image du tout");
  assert.ok(htmlVerrouille.includes("Lock") || htmlVerrouille.includes("svg"), "le cadenas est affiché");
});

await test("B-13. `onError` retombe sur l'icône de type, sans boucle", () => {
  const i = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corps = CODE_BIBLIO.slice(i, CODE_BIBLIO.indexOf("\nfunction ", i + 10));
  assert.ok(corps.includes("onError={() => setEchec(true)}"), "⚠️ `onError` doit exister");
  // Le repli est rendu dès que `echec` est vrai.
  assert.ok(/if \(!disponible \|\| echec \|\| !url\)/.test(corps), "le repli couvre les trois cas");
  assert.ok(corps.includes('data-miniature="repli"'), "et il est repérable");
  assert.ok(corps.includes("<Repli size={28}"), "le repli est l'icône de type");
  // ⚠️ PAS DE RE-SIGNATURE DANS `onError` : ce serait la boucle qu'on refuse.
  const iErreur = corps.indexOf("onError=");
  const apresErreur = corps.slice(iErreur, iErreur + 120);
  assert.ok(
    !apresErreur.includes("getSignedDocumentFileUrl"),
    "⚠️ `onError` ne doit JAMAIS redemander une signature",
  );
});

await test("B-14. un MIME absent est enregistré `null`, jamais `\"\"`", () => {
  // Les trois chemins d'écriture du MIME.
  assert.ok(
    CODE_MODALE_COACH.includes("fileMimeType: document.fileMimeType ?? null,"),
    "le seed d'édition garde `null`",
  );
  assert.ok(
    CODE_MODALE_COACH.includes("fileMimeType: uploadedFile?.fileMimeType || null,"),
    "⚠️ `||` et non `??` : une chaîne vide redevient `null`",
  );
  assert.ok(
    CODE_NOUVEAU.includes("fileMimeType: uploadedFile?.fileMimeType || null,"),
    "la création aussi",
  );
  assert.ok(
    CODE_CHAMP_UPLOAD.includes("fileMimeType: null,"),
    "le champ d'upload ne fabrique plus de chaîne vide",
  );
  // ⚠️ CONTRÔLE NÉGATIF : plus aucun `fileMimeType: ""` nulle part.
  for (const [nom, code] of [
    ["DocumentModal", CODE_MODALE_COACH],
    ["DocumentFileUploadField", CODE_CHAMP_UPLOAD],
    ["nouveau/page", CODE_NOUVEAU],
  ] as const) {
    assert.ok(
      !/fileMimeType:\s*""/.test(code),
      `${nom} ne doit plus produire \`fileMimeType: ""\``,
    );
    assert.ok(
      !/fileMimeType:[^,\n]*\?\?\s*""/.test(code),
      `${nom} ne doit plus ramener une absence à ""`,
    );
  }
});

await test("B-15. l'URL signée n'est stockée NULLE PART", () => {
  for (const [nom, code] of [
    ["RealDocumentLibrary", CODE_BIBLIO],
    ["FileViewerModal", CODE_VISIONNEUSE],
  ] as const) {
    assert.ok(!/localStorage/.test(code), `${nom} : aucun localStorage`);
    assert.ok(!/sessionStorage/.test(code), `${nom} : aucun sessionStorage`);
    assert.ok(!/indexedDB/i.test(code), `${nom} : aucun IndexedDB`);
    assert.ok(!/caches\.|CacheStorage/.test(code), `${nom} : aucun Cache Storage`);
  }
});

await test("B-16. aucune URL publique, jamais", () => {
  for (const [nom, code] of [
    ["RealDocumentLibrary", CODE_BIBLIO],
    ["FileViewerModal", CODE_VISIONNEUSE],
  ] as const) {
    assert.ok(!/getPublicUrl/.test(code), `${nom} : getPublicUrl est interdite`);
    assert.ok(!/object\/public/.test(code), `${nom} : aucune URL publique de bucket`);
  }
  // Et le `src` de la miniature ne peut pas être `storagePath` brut.
  const i = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corps = CODE_BIBLIO.slice(i, CODE_BIBLIO.indexOf("\nfunction ", i + 10));
  assert.ok(corps.includes("src={url}"), "le `src` vient de l'état signé");
  assert.ok(!/src=\{storagePath\}/.test(corps), "⚠️ jamais `storagePath` comme URL");
  assert.ok(!/src=\{`\$\{/.test(corps), "ni une URL composée à la main");
  // Le double lèverait si getPublicUrl était appelée : contrôle du contrôle.
  const { client } = fauxStorage();
  assert.throws(
    () => (client as unknown as { storage: { from: (b: string) => { getPublicUrl: () => void } } }).storage.from(DOCUMENTS_BUCKET).getPublicUrl(),
    /INTERDITE/,
    "le double doit refuser getPublicUrl",
  );
});

await test("B-17. une seule signature par carte image affichée", () => {
  const i = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corps = CODE_BIBLIO.slice(i, CODE_BIBLIO.indexOf("\nfunction ", i + 10));
  // Une seule signature dans tout le composant.
  assert.equal(
    (corps.match(/getSignedDocumentFileUrl/g) ?? []).length,
    1,
    "un seul appel de signature dans la miniature",
  );
  // Déclenchée par un effet dont les dépendances ne bougent pas au rendu.
  assert.ok(corps.includes("}, [storagePath, disponible]);"), "dépendances stables");
  // Garde anti-double-montage (mode strict en développement).
  assert.ok(corps.includes("demande.current === storagePath"), "garde de ré-entrance");
  assert.ok(corps.includes("useRef<string | null>(null)"), "portée par une référence, pas un état");
  // Et la signature n'est PAS dans le corps du rendu.
  const iRetour = corps.indexOf("return (");
  assert.ok(
    corps.indexOf("getSignedDocumentFileUrl") < iRetour,
    "⚠️ la signature est dans l'effet, pas dans le rendu — sinon elle repartirait à chaque passe",
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   B — RENDU RÉEL DE LA CARTE
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-18. la carte rend le statut de consultation, et plus le statut éditorial", () => {
  // ⚠️ `DocumentStatusBadge` rend le libellé EN MINUSCULES et le met en
  // capitales par CSS (`uppercase`) : on mesure le texte réellement émis,
  // pas celui qu'on croit voir à l'écran.
  const htmlNouveau = rendre([item({ type: "pdf" }, { viewedAt: null })]);
  assert.ok(htmlNouveau.includes(">nouveau<"), "un document jamais ouvert est « nouveau »");
  assert.ok(!htmlNouveau.includes(">consulté<"), "et pas « consulté »");

  const htmlConsulte = rendre([item({ type: "pdf" }, { viewedAt: "2026-09-20T08:00:00.000Z" })]);
  assert.ok(htmlConsulte.includes(">consulté<"), "un document ouvert est « consulté »");
  assert.ok(!htmlConsulte.includes(">nouveau<"), "et plus « nouveau »");

  // ⚠️ LE STATUT ÉDITORIAL A DISPARU DE LA CARTE ÉLÈVE.
  assert.ok(!/statusDotTone/.test(CODE_BIBLIO), "`statusDotTone` ne doit plus exister");
  assert.ok(
    !/document\.status/.test(CODE_BIBLIO),
    "⚠️ `document.status` (brouillon/publié/archivé) n'a rien à faire sur une carte élève",
  );
  for (const mot of ["brouillon", "bg-success", "bg-destructive"]) {
    assert.ok(!htmlNouveau.includes(mot), `« ${mot} » ne doit pas être rendu sur une carte élève`);
  }

  // Un verrouillé n'affiche aucun statut de consultation.
  const htmlVerrouille = rendre([item({ type: "pdf" }, { disponible: false, viewedAt: null })]);
  assert.ok(!htmlVerrouille.includes(">nouveau<"), "pas de reproche sur un contenu qu'on ne peut pas ouvrir");
  assert.ok(!htmlVerrouille.includes(">consulté<"));
});

await test("B-19. la miniature n'est tentée que pour une IMAGE téléversée", () => {
  // Un PDF ne produit aucun conteneur de miniature.
  const htmlPdf = rendre([item({ type: "pdf", fileMimeType: "application/pdf" })]);
  assert.ok(!htmlPdf.includes("data-miniature"), "aucune miniature pour un PDF");

  // Une image SANS fichier téléversé non plus.
  const htmlSansFichier = rendre([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: null, externalUrl: "https://exemple.test/x.jpg" }),
  ]);
  assert.ok(!htmlSansFichier.includes("data-miniature"), "aucune miniature sans storagePath");

  // Une image téléversée et disponible produit le conteneur. Le rendu serveur
  // n'exécute pas les effets : l'URL est encore nulle, donc c'est le REPLI
  // qui sort — ce qui prouve au passage qu'aucune balise `<img>` n'est émise
  // avant qu'une URL signée existe.
  const htmlImage = rendre([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg` }),
  ]);
  assert.ok(htmlImage.includes('data-miniature="repli"'), "le conteneur est monté, en repli");
  assert.ok(!htmlImage.includes('data-miniature="image"'), "et aucune `<img>` sans URL signée");
  assert.ok(!htmlImage.includes("<img"), "⚠️ jamais de `<img src>` vide ou cassée");

  // Et un PDF dont le MIME dit « image » EST traité comme une image : c'est
  // la priorité du MIME, vérifiée de bout en bout sur le rendu.
  const htmlMimeGagne = rendre([
    item({ type: "pdf", fileMimeType: "image/jpeg", storagePath: `${DOC}/vraiment-une-image.bin` }),
  ]);
  assert.ok(htmlMimeGagne.includes("data-miniature"), "⚠️ le MIME décide, jusque dans le rendu");
});

await test("B-20. la bibliothèque reste fonctionnelle : filtres, recherche, état vide", () => {
  assert.ok(rendre([]).includes("Aucun document disponible pour le moment."), "état vide");
  const html = rendre([item({ type: "pdf", title: "Morphologie" })]);
  for (const filtre of ["Mes documents", "Vidéos", "Guides", "Nutrition", "Entraînement", "Administratif", "À venir / verrouillés"]) {
    assert.ok(html.includes(filtre), `filtre perdu : ${filtre}`);
  }
  assert.ok(html.includes("Rechercher par titre ou description"), "la recherche subsiste");
  assert.ok(html.includes("Morphologie"), "le titre est rendu");
  assert.ok(html.includes("Ouvrir le PDF"), "et l'action d'ouverture du PDF");
  // L'icône de type est rendue (repli visuel sur toutes les cartes).
  assert.ok(html.includes("<svg"), "une icône est présente");
});

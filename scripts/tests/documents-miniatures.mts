/**
 * Harnais — MINIATURES DE DOCUMENTS (image de couverture facultative).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI EST MESURÉ, ET COMMENT — QUATRE NIVEAUX, HONNÊTEMENT DISTINGUÉS
 * ────────────────────────────────────────────────────────────────────────────
 * 1. LES FONCTIONS PURES SONT APPELÉES POUR DE VRAI. `validateDocumentCoverSource`
 *    reçoit de VRAIS octets d'en-tête (JPEG, PNG, WebP, SVG, PDF) : la règle
 *    « l'extension n'entre pour rien » est exécutée, pas décrite.
 * 2. LE CYCLE DE VIE EST MESURÉ SUR L'ORDRE RÉEL DES APPELS. Un faux client
 *    journalise chaque opération Storage et chaque écriture en base ; les
 *    assertions portent sur la SÉQUENCE, puisque c'est elle qui peut faire
 *    perdre l'image d'un coach. Toute opération non implémentée LÈVE : un
 *    faux permissif ne prouverait rien.
 * 3. LES COMPOSANTS SONT RENDUS POUR DE VRAI (`renderToString`) et le balisage
 *    produit est inspecté : rapport 16/9, `object-cover`, repli, absence de
 *    `<img>` sans URL.
 * 4. L'IDENTITÉ ENTRE LES DEUX ESPACES ET LES MIROIRS DE LA MIGRATION sont
 *    vérifiés SUR LE TEXTE des sources, et c'est une limite assumée : on
 *    prouve qu'un seul composant est importé des deux côtés et que les
 *    constantes TypeScript disent la même chose que le SQL — pas que le
 *    navigateur rend deux pixels identiques.
 *
 * ⚠️ CE QUE CE HARNAIS NE PROUVE PAS, et qui est mesuré ailleurs : les DROITS
 * RÉELS. Aucune policy ne s'exécute ici. L'isolation entre coachs, les règles
 * de publication et les droits des élèves sont mesurés par acteur sur une base
 * locale : supabase/tests/documents_miniatures_checklist.sql.
 *
 * Lancement : npm run test:documents-miniatures
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";

import {
  CLASSES_CADRE_ILLUSTRATION,
  CLASSES_IMAGE_ILLUSTRATION,
  DocumentCoverImage,
  STYLE_CADRE_ILLUSTRATION,
} from "../../components/shared/DocumentCoverImage";
import { RealDocumentLibrary } from "../../components/student/RealDocumentLibrary";
import { sniffImageMime, looksLikeSvg } from "../../lib/images/signature";
import {
  poserCouvertureApresCreation,
  remplacerCouverture,
  supprimerCouverture,
} from "../../lib/supabase/document-cover-lifecycle";
import type { StudentDocumentWithAvailability } from "../../lib/supabase/documents";
import {
  DOCUMENT_COVERS_BUCKET,
  DOCUMENT_COVER_ASPECT,
  DOCUMENT_COVER_MAX_BYTES,
  DOCUMENT_COVER_MIME,
  describeDocumentCoverRejection,
  validateDocumentCoverFile,
  validateDocumentCoverSource,
} from "../../lib/supabase/storage-document-covers";
import type { AdminDocument } from "../../types";

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
/** Retire commentaires de bloc et de ligne : une règle ne se prouve pas en prose. */
function sansProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

const CODE_COUVERTURE = sansProse(lire("../../components/shared/DocumentCoverImage.tsx"));
const CODE_CHAMP = sansProse(lire("../../components/admin/DocumentCoverField.tsx"));
const CODE_CYCLE = sansProse(lire("../../lib/supabase/document-cover-lifecycle.ts"));
const CODE_STOCKAGE = sansProse(lire("../../lib/supabase/storage-document-covers.ts"));
const CODE_BIBLIO = sansProse(lire("../../components/student/RealDocumentLibrary.tsx"));
const CODE_LISTE_ADMIN = sansProse(lire("../../app/admin/documents/page.tsx"));
const CODE_MODALE = sansProse(lire("../../components/admin/DocumentModal.tsx"));
const CODE_NOUVEAU = sansProse(lire("../../app/admin/documents/nouveau/page.tsx"));
const CODE_DOCUMENTS_LIB = sansProse(lire("../../lib/supabase/documents.ts"));
const SQL_MIGRATION = lire("../../supabase/migrations/20261024090000_documents_miniatures_couverture.sql");

// ⚠️ SOURCES BRUTES, COMMENTAIRES COMPRIS. Les contrôles de documentation
// (G-8) portent justement sur la prose : `sansProse` l'aurait effacée.
const SOURCE_STOCKAGE = lire("../../lib/supabase/storage-document-covers.ts");
const SOURCE_CHAMP = lire("../../components/admin/DocumentCoverField.tsx");

/* ══════════════════════════════════════════════════════════════════════════
   LE BANC — fixtures, faux client, rendu
   ══════════════════════════════════════════════════════════════════════════ */

const DOC = "aaaaaaaa-0000-4000-8000-000000000001";
const FICHE = "bbbbbbbb-0000-4000-8000-00000000000f";
const COUVERTURE = `${FICHE}/${DOC}/1700000000000-photo.png`;
const ANCIENNE = `${FICHE}/${DOC}/1600000000000-ancienne.png`;

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
    externalUrl: "https://exemple.test/doc.pdf",
    videoUrl: "",
    fileName: "morpho.pdf",
    storagePath: null,
    fileSizeBytes: 1024,
    fileMimeType: "application/pdf",
    coverStoragePath: null,
    status: "publié",
    important: false,
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
  partiel: Partial<AdminDocument> = {},
  options: { disponible?: boolean } = {},
): StudentDocumentWithAvailability {
  const disponible = options.disponible !== false;
  return {
    document: document_(partiel),
    availability: {
      available: disponible,
      unlockDate: disponible ? null : "2026-12-01",
      manuallyUnlocked: false,
    },
    viewedAt: null,
  };
}

/** Rend la bibliothèque élève en balisage statique. */
function rendreBiblio(documents: StudentDocumentWithAvailability[]): string {
  return renderToString(createElement(RealDocumentLibrary, { documents, studentId: null }));
}

/** Rend la miniature seule, hors carte. */
function rendreCouverture(coverStoragePath: string | null): string {
  return renderToString(createElement(DocumentCoverImage, { coverStoragePath, titre: "Morphologie" }));
}

/* ── Le faux client : il journalise l'ORDRE, et lève sur l'inconnu ───────── */

interface FauxOptions {
  echecUpload?: boolean;
  echecBase?: boolean;
  fiche?: string | null;
}

function fauxClient(options: FauxOptions = {}) {
  const ordres: string[] = [];
  const client = {
    rpc(nom: string) {
      if (nom !== "current_staff_id") {
        throw new Error(`fauxClient.rpc(${nom}) : non implémentée — ce lot n'appelle que current_staff_id`);
      }
      ordres.push("rpc:current_staff_id");
      const fiche = options.fiche === undefined ? FICHE : options.fiche;
      return Promise.resolve({ data: fiche, error: null });
    },
    storage: {
      from(bucket: string) {
        return {
          upload(path: string) {
            ordres.push(`upload:${bucket}:${path}`);
            if (options.echecUpload) {
              return Promise.resolve({ data: null, error: { message: "refus (test)" } });
            }
            return Promise.resolve({ data: { path }, error: null });
          },
          remove(paths: string[]) {
            ordres.push(`remove:${bucket}:${paths.join("|")}`);
            return Promise.resolve({ data: [], error: null });
          },
          createSignedUrl(path: string, expiresIn: number) {
            ordres.push(`sign:${bucket}:${path}`);
            return Promise.resolve({
              data: { signedUrl: `https://exemple.test/sign/${bucket}/${path}?token=JETON&exp=${expiresIn}` },
              error: null,
            });
          },
          getPublicUrl() {
            throw new Error(
              "fauxClient.getPublicUrl : INTERDITE dans ce lot — une miniature ne se sert jamais d'une URL publique",
            );
          },
        };
      },
    },
    from(table: string) {
      if (table !== "documents") {
        throw new Error(`fauxClient.from(${table}) : non implémentée — ce lot n'écrit que la table documents`);
      }
      return {
        update(champs: Record<string, unknown>) {
          return {
            eq(colonne: string, valeur: string) {
              ordres.push(
                `update:documents:${colonne}=${valeur}:cover=${JSON.stringify(champs.cover_storage_path)}`,
              );
              if (options.echecBase) {
                return Promise.resolve({ error: { message: "refus (test)" } });
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  } as never;
  return { client, ordres };
}

/* ── De vrais octets d'en-tête ───────────────────────────────────────────── */

const ENTETE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const ENTETE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const ENTETE_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const ENTETE_SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
const ENTETE_XML_SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
const ENTETE_PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
const ENTETE_GIF = new TextEncoder().encode("GIF89a");

function fichier(nom: string, type: string, octets: Uint8Array, taille?: number): File {
  // Un `ArrayBuffer` plutôt qu'une vue : `BlobPart` n'accepte pas une
  // `Uint8Array<ArrayBufferLike>` sous le réglage de types du projet.
  const longueur = taille && taille > octets.length ? taille : octets.length;
  const tampon = new ArrayBuffer(longueur);
  new Uint8Array(tampon).set(octets.subarray(0, Math.min(octets.length, longueur)));
  return new File([tampon], nom, { type });
}

/* ══════════════════════════════════════════════════════════════════════════
   A — AFFICHAGE : 16/9, RECADRAGE, REPLI
   ══════════════════════════════════════════════════════════════════════════ */

await test("A-1. l'emplacement est en 16/9, et le rapport est RENDU", () => {
  assert.deepEqual({ ...DOCUMENT_COVER_ASPECT }, { width: 16, height: 9 });
  const html = rendreCouverture(null);
  assert.ok(html.includes("aspect-ratio:16 / 9") || html.includes("aspect-ratio:16/9"), `rapport absent du balisage : ${html}`);
});

await test("A-2. sans couverture : l'emplacement existe, en repli, et AUCUNE <img>", () => {
  const html = rendreCouverture(null);
  assert.ok(html.includes('data-couverture="repli"'), "l'emplacement est monté");
  assert.ok(!html.includes('data-couverture="image"'));
  assert.ok(!html.includes("<img"), "⚠️ jamais de `<img src>` vide ou cassée");
  assert.ok(html.includes("<svg"), "une icône discrète occupe la place");
});

await test("A-3. avec un chemin, le rendu serveur reste en repli : aucune URL avant signature", () => {
  // `renderToString` n'exécute pas les effets : l'URL n'existe pas encore.
  const html = rendreCouverture(COUVERTURE);
  assert.ok(html.includes('data-couverture="repli"'), "repli tant qu'aucune URL n'est signée");
  assert.ok(!html.includes("<img"), "⚠️ aucune balise image sans URL signée");
  assert.ok(!html.includes(COUVERTURE), "le chemin de stockage n'est pas écrit dans le balisage");
});

await test("A-4. le recadrage est `object-cover` CENTRÉ, et l'image remplit l'emplacement", () => {
  // Les classes viennent des constantes partagées : on mesure LEUR contenu, et
  // le fait que le composant les consomme au lieu de réécrire une chaîne.
  assert.equal(CLASSES_IMAGE_ILLUSTRATION, "h-full w-full object-cover object-center");
  assert.ok(/className=\{CLASSES_IMAGE_ILLUSTRATION\}/.test(CODE_COUVERTURE), "le composant consomme la constante");
  assert.ok(CLASSES_CADRE_ILLUSTRATION.includes("overflow-hidden"), "le débordement est coupé, l'image n'est pas déformée");
  assert.ok(/loading="lazy"/.test(CODE_COUVERTURE), "chargement différé");
  for (const code of [CODE_COUVERTURE, CODE_BIBLIO]) {
    assert.ok(!/object-contain|object-fill|object-scale-down/.test(code), "⚠️ jamais de déformation ni de bandes");
  }
});

await test("A-5. le repli n'annonce AUCUNE erreur", () => {
  const html = rendreCouverture(null);
  for (const mot of ["erreur", "Erreur", "échec", "Échec", "indisponible", "introuvable"]) {
    assert.ok(!html.includes(mot), `le repli ne doit pas dire « ${mot} »`);
  }
  assert.ok(/aria-hidden="true"/.test(html), "l'icône de repli est décorative");
});

await test("A-6. la carte élève porte l'emplacement EN HAUT, avant le titre", () => {
  const html = rendreBiblio([item()]);
  const iCouverture = html.indexOf("data-couverture");
  const iTitre = html.indexOf("Morphologie");
  assert.ok(iCouverture >= 0, "l'emplacement est présent sur la carte élève");
  assert.ok(iCouverture < iTitre, "⚠️ la miniature précède le titre dans le balisage");
});

await test("A-7. la hauteur est cohérente : avec ou sans image, le MÊME emplacement", () => {
  const sans = rendreBiblio([item()]);
  const avec = rendreBiblio([item({ coverStoragePath: COUVERTURE })]);
  const rapport = (html: string) => (html.match(/aspect-ratio:16 ?\/ ?9/g) ?? []).length;
  assert.equal(rapport(sans), 1, "un emplacement sur une carte sans image");
  assert.equal(rapport(avec), 1, "un emplacement sur une carte avec image");
  // Aucune hauteur fixe en pixels : c'est le rapport qui réserve la place.
  assert.ok(!/h-\[\d+px\]/.test(CODE_COUVERTURE), "pas de hauteur figée en pixels");
});

await test("A-8. l'APERÇU DE L'ORIGINAL est au MÊME ratio 16/9, pas à une hauteur à part", () => {
  // Une carte illustrée par le fichier du document (image téléversée,
  // disponible, sans couverture) doit avoir exactement la même hauteur que sa
  // voisine illustrée par une couverture.
  const html = rendreBiblio([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg` }),
  ]);
  assert.equal(
    (html.match(/aspect-ratio:16 ?\/ ?9/g) ?? []).length,
    1,
    "exactement un cadre 16/9 sur une carte illustrée par son original",
  );
  assert.ok(html.includes('data-miniature="repli"'), "c'est bien l'aperçu de l'original qui occupe le cadre");
  assert.ok(!html.includes("data-couverture"), "et pas de second cadre en doublon");

  // ⚠️ PLUS AUCUNE HAUTEUR FIXE : c'est `h-40` qui créait l'écart.
  assert.ok(!/h-40/.test(CODE_BIBLIO), "⚠️ `h-40` ne doit plus exister : il désalignait les cartes");
  const iMiniature = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corpsMiniature = CODE_BIBLIO.slice(iMiniature, CODE_BIBLIO.indexOf("\nfunction ", iMiniature + 10));
  // ⚠️ BORNÉ AU CORPS DE L'APERÇU : ailleurs dans le fichier, les `min-h-[44px]`
  // sont des tailles de zone tactile, pas des hauteurs d'illustration.
  assert.ok(!/h-\[\d+px\]/.test(corpsMiniature), "aucune hauteur en pixels dans l'aperçu");
  assert.ok(!/\bh-\d+\b/.test(corpsMiniature), "aucune hauteur fixe d'aucune sorte");
});

await test("A-9. le cadre n'est défini QU'UNE FOIS, et les deux illustrations le partagent", () => {
  // Les constantes sont la source unique — pas deux chaînes recopiées.
  assert.equal(STYLE_CADRE_ILLUSTRATION.aspectRatio, "16 / 9");
  assert.ok(CLASSES_CADRE_ILLUSTRATION.includes("overflow-hidden"), "le cadre coupe le débordement");
  assert.ok(CLASSES_IMAGE_ILLUSTRATION.includes("object-cover"), "et recadre sans déformer");
  assert.ok(CLASSES_IMAGE_ILLUSTRATION.includes("object-center"), "…centré");

  // La bibliothèque élève les IMPORTE au lieu de les réécrire.
  assert.ok(
    /CLASSES_CADRE_ILLUSTRATION/.test(CODE_BIBLIO) && /STYLE_CADRE_ILLUSTRATION/.test(CODE_BIBLIO),
    "l'aperçu de l'original consomme les constantes partagées",
  );
  const iMini = CODE_BIBLIO.indexOf("function MiniatureImage");
  const corpsMini = CODE_BIBLIO.slice(iMini, CODE_BIBLIO.indexOf("\nfunction ", iMini + 10));
  assert.ok(!/aspectRatio/.test(corpsMini), "⚠️ le rapport n'est PAS réécrit dans l'aperçu de l'original");
  assert.ok(!/object-cover/.test(corpsMini), "⚠️ ni le recadrage");
  assert.ok(corpsMini.includes("STYLE_CADRE_ILLUSTRATION"), "il vient de la constante");
});

await test("A-10. UNE SEULE ILLUSTRATION EN HAUT, dans les quatre combinaisons", () => {
  const cas: [string, Partial<AdminDocument>][] = [
    ["ni couverture ni image", {}],
    ["couverture seule", { coverStoragePath: COUVERTURE }],
    ["image originale seule", { type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/p.jpg` }],
    ["les deux", { type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/p.jpg`, coverStoragePath: COUVERTURE }],
  ];
  for (const [nom, partiel] of cas) {
    const html = rendreBiblio([item(partiel)]);
    const cadres = (html.match(/aspect-ratio:16 ?\/ ?9/g) ?? []).length;
    assert.equal(cadres, 1, `${nom} : ${cadres} cadre(s) au lieu d'un seul`);
    const marques =
      (html.match(/data-couverture="/g) ?? []).length + (html.match(/data-miniature="/g) ?? []).length;
    assert.equal(marques, 1, `${nom} : ${marques} illustration(s) marquée(s) au lieu d'une`);
    // Et elle précède toujours le titre.
    const iIllustration = Math.min(
      ...[html.indexOf("data-couverture"), html.indexOf("data-miniature")].filter((i) => i >= 0),
    );
    assert.ok(iIllustration < html.indexOf("Morphologie"), `${nom} : l'illustration doit précéder le titre`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   B — IDENTITÉ ENTRE LES DEUX ESPACES
   ══════════════════════════════════════════════════════════════════════════ */

await test("B-1. élève et staff importent LE MÊME composant", () => {
  for (const [nom, code] of [
    ["bibliothèque élève", CODE_BIBLIO],
    ["liste admin/coach", CODE_LISTE_ADMIN],
    ["modale admin/coach", CODE_MODALE],
  ] as const) {
    // ⚠️ L'IMPORT PEUT ÊTRE SUR UNE OU PLUSIEURS LIGNES. On mesure la
    // propriété — ce module-là, ce nom-là — pas sa mise en forme.
    const i = code.indexOf('from "@/components/shared/DocumentCoverImage"');
    assert.ok(i > 0, `${nom} : n'importe pas le module partagé`);
    const clause = code.slice(Math.max(0, code.lastIndexOf("import", i)), i);
    assert.ok(clause.includes("DocumentCoverImage"), `${nom} : n'importe pas le composant partagé`);
  }
});

await test("B-2. il n'existe QU'UN composant de miniature de couverture", () => {
  for (const [nom, code] of [
    ["bibliothèque élève", CODE_BIBLIO],
    ["liste admin/coach", CODE_LISTE_ADMIN],
    ["champ de formulaire", CODE_CHAMP],
  ] as const) {
    assert.ok(
      !/function\s+\w*Couverture\w*Image|function\s+DocumentCoverImage/.test(code),
      `${nom} : réécrit une seconde miniature au lieu d'utiliser la partagée`,
    );
  }
  assert.ok(/export function DocumentCoverImage/.test(CODE_COUVERTURE), "une seule définition, dans le module partagé");
});

await test("B-3. le rapport, le recadrage et le repli ne se règlent PAS depuis l'appelant", () => {
  // Seuls l'arrondi, la largeur et l'icône sont paramétrables : tout ce qui
  // définit l'aspect visuel commun est enfermé dans le composant.
  const signature = CODE_COUVERTURE.slice(
    CODE_COUVERTURE.indexOf("export function DocumentCoverImage"),
    CODE_COUVERTURE.indexOf("}) {"),
  );
  assert.ok(!signature.includes("aspect"), "le rapport n'est pas un paramètre");
  assert.ok(!signature.includes("objectFit"), "le recadrage n'est pas un paramètre");
  assert.ok(signature.includes("rounded"), "l'arrondi, lui, est paramétrable (coins de carte vs. panneau)");
  assert.ok(signature.includes("className"), "la largeur du conteneur est paramétrable");
});

await test("B-4. côté staff, la largeur est bornée sur ordinateur et pleine sur mobile", () => {
  const i = CODE_LISTE_ADMIN.indexOf("<DocumentCoverImage");
  assert.ok(i >= 0, "la liste staff rend la miniature");
  const appel = CODE_LISTE_ADMIN.slice(i, CODE_LISTE_ADMIN.indexOf("/>", i));
  assert.ok(/w-full/.test(appel), "pleine largeur sur mobile");
  assert.ok(/(sm|md|lg):w-/.test(appel), "largeur bornée sur grand écran");
});

/* ══════════════════════════════════════════════════════════════════════════
   C — COMPATIBILITÉ AVEC LES DOCUMENTS ANTÉRIEURS
   ══════════════════════════════════════════════════════════════════════════ */

await test("C-1. les six types rendent sans erreur, avec et sans couverture", () => {
  for (const type of ["pdf", "vidéo", "lien", "guide", "image", "texte"] as const) {
    for (const cover of [null, COUVERTURE]) {
      const html = rendreBiblio([
        item({ type, coverStoragePath: cover, contentText: type === "texte" ? "Note" : "" }),
      ]);
      assert.ok(html.includes("data-couverture") || html.includes("data-miniature"), `${type} / ${cover} : aucune illustration`);
      assert.ok(!html.includes("<img src=\"\""), `${type} / ${cover} : image cassée`);
    }
  }
});

await test("C-2. un document ANTÉRIEUR (cover NULL) garde un emplacement neutre, jamais une carte cassée", () => {
  const html = rendreBiblio([item({ coverStoragePath: null })]);
  assert.ok(html.includes('data-couverture="repli"'));
  assert.ok(!html.includes("<img"), "⚠️ aucune balise image");
  assert.ok(html.includes("Morphologie"), "la carte reste complète");
  assert.ok(html.includes("Télécharger"), "et son action d'ouverture (lien externe, sans fichier téléversé)");
});

await test("C-3. l'aperçu de l'ORIGINAL (image téléversée) n'est pas remplacé par ce lot", () => {
  // Pas de couverture, mais le document EST une image téléversée et disponible :
  // c'est le comportement antérieur qui illustre la carte, à l'identique.
  const html = rendreBiblio([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg`, coverStoragePath: null }),
  ]);
  assert.ok(html.includes('data-miniature="repli"'), "l'aperçu de l'original est monté");
  assert.ok(!html.includes("data-couverture"), "et il prend la place de l'emplacement, sans doublon");
});

await test("C-4. la couverture a PRIORITÉ sur l'aperçu de l'original", () => {
  const html = rendreBiblio([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg`, coverStoragePath: COUVERTURE }),
  ]);
  assert.ok(html.includes("data-couverture"), "la couverture illustre la carte");
  assert.ok(!html.includes("data-miniature"), "⚠️ une seule illustration, jamais deux");
});

await test("C-5. un PDF verrouillé montre sa couverture, mais AUCUN accès à l'original", () => {
  const html = rendreBiblio([item({ coverStoragePath: COUVERTURE }, { disponible: false })]);
  assert.ok(html.includes("data-couverture"), "la couverture annonce le contenu à venir");
  assert.ok(!html.includes("Ouvrir le PDF"), "⚠️ le fichier reste inaccessible avant son déblocage");
  assert.ok(html.includes("Disponible"), "le message de déblocage est là");
});

await test("C-6. un document verrouillé NE monte PAS l'aperçu de son original", () => {
  const html = rendreBiblio([
    item({ type: "image", fileMimeType: "image/jpeg", storagePath: `${DOC}/photo.jpg` }, { disponible: false }),
  ]);
  assert.ok(!html.includes("data-miniature"), "⚠️ l'original d'un verrouillé n'est jamais signé");
  assert.ok(html.includes('data-couverture="repli"'), "c'est l'emplacement neutre qui sort");
});

await test("C-7. la colonne est lue, et la charge utile du formulaire ne l'écrit JAMAIS", () => {
  assert.ok(/coverStoragePath: row\.cover_storage_path/.test(CODE_DOCUMENTS_LIB), "la colonne est mappée en lecture");
  const i = CODE_DOCUMENTS_LIB.indexOf("function documentFields");
  const corps = CODE_DOCUMENTS_LIB.slice(i, CODE_DOCUMENTS_LIB.indexOf("\n}", i));
  assert.ok(!corps.includes("cover_storage_path"), "⚠️ l'insertion ne porte pas la couverture");
  // Et la modale n'émet pas le champ dans `onSave`.
  const j = CODE_MODALE.indexOf("function handleSave");
  const save = CODE_MODALE.slice(j, CODE_MODALE.indexOf("setSaved(true)", j));
  assert.ok(!save.includes("coverStoragePath"), "⚠️ publier ou renommer ne peut pas effacer la miniature");
});

/* ══════════════════════════════════════════════════════════════════════════
   D — VALIDATION DE L'IMAGE : LES OCTETS, PAS L'EXTENSION
   ══════════════════════════════════════════════════════════════════════════ */

await test("D-1. les signatures réelles sont reconnues", () => {
  assert.equal(sniffImageMime(ENTETE_JPEG), "image/jpeg");
  assert.equal(sniffImageMime(ENTETE_PNG), "image/png");
  assert.equal(sniffImageMime(ENTETE_WEBP), "image/webp");
  assert.equal(sniffImageMime(ENTETE_PDF), null);
  assert.equal(sniffImageMime(ENTETE_GIF), null);
  assert.ok(looksLikeSvg(ENTETE_SVG));
  assert.ok(looksLikeSvg(ENTETE_XML_SVG));
  assert.ok(!looksLikeSvg(ENTETE_PNG));
});

await test("D-2. les trois formats admis passent", () => {
  assert.equal(validateDocumentCoverSource("image/jpeg", 1024, ENTETE_JPEG), null);
  assert.equal(validateDocumentCoverSource("image/png", 1024, ENTETE_PNG), null);
  assert.equal(validateDocumentCoverSource("image/webp", 1024, ENTETE_WEBP), null);
});

await test("D-3. tout autre format est refusé", () => {
  assert.equal(validateDocumentCoverSource("image/gif", 1024, ENTETE_GIF), "mime_not_supported");
  assert.equal(validateDocumentCoverSource("application/pdf", 1024, ENTETE_PDF), "mime_not_supported");
  assert.equal(validateDocumentCoverSource("image/svg+xml", 1024, ENTETE_SVG), "svg_refused");
});

await test("D-4. ⚠️ UN SVG DÉGUISÉ EN PNG EST REFUSÉ — l'extension n'entre pour rien", () => {
  assert.equal(validateDocumentCoverSource("image/png", 1024, ENTETE_SVG), "svg_refused");
  assert.equal(validateDocumentCoverSource("image/jpeg", 1024, ENTETE_XML_SVG), "svg_refused");
});

await test("D-5. un contenu qui contredit le type déclaré est refusé", () => {
  assert.equal(validateDocumentCoverSource("image/png", 1024, ENTETE_PDF), "content_mismatch");
  assert.equal(validateDocumentCoverSource("image/png", 1024, ENTETE_JPEG), "content_mismatch");
  assert.equal(validateDocumentCoverSource("image/webp", 1024, ENTETE_PNG), "content_mismatch");
  assert.equal(validateDocumentCoverSource("image/jpeg", 1024, ENTETE_GIF), "content_mismatch");
});

await test("D-6. le plafond de 5 Mo est appliqué, à l'octet près", () => {
  assert.equal(DOCUMENT_COVER_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(validateDocumentCoverSource("image/png", DOCUMENT_COVER_MAX_BYTES, ENTETE_PNG), null);
  assert.equal(validateDocumentCoverSource("image/png", DOCUMENT_COVER_MAX_BYTES + 1, ENTETE_PNG), "too_large");
  assert.equal(validateDocumentCoverSource("image/png", 0, ENTETE_PNG), "empty");
});

await test("D-7. chaque refus a un message DISTINCT et lisible", () => {
  const codes = ["empty", "too_large", "mime_not_supported", "svg_refused", "content_mismatch"] as const;
  const messages = codes.map((c) => describeDocumentCoverRejection(c));
  assert.equal(new Set(messages).size, codes.length, "cinq messages distincts");
  for (const m of messages) {
    assert.ok(m.length > 15, `message trop pauvre : ${m}`);
    assert.ok(!/undefined|null|\[object/.test(m), `message mal formé : ${m}`);
  }
  assert.ok(describeDocumentCoverRejection("svg_refused").includes("SVG"), "le cas SVG se nomme");
  assert.ok(describeDocumentCoverRejection("too_large").includes("5 Mo"), "le plafond se dit");
});

await test("D-8. la validation d'un VRAI fichier lit bien ses octets", async () => {
  assert.equal(await validateDocumentCoverFile(fichier("photo.png", "image/png", ENTETE_PNG)), null);
  const deguise = await validateDocumentCoverFile(fichier("photo.png", "image/png", ENTETE_SVG));
  assert.ok(deguise !== null && deguise.includes("SVG"), `un SVG nommé .png doit être refusé (${deguise})`);
  const faux = await validateDocumentCoverFile(fichier("image.jpg", "image/jpeg", ENTETE_PDF));
  assert.ok(faux !== null, "un PDF nommé .jpg doit être refusé");
});

await test("D-9. le champ valide AVANT d'envoyer, et vide le sélecteur", () => {
  const i = CODE_CHAMP.indexOf("async function choisir");
  const corps = CODE_CHAMP.slice(i, CODE_CHAMP.indexOf("async function televerser"));
  assert.ok(corps.includes('event.target.value = ""'), "le sélecteur est vidé : re-choisir le même fichier marche");
  assert.ok(corps.includes("validateDocumentCoverFile"), "validation réelle");
  assert.ok(
    corps.indexOf("validateDocumentCoverFile") < corps.indexOf("URL.createObjectURL"),
    "⚠️ la validation précède même l'aperçu",
  );
  assert.ok(!corps.includes("uploadDocumentCover") && !corps.includes("remplacerCouverture"), "⚠️ choisir n'envoie jamais");
});

/* ══════════════════════════════════════════════════════════════════════════
   E — CYCLE DE VIE : L'ORDRE RÉEL DES OPÉRATIONS
   ══════════════════════════════════════════════════════════════════════════ */

await test("E-1. REMPLACEMENT : téléverser → écrire la base → supprimer l'ancien", async () => {
  const { client, ordres } = fauxClient();
  const r = await remplacerCouverture(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG), ANCIENNE);
  assert.ok(r.ok, "le remplacement réussit");
  const utiles = ordres.filter((o) => !o.startsWith("rpc:"));
  assert.equal(utiles.length, 3, `trois opérations, pas plus : ${utiles.join(" ; ")}`);
  assert.ok(utiles[0].startsWith(`upload:${DOCUMENT_COVERS_BUCKET}:`), "1. téléversement");
  assert.ok(utiles[1].startsWith("update:documents:"), "2. écriture en base");
  assert.equal(utiles[2], `remove:${DOCUMENT_COVERS_BUCKET}:${ANCIENNE}`, "3. et SEULEMENT APRÈS, l'ancien objet");
});

await test("E-2. ⚠️ JAMAIS « SUPPRIMER PUIS TÉLÉVERSER » — l'ancien survit à un échec d'envoi", async () => {
  const { client, ordres } = fauxClient({ echecUpload: true });
  const r = await remplacerCouverture(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG), ANCIENNE);
  assert.ok(!r.ok, "l'échec est remonté");
  assert.ok(!ordres.some((o) => o.startsWith("remove:")), "⚠️ AUCUNE suppression : l'ancienne image est intacte");
  assert.ok(!ordres.some((o) => o.startsWith("update:")), "et la base n'a pas bougé");
});

await test("E-3. échec d'écriture : l'ancien est PRÉSERVÉ, le nouveau est nettoyé", async () => {
  const { client, ordres } = fauxClient({ echecBase: true });
  const r = await remplacerCouverture(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG), ANCIENNE);
  assert.ok(!r.ok, "l'échec est remonté");
  const suppressions = ordres.filter((o) => o.startsWith("remove:"));
  assert.equal(suppressions.length, 1, "une seule suppression");
  assert.ok(!suppressions[0].includes(ANCIENNE), "⚠️ ce n'est PAS l'ancienne couverture qui est supprimée");
  assert.ok(suppressions[0].includes("photo.png"), "c'est le nouvel objet, que plus rien ne référence");
  assert.ok(!r.ok && r.error.includes("précédente est conservée"), "et le message le dit au coach");
});

await test("E-4. SUPPRESSION : la base oublie d'abord, l'objet disparaît ensuite", async () => {
  const { client, ordres } = fauxClient();
  const r = await supprimerCouverture(client, DOC, ANCIENNE);
  assert.ok(r.ok && r.coverStoragePath === null);
  const utiles = ordres.filter((o) => !o.startsWith("rpc:"));
  assert.equal(utiles.length, 2);
  assert.ok(utiles[0].includes("cover=null"), "1. la colonne passe à NULL");
  assert.equal(utiles[1], `remove:${DOCUMENT_COVERS_BUCKET}:${ANCIENNE}`, "2. puis l'objet");
});

await test("E-5. suppression refusée par la base : l'objet n'est PAS détruit", async () => {
  const { client, ordres } = fauxClient({ echecBase: true });
  const r = await supprimerCouverture(client, DOC, ANCIENNE);
  assert.ok(!r.ok);
  assert.ok(!ordres.some((o) => o.startsWith("remove:")), "⚠️ rien n'est détruit : l'écran reste conforme à la base");
});

await test("E-6. suppression sans couverture : aucune opération", async () => {
  const { client, ordres } = fauxClient();
  const r = await supprimerCouverture(client, DOC, null);
  assert.ok(r.ok && r.coverStoragePath === null);
  assert.deepEqual(ordres, [], "ni écriture, ni suppression");
});

await test("E-7. CRÉATION : rien n'est envoyé avant que le document existe", () => {
  const i = CODE_NOUVEAU.indexOf("<DocumentCoverField");
  assert.ok(i >= 0, "le champ est présent sur la page de création");
  const appel = CODE_NOUVEAU.slice(i, CODE_NOUVEAU.indexOf("/>", i));
  assert.ok(/\bdiffere\b/.test(appel), "⚠️ le champ est en mode DIFFÉRÉ");
  assert.ok(/onPending=\{setPendingCover\}/.test(appel), "l'image attend en mémoire");
  // L'insertion ne porte jamais de chemin de couverture.
  assert.ok(/coverStoragePath: null,/.test(CODE_NOUVEAU), "l'insertion écrit NULL, toujours");
  // Et la pose vient APRÈS la création. ⚠️ On borne la recherche au CORPS de
  // `handleCreate` : `poserCouvertureApresCreation` apparaît aussi dans les
  // imports, tout en haut, ce qui inverserait l'ordre mesuré.
  const corpsCreate = CODE_NOUVEAU.slice(CODE_NOUVEAU.indexOf("async function handleCreate"));
  const iCreate = corpsCreate.indexOf("createDocumentSupabase(supabase, data, pendingDocumentId)");
  const iPose = corpsCreate.indexOf("poserCouvertureApresCreation");
  assert.ok(iCreate >= 0, "l'insertion est bien appelée avec l'identifiant pré-généré");
  assert.ok(iPose > iCreate, "⚠️ la couverture est posée APRÈS l'insertion");
});

await test("E-8. création : la pose suit le même ordre, sans ancien à supprimer", async () => {
  const { client, ordres } = fauxClient();
  const r = await poserCouvertureApresCreation(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG));
  assert.ok(r.ok);
  const utiles = ordres.filter((o) => !o.startsWith("rpc:"));
  assert.equal(utiles.length, 2, "téléversement puis écriture, et rien d'autre");
  assert.ok(utiles[0].startsWith("upload:"));
  assert.ok(utiles[1].startsWith("update:documents:"));
  assert.ok(!ordres.some((o) => o.startsWith("remove:")), "aucune suppression : il n'y avait pas d'ancienne image");
});

await test("E-9. un échec de pose n'annule PAS la création du document", () => {
  const corpsCreate = CODE_NOUVEAU.slice(CODE_NOUVEAU.indexOf("async function handleCreate"));
  const i = corpsCreate.indexOf("poserCouvertureApresCreation");
  assert.ok(i >= 0, "la pose est appelée depuis handleCreate");
  const suite = corpsCreate.slice(i, i + 600);
  assert.ok(/setCoverWarning/.test(suite), "le coach est averti");
  // L'identifiant créé est posé malgré l'échec de la miniature.
  const iCreated = corpsCreate.indexOf("setCreatedId(id)", i);
  assert.ok(iCreated > i, "⚠️ le document est bien enregistré même sans miniature");
});

await test("E-10. le chemin de stockage porte le propriétaire, et le navigateur ne le choisit pas", async () => {
  const { client, ordres } = fauxClient();
  await remplacerCouverture(client, DOC, fichier("mon image (1).png", "image/png", ENTETE_PNG), null);
  const envoi = ordres.find((o) => o.startsWith("upload:"))!;
  const chemin = envoi.slice(`upload:${DOCUMENT_COVERS_BUCKET}:`.length);
  const segments = chemin.split("/");
  assert.equal(segments[0], FICHE, "⚠️ le premier segment est la fiche résolue EN BASE");
  assert.equal(segments[1], DOC, "le second est l'identifiant du document");
  assert.ok(/^\d+-/.test(segments[2]), "le nom est horodaté : aucun écrasement en place");
  assert.ok(!/[^a-zA-Z0-9.\-_]/.test(segments[2].replace(/^\d+-/, "")), `nom assaini : ${segments[2]}`);
  assert.ok(ordres[0] === "rpc:current_staff_id", "la fiche est demandée à la base AVANT tout envoi");
});

await test("E-11. sans fiche staff, rien n'est envoyé", async () => {
  const { client, ordres } = fauxClient({ fiche: null });
  const r = await remplacerCouverture(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG), ANCIENNE);
  assert.ok(!r.ok, "refus explicite");
  assert.ok(!ordres.some((o) => o.startsWith("upload:")), "aucun téléversement sans propriétaire possible");
  assert.ok(!ordres.some((o) => o.startsWith("remove:")), "et l'ancienne image reste intacte");
});

await test("E-12. aucune double soumission : tout est désactivé pendant l'opération", () => {
  assert.ok(/const inactif = disabled \|\| enCours;/.test(CODE_CHAMP), "un seul verrou pour tout le champ");
  const occurrences = (CODE_CHAMP.match(/disabled=\{inactif\}/g) ?? []).length;
  assert.ok(occurrences >= 3, `sélecteur et boutons désactivés (${occurrences} contrôles)`);
  assert.ok(/setEnCours\(true\)/.test(CODE_CHAMP) && /setEnCours\(false\)/.test(CODE_CHAMP), "état de chargement réel");
});

await test("E-13. l'aperçu `blob:` est révoqué, jamais accumulé", () => {
  assert.ok(/URL\.revokeObjectURL/.test(CODE_CHAMP), "révocation présente");
  assert.ok(/return \(\) => \{\s*if \(apercuLocal\) URL\.revokeObjectURL\(apercuLocal\);/.test(CODE_CHAMP), "révocation au démontage");
  assert.ok(/function remplacerApercu/.test(CODE_CHAMP), "et à chaque remplacement");
});

/* ══════════════════════════════════════════════════════════════════════════
   F — NON-FUITE : AUCUNE URL PERSISTÉE, AUCUNE URL PUBLIQUE
   ══════════════════════════════════════════════════════════════════════════ */

await test("F-1. la miniature passe par une URL SIGNÉE, du seau dédié", async () => {
  const { client, ordres } = fauxClient();
  const { getSignedDocumentCoverUrl } = await import("../../lib/supabase/storage-document-covers");
  const url = await getSignedDocumentCoverUrl(client, COUVERTURE);
  assert.deepEqual(ordres, [`sign:${DOCUMENT_COVERS_BUCKET}:${COUVERTURE}`]);
  assert.ok(url !== null && url.includes("/sign/"), "une URL signée");
  assert.ok(url !== null && url.includes("token="), "porteuse d'un jeton temporaire");
});

await test("F-2. AUCUNE URL publique, nulle part", () => {
  for (const [nom, code] of [
    ["composant partagé", CODE_COUVERTURE],
    ["module de stockage", CODE_STOCKAGE],
    ["champ de formulaire", CODE_CHAMP],
    ["cycle de vie", CODE_CYCLE],
  ] as const) {
    assert.ok(!/getPublicUrl|object\/public/.test(code), `${nom} : une URL publique apparaît`);
  }
});

await test("F-3. l'URL signée n'est stockée NULLE PART", () => {
  for (const [nom, code] of [
    ["composant partagé", CODE_COUVERTURE],
    ["champ de formulaire", CODE_CHAMP],
    ["cycle de vie", CODE_CYCLE],
  ] as const) {
    for (const interdit of ["localStorage", "sessionStorage", "indexedDB", "caches.open", "document.cookie"]) {
      assert.ok(!code.includes(interdit), `${nom} : ${interdit} ne doit pas apparaître`);
    }
  }
  // Et jamais en base : seule la colonne de CHEMIN est écrite.
  assert.ok(!/signedUrl/.test(CODE_CYCLE), "le cycle de vie n'écrit jamais d'URL");
});

await test("F-4. une seule signature par carte, et AUCUNE re-signature sur erreur", () => {
  const i = CODE_COUVERTURE.indexOf("export function DocumentCoverImage");
  const corps = CODE_COUVERTURE.slice(i);
  assert.equal(
    (corps.match(/getSignedDocumentCoverUrl/g) ?? []).length,
    1,
    "un seul appel de signature dans le composant",
  );
  assert.ok(corps.includes("}, [coverStoragePath]);"), "dépendances stables : l'effet ne repart pas au rendu");
  assert.ok(corps.includes("demande.current === coverStoragePath"), "garde de ré-entrance (mode strict)");
  assert.ok(corps.includes("useRef<string | null>(null)"), "portée par une référence, pas un état");
  assert.ok(corps.includes("onError={() => setEchec(true)}"), "`onError` retombe sur le repli…");
  const iRetour = corps.indexOf("return (");
  assert.ok(corps.indexOf("getSignedDocumentCoverUrl") < iRetour, "⚠️ la signature est dans l'effet, pas dans le rendu");
});

await test("F-5. la colonne porte un CHEMIN, et la base ne reçoit jamais une URL", async () => {
  const { client, ordres } = fauxClient();
  await remplacerCouverture(client, DOC, fichier("photo.png", "image/png", ENTETE_PNG), null);
  const ecriture = ordres.find((o) => o.startsWith("update:documents:"))!;
  assert.ok(!/https?:/.test(ecriture), `⚠️ aucune URL en base : ${ecriture}`);
  assert.ok(!/token=/.test(ecriture), "aucun jeton de signature en base");
  assert.ok(ecriture.includes(`${FICHE}/${DOC}/`), "c'est bien le chemin du seau qui est écrit");
});

/* ══════════════════════════════════════════════════════════════════════════
   G — MIROIRS DE LA MIGRATION (le code et le SQL disent la même chose)
   ══════════════════════════════════════════════════════════════════════════ */

await test("G-1. le seau, ses plafonds et ses types MIME concordent avec le SQL", () => {
  assert.equal(DOCUMENT_COVERS_BUCKET, "document-covers");
  assert.ok(SQL_MIGRATION.includes("'document-covers'"), "le SQL crée bien ce seau");
  assert.ok(SQL_MIGRATION.includes(String(DOCUMENT_COVER_MAX_BYTES)), `le SQL plafonne à ${DOCUMENT_COVER_MAX_BYTES}`);
  for (const mime of DOCUMENT_COVER_MIME) {
    assert.ok(SQL_MIGRATION.includes(`'${mime}'`), `le SQL admet ${mime}`);
  }
  assert.deepEqual([...DOCUMENT_COVER_MIME], ["image/jpeg", "image/png", "image/webp"]);
});

await test("G-2. le SVG est exclu du seau, et le seau reste PRIVÉ", () => {
  // ⚠️ ON MESURE L'INSERT, PAS TOUT LE FICHIER. Le bloc de vérification
  // mentionne `image/svg+xml` à DESSEIN, pour le REFUSER : chercher la chaîne
  // dans l'ensemble du SQL ferait échouer le contrôle sur sa propre garde.
  const iInsert = SQL_MIGRATION.indexOf("insert into storage.buckets");
  const insertion = SQL_MIGRATION.slice(iInsert, SQL_MIGRATION.indexOf(";", iInsert));
  assert.ok(iInsert >= 0, "le seau est bien créé par un insert");
  assert.ok(!/image\/svg/.test(insertion), "aucun SVG dans les types admis");
  assert.ok(/false,/.test(insertion), "le seau est créé privé");
  // Et la garde existe : la migration refuse un seau qui aurait reçu du SVG.
  assert.ok(/'image\/svg\+xml' = any\(v_seau\.allowed_mime_types\)/.test(SQL_MIGRATION),
    "la vérification refuse explicitement le SVG");
  assert.ok(/set public = false/.test(SQL_MIGRATION), "et le reste même sur une relance");
});

await test("G-3. la migration est ADDITIVE : colonne nullable, aucune reprise de données", () => {
  assert.ok(/add column if not exists cover_storage_path text;/.test(SQL_MIGRATION), "colonne texte, ajout conditionnel");
  assert.ok(!/not null/i.test(SQL_MIGRATION.split("add column")[1].split(";")[0]), "nullable");
  assert.ok(!/\bupdate public\.documents\b/i.test(SQL_MIGRATION), "⚠️ aucun backfill : les documents existants ne sont pas réécrits");
  assert.ok(!/\bdelete from\b/i.test(SQL_MIGRATION), "aucune suppression de données");
  assert.ok(!/drop column|drop table/i.test(SQL_MIGRATION), "rien n'est retiré");
});

await test("G-4. la migration ne touche NI le seau `documents`, NI les policies de la table", () => {
  assert.ok(!/drop policy if exists "documents_bucket/.test(SQL_MIGRATION), "les policies du seau documents ne sont pas redéfinies");
  assert.ok(!/drop policy if exists "documents_select_global_or_assigned"/.test(SQL_MIGRATION), "ni celles de la table");
  assert.ok(!/update storage\.buckets[\s\S]*'documents'/.test(SQL_MIGRATION), "le seau documents n'est pas modifié");
  assert.ok(/id = 'documents' and public = false/.test(SQL_MIGRATION), "et la migration VÉRIFIE qu'il reste privé");
});

await test("G-5. aucun changement de rôle de session dans la migration", () => {
  for (const interdit of ["set role", "reset role", "set_config('role'"]) {
    assert.ok(!SQL_MIGRATION.toLowerCase().includes(interdit), `la migration contient « ${interdit} »`);
  }
});

await test("G-6. les quatre policies du seau sont au rôle `authenticated`, et l'UPDATE porte un `with check`", () => {
  for (const nom of [
    "document_covers_select_accessible",
    "document_covers_insert_staff",
    "document_covers_update_staff",
    "document_covers_delete_staff",
  ]) {
    assert.ok(SQL_MIGRATION.includes(`create policy "${nom}"`), `policy manquante : ${nom}`);
  }
  assert.equal((SQL_MIGRATION.match(/to authenticated/g) ?? []).length, 4, "quatre policies, toutes authentifiées");
  const iUpdate = SQL_MIGRATION.indexOf('create policy "document_covers_update_staff"');
  const corpsUpdate = SQL_MIGRATION.slice(iUpdate, SQL_MIGRATION.indexOf('create policy "document_covers_delete_staff"'));
  assert.ok(corpsUpdate.includes("with check ("), "⚠️ sans `with check`, un objet pourrait être déplacé chez un autre coach");
});

await test("G-8. ⚠️ LA LIMITE DE VALIDATION MIME EST ÉCRITE, ET N'EST PAS SUR-VENDUE", () => {
  // ══════════════════════════════════════════════════════════════════
  // POURQUOI UN TEST SUR DE LA PROSE
  // ══════════════════════════════════════════════════════════════════
  // La confusion serait dangereuse : quelqu'un pourrait lire
  // `allowed_mime_types` et en conclure que le serveur refuse un fichier dont
  // le CONTENU n'est pas une image. Ce n'est pas le cas — il ne compare que le
  // `content-type` ANNONCÉ. La seule protection contre cette confusion est que
  // la limite reste écrite là où on l'oublierait : ce test l'y maintient.
  assert.ok(
    SOURCE_STOCKAGE.includes("LE SERVEUR NE VÉRIFIE PAS LA SIGNATURE RÉELLE DU FICHIER"),
    "le module de stockage doit nommer la limite, en tête",
  );
  assert.ok(
    /AUCUNE VÉRIFICATION DE LA SIGNATURE RÉELLE N'EXISTE CÔTÉ SERVEUR/.test(SOURCE_STOCKAGE),
    "…et la dire sans ambiguïté",
  );
  assert.ok(
    /content-type` ANNONCÉ/.test(SOURCE_STOCKAGE),
    "…en précisant ce que Storage compare réellement",
  );
  assert.ok(
    /contournable/i.test(SOURCE_STOCKAGE) && /navigateur/i.test(SOURCE_STOCKAGE),
    "…et que le contrôle par octets est côté navigateur",
  );
  // La migration non plus ne doit pas laisser croire le contraire.
  assert.ok(
    /AUCUNE VÉRIFICATION DE LA SIGNATURE RÉELLE/.test(SQL_MIGRATION),
    "la migration documente la même limite",
  );
  // Et le champ renvoie vers l'explication, au lieu de promettre autre chose.
  // ⚠️ PROSE NORMALISÉE : la phrase est coupée par un retour à la ligne et un
  // `*` de bloc de commentaire. On mesure la phrase, pas sa mise en page.
  const champNormalise = SOURCE_CHAMP.replace(/[\s*]+/g, " ");
  assert.ok(
    champNormalise.includes("signature réelle du fichier n'est pas vérifiée par le serveur"),
    "le champ de formulaire ne sur-vend pas la validation",
  );
  assert.ok(
    /storage-document-covers\.ts/.test(SOURCE_CHAMP),
    "…et pointe vers l'explication détaillée",
  );

  // ⚠️ CONTRÔLE NÉGATIF : aucune des trois sources ne doit affirmer que le
  // serveur valide la signature, le contenu ou les octets.
  for (const [nom, source] of [
    ["module de stockage", SOURCE_STOCKAGE],
    ["champ de formulaire", SOURCE_CHAMP],
    ["migration", SQL_MIGRATION],
  ] as const) {
    for (const motif of [
      /signature (?:réelle |)vérifiée (?:par|côté) (?:le )?serveur/i,
      /le serveur (?:valide|vérifie) (?:les octets|le contenu réel)/i,
      /validation serveur (?:du contenu|des octets)/i,
    ]) {
      assert.ok(!motif.test(source), `${nom} : affirmation trompeuse — ${motif}`);
    }
  }

  // Et ce qui TIENT vraiment est nommé, pour que la limite ne soit pas lue
  // comme une faille béante : SVG exclu, seau privé, écriture bornée au staff.
  assert.ok(/image\/svg\+xml` est EXCLU/.test(SOURCE_STOCKAGE) || /EXCLU du seau/.test(SOURCE_STOCKAGE),
    "le SVG exclu est nommé comme la protection qui compte");
  assert.ok(/PRIVÉ/.test(SOURCE_STOCKAGE), "le seau privé est nommé");
});

await test("G-9. aucune Edge Function n'a été ajoutée dans ce lot", () => {
  // ⚠️ DÉCISION EXPLICITE, PAS UN OUBLI. Une vérification serveur du contenu
  // réel demanderait un service de relais à déployer et à surveiller ; le coût
  // et l'utilité sont exposés dans l'en-tête du module, et rien n'est construit
  // avant décision.
  for (const [nom, code] of [
    ["module de stockage", CODE_STOCKAGE],
    ["cycle de vie", CODE_CYCLE],
    ["champ de formulaire", CODE_CHAMP],
  ] as const) {
    assert.ok(!/functions\.invoke|supabase\/functions/.test(code), `${nom} : appelle une Edge Function`);
  }
  assert.ok(!/create function .*http|net\.http/i.test(SQL_MIGRATION), "la migration n'appelle aucun service externe");
  // Mais le coût et l'utilité sont bien exposés, pour que la décision soit prise
  // en connaissance de cause plutôt que par défaut.
  assert.ok(/Edge Function/.test(SOURCE_STOCKAGE), "l'option est nommée…");
  assert.ok(/CE QU'IL COÛTERAIT/.test(SOURCE_STOCKAGE), "…avec son coût");
});

await test("G-7. aucune branche « aucune ligne n'existe » dans les policies d'écriture", () => {
  const iEcriture = SQL_MIGRATION.indexOf('create policy "document_covers_insert_staff"');
  const iFin = SQL_MIGRATION.indexOf("-- 5. VÉRIFICATION");
  const ecriture = SQL_MIGRATION.slice(iEcriture, iFin > iEcriture ? iFin : undefined);
  assert.ok(!/not exists \(select 1 from public\.documents/.test(ecriture), "⚠️ un orphelin resterait manipulable par tout le staff");
  assert.equal((ecriture.match(/current_staff_id\(\)\) is not null/g) ?? []).length, 4, "les trois écritures exigent une fiche staff (dont l'UPDATE deux fois)");
});

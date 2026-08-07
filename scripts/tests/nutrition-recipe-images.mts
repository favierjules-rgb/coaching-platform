import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  RECIPE_IMAGE_BUCKET,
  RECIPE_IMAGE_MAX_SOURCE_BYTES,
  RECIPE_IMAGE_MAX_STORED_BYTES,
  RECIPE_IMAGE_QUALITY_LADDER,
  RECIPE_IMAGE_SOURCE_MIME,
  RECIPE_IMAGE_STORED_MIME,
  buildRecipeImagePath,
  computeResizedDimensions,
  describeRecipeImageRejection,
  isRecipeImagePathFor,
  looksLikeSvg,
  recipeImageExtension,
  recipeImagePublicUrl,
  recipeImageRemotePattern,
  sniffImageMime,
  validateRecipeImageSource,
} from "../../lib/nutrition/recipe-image";
import {
  optimizeRecipeImage,
  type DecodedImage,
  type RecipeImageCodec,
} from "../../lib/nutrition/recipe-image-optimizer";
import {
  attachRecipeImage,
  cleanupRecipeImageAfterDeletion,
  copyRecipeImageForDuplicate,
  detachRecipeImage,
  parseSetRecipeImageResult,
} from "../../lib/supabase/storage-recipe-images";
import { parseDuplicateRecipeResult } from "../../lib/supabase/nutrition-recipes-write";
import { parseDeletionResult } from "../../lib/supabase/nutrition-lifecycle";

/**
 * PR E.1 — LA PHOTO D'UNE RECETTE, ET LE NETTOYAGE D'INTERFACE
 *
 * CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE PEUT PAS PROUVER
 *
 * Elle prouve, sans navigateur et sans base : les règles de validation, le
 * calcul des dimensions, la forme des chemins, l'ENCHAÎNEMENT des écritures
 * (l'ordre exact des appels à Storage et à la RPC dans chaque scénario
 * d'échec), et l'absence de tout reliquat de l'ancien import de démonstration.
 *
 * Elle ne prouve PAS que le codec du navigateur produit un fichier léger :
 * cela a été mesuré séparément dans un Chromium réel, et les nombres figurent
 * dans le rapport de la PR. Elle ne prouve pas non plus les policies Storage :
 * c'est le rôle de `supabase/tests/nutrition_recipe_images_checklist.sql`,
 * exécuté contre un vrai PostgreSQL.
 *
 * L'ORDRE DES ÉCRITURES EST LA PROPRIÉTÉ CENTRALE. PostgreSQL et Storage ne
 * partagent aucune transaction ; la seule garantie possible est un ordre dont
 * le pire cas laisse un fichier orphelin, jamais une image cassée. Les tests
 * de la section H vérifient cet ordre appel par appel, y compris quand chaque
 * étape échoue.
 */

let réussis = 0;
let échecs = 0;

async function test(nom: string, fn: () => void | Promise<void>) {
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

const lire = (chemin: string) => readFileSync(new URL(chemin, import.meta.url), "utf8");

const MIGRATION = lire("../../supabase/migrations/20260819090000_nutrition_recipe_images.sql");
const NEXT_CONFIG = lire("../../next.config.ts");
const CHAMP_IMAGE = lire("../../components/admin/RecipeImageField.tsx");
const COMPOSANT_IMAGE = lire("../../components/shared/RecipeImage.tsx");
const PAGE_LISTE = lire("../../app/admin/nutrition/recettes/page.tsx");
const PAGE_NOUVELLE = lire("../../app/admin/nutrition/recettes/nouvelle/page.tsx");
const PAGE_DETAIL = lire("../../app/admin/nutrition/recettes/[recipeId]/page.tsx");
const PAGE_PLAN_ÉLÈVE = lire("../../app/(student)/nutrition/[planId]/page.tsx");
const TRACKER = lire("../../components/student/WeeklyNutritionTracker.tsx");
const RECETTES_ÉLÈVE = lire("../../components/student/StudentAdaptiveRecipes.tsx");
const SERVICE_STORAGE = lire("../../lib/supabase/storage-recipe-images.ts");
const SOLVEUR = lire("../../lib/nutrition/recipe-solver.ts");
const APPARIEMENT = lire("../../lib/nutrition/recipe-matching.ts");

/** Retire les commentaires : un test ne doit jamais valider un commentaire. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function sansCommentairesSql(source: string): string {
  return source.replace(/^\s*--.*$/gm, "");
}

const COACH = "11111111-1111-4111-8111-111111111111";
const RECETTE = "22222222-2222-4222-8222-222222222222";
const FICHIER = "33333333-3333-4333-8333-333333333333";

/* ═══════════ A. Les constantes sont des MIROIRS de la migration ═══════════ */

await test("1. le bucket, la taille et les formats du code correspondent à la migration", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes(`'${RECIPE_IMAGE_BUCKET}'`), "le bucket porte le même nom");
  assert.ok(
    sql.includes(String(RECIPE_IMAGE_MAX_STORED_BYTES)),
    `file_size_limit doit valoir ${RECIPE_IMAGE_MAX_STORED_BYTES}`,
  );
  for (const mime of RECIPE_IMAGE_STORED_MIME) {
    assert.ok(sql.includes(`'${mime}'`), `${mime} doit figurer dans allowed_mime_types`);
  }
  // Le point qui compte le plus : le SVG n'est pas dans la liste du bucket.
  const listeMime = sql.slice(sql.indexOf("allowed_mime_types)"), sql.indexOf("on conflict (id) do update"));
  assert.ok(!listeMime.includes("image/svg"), "aucun SVG dans allowed_mime_types");
  // Et le contrôle final de la migration REFUSE explicitement un bucket qui
  // en accepterait un.
  assert.ok(sql.includes("'image/svg+xml' = any(v_bucket.allowed_mime_types)"),
    "la migration échoue si le SVG venait à être autorisé");
  assert.ok(!(RECIPE_IMAGE_SOURCE_MIME as readonly string[]).includes("image/svg+xml"));
});

await test("2. le bucket est PUBLIC en lecture, et ses plafonds sont posés en base", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(/insert into storage\.buckets[\s\S]*?'recipe-images'[\s\S]*?true/.test(sql));
  assert.ok(sql.includes("file_size_limit"), "un plafond de taille est posé");
  assert.ok(sql.includes("allowed_mime_types"), "une liste MIME est posée");
  // `do update` et non `do nothing` : un bucket créé à la main sans plafond
  // doit être CORRIGÉ, pas ignoré.
  assert.ok(/on conflict \(id\) do update/.test(sql), "la migration corrige un bucket préexistant");
});

await test("3. les quatre policies existent, avec les clauses exigées", () => {
  const sql = sansCommentairesSql(MIGRATION);
  const attendues: [string, RegExp][] = [
    ["insert", /create policy "recipe_images_insert_owner_coach"[\s\S]*?with check \(/],
    ["update", /create policy "recipe_images_update_owner_coach"[\s\S]*?using \([\s\S]*?with check \(/],
    ["delete", /create policy "recipe_images_delete_owner_coach"[\s\S]*?using \(/],
    ["select", /create policy "recipe_images_select_owner_coach"[\s\S]*?using \(/],
  ];
  for (const [nom, motif] of attendues) {
    assert.ok(motif.test(sql), `policy ${nom} absente ou incomplète`);
  }
  // `to authenticated` sur les quatre : `anon` ne peut jamais y tomber.
  const nb = [...sql.matchAll(/create policy "recipe_images_\w+" on storage\.objects\s*\n\s*for \w+ to authenticated/g)];
  assert.equal(nb.length, 4, "les quatre policies doivent être réservées à authenticated");
  // Et surtout : jamais `is_coach_or_admin()` seul.
  assert.ok(
    !/create policy "recipe_images[\s\S]{0,400}?is_coach_or_admin\(\)\s*\)/.test(sql),
    "aucune policy ne doit se contenter de is_coach_or_admin()",
  );
});

await test("4. l'appartenance est vérifiée par JOINTURE, pas par égalité de chaînes", () => {
  const sql = sansCommentairesSql(MIGRATION);
  const début = sql.indexOf("create or replace function public.nutrition_recipe_image_owner_ok");
  assert.ok(début > 0, "la fonction d'appartenance existe");
  const corps = sql.slice(début, sql.indexOf("$fn$;", début));
  assert.ok(corps.includes("from public.nutrition_recipes r"), "elle interroge réellement la table");
  assert.ok(corps.includes("r.coach_id::text = (storage.foldername(p_name))[2]"),
    "le coach du chemin doit être le PROPRIÉTAIRE de la recette");
  assert.ok(corps.includes("r.id::text = (storage.foldername(p_name))[3]"),
    "la recette du chemin doit exister");
  assert.ok(corps.includes("public.current_coach_id()"), "et l'appelant doit être ce coach");
  assert.ok(corps.includes("array_length(storage.foldername(p_name), 1) = 3"), "la forme est contrôlée");
});

await test("5. la contrainte de colonne enferme le chemin dans SA recette", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes("nutrition_recipes_image_path_shape"));
  const i = sql.indexOf("add constraint nutrition_recipes_image_path_shape");
  const bloc = sql.slice(i, i + 500);
  assert.ok(bloc.includes("coach_id::text"), "le chemin contient le coach de la LIGNE");
  assert.ok(bloc.includes("id::text"), "et la recette de la LIGNE");
  assert.ok(bloc.includes("(webp|jpg)"), "seules deux extensions sont admises");
});

/* ═══════════ B. Le contenu réel d'un fichier ═══════════ */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const SVG = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

await test("6. la signature d'octets reconnaît JPEG, PNG et WebP — et rien d'autre", () => {
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  assert.equal(sniffImageMime(SVG), null);
  assert.equal(sniffImageMime(new Uint8Array([1, 2, 3])), null, "trop court = inconnu");
  // « RIFF » sans « WEBP » (un WAV, par exemple) n'est pas une image.
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]);
  assert.equal(sniffImageMime(wav), null);
});

await test("7. un SVG déguisé en PNG est REFUSÉ — c'est le cas qui compte", () => {
  // Le fichier s'annonce PNG, son extension est .png, mais son contenu est
  // du XML exécutable. Sans lecture des octets, il partait dans un bucket
  // public.
  assert.equal(looksLikeSvg(SVG), true);
  assert.equal(validateRecipeImageSource("image/png", 4000, SVG), "svg_refused");
  // Et même sans en-tête XML, un contenu qui ne correspond pas au type
  // déclaré est refusé.
  assert.equal(validateRecipeImageSource("image/png", 4000, JPEG), "content_mismatch");
});

/* ═══════════ C. La validation de la source ═══════════ */

await test("8. taille, vide, format : chaque refus a son code et son message", () => {
  assert.equal(validateRecipeImageSource("image/jpeg", 0, JPEG), "empty");
  assert.equal(
    validateRecipeImageSource("image/jpeg", RECIPE_IMAGE_MAX_SOURCE_BYTES + 1, JPEG),
    "too_large",
  );
  assert.equal(validateRecipeImageSource("image/gif", 1000, JPEG), "mime_not_supported");
  assert.equal(validateRecipeImageSource("image/svg+xml", 1000, SVG), "svg_refused");
  assert.equal(validateRecipeImageSource("image/jpeg", 1000, JPEG), null);
  assert.equal(validateRecipeImageSource("image/png", 1000, PNG), null);
  assert.equal(validateRecipeImageSource("image/webp", 1000, WEBP), null);

  // Chaque code produit un message non vide, en français, sans jargon.
  for (const code of [
    "empty", "too_large", "mime_not_supported", "svg_refused",
    "content_mismatch", "decode_failed", "encode_failed", "still_too_large",
  ] as const) {
    const message = describeRecipeImageRejection(code);
    assert.ok(message.length > 10, code);
    assert.ok(!/undefined|null|error/i.test(message), `${code} : message technique`);
  }
});

/* ═══════════ D. Les dimensions ═══════════ */

await test("9. le côté long est ramené à la cible, le rapport est conservé", () => {
  assert.deepEqual(computeResizedDimensions({ width: 4032, height: 3024 }), { width: 1400, height: 1050 });
  assert.deepEqual(computeResizedDimensions({ width: 3024, height: 4032 }), { width: 1050, height: 1400 });
  assert.deepEqual(computeResizedDimensions({ width: 2000, height: 2000 }), { width: 1400, height: 1400 });
  // Rapport conservé à l'arrondi près.
  const r = computeResizedDimensions({ width: 4000, height: 2250 });
  assert.ok(Math.abs(r.width / r.height - 4000 / 2250) < 0.01);
});

await test("10. une image DÉJÀ petite n'est jamais agrandie", () => {
  assert.deepEqual(computeResizedDimensions({ width: 800, height: 600 }), { width: 800, height: 600 });
  assert.deepEqual(computeResizedDimensions({ width: 1400, height: 900 }), { width: 1400, height: 900 });
  // Dimensions absurdes : on rend 0 plutôt que NaN, et l'optimiseur refuse.
  assert.deepEqual(computeResizedDimensions({ width: 0, height: 10 }), { width: 0, height: 0 });
  assert.deepEqual(computeResizedDimensions({ width: Number.NaN, height: 10 }), { width: 0, height: 0 });
});

/* ═══════════ E. Les chemins ═══════════ */

await test("11. le chemin porte le coach, la recette, un UUID — et rien d'autre", () => {
  const chemin = buildRecipeImagePath(COACH, RECETTE, FICHIER, "image/webp");
  assert.equal(chemin, `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`);
  assert.equal(recipeImageExtension("image/jpeg"), "jpg");
  assert.equal(recipeImageExtension("image/webp"), "webp");
  assert.ok(isRecipeImagePathFor(chemin, COACH, RECETTE));

  // AUCUNE donnée d'élève, aucun nom de fichier d'origine, aucun horodatage.
  assert.ok(!/\d{13}/.test(chemin), "pas d'horodatage");
  assert.equal(chemin.split("/").length, 4, "trois dossiers et un fichier");
});

await test("12. un chemin d'un AUTRE coach ou d'une AUTRE recette est rejeté", () => {
  const autre = "99999999-9999-4999-8999-999999999999";
  const chemin = buildRecipeImagePath(COACH, RECETTE, FICHIER, "image/webp");
  assert.equal(isRecipeImagePathFor(chemin, autre, RECETTE), false);
  assert.equal(isRecipeImagePathFor(chemin, COACH, autre), false);
  // Traversée, extension interdite, nom libre : tous refusés.
  for (const mauvais of [
    `recipes/${COACH}/${RECETTE}/../../x.webp`,
    `recipes/${COACH}/${RECETTE}/${FICHIER}.svg`,
    `recipes/${COACH}/${RECETTE}/photo.webp`,
    `recipes/${COACH}/${RECETTE}/${FICHIER}.webp.svg`,
    `${COACH}/${RECETTE}/${FICHIER}.webp`,
  ]) {
    assert.equal(isRecipeImagePathFor(mauvais, COACH, RECETTE), false, mauvais);
  }
});

await test("13. l'URL publique est DÉRIVÉE, jamais stockée", () => {
  const url = recipeImagePublicUrl("https://abc.supabase.co", `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`);
  assert.equal(url, `https://abc.supabase.co/storage/v1/object/public/recipe-images/recipes/${COACH}/${RECETTE}/${FICHIER}.webp`);
  assert.equal(recipeImagePublicUrl("https://abc.supabase.co/", "x"), "https://abc.supabase.co/storage/v1/object/public/recipe-images/x");
  assert.equal(recipeImagePublicUrl(undefined, "x"), null, "sans URL de base, pas d'image");
  assert.equal(recipeImagePublicUrl("https://abc.supabase.co", null), null, "sans chemin, pas d'image");
});

/* ═══════════ F. L'orchestration de l'optimiseur ═══════════ */

/** Un codec factice : il ne dessine rien, il rend des tailles décidées ici. */
function codecFactice(options: {
  width?: number;
  height?: number;
  /** Taille rendue pour (mime, quality). `null` = format non supporté. */
  taille?: (mime: string, quality: number) => number | null;
  /** Type réellement rendu — pour simuler le repli silencieux vers PNG. */
  typeRendu?: (mime: string) => string;
  échoueAuDécodage?: boolean;
}): { codec: RecipeImageCodec; appels: string[] } {
  const appels: string[] = [];
  const codec: RecipeImageCodec = {
    async decode() {
      appels.push("decode");
      if (options.échoueAuDécodage) throw new Error("illisible");
      return { bitmap: {}, width: options.width ?? 4000, height: options.height ?? 3000 };
    },
    async encode(_decoded: DecodedImage, _dims, mime, quality) {
      appels.push(`encode:${mime}:${quality}`);
      const taille = options.taille ? options.taille(mime, quality) : 200_000;
      if (taille === null) return null;
      const type = options.typeRendu ? options.typeRendu(mime) : mime;
      return { blob: new Blob([new Uint8Array(taille)], { type }), type };
    },
    release() {
      appels.push("release");
    },
  };
  return { codec, appels };
}

function fichierFactice(mime: string, octets: number, entête: Uint8Array): File {
  const corps = new Uint8Array(octets);
  corps.set(entête.subarray(0, Math.min(entête.length, octets)));
  return new File([corps], "photo", { type: mime });
}

await test("14. le premier palier suffit : un seul encodage, en WebP", async () => {
  const { codec, appels } = codecFactice({ taille: () => 250_000 });
  const r = await optimizeRecipeImage(fichierFactice("image/jpeg", 5000, JPEG), codec);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.mime, "image/webp", "WebP est essayé en premier");
    assert.equal(r.quality, RECIPE_IMAGE_QUALITY_LADDER[0]);
    assert.equal(r.width, 1400);
    assert.equal(r.bytes, 250_000);
    assert.equal(r.sourceBytes, 5000);
  }
  assert.deepEqual(appels, ["decode", "encode:image/webp:0.82", "release"]);
});

await test("15. si le navigateur ne sait pas produire de WebP, il bascule sur JPEG — une fois", async () => {
  const { codec, appels } = codecFactice({
    taille: (mime) => (mime === "image/webp" ? null : 300_000),
  });
  const r = await optimizeRecipeImage(fichierFactice("image/png", 5000, PNG), codec);
  assert.equal(r.ok && r.mime, "image/jpeg");
  // Le WebP n'est PLUS retenté aux paliers suivants : le format est décidé.
  assert.deepEqual(appels, ["decode", "encode:image/webp:0.82", "encode:image/jpeg:0.82", "release"]);
});

await test("16. `toBlob` qui retombe silencieusement sur PNG est traité comme un refus", async () => {
  // Le piège classique : `canvas.toBlob(cb, "image/webp")` rend un PNG sans
  // le dire sur les navigateurs sans WebP. Comparer le type est le seul
  // contrôle honnête.
  const { codec } = codecFactice({
    typeRendu: (mime) => (mime === "image/webp" ? "image/png" : mime),
    taille: () => 200_000,
  });
  const r = await optimizeRecipeImage(fichierFactice("image/jpeg", 5000, JPEG), codec);
  assert.equal(r.ok && r.mime, "image/jpeg", "le PNG déguisé ne doit pas être accepté");
});

await test("17. trop lourd au premier palier : on descend l'échelle, pas plus bas", async () => {
  const tailles: Record<number, number> = { 0.82: 2_000_000, 0.7: 1_500_000, 0.6: 900_000 };
  const { codec, appels } = codecFactice({ taille: (_m, q) => tailles[q] });
  const r = await optimizeRecipeImage(fichierFactice("image/jpeg", 9_000_000, JPEG), codec);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.quality, 0.6);
  assert.ok(r.ok && r.bytes <= RECIPE_IMAGE_MAX_STORED_BYTES);
  assert.deepEqual(appels, [
    "decode",
    "encode:image/webp:0.82",
    "encode:image/webp:0.7",
    "encode:image/webp:0.6",
    "release",
  ]);
});

await test("18. si même le dernier palier dépasse, on REFUSE plutôt que d'envoyer", async () => {
  const { codec } = codecFactice({ taille: () => 3_000_000 });
  const r = await optimizeRecipeImage(fichierFactice("image/jpeg", 9_000_000, JPEG), codec);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, "still_too_large");
  // Message distinct de « aucun format » : le coach doit savoir quoi faire.
  assert.notEqual(
    describeRecipeImageRejection("still_too_large"),
    describeRecipeImageRejection("encode_failed"),
  );
});

await test("19. aucun format disponible, décodage impossible : deux causes distinctes", async () => {
  const aucun = codecFactice({ taille: () => null });
  const r1 = await optimizeRecipeImage(fichierFactice("image/jpeg", 5000, JPEG), aucun.codec);
  assert.equal(!r1.ok && r1.code, "encode_failed");

  const illisible = codecFactice({ échoueAuDécodage: true });
  const r2 = await optimizeRecipeImage(fichierFactice("image/jpeg", 5000, JPEG), illisible.codec);
  assert.equal(!r2.ok && r2.code, "decode_failed");
  // Le décodage a échoué : rien n'a été encodé, et la ressource est libérée
  // quand même n'est PAS attendu ici (il n'y a rien à libérer).
  assert.deepEqual(illisible.appels, ["decode"]);
});

await test("20. un fichier refusé à la validation n'est JAMAIS décodé", async () => {
  const { codec, appels } = codecFactice({});
  const r = await optimizeRecipeImage(fichierFactice("image/png", 5000, SVG), codec);
  assert.equal(!r.ok && r.code, "svg_refused");
  assert.deepEqual(appels, [], "aucun appel au codec sur un fichier refusé");
});

/* ═══════════ G. next.config et l'optimiseur d'images ═══════════ */

await test("21. `remotePatterns` vise l'hôte EXACT et le seul bucket des recettes", () => {
  // On lit la SOURCE BRUTE, sans retirer les commentaires : le chemin du
  // bucket contient « /** », que tout découpeur naïf prendrait pour un
  // début de commentaire — et qui ferait disparaître la moitié du fichier.
  assert.ok(
    NEXT_CONFIG.includes("remotePatterns: recipeImageRemotePatterns()"),
    "la configuration branche bien la liste",
  );
  const début = NEXT_CONFIG.indexOf("function recipeImageRemotePatterns");
  const fin = NEXT_CONFIG.indexOf("const nextConfig", début);
  assert.ok(début > 0 && fin > début, "la fonction existe avant la configuration");
  const bloc = NEXT_CONFIG.slice(début, fin);

  assert.ok(bloc.includes("new URL(brut).hostname"), "l'hôte est dérivé de l'environnement");
  assert.ok(bloc.includes("NEXT_PUBLIC_SUPABASE_URL"), "et de CETTE variable");
  assert.ok(
    bloc.includes(`/storage/v1/object/public/${RECIPE_IMAGE_BUCKET}/**`),
    "le chemin est borné au bucket des recettes",
  );
  assert.ok(bloc.includes('search: ""'), "aucune chaîne de requête admise");
  // LE POINT QUI COMPTE : jamais de joker d'hôte.
  assert.ok(!/hostname:\s*["'`]/.test(bloc), "l'hôte n'est jamais une chaîne littérale");
  assert.ok(!bloc.includes("supabase.co"), "aucun domaine écrit en dur, donc aucun joker possible");
  assert.ok(bloc.includes("return []"), "sans URL, aucun relais n'est ouvert");
});

await test("22. le code et la configuration décrivent le MÊME motif", () => {
  const motif = recipeImageRemotePattern("https://abc.supabase.co");
  assert.deepEqual(motif, {
    protocol: "https",
    hostname: "abc.supabase.co",
    pathname: `/storage/v1/object/public/${RECIPE_IMAGE_BUCKET}/**`,
    search: "",
  });
  assert.equal(recipeImageRemotePattern(undefined), null);
  assert.equal(recipeImageRemotePattern("pas une url"), null);
  // Une URL construite par le code doit satisfaire le motif de la config.
  const url = new URL(recipeImagePublicUrl("https://abc.supabase.co", `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`)!);
  assert.equal(url.hostname, motif!.hostname);
  assert.ok(url.pathname.startsWith(`/storage/v1/object/public/${RECIPE_IMAGE_BUCKET}/`));
  assert.equal(url.search, "");
});

await test("23. l'affichage fixe un rapport et une taille : aucun saut, aucune image géante", () => {
  assert.ok(COMPOSANT_IMAGE.includes("aspectRatio"), "le rapport est fixé avant le chargement");
  assert.ok(COMPOSANT_IMAGE.includes("sizes={sizes}"), "`sizes` est obligatoire");
  assert.ok(COMPOSANT_IMAGE.includes("object-cover"), "recadrage, jamais déformation");
  assert.ok(COMPOSANT_IMAGE.includes("ChefHat"), "un repli existe pour les recettes sans photo");
  // Chaque usage passe un `sizes` réaliste — sans lui, `fill` télécharge la
  // variante pleine largeur d'écran.
  for (const [nom, source] of Object.entries({ CATALOGUE: lire("../../components/admin/RecipeCatalog.tsx"), RECETTES_ÉLÈVE, CHAMP_IMAGE })) {
    for (const usage of source.matchAll(/<RecipeImage\b[\s\S]{0,400}?\/>/g)) {
      assert.ok(/sizes=/.test(usage[0]), `${nom} : un <RecipeImage> sans sizes`);
    }
  }
});

/* ═══════════ H. L'ORDRE des écritures — la propriété centrale ═══════════ */

interface AppelStorage {
  readonly quoi: string;
  readonly chemin?: string;
}

/**
 * Un client Supabase factice : il enregistre l'ORDRE des appels, et permet
 * de faire échouer n'importe lequel. C'est le seul moyen de prouver qu'aucun
 * scénario d'échec ne détruit l'image encore valide.
 */
function clientFactice(options: {
  échecUpload?: boolean;
  échecRpc?: boolean;
  échecRemove?: boolean;
  échecCopy?: boolean;
  cheminPrécédent?: string | null;
}) {
  const appels: AppelStorage[] = [];
  const client = {
    storage: {
      from() {
        return {
          async upload(chemin: string) {
            appels.push({ quoi: "upload", chemin });
            return { error: options.échecUpload ? { message: "boom" } : null };
          },
          async remove(chemins: string[]) {
            appels.push({ quoi: "remove", chemin: chemins[0] });
            return { error: options.échecRemove ? { message: "boom" } : null };
          },
          async copy(source: string, cible: string) {
            appels.push({ quoi: "copy", chemin: `${source}->${cible}` });
            return { error: options.échecCopy ? { message: "boom" } : null };
          },
        };
      },
    },
    async rpc(_nom: string, args: Record<string, unknown>) {
      appels.push({ quoi: "rpc", chemin: (args.p_image_path as string | null) ?? "null" });
      if (options.échecRpc) return { data: { ok: false, reason: "forbidden" }, error: null };
      return {
        data: {
          ok: true,
          image_path: args.p_image_path,
          previous_path: options.cheminPrécédent ?? null,
        },
        error: null,
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, appels };
}

const BLOB = new Blob([new Uint8Array(1000)], { type: "image/webp" });

await test("24. POSE : envoyer, PUIS committer — jamais l'inverse", async () => {
  const { client, appels } = clientFactice({});
  const r = await attachRecipeImage(client, {
    coachId: COACH, recipeId: RECETTE, blob: BLOB, mime: "image/webp", fileId: FICHIER,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(appels.map((a) => a.quoi), ["upload", "rpc"]);
  assert.equal(appels[0].chemin, `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`);
});

await test("25. REMPLACEMENT : l'ancienne image n'est supprimée qu'APRÈS le commit", async () => {
  const ancien = `recipes/${COACH}/${RECETTE}/44444444-4444-4444-8444-444444444444.webp`;
  const { client, appels } = clientFactice({ cheminPrécédent: ancien });
  const r = await attachRecipeImage(client, {
    coachId: COACH, recipeId: RECETTE, blob: BLOB, mime: "image/webp", fileId: FICHIER,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(appels.map((a) => a.quoi), ["upload", "rpc", "remove"]);
  assert.equal(appels[2].chemin, ancien, "c'est bien l'ANCIENNE qui est retirée");
  // L'ordre est la garantie : à aucun moment `remove` ne précède `upload`.
  assert.ok(appels.findIndex((a) => a.quoi === "remove") > appels.findIndex((a) => a.quoi === "upload"));
});

await test("26. ÉCHEC DE L'ENVOI : rien n'est committé, rien n'est supprimé", async () => {
  const { client, appels } = clientFactice({ échecUpload: true, cheminPrécédent: "ancien" });
  const r = await attachRecipeImage(client, {
    coachId: COACH, recipeId: RECETTE, blob: BLOB, mime: "image/webp", fileId: FICHIER,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(appels.map((a) => a.quoi), ["upload"]);
});

await test("27. ÉCHEC DU COMMIT : le fichier tout juste envoyé est REPRIS, l'ancien reste", async () => {
  const ancien = `recipes/${COACH}/${RECETTE}/44444444-4444-4444-8444-444444444444.webp`;
  const { client, appels } = clientFactice({ échecRpc: true, cheminPrécédent: ancien });
  const r = await attachRecipeImage(client, {
    coachId: COACH, recipeId: RECETTE, blob: BLOB, mime: "image/webp", fileId: FICHIER,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(appels.map((a) => a.quoi), ["upload", "rpc", "remove"]);
  // Le `remove` porte sur le NOUVEAU chemin : on annule ce qu'on vient de
  // faire. L'ancienne image n'est jamais touchée.
  assert.equal(appels[2].chemin, `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`);
  assert.notEqual(appels[2].chemin, ancien, "l'ancienne image ne doit JAMAIS être supprimée ici");
});

await test("28. ÉCHEC DU NETTOYAGE : la base est juste, l'orphelin est SIGNALÉ", async () => {
  const { client } = clientFactice({ échecRemove: true, cheminPrécédent: "ancien" });
  const r = await attachRecipeImage(client, {
    coachId: COACH, recipeId: RECETTE, blob: BLOB, mime: "image/webp", fileId: FICHIER,
  });
  assert.equal(r.ok, true, "un nettoyage raté n'est pas un échec d'enregistrement");
  assert.equal(r.ok && r.orphanLeft, true, "mais il est dit");
  assert.ok(CHAMP_IMAGE.includes("orphanLeft"), "et l'interface le relaie");
});

await test("29. RETRAIT : la base d'abord, le fichier ensuite", async () => {
  const ancien = `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`;
  const { client, appels } = clientFactice({ cheminPrécédent: ancien });
  const r = await detachRecipeImage(client, RECETTE);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.imagePath, null);
  assert.deepEqual(appels.map((a) => a.quoi), ["rpc", "remove"]);
  assert.equal(appels[0].chemin, "null", "la RPC reçoit bien NULL");
});

await test("30. RETRAIT refusé par la base : aucun fichier n'est supprimé", async () => {
  const { client, appels } = clientFactice({ échecRpc: true, cheminPrécédent: "ancien" });
  const r = await detachRecipeImage(client, RECETTE);
  assert.equal(r.ok, false);
  assert.deepEqual(appels.map((a) => a.quoi), ["rpc"]);
});

await test("31. DUPLICATION : copie du fichier, puis commit — et rollback si le commit échoue", async () => {
  const source = `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`;
  const nouvelle = "55555555-5555-4555-8555-555555555555";

  const ok = clientFactice({});
  const r1 = await copyRecipeImageForDuplicate(ok.client, {
    coachId: COACH, sourcePath: source, newRecipeId: nouvelle, fileId: FICHIER,
  });
  assert.equal(r1.ok, true);
  assert.deepEqual(ok.appels.map((a) => a.quoi), ["copy", "rpc"]);
  assert.ok(ok.appels[0].chemin?.endsWith(`recipes/${COACH}/${nouvelle}/${FICHIER}.webp`),
    "la cible est le dossier de la COPIE");

  const ko = clientFactice({ échecRpc: true });
  const r2 = await copyRecipeImageForDuplicate(ko.client, {
    coachId: COACH, sourcePath: source, newRecipeId: nouvelle, fileId: FICHIER,
  });
  assert.equal(r2.ok, false);
  assert.deepEqual(ko.appels.map((a) => a.quoi), ["copy", "rpc", "remove"]);
  assert.equal(ko.appels[2].chemin, `recipes/${COACH}/${nouvelle}/${FICHIER}.webp`,
    "on retire la copie orpheline, jamais la source");
});

await test("32. DUPLICATION : le chemin de la copie ne peut PAS être celui de l'original", () => {
  const source = `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`;
  const nouvelle = "55555555-5555-4555-8555-555555555555";
  const cible = buildRecipeImagePath(COACH, nouvelle, FICHIER, "image/webp");
  assert.notEqual(cible, source);
  // Et la contrainte SQL l'interdit de toute façon : le chemin contient
  // l'identifiant de la recette.
  assert.equal(isRecipeImagePathFor(source, COACH, nouvelle), false);
});

await test("33. SUPPRESSION d'une recette : la base tranche, le fichier suit", async () => {
  const chemin = `recipes/${COACH}/${RECETTE}/${FICHIER}.webp`;
  const { client, appels } = clientFactice({});
  assert.equal(await cleanupRecipeImageAfterDeletion(client, chemin), true);
  assert.deepEqual(appels.map((a) => a.quoi), ["remove"]);
  // Une recette sans photo ne déclenche aucun appel.
  const vide = clientFactice({});
  assert.equal(await cleanupRecipeImageAfterDeletion(vide.client, null), true);
  assert.deepEqual(vide.appels, []);
  // Et la page appelle bien le nettoyage APRÈS la suppression.
  const page = sansCommentairesTs(PAGE_DETAIL);
  const iSupp = page.indexOf("deleteNutritionRecipe(");
  const iClean = page.indexOf("cleanupRecipeImageAfterDeletion(");
  assert.ok(iSupp > 0 && iClean > iSupp, "le nettoyage suit la suppression");
});

await test("34. les retours des RPC sont lus sans supposition", () => {
  assert.deepEqual(parseSetRecipeImageResult({ ok: true, image_path: "a", previous_path: "b" }),
    { ok: true, imagePath: "a", previousPath: "b" });
  assert.deepEqual(parseSetRecipeImageResult({ ok: true, image_path: null, previous_path: null }),
    { ok: true, imagePath: null, previousPath: null });
  assert.equal(parseSetRecipeImageResult({ ok: false, reason: "forbidden" }).ok, false);
  assert.equal(parseSetRecipeImageResult(null).ok, false, "un retour vide n'est pas un succès");
  assert.equal(parseSetRecipeImageResult({ reason: "invalid_path" }).ok, false);

  // Duplication et suppression transportent bien le chemin.
  const dup = parseDuplicateRecipeResult({
    ok: true, recipe_id: "r2", name: "n", source_image_path: "recipes/a/b/c.webp",
    copied: { ingredients: 1, links: 0, tags: 0 },
  });
  assert.equal(dup.ok && dup.sourceImagePath, "recipes/a/b/c.webp");
  const dupSans = parseDuplicateRecipeResult({ ok: true, recipe_id: "r2", name: "n", copied: {} });
  assert.equal(dupSans.ok && dupSans.sourceImagePath, null);

  const supp = parseDeletionResult({ ok: true, recipe_id: "r", name: "n", image_path: "p", deleted: {} }, "r");
  assert.equal(supp.ok && supp.imagePath, "p");
  const suppSans = parseDeletionResult({ ok: true, recipe_id: "r", name: "n", deleted: {} }, "r");
  assert.equal(suppSans.ok && suppSans.imagePath, null);
});

await test("35. CRÉATION : rien n'est envoyé avant que la recette existe", () => {
  const champ = sansCommentairesTs(CHAMP_IMAGE);
  // En mode création, le composant ne peut pas appeler l'envoi : le chemin
  // exige un identifiant de recette.
  const iCréation = champ.indexOf("if (recipeId === null)");
  const iEnvoi = champ.indexOf("attachRecipeImage(");
  assert.ok(iCréation > 0 && iEnvoi > iCréation, "la branche création précède l'envoi");
  assert.ok(champ.includes("onPending?."), "l'image est remise à la page, pas envoyée");

  // Et la page de création n'envoie qu'APRÈS un enregistrement réussi.
  const page = sansCommentairesTs(PAGE_NOUVELLE);
  const iOk = page.indexOf("if (!résultat.ok)");
  const iAttach = page.indexOf("attachRecipeImage(");
  assert.ok(iOk > 0 && iAttach > iOk, "l'envoi vient après le contrôle du résultat");
  assert.ok(page.includes("résultat.recipeId"), "et utilise l'identifiant rendu par la base");
});

await test("36. le service Storage ne prétend jamais à l'atomicité", () => {
  const texte = SERVICE_STORAGE.toLowerCase();
  assert.ok(texte.includes("il n'y a pas de transaction entre postgresql et storage"),
    "l'absence d'atomicité est dite explicitement");
  assert.ok(texte.includes("orphelin"), "le pire cas assumé est nommé");
  // Aucune promesse de transaction dans le code.
  assert.ok(!/\btransactionnel|atomiquement\b/.test(sansCommentairesTs(SERVICE_STORAGE)));
});

/* ═══════════ I. Nettoyage d'interface ═══════════ */

await test("37. « Suivi de la semaine » n'apparaît qu'UNE fois sur la page du plan", () => {
  // Le titre est rendu par le composant, une seule fois.
  const titresComposant = [...TRACKER.matchAll(/Suivi de la semaine/g)];
  const titresRendus = [...TRACKER.matchAll(/<h2[^>]*>\s*Suivi de la semaine/g)];
  assert.equal(titresRendus.length, 1, "le composant rend son titre une fois");
  assert.ok(titresComposant.length >= 1);

  // Et la page ne le redouble pas.
  const page = sansCommentairesTs(PAGE_PLAN_ÉLÈVE);
  assert.equal(
    [...page.matchAll(/Suivi de la semaine/g)].length,
    0,
    "la page ne doit plus rendre ce titre",
  );
  // Le doublon a été SUPPRIMÉ, pas masqué.
  assert.ok(!/hidden|sr-only|display:\s*none/.test(
    PAGE_PLAN_ÉLÈVE.slice(Math.max(0, PAGE_PLAN_ÉLÈVE.indexOf("WeeklyNutritionTracker") - 600),
      PAGE_PLAN_ÉLÈVE.indexOf("WeeklyNutritionTracker")),
  ), "aucun masquage CSS autour du tracker");
});

await test("38. l'autre écran qui monte le tracker garde bien son titre", () => {
  // Retirer le titre du COMPOSANT aurait laissé /nutrition sans intitulé.
  const pageNutrition = lire("../../app/(student)/nutrition/page.tsx");
  assert.ok(pageNutrition.includes("<WeeklyNutritionTracker"), "le tracker est monté ici aussi");
  assert.ok(
    !/Suivi de la semaine/.test(sansCommentairesTs(pageNutrition)),
    "cette page n'a jamais eu de titre à elle : c'est celui du composant qui sert",
  );
});

await test("39. l'ancien import de démonstration n'existe plus NULLE PART", () => {
  const interdits = [
    "RecipeFixtureImportDialog",
    "importNutritionRecipeFixtures",
    "recipe-fixtures-import",
    "RECIPE_FIXTURES",
    "Importer les recettes de démonstration",
  ];
  const surfaces: Record<string, string> = {
    PAGE_LISTE, PAGE_NOUVELLE, PAGE_DETAIL,
    CATALOGUE: lire("../../components/admin/RecipeCatalog.tsx"),
    ÉCRITURE: lire("../../lib/supabase/nutrition-recipes-write.ts"),
  };
  for (const [nom, source] of Object.entries(surfaces)) {
    for (const interdit of interdits) {
      assert.ok(!source.includes(interdit), `${nom} contient encore « ${interdit} »`);
    }
  }
  // Les deux fichiers eux-mêmes ont disparu.
  for (const chemin of [
    "../../components/admin/RecipeFixtureImportDialog.tsx",
    "../../lib/nutrition/recipe-fixtures-import.ts",
  ]) {
    assert.throws(() => lire(chemin), `${chemin} devrait avoir été supprimé`);
  }
});

await test("40. le NOUVEL import et la création manuelle sont toujours là", () => {
  assert.ok(PAGE_LISTE.includes("RecipeImportDialog"), "l'import d'un fichier reste monté");
  assert.ok(PAGE_LISTE.includes("Créer une recette"), "la création manuelle reste offerte");
  const dialogue = lire("../../components/admin/RecipeImportDialog.tsx");
  assert.ok(/Importer des recettes|Choisir un fichier/i.test(dialogue));
});

/* ═══════════ J. Non-régression : la photo n'influence RIEN ═══════════ */

await test("41. ni le solveur ni le filtrage ne connaissent l'existence d'une photo", () => {
  for (const [nom, source] of Object.entries({ SOLVEUR, APPARIEMENT })) {
    assert.ok(!/imagePath|image_path|RECIPE_IMAGE|recipe-image/.test(source),
      `${nom} ne doit rien savoir de la photo`);
  }
  // Et le parcours élève reste jour → créneau → objectifs → recettes.
  const élève = sansCommentairesTs(RECETTES_ÉLÈVE);
  assert.ok(élève.includes("slotTargetForDay("), "la cible vient toujours du créneau");
  assert.ok(élève.includes("solveRecipe("), "le solveur est toujours l'unique calcul");
  assert.ok(!/supabase|insert|update|upsert/i.test(élève), "aucune écriture côté élève");
});

await test("42. `save_nutrition_recipe` n'écrit JAMAIS image_path", () => {
  const sql = sansCommentairesSql(lire("../../supabase/migrations/20260818090000_nutrition_recipe_catalog.sql"));
  const début = sql.indexOf("create or replace function public.save_nutrition_recipe");
  const corps = sql.slice(début, sql.indexOf("$fn$;", début));
  assert.ok(!corps.includes("image_path"), "la sauvegarde ne doit pas connaître la colonne");
  // Donc publier, archiver ou enregistrer un brouillon ne peut pas la perdre.
  const écriture = sansCommentairesTs(lire("../../lib/nutrition/recipe-form.ts"));
  assert.ok(!écriture.includes("image_path"), "la charge utile du formulaire ne la porte pas");
});

await test("43. l'import JSON ne peut pas injecter de chemin Storage", () => {
  const analyse = sansCommentairesTs(lire("../../lib/nutrition/recipe-import.ts"));
  for (const interdit of ["image_path", "imagePath", "image", "url"]) {
    assert.ok(!new RegExp(`\\b${interdit}\\b`, "i").test(analyse),
      `le format d'import ne doit pas comporter « ${interdit} »`);
  }
  const sql = sansCommentairesSql(lire("../../supabase/migrations/20260818090000_nutrition_recipe_catalog.sql"));
  const début = sql.indexOf("create or replace function public.import_nutrition_recipes");
  const corps = sql.slice(début, sql.indexOf("$fn$;", début));
  assert.ok(!corps.includes("image_path"), "la RPC d'import ne lit ni n'écrit la colonne");
});

await test("44. la migration est déclarée au manifeste", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.ok(attendues.includes("20260819090000_nutrition_recipe_images.sql"));
  // Et les migrations déjà appliquées restent intouchées : la nouvelle est la
  // seule à créer des objets d'image.
  for (const antérieure of ["20260815090000", "20260816090000", "20260817090000"]) {
    const fichier = attendues.find((f) => f.startsWith(antérieure))!;
    const contenu = lire(`../../supabase/migrations/${fichier}`);
    assert.ok(!contenu.includes("image_path"), `${fichier} ne doit pas parler d'image`);
  }
});

await test("45. les conventions du dépôt sont respectées par la nouvelle migration", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const fn of ["nutrition_recipe_image_owner_ok", "set_nutrition_recipe_image"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn}`), `${fn} : revoke all`);
    assert.ok(sql.includes(`revoke execute on function public.${fn}`), `${fn} : anon révoqué`);
    assert.ok(sql.includes(`grant execute on function public.${fn}`), `${fn} : authenticated autorisé`);
    assert.ok(sql.includes(`alter function public.${fn}`), `${fn} : propriétaire postgres`);
  }
  // En DÉBUT DE LIGNE seulement : « security invoker » figure aussi dans les
  // textes de `comment on function`, qui sont du SQL et non des commentaires.
  assert.equal([...sql.matchAll(/^security invoker$/gm)].length, 4, "quatre fonctions, toutes invoker");
  assert.equal([...sql.matchAll(/^security definer$/gm)].length, 0, "aucune fonction definer ajoutée");
  assert.equal([...sql.matchAll(/^set search_path = ''$/gm)].length, 4, "search_path vide partout");
  // Un contrôle final qui échoue bruyamment.
  assert.ok(sql.includes("MIGRATION INCOMPLÈTE"), "la migration se relit elle-même");
});

await test("46. un planId étranger dans l'URL donne « introuvable », pas un écran vide", () => {
  // La RLS refusait déjà les données ; l'écran, lui, annonçait « ce plan n'a
  // pas encore de semaine » — ce qui laisse croire que le plan existe.
  const page = sansCommentairesTs(lire("../../app/(student)/nutrition/[planId]/recettes/page.tsx"));
  const iRecherche = page.indexOf("supabaseNutrition.plans.find(");
  const iGarde = page.indexOf("if (!plan)");
  const iRendu = page.indexOf("<StudentAdaptiveRecipes");
  assert.ok(iRecherche > 0, "la page cherche le plan parmi ceux de l'élève");
  assert.ok(iGarde > iRecherche, "et s'arrête si elle ne le trouve pas");
  assert.ok(iRendu > iGarde, "le rendu vient APRÈS la garde");
  assert.ok(page.includes("Plan introuvable."), "le message est celui de la fiche du plan");

  // La fiche du plan porte la même garde — les deux écrans se comportent
  // pareil devant un identifiant qui n'est pas le sien.
  const fiche = sansCommentairesTs(PAGE_PLAN_ÉLÈVE);
  assert.ok(fiche.includes("Plan introuvable."), "la fiche du plan aussi");
});

console.log("");
console.log(`${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);

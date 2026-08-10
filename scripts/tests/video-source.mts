/**
 * LE RÉSOLVEUR DE SOURCE VIDÉO — CE QUI ENTRE, ET CE QUI EST REFUSÉ.
 *
 * Module pur, exécuté dans Node. C'est ici que se joue la sécurité du
 * lecteur : tout ce que ce fichier accepte finira dans une `<iframe>` ou un
 * `<video>`, et rien d'autre n'y arrivera jamais.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://yesuolzfmxgnaznhbcnw.supabase.co";

const { resoudreSource, urlIntegrationYouTube, videoLisible } = await import("../../lib/video/source");


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

const ID = "dQw4w9WgXcQ";
const SIGNEE =
  "https://yesuolzfmxgnaznhbcnw.supabase.co/storage/v1/object/sign/feedback-videos/eleve/x.webm?token=abc.def.ghi";

test("VIDEO1. watch?v=ID donne une source youtube correcte", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL123`,
  ]) {
    assert.deepEqual(resoudreSource(url), { type: "youtube", videoId: ID }, url);
  }
});

test("VIDEO2. youtu.be/ID donne une source youtube correcte — paramètre de suivi compris", () => {
  for (const url of [
    `https://youtu.be/${ID}`,
    // La forme RÉELLEMENT présente en base : le `?si=` de partage.
    `https://youtu.be/${ID}?si=M2bRc4ufxQyliFDM`,
    `https://youtu.be/${ID}?t=30`,
  ]) {
    assert.deepEqual(resoudreSource(url), { type: "youtube", videoId: ID }, url);
  }
  // Et la query ne survit pas : elle n'a rien à faire dans l'embed.
  assert.ok(!urlIntegrationYouTube(ID).includes("si="));
});

test("VIDEO3. shorts/ID donne une source youtube correcte", () => {
  for (const url of [
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube.com/live/${ID}`,
  ]) {
    assert.deepEqual(resoudreSource(url), { type: "youtube", videoId: ID }, url);
  }
});

test("VIDEO4. une URL externe inconnue est REFUSÉE", () => {
  for (const url of [
    "https://vimeo.com/123456789",
    "https://dailymotion.com/video/x8abcde",
    "https://evil.example/video.mp4",
    // Les deux restes de données d'exemple présents en production : un hôte
    // fictif ne doit pas produire un lecteur qui échouera à l'écran.
    "https://videos.seth-coaching.mock/exercices/mobilite-epaule.mp4",
    "https://videos.seth-coaching.mock/exercices/corde-a-sauter.mp4",
    // Un hôte qui CONTIENT le domaine autorisé sans en être un.
    "https://youtu.be.evil.example/dQw4w9WgXcQ",
    "https://yesuolzfmxgnaznhbcnw.supabase.co.evil.example/x.mp4",
    // Un identifiant YouTube mal formé.
    "https://youtu.be/trop-court",
    "https://www.youtube.com/watch?v=pas_un_identifiant_valide",
    "https://www.youtube.com/",
    "",
    "   ",
    "pas une url",
  ]) {
    assert.equal(resoudreSource(url), null, `${url} aurait dû être refusée`);
  }
  assert.equal(resoudreSource(null), null);
  assert.equal(resoudreSource(42), null);
  assert.equal(resoudreSource(undefined), null);
});

test("VIDEO5. javascript:, data: et les protocoles non chiffrés sont REFUSÉS", () => {
  for (const url of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "data:video/mp4;base64,AAAA",
    "blob:https://exemple.test/1234",
    "file:///etc/passwd",
    // `http:` en clair, même sur un hôte autorisé : refusé.
    `http://www.youtube.com/watch?v=${ID}`,
    "http://yesuolzfmxgnaznhbcnw.supabase.co/storage/v1/object/sign/x",
    "//youtu.be/dQw4w9WgXcQ",
    "vbscript:msgbox(1)",
  ]) {
    assert.equal(resoudreSource(url), null, `${url} aurait dû être refusée`);
  }
  // Et l'URL d'intégration refuse de fabriquer quoi que ce soit sans un ID valide.
  for (const mauvais of ["", "../../evil", "dQw4w9WgXc", '"><script>', "a".repeat(12)]) {
    assert.throws(() => urlIntegrationYouTube(mauvais), /invalide/, mauvais);
  }
});

test("VIDEO10. une URL Supabase signée donne une source `file`, reprise telle quelle", () => {
  assert.equal(videoLisible(SIGNEE), true, "elle doit être jugée lisible");
  assert.equal(videoLisible("https://videos.seth-coaching.mock/x.mp4"), false);
  const source = resoudreSource(SIGNEE);
  assert.deepEqual(source, { type: "file", url: SIGNEE });
  // La signature et l'expiration FONT PARTIE de l'adresse : la réécrire
  // l'invaliderait, et la tronquer transformerait un accès temporaire en
  // requête refusée.
  assert.ok((source as { url: string }).url.includes("token=abc.def.ghi"));
});

test("VIDEO15. aucune URL privée n'est transformée en adresse publique permanente", () => {
  const source = resoudreSource(SIGNEE) as { type: string; url: string };
  // Le résolveur ne fabrique PAS d'URL `/object/public/…` : il transporte,
  // il ne republie pas.
  assert.ok(!source.url.includes("/object/public/"));
  assert.equal(source.url, SIGNEE, "l'URL signée doit être rendue à l'identique");

  // Et une URL publique du même projet reste… une URL publique, jamais
  // fabriquée ici : rien dans ce module ne construit d'adresse de stockage.
  const source2 = readFileSyncSource();
  assert.ok(!/object\/public/.test(source2), "le module ne doit pas construire d'URL publique");
  assert.ok(!/createSignedUrl|getPublicUrl/.test(source2), "il ne parle pas au stockage non plus");
});

function readFileSyncSource(): string {
  return readFileSync(new URL("../../lib/video/source.ts", import.meta.url).pathname, "utf8");
}

console.log(`\n${réussis} réussis, ${échecs} échecs`);
process.exit(échecs === 0 ? 0 : 1);

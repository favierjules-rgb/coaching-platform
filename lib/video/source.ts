/**
 * D'OÙ VIENT UNE VIDÉO — ET SI ON A LE DROIT DE LA MONTRER.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN SEUL PARSEUR, ET C'EST CELUI-CI
 * ════════════════════════════════════════════════════════════════════════
 * Aucun composant métier ne reconstruit d'URL d'intégration. Une deuxième
 * implémentation, c'est une deuxième liste blanche à maintenir — et celle
 * qu'on oublie de mettre à jour est celle par laquelle une URL arbitraire
 * finit dans une `<iframe>`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LISTE BLANCHE, PAS LISTE NOIRE
 * ════════════════════════════════════════════════════════════════════════
 * On ne cherche pas à repérer ce qui est dangereux : on n'accepte que ce
 * qu'on reconnaît. `javascript:`, `data:`, un `http:` en clair, un hôte
 * inconnu, une iframe tierce — tout cela rend `null` sans qu'il ait fallu y
 * penser à l'avance.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE LA PRODUCTION CONTIENT VRAIMENT (relevé du 10/08/2026)
 * ════════════════════════════════════════════════════════════════════════
 *   workout_exercises.video_url   783 youtu.be · 175 shorts · 0 watch?v=
 *   exercise_library.video_url     94 youtu.be ·  15 shorts · 2 hôtes fictifs
 *
 * `watch?v=` est absent de la base et pourtant supporté : c'est la forme
 * qu'un humain colle depuis un navigateur. Les deux `videos.seth-coaching.mock`
 * sont des restes de données d'exemple — ils sont REFUSÉS, et l'écran dira
 * « vidéo indisponible » plutôt que de tenter une lecture qui échouerait.
 *
 * Certaines URLs portent un paramètre de suivi (`?si=…`) : seul l'IDENTIFIANT
 * est retenu, jamais la query.
 */

export type VideoSource =
  | { type: "youtube"; videoId: string }
  | { type: "file"; url: string };

/** Un identifiant YouTube : onze caractères, et rien d'autre. */
const ID_YOUTUBE = /^[A-Za-z0-9_-]{11}$/;

const HOTES_YOUTUBE = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function sansPointWww(hote: string): string {
  return hote.toLowerCase();
}

/**
 * L'origine autorisée pour un fichier : celle du projet Supabase, et elle
 * seule. Les vidéos d'élève et les réponses coach sont servies par des URLs
 * SIGNÉES de ce domaine ; accepter un autre hôte reviendrait à laisser la
 * base décider quel serveur le navigateur va contacter.
 */
function origineFichierAutorisee(): string | null {
  const brut = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!brut) return null;
  try {
    return new URL(brut).origin;
  } catch {
    return null;
  }
}

function idDepuisYouTube(url: URL): string | null {
  const hote = sansPointWww(url.hostname);

  // youtu.be/<id>
  if (hote === "youtu.be" || hote === "www.youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    return ID_YOUTUBE.test(id) ? id : null;
  }

  // youtube.com/watch?v=<id>
  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return ID_YOUTUBE.test(id) ? id : null;
  }

  // youtube.com/shorts/<id>, /embed/<id>, /live/<id>
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "embed", "live", "v"].includes(segments[0])) {
    return ID_YOUTUBE.test(segments[1]) ? segments[1] : null;
  }

  return null;
}

/**
 * La source d'une URL, ou `null` si on ne la reconnaît pas.
 *
 * `null` n'est pas une erreur technique : c'est un refus, et l'appelant doit
 * l'afficher comme tel (« Cette vidéo n'est pas disponible »), jamais
 * retomber sur une ouverture externe.
 */
export function resoudreSource(brut: unknown): VideoSource | null {
  if (typeof brut !== "string") return null;
  const texte = brut.trim();
  if (texte.length === 0) return null;

  let url: URL;
  try {
    url = new URL(texte);
  } catch {
    return null;
  }

  // `javascript:`, `data:`, `blob:`, `file:` : refusés avant toute autre
  // considération. Seul `https:` est lisible sans risque.
  if (url.protocol !== "https:") return null;

  if (HOTES_YOUTUBE.has(sansPointWww(url.hostname))) {
    const videoId = idDepuisYouTube(url);
    return videoId ? { type: "youtube", videoId } : null;
  }

  const origine = origineFichierAutorisee();
  if (origine && url.origin === origine) {
    // L'URL signée est reprise TELLE QUELLE : sa signature et son expiration
    // font partie de l'adresse. La réécrire l'invaliderait.
    return { type: "file", url: texte };
  }

  return null;
}

/**
 * L'adresse d'intégration d'une vidéo YouTube.
 *
 * `youtube-nocookie` : le domaine sans cookie de suivi tant que la lecture
 * n'a pas commencé. `playsinline=1` : sur iPhone, la vidéo reste DANS la
 * page au lieu de basculer en plein écran natif — c'est tout l'objet du
 * chantier. `autoplay` est absent à dessein : c'est le clic de l'élève qui
 * ouvre le lecteur, la lecture reste son geste.
 */
export function urlIntegrationYouTube(videoId: string): string {
  if (!ID_YOUTUBE.test(videoId)) {
    throw new Error("Identifiant YouTube invalide");
  }
  const parametres = new URLSearchParams({
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${parametres.toString()}`;
}

/** Y a-t-il quelque chose de lisible derrière cette URL ? */
export function videoLisible(brut: unknown): boolean {
  return resoudreSource(brut) !== null;
}

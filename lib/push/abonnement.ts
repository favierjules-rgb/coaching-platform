/**
 * LA FORME D'UN ABONNEMENT PUSH, VÉRIFIÉE AVANT D'ÊTRE ÉCRITE.
 *
 * Le navigateur rend un `PushSubscription` dont `toJSON()` donne
 * `{ endpoint, keys: { p256dh, auth } }`. Ce corps arrive par une requête
 * HTTP : il est traité comme une ENTRÉE, jamais comme une vérité.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST REFUSÉ, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════
 * • un endpoint qui n'est pas une URL https — un abonnement ne peut pas
 *   vivre ailleurs, et accepter autre chose reviendrait à laisser le serveur
 *   émettre des requêtes vers une adresse choisie par le client (SSRF) ;
 * • des clés vides ou démesurées : ce sont des valeurs base64url de taille
 *   connue (p256dh ≈ 87, auth ≈ 22) ;
 * • tout champ supplémentaire est ignoré, jamais recopié en base.
 */

export interface AbonnementPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function lireAbonnement(brut: unknown): AbonnementPush | null {
  if (!brut || typeof brut !== "object") {
    return null;
  }
  const objet = brut as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = objet.endpoint;
  const p256dh = objet.keys?.p256dh;
  const auth = objet.keys?.auth;

  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return null;
  }
  if (endpoint.length > 2000 || p256dh.length > 200 || auth.length > 100) {
    return null;
  }
  if (!BASE64URL.test(p256dh) || !BASE64URL.test(auth)) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  // https OBLIGATOIRE : le serveur ira lui-même frapper cette adresse.
  if (url.protocol !== "https:") {
    return null;
  }
  return { endpoint, p256dh, auth };
}

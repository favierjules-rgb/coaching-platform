import "server-only";

/**
 * C5.1 — LE CLIENT OAUTH2 NOLIO.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE SEUL MODULE QUI CONNAÎT `NOLIO_CLIENT_SECRET`
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ `import "server-only"` EN PREMIÈRE LIGNE, ET CE N'EST PAS DÉCORATIF. Il
 * fait ÉCHOUER LE BUILD si un composant client importe ce fichier, même
 * indirectement. C'est la seule protection qui agit avant l'exécution : une
 * revue de code peut laisser passer un import, le compilateur non.
 *
 * ════════════════════════════════════════════════════════════════════════
 * SETHCOACHING EST UN CLIENT CONFIDENTIEL, MALGRÉ LA PWA
 * ════════════════════════════════════════════════════════════════════════
 * Nolio annonce PKCE comme supporté mais optionnel. Il n'est PAS retenu ici,
 * et le raisonnement mérite d'être écrit parce qu'il est contre-intuitif :
 *
 *   PKCE existe pour les clients PUBLICS — ceux qui ne peuvent pas détenir de
 *   secret, parce que leur code s'exécute chez l'utilisateur. Sethcoaching est
 *   une PWA, mais le client OAuth n'est PAS le navigateur : c'est le serveur
 *   Next.js. L'échange du code se fait dans un route handler, en Basic auth,
 *   et le navigateur ne voit ni le code, ni les jetons, ni le secret.
 *
 * Le `state` est donc le mécanisme qui compte : c'est lui qui empêche qu'un
 * tiers fasse aboutir un callback qu'il a initié.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE `redirect_uri` EST UNE CONSTANTE, JAMAIS UNE VALEUR CALCULÉE
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ MESURÉ : `sethcoaching.fr` ET `www.sethcoaching.fr` répondent tous deux
 * 200 SANS redirection. Un `redirect_uri` dérivé de `request.url.origin`
 * vaudrait donc tantôt l'un, tantôt l'autre, selon l'adresse par laquelle
 * l'élève est arrivé. Or Nolio exige que le `redirect_uri` de `/token/` soit
 * « byte-for-byte identical » à celui de `/authorize/`. L'échange échouerait
 * une fois sur deux — et marcherait toujours depuis le domaine du développeur.
 *
 * D'où `NOLIO_REDIRECT_URI` : une chaîne littérale, lue au même endroit pour
 * les deux appels. `NEXT_PUBLIC_APP_URL` n'est pas utilisée ici, et ne doit
 * pas l'être : c'est une variable publique, inlinée dans le bundle.
 *
 * ⚠️ ET ON NE LA RÉ-ENCODE PAS. La documentation Nolio est explicite : « Do
 * not url-decode the `redirect_uri` value when sending it to /api/token/ ».
 * `URLSearchParams` s'en charge une fois, correctement, à l'aller comme au
 * retour.
 */

const BASE_NOLIO = "https://www.nolio.io/api";
const URL_AUTORISATION = `${BASE_NOLIO}/authorize/`;
const URL_JETON = `${BASE_NOLIO}/token/`;
const URL_DEAUTORISATION = `${BASE_NOLIO}/deauthorize/`;
const URL_UTILISATEUR = `${BASE_NOLIO}/get/user/`;

/** Au-delà, on considère l'amont injoignable plutôt que d'attendre un route handler bloqué. */
const DELAI_MS = 10_000;

export type MotifNolio =
  | "configuration-absente"
  | "code-invalide"
  | "jeton-invalide"
  | "reponse-illisible"
  | "identite-illisible"
  | "amont-indisponible";

/**
 * ⚠️ AUCUN CORPS DE RÉPONSE NE REMONTE DANS CETTE ERREUR. Nolio renvoie ses
 * motifs d'échec en clair, et une réponse de `/token/` peut contenir un jeton
 * partiel. Un motif court est tout ce dont l'appelant a besoin, et tout ce
 * qu'on accepte de voir apparaître dans un journal.
 */
export class NolioErreur extends Error {
  readonly motif: MotifNolio;
  readonly statut: number | null;

  constructor(motif: MotifNolio, statut: number | null = null) {
    super(`nolio: ${motif}`);
    this.name = "NolioErreur";
    this.motif = motif;
    this.statut = statut;
  }
}

interface ConfigurationNolio {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

/**
 * Lue à chaque appel, jamais mémorisée — même raison que dans `crypto.ts` :
 * un module qui fige `process.env` à l'importation rend le cas « variable
 * absente » impossible à tester honnêtement.
 */
function configuration(): ConfigurationNolio {
  const clientId = process.env.NOLIO_CLIENT_ID?.trim();
  const clientSecret = process.env.NOLIO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.NOLIO_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    // ⚠️ ON NE DIT PAS LAQUELLE MANQUE. Nommer la variable absente dans une
    // erreur qui peut atteindre un journal partagé revient à cartographier la
    // configuration du serveur pour qui sait lire.
    throw new NolioErreur("configuration-absente");
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * L'origine du site, DÉRIVÉE de `NOLIO_REDIRECT_URI`.
 *
 * ⚠️ ELLE NE VIENT NI D'UN LITTÉRAL EN DUR, NI DE `NEXT_PUBLIC_APP_URL`, NI DE
 * `request.url`. Le `redirect_uri` est déjà la seule adresse dont on sait
 * qu'elle est déclarée chez Nolio et stable ; en tirer l'origine garantit que
 * la redirection finale vers le profil part du MÊME domaine que celui par
 * lequel l'élève vient de revenir — apex ou `www`, sans hasard.
 */
export function origineDuSite(): string {
  return new URL(configuration().redirectUri).origin;
}

/** `true` si les trois variables OAuth sont présentes. Ne révèle aucune valeur. */
export function nolioEstConfigure(): boolean {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

/**
 * L'URL vers laquelle envoyer l'élève.
 *
 * ⚠️ PAS DE PARAMÈTRE `scope`. La documentation est explicite : « 'scope' is
 * not a parameter we ask for currently, all routes will be accessible by
 * default ». En envoyer un serait inventer une API.
 */
export function urlDAutorisation(state: string): string {
  const { clientId, redirectUri } = configuration();
  const parametres = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  return `${URL_AUTORISATION}?${parametres.toString()}`;
}

export interface JetonsNolio {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly scope: string | null;
}

/** L'en-tête Basic exigé par `/api/token/`. */
function enteteBasic({ clientId, clientSecret }: ConfigurationNolio): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function appelerJeton(corps: URLSearchParams, motifEchec: MotifNolio): Promise<JetonsNolio> {
  const config = configuration();
  let reponse: Response;
  try {
    reponse = await fetch(URL_JETON, {
      method: "POST",
      headers: {
        Authorization: enteteBasic(config),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: corps.toString(),
      signal: AbortSignal.timeout(DELAI_MS),
      cache: "no-store",
    });
  } catch {
    throw new NolioErreur("amont-indisponible");
  }

  if (!reponse.ok) throw new NolioErreur(motifEchec, reponse.status);

  let brut: unknown;
  try {
    brut = await reponse.json();
  } catch {
    throw new NolioErreur("reponse-illisible", reponse.status);
  }

  const donnees = brut as Partial<{
    access_token: unknown;
    refresh_token: unknown;
    expires_in: unknown;
    scope: unknown;
  }>;
  const accessToken = typeof donnees.access_token === "string" ? donnees.access_token.trim() : "";
  const refreshToken = typeof donnees.refresh_token === "string" ? donnees.refresh_token.trim() : "";
  // ⚠️ LES DEUX SONT EXIGÉS. Nolio ROTE le refresh_token à chaque usage :
  // accepter une réponse sans nouveau refresh_token reviendrait à conserver
  // celui qu'on vient d'invalider, donc à perdre la connexion au prochain
  // rafraîchissement — silencieusement, des heures plus tard.
  if (!accessToken || !refreshToken) throw new NolioErreur("reponse-illisible", reponse.status);

  const secondes = typeof donnees.expires_in === "number" && Number.isFinite(donnees.expires_in)
    ? donnees.expires_in
    : 86_400; // 24 h — la valeur documentée, utilisée si l'amont l'omet.

  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + secondes * 1000),
    scope: typeof donnees.scope === "string" ? donnees.scope : null,
  };
}

/** Échange le code d'autorisation contre le premier couple de jetons. */
export async function echangerCode(code: string): Promise<JetonsNolio> {
  const { redirectUri } = configuration();
  return appelerJeton(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      // ⚠️ LE MÊME LITTÉRAL QU'À `/authorize/`, à l'octet près. Voir l'en-tête.
      redirect_uri: redirectUri,
    }),
    "code-invalide",
  );
}

/**
 * Rafraîchit les jetons.
 *
 * ⚠️ L'APPELANT DOIT DÉTENIR LE BAIL. Nolio invalide l'ancien refresh_token
 * dès qu'il est présenté : deux appels concurrents pour le même élève et la
 * connexion est perdue. La sérialisation vit dans `lib/supabase/nolio.ts`,
 * qui est le seul module autorisé à appeler cette fonction.
 */
export async function rafraichirJetons(refreshToken: string): Promise<JetonsNolio> {
  return appelerJeton(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    "jeton-invalide",
  );
}

/**
 * Révoque l'autorisation côté Nolio.
 *
 * ⚠️ NE LÈVE JAMAIS. Une déconnexion doit aboutir côté Sethcoaching même si
 * Nolio est injoignable : garder la ligne locale « au cas où » laisserait
 * l'élève sans moyen de se déconnecter, et des jetons vivants en base. Rend
 * `true` si l'amont a confirmé, `false` sinon — l'appelant journalise le fait,
 * il ne s'y arrête pas.
 */
export async function deautoriser(accessToken: string): Promise<boolean> {
  let config: ConfigurationNolio;
  try {
    config = configuration();
  } catch {
    return false;
  }
  try {
    const reponse = await fetch(URL_DEAUTORISATION, {
      method: "POST",
      headers: {
        Authorization: enteteBasic(config),
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ token: accessToken }).toString(),
      signal: AbortSignal.timeout(DELAI_MS),
      cache: "no-store",
    });
    return reponse.ok;
  } catch {
    return false;
  }
}

/**
 * L'identité Nolio du titulaire du jeton.
 *
 * ⚠️ APPELÉ SANS `athlete_id`, ET C'EST VOLONTAIRE. Le paramètre sert à lire
 * un athlète GÉRÉ par le compte ; sans lui, l'endpoint rend le titulaire du
 * jeton — la seule identité qui a un sens pour « quel compte cet élève
 * vient-il de connecter ? ». La gestion d'athlètes multiples est hors C5.1.
 */
export async function lireIdentiteNolio(accessToken: string): Promise<number> {
  let reponse: Response;
  try {
    reponse = await fetch(URL_UTILISATEUR, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(DELAI_MS),
      cache: "no-store",
    });
  } catch {
    throw new NolioErreur("amont-indisponible");
  }
  if (!reponse.ok) throw new NolioErreur("jeton-invalide", reponse.status);

  let brut: unknown;
  try {
    brut = await reponse.json();
  } catch {
    throw new NolioErreur("identite-illisible", reponse.status);
  }

  const id = (brut as Partial<{ id: unknown }>).id;
  // ⚠️ ENTIER STRICTEMENT POSITIF. La colonne est `bigint` avec une contrainte
  // `> 0` : accepter un `0`, un flottant ou une chaîne ferait échouer
  // l'écriture bien plus loin, avec une erreur de base incompréhensible.
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new NolioErreur("identite-illisible", reponse.status);
  }
  return id;
}

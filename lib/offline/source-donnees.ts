/**
 * HORS LIGNE — D'OÙ VIENNENT LES DONNÉES, ET POURQUOI.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS CONFUSIONS À TENIR SÉPARÉES
 * ════════════════════════════════════════════════════════════════════════
 * Avant ce chantier, un seul booléen — `active` — répondait à des questions
 * qui n'ont rien à voir : « Supabase est-il configuré ? », « quelqu'un
 * est-il connecté ? », « ce compte a-t-il une fiche élève ? », « la requête
 * a-t-elle abouti ? ». Toutes les réponses négatives menaient au même
 * endroit : `data/student.ts`, une séance de DÉMONSTRATION.
 *
 * Ce fichier découpe ce booléen. Trois règles le gouvernent, et chacune
 * interdit une catastrophe distincte :
 *
 *   ► MOCK = environnement volontairement non configuré. RIEN d'autre.
 *     Un vrai compte ne doit jamais se voir présenter une séance inventée
 *     comme si c'était la sienne — ni parce qu'il n'a pas encore de fiche,
 *     ni parce que sa session a expiré.
 *
 *   ► OFFLINE = vraie application, vraie identité, panne réseau CONSTATÉE.
 *     Servir un snapshot ancien parce qu'on n'a pas su lire une erreur,
 *     c'est présenter des données périmées comme si tout allait bien.
 *
 *   ► ERREUR = le serveur a répondu, et sa réponse est un refus ou un
 *     échec. Un 401, un 403, un RLS, un 500, un payload invalide : aucun
 *     n'est une panne réseau, aucun n'autorise à basculer hors ligne.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DOUTE NE PROFITE PLUS AU HORS-LIGNE
 * ════════════════════════════════════════════════════════════════════════
 * Une première version répondait « panne réseau » en cas d'erreur non
 * reconnue. C'était le mauvais arbitrage : une erreur inconnue est bien
 * plus souvent un 401, un problème de politique RLS ou un bug applicatif
 * qu'une coupure — et chacun de ces cas se serait alors traduit par
 * l'affichage silencieux d'un snapshot d'hier.
 *
 * La bascule hors ligne exige désormais un SIGNAL POSITIF de transport.
 * À défaut : `erreur`. L'écran peut alors le dire, au lieu de faire comme
 * si de rien n'était.
 */

/* ════════════════════════════════════════════════════════════════════════
 * I. CE QU'ON A CONSTATÉ
 * ════════════════════════════════════════════════════════════════════════ */

export type DiagnosticChargement =
  /** Aucun client Supabase : l'environnement n'est pas configuré. */
  | "non_configure"
  /** Aucune session locale : personne n'est connecté. */
  | "non_authentifie"
  /** Compte réel, aucune fiche `students` — cas normal avant création par le coach. */
  | "sans_fiche_eleve"
  /** Panne de TRANSPORT constatée : le serveur n'a jamais répondu. */
  | "reseau_indisponible"
  /** Le serveur a répondu : session expirée / non authentifiée (401). */
  | "erreur_auth"
  /** Le serveur a répondu : accès refusé, politique RLS (403, 42501). */
  | "erreur_autorisation"
  /** Le serveur a répondu, et a échoué (5xx, SQL, payload refusé). */
  | "erreur_serveur"
  /** Quelque chose a échoué sans signal exploitable. Surtout PAS « réseau ». */
  | "erreur_inconnue"
  /** Chargement réussi. */
  | "charge";

export type SourceDonnees =
  /** Données réelles et fraîches. */
  | "supabase"
  /** Dépôt local, identité vérifiée, panne réseau constatée. */
  | "offline"
  /** Démonstration — environnement volontairement non configuré. */
  | "mock"
  /** Il faut se (re)connecter. Aucune donnée élève. */
  | "non_authentifie"
  /** Compte réel sans fiche élève. Aucune donnée élève, et surtout pas une inventée. */
  | "sans_fiche_eleve"
  /** Le serveur a refusé ou échoué. On le dit, on n'improvise pas. */
  | "erreur";

export interface OptionsClassement {
  /**
   * L'application tourne-t-elle EXPLICITEMENT en environnement de
   * démonstration ?
   *
   * Défaut `false`. C'est la seule façon d'obtenir `mock` autrement que par
   * une absence de configuration — et elle doit être demandée, jamais
   * déduite d'un échec.
   */
  environnementDemo?: boolean;
}

export function classerSource(
  diagnostic: DiagnosticChargement,
  options: OptionsClassement = {},
): SourceDonnees {
  switch (diagnostic) {
    case "charge":
      return "supabase";
    case "reseau_indisponible":
      return "offline";
    case "non_configure":
      // Le seul chemin inconditionnel vers la démonstration.
      return "mock";
    case "non_authentifie":
      // En démonstration assumée, un visiteur non connecté a le droit de
      // voir la vitrine. Partout ailleurs, il voit un écran d'authentification.
      return options.environnementDemo === true ? "mock" : "non_authentifie";
    case "sans_fiche_eleve":
      // JAMAIS le mock : ce compte est réel, il n'a simplement pas encore de
      // fiche. Lui montrer une séance de démonstration lui ferait remplir un
      // entraînement qui n'existe pas.
      return "sans_fiche_eleve";
    case "erreur_auth":
    case "erreur_autorisation":
    case "erreur_serveur":
    case "erreur_inconnue":
      return "erreur";
  }
}

/* ════════════════════════════════════════════════════════════════════════
 * II. LIRE UNE ERREUR SANS LUI FAIRE DIRE CE QU'ELLE NE DIT PAS
 * ════════════════════════════════════════════════════════════════════════ */

export type NatureErreur = "reseau" | "auth" | "autorisation" | "serveur" | "inconnue";

/** Ce qu'on sait regarder dans une erreur, quelle que soit la couche qui l'a produite. */
interface ErreurObservee {
  name?: unknown;
  message?: unknown;
  /** `fetch` / Supabase : présent dès que le serveur A RÉPONDU. */
  status?: unknown;
  /** `PostgrestError.code` — `PGRST301`, `42501`… */
  code?: unknown;
}

/**
 * La nature d'une erreur, classée PRUDEMMENT.
 *
 * L'ordre des contrôles est le raisonnement lui-même :
 *
 *   1. un STATUT HTTP signifie que le serveur a répondu — donc jamais
 *      « réseau », quel que soit le reste du message ;
 *   2. un CODE Postgres désigne une décision de la base ;
 *   3. seulement ensuite, les signaux de transport reconnus ;
 *   4. à défaut : `inconnue`. Pas `reseau`.
 */
export function classerErreur(erreur: unknown): NatureErreur {
  if (erreur === null || erreur === undefined) return "inconnue";
  const e = erreur as ErreurObservee;

  // 1. Le serveur a répondu.
  const statut = typeof e.status === "number" ? e.status : null;
  if (statut !== null) {
    if (statut === 401) return "auth";
    if (statut === 403) return "autorisation";
    if (statut >= 400) return "serveur";
    // Un 2xx/3xx en erreur : quelque chose d'inattendu, mais le serveur
    // était bien là.
    return "inconnue";
  }

  // 2. La base a tranché.
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "PGRST301" || code === "PGRST302") return "auth";
  if (code === "42501") return "autorisation";
  if (code.startsWith("PGRST") || /^[0-9A-Z]{5}$/.test(code)) return "serveur";

  // 3. Signaux de TRANSPORT — les seuls qui autorisent le hors-ligne.
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "reseau";
  const nom = typeof e.name === "string" ? e.name : "";
  if (nom === "AbortError" || nom === "NetworkError" || nom === "TimeoutError") return "reseau";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (
    (nom === "TypeError" && message.includes("fetch")) ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("err_internet_disconnected") ||
    message.includes("err_network_changed") ||
    message.includes("load failed")
  ) {
    return "reseau";
  }

  // 4. Rien d'exploitable. On ne devine pas.
  return "inconnue";
}

/**
 * Le diagnostic à partir de ce qui a été observé.
 *
 * Sans effet de bord et sans appel : les hooks lui passent ce qu'ils ont
 * constaté, il tranche. C'est ce qui rend « offline ≠ mock ≠ erreur »
 * vérifiable dans Node.
 */
export function diagnostiquer(observation: {
  /** `createSupabaseBrowserClient()` a-t-il rendu un client ? */
  clientDisponible: boolean;
  /** Une session auth locale existe-t-elle ? (lecture LOCALE, aucun appel) */
  sessionLocale: boolean;
  /** L'erreur rencontrée en chargeant, s'il y en a une. */
  erreur?: unknown;
  /**
   * La fiche élève a-t-elle été trouvée ?
   *   `true`  → trouvée
   *   `false` → le serveur a répondu « aucune ligne »
   *   `null`/absent → la question n'a pas reçu de réponse
   */
  ficheEleve?: boolean | null;
}): DiagnosticChargement {
  if (!observation.clientDisponible) return "non_configure";

  if (observation.erreur !== undefined && observation.erreur !== null) {
    switch (classerErreur(observation.erreur)) {
      case "reseau":
        return "reseau_indisponible";
      case "auth":
        return "erreur_auth";
      case "autorisation":
        return "erreur_autorisation";
      case "serveur":
        return "erreur_serveur";
      case "inconnue":
        return "erreur_inconnue";
    }
  }

  if (!observation.sessionLocale) return "non_authentifie";
  if (observation.ficheEleve === true) return "charge";
  if (observation.ficheEleve === false) return "sans_fiche_eleve";

  // Aucune erreur, aucune réponse : on ne fabrique ni « pas de fiche », ni
  // « panne réseau ». On dit qu'on ne sait pas.
  return "erreur_inconnue";
}

/**
 * Cette source autorise-t-elle à afficher des données de l'élève ?
 *
 * `mock` en est exclu délibérément : ce qu'il montre n'appartient à
 * personne.
 */
export function afficheDonneesReelles(source: SourceDonnees): boolean {
  return source === "supabase" || source === "offline";
}

/**
 * Cette source autorise-t-elle une MISE EN FILE hors ligne ?
 *
 * `offline`, et rien d'autre. En particulier pas `erreur` : le serveur est
 * joignable et a refusé — mettre le retour en file reviendrait à programmer
 * la répétition d'un refus, en laissant croire à l'élève que c'est réglé.
 * Et pas `mock` : il n'y a personne à qui attribuer ce retour.
 */
export function autoriseSoumissionHorsLigne(source: SourceDonnees): boolean {
  return source === "offline";
}

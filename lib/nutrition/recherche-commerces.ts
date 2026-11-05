import { RAYON_KM_DEFAUT, RAYON_KM_MAX, RAYON_KM_MIN } from "@/lib/nutrition/magasin-proche";

/**
 * COURSES — L'ÉTAT DE LA RECHERCHE DE COMMERCES, HORS DE REACT.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════════
 * L'écran portait treize états dans une seule union, mêlant le mode (« autour
 * de moi » / « par ville ») et la situation (« en cours », « aucun résultat »,
 * « refusé »). Treize valeurs pour deux questions : chaque nouvel état obligeait
 * à relire les douze autres, et l'écran pouvait montrer un chargement
 * permanent — un `état` resté sur « chargement » parce qu'un chemin d'erreur
 * avait oublié de le changer.
 *
 * Ici, les deux questions sont séparées, et l'invariant que l'énoncé demande
 * — « toujours terminer l'état de chargement, même en cas d'erreur » — devient
 * une propriété vérifiable : `SITUATIONS_DE_CHARGEMENT` est fini et
 * `situationApres()` ne rend jamais une situation de chargement.
 *
 * Module FEUILLE : ni React, ni réseau, ni DOM. Fonctions PURES.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. LE MODE — DEUX, CLAIREMENT IDENTIFIÉS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ DEUX MODES, ET AUCUN N'EST LE REPLI DE L'AUTRE. Un élève peut préférer
 * taper sa ville d'emblée — parce qu'il prépare ses courses depuis son bureau.
 * Faire de la recherche par ville une conséquence d'un refus de géolocalisation
 * ferait de celle-ci un passage obligé.
 */
export type ModeRecherche = "autour" | "ville";

export const MODES: readonly { readonly id: ModeRecherche; readonly libelle: string }[] = [
  { id: "autour", libelle: "Autour de moi" },
  { id: "ville", libelle: "Par ville" },
];

/* ══════════════════════════════════════════════════════════════════════════
   2. LA SITUATION — LES ÉTATS VISUELS QUE L'ÉNONCÉ ÉNUMÈRE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les six situations distinctes demandées, plus les refus de géolocalisation
 * qui ne sont pas des pannes.
 *
 * ⚠️ « REFUSÉ » N'EST PAS « ERREUR ». Un élève qui refuse la localisation a
 * fait un choix ; l'afficher en rouge comme une panne le lui reproche.
 */
export type Situation =
  /** Aucune recherche n'a encore été lancée. */
  | "repos"
  /** La permission de géolocalisation est demandée au navigateur. */
  | "permission"
  /** Géolocalisation obtenue, commerces en cours de lecture. */
  | "chargement_autour"
  /** Commune choisie, commerces en cours de lecture. */
  | "chargement_ville"
  /** Des commerces ont été trouvés. */
  | "resultats"
  /** La recherche a abouti, et n'a rien trouvé. */
  | "aucun_resultat"
  /** La recherche n'a pas abouti. */
  | "erreur"
  /** L'élève a refusé la géolocalisation. */
  | "permission_refusee"
  /** L'appareil n'a pas su donner de position. */
  | "position_indisponible"
  /** La géolocalisation a mis trop de temps. */
  | "position_expiree";

/**
 * ⚠️ LA LISTE EXHAUSTIVE DES SITUATIONS QUI AFFICHENT UN CHARGEMENT. Elle
 * existe pour qu'un test puisse prouver qu'aucune transition de fin n'y mène —
 * c'est-à-dire qu'un chargement permanent est impossible.
 */
export const SITUATIONS_DE_CHARGEMENT: ReadonlySet<Situation> = new Set<Situation>([
  "permission",
  "chargement_autour",
  "chargement_ville",
]);

export function enChargement(situation: Situation): boolean {
  return SITUATIONS_DE_CHARGEMENT.has(situation);
}

/** Ce que la recherche a rendu — le seul vocabulaire que l'écran a à traduire. */
export type Issue =
  | { readonly type: "trouves"; readonly nombre: number }
  | { readonly type: "echec" }
  | { readonly type: "permission_refusee" }
  | { readonly type: "position_indisponible" }
  | { readonly type: "position_expiree" };

/**
 * La situation qui suit une issue.
 *
 * ⚠️ ELLE NE REND JAMAIS UNE SITUATION DE CHARGEMENT, et c'est tout l'objet de
 * cette fonction. Tant que chaque chemin de sortie posait son état lui-même,
 * il suffisait d'un `return` oublié pour laisser l'écran tourner indéfiniment.
 * Ici, il n'existe qu'une porte de sortie, et elle est fermée sur le
 * chargement. Un test le vérifie sur TOUTES les issues.
 */
export function situationApres(issue: Issue): Situation {
  switch (issue.type) {
    case "trouves":
      return issue.nombre > 0 ? "resultats" : "aucun_resultat";
    case "echec":
      return "erreur";
    case "permission_refusee":
      return "permission_refusee";
    case "position_indisponible":
      return "position_indisponible";
    case "position_expiree":
      return "position_expiree";
  }
}

/**
 * Le code d'erreur de géolocalisation du navigateur → une issue.
 *
 * ⚠️ TROIS REFUS DIFFÉRENTS, TROIS ISSUES DIFFÉRENTES. `PERMISSION_DENIED`,
 * `POSITION_UNAVAILABLE` et `TIMEOUT` appellent trois conduites : passer par la
 * ville, réessayer plus tard, réessayer tout de suite.
 */
export function issueDeGeolocalisation(code: number | undefined): Issue {
  if (code === 1) return { type: "permission_refusee" };
  if (code === 2) return { type: "position_indisponible" };
  if (code === 3) return { type: "position_expiree" };
  return { type: "echec" };
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LE MESSAGE — UN PAR SITUATION, ET AUCUN QUI MENTE
   ══════════════════════════════════════════════════════════════════════════ */

export interface MessageDeSituation {
  readonly texte: string;
  /** `alert` pour une panne, `status` pour tout le reste. Jamais l'inverse. */
  readonly role: "status" | "alert";
}

/**
 * ⚠️ « AUCUN RÉSULTAT » DÉPEND DE LA TRONCATURE, ET C'EST UNE QUESTION DE
 * VÉRITÉ. Quand la recherche a été écourtée, nous n'avons consulté qu'une
 * portion : affirmer l'absence serait affirmer ce que nous n'avons pas mesuré,
 * et l'élève renoncerait à un magasin qui existe.
 */
export function messageDeSituation(
  situation: Situation,
  contexte: { readonly mode: ModeRecherche; readonly tronque: boolean },
): MessageDeSituation | null {
  switch (situation) {
    case "repos":
      return null;
    case "resultats":
      return null;
    case "permission":
      return { texte: "Autorise la localisation pour continuer.", role: "status" };
    case "chargement_autour":
      return { texte: "Recherche des commerces autour de toi…", role: "status" };
    case "chargement_ville":
      return { texte: "Recherche des commerces de la commune…", role: "status" };
    case "aucun_resultat":
      if (contexte.tronque) {
        return {
          texte:
            "Aucun commerce dans les premiers résultats consultés. La recherche a été écourtée : il en existe peut-être d'autres.",
          role: "status",
        };
      }
      return {
        texte:
          contexte.mode === "autour"
            ? "Aucun commerce cartographié autour de toi. Ce n'est pas une erreur : la base est collaborative et reste incomplète par endroits."
            : "Aucun commerce cartographié dans cette commune. Ce n'est pas une erreur : la base est collaborative et reste incomplète par endroits.",
        role: "status",
      };
    case "erreur":
      return { texte: "La recherche n'a pas abouti. Réessaie dans un instant.", role: "alert" };
    case "permission_refusee":
      return {
        texte: "Localisation refusée — rien n'est enregistré. Cherche par ville.",
        role: "status",
      };
    case "position_indisponible":
      return {
        texte: "Ton appareil n'a pas pu donner ta position. Cherche par ville.",
        role: "status",
      };
    case "position_expiree":
      return { texte: "La localisation a mis trop de temps. Réessaie.", role: "status" };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   4. LE RAYON
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les rayons proposés à l'élève.
 *
 * ⚠️ DES PALIERS, PAS UN CURSEUR LIBRE. Un curseur de 1 à 25 km invite à
 * chercher le réglage parfait ; quatre paliers répondent à la seule question
 * réelle — mon quartier, ma ville, ou plus loin. Et ils restent DANS les bornes
 * serveur : un test le vérifie, pour qu'un palier ajouté hors bornes ne
 * produise pas un 400 au clic.
 */
export const RAYONS_PROPOSES: readonly number[] = [2, 5, 10, 25];

export { RAYON_KM_DEFAUT, RAYON_KM_MAX, RAYON_KM_MIN };

/** « 10 km ». */
export function libelleDuRayon(km: number): string {
  return `${km} km`;
}

/**
 * ⚠️ LE RAYON CHOISI PAR L'ÉCRAN EST BORNÉ ICI AUSSI. Le schéma d'entrée et la
 * route le reverront ; cette borne-ci évite simplement d'envoyer une requête
 * dont on sait déjà qu'elle sera refusée.
 */
export function rayonUtilisable(km: number): number {
  if (!Number.isFinite(km)) return RAYON_KM_DEFAUT;
  if (km < RAYON_KM_MIN) return RAYON_KM_MIN;
  if (km > RAYON_KM_MAX) return RAYON_KM_MAX;
  return km;
}

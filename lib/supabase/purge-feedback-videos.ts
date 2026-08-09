import type { SupabaseClient } from "@supabase/supabase-js";

import { FEEDBACK_VIDEO_BUCKET } from "@/lib/feedback-video";
import {
  bornerCandidats,
  classerObjetFeedbackVideo,
  FEEDBACK_VIDEO_PURGE_MAX_PAR_EXECUTION,
  FEEDBACK_VIDEO_RECONCILIATION_GRACE_MS,
  type ObjetVideo,
  type RaisonSuppression,
} from "@/lib/feedback-video-retention";
import type { Database } from "@/types/supabase";

/**
 * F4.1 — LA PURGE DE RÉTENTION DES VIDÉOS DE TECHNIQUE.
 *
 * Appelée une fois par jour par `app/api/cron/purge-feedback-videos`. Elle
 * ne s'exécute qu'avec le client service role, jamais depuis un navigateur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * DEUX CATÉGORIES, DANS CET ORDRE, JAMAIS L'INVERSE
 * ────────────────────────────────────────────────────────────────────────
 *   A. les vidéos RÉFÉRENCÉES dont l'objet a plus de 30 jours ;
 *   B. les ORPHELINS de plus de 24 h.
 *
 * L'ordre n'est pas cosmétique. Traiter B d'abord effacerait des fichiers
 * que A s'apprête à déréférencer, et surtout : une vidéo dont A vient de
 * lever la référence deviendrait, dans le même passage, un « orphelin »
 * qu'on tenterait de supprimer une seconde fois. On calcule donc B sur
 * l'inventaire MOINS ce que A a traité.
 *
 * ────────────────────────────────────────────────────────────────────────
 * BASE D'ABORD, STORAGE ENSUITE — ET JAMAIS DE SQL SUR storage.objects
 * ────────────────────────────────────────────────────────────────────────
 * Un objet Storage n'est pas une ligne PostgreSQL : supprimer la ligne
 * laisserait le fichier en place. Tout passe par l'API Storage.
 *
 * L'ORDRE A ÉTÉ INVERSÉ, et c'est le correctif central de cette version.
 *
 * La première version supprimait le fichier PUIS levait la référence. Le
 * défaut n'apparaît qu'en cas de panne entre les deux : le fichier est
 * parti, la ligne pointe encore vers lui — et comme les candidats sont
 * inventoriés DEPUIS STORAGE, cet objet n'existe plus, donc plus aucun
 * passage ne retrouvera jamais la référence cassée. Elle serait
 * définitive, et invisible.
 *
 * On lève donc la référence D'ABORD, on efface ENSUITE. Les deux pannes
 * possibles deviennent alors bénignes :
 *   • le nettoyage DB échoue      → rien n'est effacé, tout est intact,
 *                                   le passage suivant réessaie ;
 *   • le nettoyage DB réussit et
 *     la suppression Storage échoue → l'objet devient un ORPHELIN, que la
 *                                   catégorie B ramassera au passage
 *                                   suivant. On ne recrée JAMAIS la
 *                                   référence : elle serait cassée.
 *
 * C'est l'invariant tenu depuis F4, énoncé dans l'autre sens : un orphelin
 * se rattrape, une référence vers un objet absent ne se rattrape pas.
 *
 * Le nettoyage DB est CONDITIONNEL sur le même `video_path` (`.eq`) : si
 * l'élève a remplacé sa vidéo entre l'inventaire et maintenant, la ligne
 * porte un autre chemin, l'UPDATE ne touche AUCUNE ligne — et l'objet
 * bascule alors en catégorie B, où la revalidation décide de son sort. Zéro
 * ligne touchée n'est jamais compté comme une suppression référencée
 * réussie.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LA COURSE QU'AUCUN ORDRE NE FERME, ET COMMENT ON S'EN RELÈVE
 * ────────────────────────────────────────────────────────────────────────
 * PostgreSQL et Supabase Storage sont deux systèmes distincts : aucune
 * séquence, aucun UPDATE conditionnel ne peut les rendre atomiques. Il reste
 * donc une fenêtre :
 *
 *   1. la purge lève la référence de V1 ;
 *   2. AVANT le `remove(V1)`, un vieil onglet renvoie le formulaire et
 *      réécrit V1 dans `video_path` ;
 *   3. le `remove(V1)` réussit ;
 *   4. la base pointe vers un objet qui n'existe plus.
 *
 * On ne prétend pas fermer cette fenêtre. On en SORT, par deux filets :
 *
 *   • IMMÉDIAT — après un `remove` réussi, on rejoue le même UPDATE
 *     conditionnel. Toute référence réapparue pendant la fenêtre est levée
 *     dans la foulée. Cela couvre l'écrasante majorité des cas.
 *   • DIFFÉRÉ — une passe de RÉCONCILIATION, en fin de purge : on relit les
 *     références et on nettoie celles qui désignent un objet réellement
 *     absent. Elle rattrape le cas où le second UPDATE a lui-même échoué,
 *     et toute réapparition plus tardive encore.
 *
 * La réconciliation ne s'exécute QUE si l'inventaire Storage est COMPLET.
 * Déduire « ce fichier n'existe pas » d'un listing partiel effacerait des
 * références parfaitement valides — une purge ne conclut jamais depuis une
 * information incomplète.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUE « 30 JOURS » VEUT DIRE EXACTEMENT
 * ────────────────────────────────────────────────────────────────────────
 * Une vidéo devient éligible à J+30. En fonctionnement nominal, le cron
 * quotidien (03:00 UTC) la traite au passage suivant, généralement entre
 * J+30 et J+31.
 *
 * « Généralement » n'est pas une coquetterie : un échec Storage, un nouvel
 * essai, le plafond de suppressions par exécution ou un arriéré peuvent
 * repousser le traitement de plusieurs passages. Il n'y a donc pas de borne
 * haute garantie, et ce paragraphe existe pour qu'on n'en promette pas une.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface SuppressionJournalisee {
  path: string;
  raison: RaisonSuppression;
  /** `storage.objects.created_at` tel que lu à l'inventaire. */
  creeLe: string;
}

export interface EchecPurge {
  path: string;
  etape: "storage" | "base";
  message: string;
}

export interface BilanPurge {
  demarreA: string;
  termineA: string;
  dureeMs: number;
  /** Objets inventoriés dans le bucket, toutes catégories confondues. */
  objetsInventories: number;
  expireesDetectees: number;
  expireesSupprimees: number;
  referencesNettoyees: number;
  /**
   * Références levées avec succès, mais dont le fichier n'a PAS pu être
   * effacé : ces objets sont devenus des orphelins ordinaires et partiront
   * en catégorie B au passage suivant. Aucune référence cassée n'en résulte.
   */
  expireesDereferenceesSansSuppression: number;
  /**
   * L'UPDATE n'a touché AUCUNE ligne : la vidéo a été remplacée entre
   * l'inventaire et l'action. Jamais compté comme une suppression réussie —
   * l'objet bascule en catégorie B et la revalidation tranche.
   */
  expireesRemplaceesEntreTemps: number;
  orphelinsDetectes: number;
  orphelinsSupprimes: number;
  /** Orphelins re-référencés entre l'inventaire et la suppression : épargnés. */
  orphelinsEpargnesParRevalidation: number;
  /**
   * Chemins que le balayeur a vus sans savoir les traiter : forme non
   * conforme, fichier à la racine du bucket, sous-dossier inattendu. Ils ne
   * sont JAMAIS supprimés. Ce sont des avertissements, pas des échecs
   * opérationnels : ils ne font pas échouer le cron.
   */
  cheminsMalformes: string[];
  /** La réconciliation a-t-elle pu s'exécuter ? Non si l'inventaire est partiel. */
  reconciliationExecutee: boolean;
  /** Références désignant un objet réellement absent du bucket. */
  referencesCasseesDetectees: number;
  referencesCasseesNettoyees: number;
  erreursReconciliation: number;
  reportesAuProchainPassage: number;
  echecs: EchecPurge[];
  suppressions: SuppressionJournalisee[];
}

const PREFIXE_LOG = "[purge-feedback-videos]";

/**
 * Inventaire complet du bucket, avec la date de création RÉELLE de chaque
 * objet.
 *
 * `list()` n'est pas récursif : à la racine il rend les « dossiers » (un par
 * élève), et il faut redescendre dans chacun. C'est un appel par élève, pas
 * un par vidéo — le N+1 est sur les dossiers, borné par le nombre d'élèves,
 * et il n'existe aucune API Storage qui liste un bucket à plat.
 *
 * Chaque dossier est paginé : `list()` s'arrête à 100 objets par défaut, et
 * une purge qui s'arrêterait là laisserait exactement ce qu'elle prétend
 * nettoyer.
 */
async function inventorierBucket(
  supabase: TypedSupabaseClient,
): Promise<{ objets: ObjetVideo[]; anomalies: string[]; echecs: EchecPurge[]; complet: boolean }> {
  const seau = supabase.storage.from(FEEDBACK_VIDEO_BUCKET);
  const objets: ObjetVideo[] = [];
  /**
   * Ce que le balayeur voit sans savoir quoi en faire. Rien ici n'est
   * supprimé — mais rien n'est passé sous silence non plus : un objet que
   * l'inventaire IGNORE est bien pire qu'un objet qu'il signale, parce que
   * personne ne sait qu'il existe.
   */
  const anomalies: string[] = [];
  const echecs: EchecPurge[] = [];
  /**
   * Faux dès qu'un listing a échoué ou s'est arrêté sur un garde-fou. La
   * réconciliation en dépend : conclure « ce fichier n'existe pas » depuis
   * un inventaire partiel effacerait des références valides.
   */
  let complet = true;

  const { data: racine, error: erreurRacine } = await seau.list("", { limit: 1000 });
  if (erreurRacine) {
    echecs.push({ path: "", etape: "storage", message: erreurRacine.message });
    return { objets, anomalies, echecs, complet: false };
  }

  // Un « dossier » se reconnaît à son `id` nul : Storage n'a pas de vrais
  // répertoires, il synthétise ces entrées à partir des préfixes. Tout ce
  // qui porte un `id` à la RACINE est donc un FICHIER posé hors de tout
  // dossier d'élève — impossible par les policies, mais possible par le
  // tableau de bord. On le signale au lieu de faire comme s'il n'existait pas.
  const dossiers: string[] = [];
  for (const entree of racine ?? []) {
    if (entree.id === null) dossiers.push(entree.name);
    else anomalies.push(entree.name);
  }

  for (const dossier of dossiers) {
    for (let page = 0; page < 1000; page += 1) {
      const { data: fichiers, error } = await seau.list(dossier, {
        limit: 100,
        offset: page * 100,
      });
      if (error) {
        echecs.push({ path: dossier, etape: "storage", message: error.message });
        complet = false;
        break;
      }
      if (!fichiers || fichiers.length === 0) break;
      for (const fichier of fichiers) {
        // Un `id` nul À CE NIVEAU signale un SOUS-DOSSIER : la forme attendue
        // n'a que deux segments. On ne descend pas dedans — on ne saurait pas
        // quoi faire de ce qu'on y trouverait — mais on le nomme, avec sa
        // barre finale pour qu'on voie tout de suite que ce n'est pas un
        // fichier.
        if (fichier.id === null) {
          anomalies.push(`${dossier}/${fichier.name}/`);
          continue;
        }
        objets.push({
          path: `${dossier}/${fichier.name}`,
          // `created_at` absent ne doit pas se traduire par « très ancien » :
          // on prend l'instant présent, donc l'objet est épargné et repassera
          // au prochain tour. Une purge ne devine jamais un âge.
          creeLe: fichier.created_at ? new Date(fichier.created_at).getTime() : Date.now(),
        });
      }
      if (fichiers.length < 100) break;
      // Le garde-fou des 1000 pages est atteint : le dossier n'a pas été lu
      // jusqu'au bout, l'inventaire n'est donc pas complet.
      if (page === 999) complet = false;
    }
  }

  return { objets, anomalies, echecs, complet };
}

interface ReferenceVideo {
  videoPath: string;
  /**
   * Depuis quand CETTE ligne pointe vers CE chemin. Ne dit rien de l'âge du
   * fichier — une resoumission le redate — mais dit fidèlement l'âge du
   * RATTACHEMENT, ce qui est exactement ce dont la réconciliation a besoin.
   */
  videoUploadedAt: string | null;
}

/** Toutes les références actuelles, paginées — la table peut être longue. */
async function lireReferences(
  supabase: TypedSupabaseClient,
): Promise<{ lignes: ReferenceVideo[]; complet: boolean }> {
  const lignes: ReferenceVideo[] = [];
  const taille = 1000;
  for (let page = 0; page < 1000; page += 1) {
    const { data, error } = await supabase
      .from("exercise_feedback")
      .select("video_path, video_uploaded_at")
      .range(page * taille, page * taille + taille - 1);
    if (error) {
      console.error(`${PREFIXE_LOG} lecture des références : ${error.message}`);
      return { lignes, complet: false };
    }
    if (!data || data.length === 0) break;
    for (const ligne of data) {
      if (ligne.video_path) {
        lignes.push({ videoPath: ligne.video_path, videoUploadedAt: ligne.video_uploaded_at });
      }
    }
    if (data.length < taille) break;
  }
  return { lignes, complet: true };
}

/** Ce chemin est-il référencé À CET INSTANT ? Revalidation avant suppression. */
async function estEncoreReference(supabase: TypedSupabaseClient, path: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("exercise_feedback")
    .select("id")
    .eq("video_path", path)
    .limit(1);
  if (error) {
    // Dans le doute, on ÉPARGNE : un objet gardé une journée de plus ne coûte
    // rien, un objet effacé à tort est irrécupérable.
    console.error(`${PREFIXE_LOG} revalidation de ${path} : ${error.message}`);
    return true;
  }
  return (data ?? []).length > 0;
}

/**
 * Exécute une purge complète. Idempotente : un second passage immédiat ne
 * trouve plus rien à faire.
 *
 * `maintenant` est injecté pour que les tests puissent vieillir un objet
 * sans attendre trente jours.
 */
export async function purgeFeedbackVideos(
  supabase: TypedSupabaseClient,
  options: { maintenant?: number; maximumParExecution?: number } = {},
): Promise<BilanPurge> {
  const maintenant = options.maintenant ?? Date.now();
  const maximum = options.maximumParExecution ?? FEEDBACK_VIDEO_PURGE_MAX_PAR_EXECUTION;
  const debut = Date.now();
  const seau = supabase.storage.from(FEEDBACK_VIDEO_BUCKET);

  console.info(`${PREFIXE_LOG} début — bucket ${FEEDBACK_VIDEO_BUCKET}`);

  const { objets, anomalies, echecs, complet: inventaireComplet } = await inventorierBucket(supabase);
  const lectureReferences = await lireReferences(supabase);
  const references = new Set(lectureReferences.lignes.map((l) => l.videoPath));

  // Les anomalies de STRUCTURE relevées par l'inventaire (fichier à la
  // racine, sous-dossier) rejoignent les chemins de forme invalide : mêmes
  // conséquences, même journal, aucune suppression.
  const cheminsMalformes: string[] = [...anomalies];
  const suppressions: SuppressionJournalisee[] = [];
  const expirees: ObjetVideo[] = [];
  const orphelins: ObjetVideo[] = [];

  for (const objet of objets) {
    const verdict = classerObjetFeedbackVideo(objet, {
      estReference: references.has(objet.path),
      maintenant,
    });
    if (verdict.action === "signaler") {
      cheminsMalformes.push(objet.path);
      continue;
    }
    if (verdict.action !== "supprimer") continue;
    if (verdict.raison === "expired_reference") expirees.push(objet);
    else orphelins.push(objet);
  }

  // Le plafond porte sur le TOTAL des suppressions, A et B confondues : c'est
  // le nombre d'appels réseau qui fait expirer une route, pas la catégorie.
  const bornees = bornerCandidats([...expirees, ...orphelins], maximum);
  const retenus = new Set(bornees.retenus.map((o) => o.path));

  let expireesSupprimees = 0;
  let referencesNettoyees = 0;
  let expireesDereferenceesSansSuppression = 0;
  let expireesRemplaceesEntreTemps = 0;
  let orphelinsSupprimes = 0;
  let orphelinsEpargnesParRevalidation = 0;
  /**
   * Objets qui étaient référencés à l'inventaire mais ne le sont plus au
   * moment d'agir (remplacement concurrent). Ils rejoignent la catégorie B,
   * revalidation comprise : c'est elle qui tranche, jamais A.
   */
  const rebasculesEnOrphelin: ObjetVideo[] = [];

  const journaliser = (objet: ObjetVideo, raison: RaisonSuppression) => {
    const creeLe = new Date(objet.creeLe).toISOString();
    suppressions.push({ path: objet.path, raison, creeLe });
    console.info(`${PREFIXE_LOG} supprimé ${objet.path} — raison=${raison} créé_le=${creeLe}`);
  };

  // ── A. LES VIDÉOS RÉFÉRENCÉES EXPIRÉES ────────────────────────────────
  // BASE D'ABORD, STORAGE ENSUITE. Voir l'en-tête : dans l'autre sens, une
  // panne entre les deux laisse une référence vers un fichier disparu — que
  // plus aucun passage ne retrouvera, puisque les candidats sont inventoriés
  // depuis Storage.
  //
  // Un échec sur un objet n'arrête pas les autres : ils sont indépendants,
  // et abandonner tout le passage pour un fichier récalcitrant reviendrait à
  // laisser un seul objet bloquer la rétention de tous les autres.
  for (const objet of expirees) {
    if (!retenus.has(objet.path)) continue;

    // 1. Lever la référence — et SEULEMENT celle qui porte encore exactement
    //    ce chemin. Si l'élève a remplacé sa vidéo entre-temps, la ligne
    //    porte un autre chemin : on n'y touche pas.
    //
    // `video_uploaded_at` n'est PAS envoyé — le type `Update` de la table ne
    // l'expose même pas, et c'est voulu : le gardien
    // `enforce_exercise_feedback_write` le DÉRIVE, et le remet à NULL dès que
    // `video_path` passe à NULL. La purge n'a donc rien à dire là-dessus, et
    // ne peut pas se tromper.
    const { data: nettoyees, error: erreurBase } = await supabase
      .from("exercise_feedback")
      .update({ video_path: null })
      .eq("video_path", objet.path)
      .select("id");

    if (erreurBase) {
      // Rien n'a été effacé, rien n'est perdu : le fichier ET sa référence
      // sont intacts, le passage suivant réessaiera.
      echecs.push({ path: objet.path, etape: "base", message: erreurBase.message });
      console.error(
        `${PREFIXE_LOG} échec nettoyage DB ${objet.path} : ${erreurBase.message} — fichier CONSERVÉ`,
      );
      continue;
    }

    const lignes = (nettoyees ?? []).length;
    if (lignes === 0) {
      // La vidéo a été remplacée entre l'inventaire et maintenant. Ce n'est
      // pas une suppression réussie : l'objet n'est plus référencé, donc il
      // relève désormais de la catégorie B — avec sa revalidation.
      expireesRemplaceesEntreTemps += 1;
      rebasculesEnOrphelin.push(objet);
      console.info(`${PREFIXE_LOG} ${objet.path} remplacé depuis l'inventaire — bascule en orphelin`);
      continue;
    }
    referencesNettoyees += lignes;

    // 2. Le fichier, maintenant que plus rien ne le désigne.
    const { error: erreurStorage } = await seau.remove([objet.path]);
    if (erreurStorage) {
      // La référence est levée, le fichier est là : c'est un ORPHELIN, pas
      // une référence cassée. Il partira en catégorie B au passage suivant.
      // On ne recrée JAMAIS la référence — elle pointerait vers un objet que
      // l'on vient précisément de décider d'effacer.
      expireesDereferenceesSansSuppression += 1;
      echecs.push({ path: objet.path, etape: "storage", message: erreurStorage.message });
      console.error(
        `${PREFIXE_LOG} échec Storage ${objet.path} : ${erreurStorage.message} — référence déjà levée, ` +
          "l'objet est devenu orphelin et sera repris au passage suivant",
      );
      continue;
    }
    expireesSupprimees += 1;
    journaliser(objet, "expired_reference");

    // PREMIER FILET. Entre l'UPDATE et le `remove`, un vieil onglet a pu
    // renvoyer le formulaire et réécrire ce chemin. Le fichier vient d'être
    // effacé : toute référence réapparue pendant cette fenêtre pointe
    // désormais dans le vide. On rejoue donc le même UPDATE conditionnel.
    // Idempotent : dans le cas normal, il ne touche aucune ligne.
    const { data: reapparues, error: erreurReprise } = await supabase
      .from("exercise_feedback")
      .update({ video_path: null })
      .eq("video_path", objet.path)
      .select("id");
    if (erreurReprise) {
      // La réconciliation de fin de passage — ou celle du passage suivant —
      // rattrapera : l'objet n'existe plus, donc toute référence qui le
      // désigne sera détectée comme cassée.
      echecs.push({ path: objet.path, etape: "base", message: erreurReprise.message });
      console.error(
        `${PREFIXE_LOG} échec du nettoyage post-suppression ${objet.path} : ${erreurReprise.message} — ` +
          "la réconciliation reprendra",
      );
    } else if ((reapparues ?? []).length > 0) {
      referencesNettoyees += reapparues!.length;
      console.warn(
        `${PREFIXE_LOG} référence réapparue puis levée pour ${objet.path} ` +
          `(${reapparues!.length} ligne(s)) — course avec une resoumission`,
      );
    }
  }

  // ── B. LES ORPHELINS ──────────────────────────────────────────────────
  for (const objet of [...orphelins, ...rebasculesEnOrphelin]) {
    if (!retenus.has(objet.path)) continue;

    // REVALIDATION. Entre l'inventaire et maintenant, un élève a pu envoyer
    // le retour qui adopte ce fichier. Sans ce second regard, la purge
    // effacerait une vidéo qui vient d'être rattachée.
    if (await estEncoreReference(supabase, objet.path)) {
      orphelinsEpargnesParRevalidation += 1;
      console.info(`${PREFIXE_LOG} épargné ${objet.path} — référencé depuis l'inventaire`);
      continue;
    }

    const { error } = await seau.remove([objet.path]);
    if (error) {
      echecs.push({ path: objet.path, etape: "storage", message: error.message });
      console.error(`${PREFIXE_LOG} échec Storage ${objet.path} : ${error.message}`);
      continue;
    }
    orphelinsSupprimes += 1;
    journaliser(objet, "orphan");
  }

  // ── C. RÉCONCILIATION — le filet différé ──────────────────────────────
  // On relit les références MAINTENANT (pas celles du début du passage) et
  // on cherche celles qui désignent un objet réellement absent : c'est la
  // signature d'une course perdue, ou d'un nettoyage post-suppression qui a
  // échoué. Elle rattrape aussi les passages précédents.
  let reconciliationExecutee = false;
  let referencesCasseesDetectees = 0;
  let referencesCasseesNettoyees = 0;
  let erreursReconciliation = 0;

  if (!inventaireComplet || !lectureReferences.complet) {
    // ON NE CONCLUT PAS DEPUIS UNE INFORMATION PARTIELLE. Un listing
    // incomplet ferait passer des fichiers bien présents pour disparus, et
    // la « réparation » effacerait des références valides.
    console.warn(
      `${PREFIXE_LOG} réconciliation IGNORÉE — inventaire incomplet ` +
        `(storage=${inventaireComplet}, références=${lectureReferences.complet})`,
    );
  } else {
    reconciliationExecutee = true;
    // Ce qui existe VRAIMENT après ce passage : l'inventaire, moins ce qu'on
    // vient d'effacer.
    const supprimesCePassage = new Set(suppressions.map((s) => s.path));
    const existants = new Set(objets.map((o) => o.path).filter((p) => !supprimesCePassage.has(p)));

    const { lignes: referencesFinales, complet: relectureComplete } = await lireReferences(supabase);
    if (!relectureComplete) {
      erreursReconciliation += 1;
      reconciliationExecutee = false;
      console.warn(`${PREFIXE_LOG} réconciliation INTERROMPUE — relecture des références en erreur`);
    } else {
      const cassees = new Map<string, ReferenceVideo>();
      for (const reference of referencesFinales) {
        if (existants.has(reference.videoPath)) continue;
        // Garde-fou : un rattachement tout frais peut désigner un fichier
        // déposé APRÈS l'inventaire. Il n'est pas cassé, il est juste plus
        // récent que notre photographie du bucket.
        const rattacheLe = reference.videoUploadedAt ? Date.parse(reference.videoUploadedAt) : null;
        if (rattacheLe !== null && maintenant - rattacheLe < FEEDBACK_VIDEO_RECONCILIATION_GRACE_MS) {
          continue;
        }
        cassees.set(reference.videoPath, reference);
      }
      referencesCasseesDetectees = cassees.size;

      for (const chemin of cassees.keys()) {
        const { data: nettoyees, error } = await supabase
          .from("exercise_feedback")
          .update({ video_path: null })
          .eq("video_path", chemin)
          .select("id");
        if (error) {
          erreursReconciliation += 1;
          echecs.push({ path: chemin, etape: "base", message: error.message });
          console.error(`${PREFIXE_LOG} échec réconciliation ${chemin} : ${error.message}`);
          continue;
        }
        referencesCasseesNettoyees += (nettoyees ?? []).length;
        console.warn(
          `${PREFIXE_LOG} référence cassée nettoyée : ${chemin} ` +
            `(${(nettoyees ?? []).length} ligne(s)) — l'objet n'existe plus dans le bucket`,
        );
      }
    }
  }

  const bilan: BilanPurge = {
    demarreA: new Date(debut).toISOString(),
    termineA: new Date().toISOString(),
    dureeMs: Date.now() - debut,
    objetsInventories: objets.length,
    expireesDetectees: expirees.length,
    expireesSupprimees,
    referencesNettoyees,
    expireesDereferenceesSansSuppression,
    expireesRemplaceesEntreTemps,
    orphelinsDetectes: orphelins.length,
    orphelinsSupprimes,
    orphelinsEpargnesParRevalidation,
    cheminsMalformes,
    reconciliationExecutee,
    referencesCasseesDetectees,
    referencesCasseesNettoyees,
    erreursReconciliation,
    reportesAuProchainPassage: bornees.reportes,
    echecs,
    suppressions,
  };

  console.info(
    `${PREFIXE_LOG} fin — inventaire=${bilan.objetsInventories} expirées=${bilan.expireesDetectees}/${bilan.expireesSupprimees} ` +
      `références_nettoyées=${bilan.referencesNettoyees} déréférencées_non_supprimées=${bilan.expireesDereferenceesSansSuppression} ` +
      `remplacées_entre_temps=${bilan.expireesRemplaceesEntreTemps} orphelins=${bilan.orphelinsDetectes}/${bilan.orphelinsSupprimes} ` +
      `épargnés=${bilan.orphelinsEpargnesParRevalidation} malformés=${bilan.cheminsMalformes.length} ` +
      `reportés=${bilan.reportesAuProchainPassage} réconciliation=${bilan.reconciliationExecutee ? "oui" : "ignorée"} ` +
      `références_cassées=${bilan.referencesCasseesDetectees}/${bilan.referencesCasseesNettoyees} ` +
      `erreurs_réconciliation=${bilan.erreursReconciliation} échecs=${bilan.echecs.length} durée=${bilan.dureeMs}ms`,
  );
  if (bilan.cheminsMalformes.length > 0) {
    // AVERTISSEMENT, pas échec : ces objets ne bloquent rien, ils demandent
    // un coup d'œil humain. Ils ne font donc pas échouer le cron.
    console.warn(`${PREFIXE_LOG} chemins non traités, NON supprimés : ${bilan.cheminsMalformes.join(", ")}`);
  }
  for (const echec of bilan.echecs) {
    console.error(`${PREFIXE_LOG} échec ${echec.etape} sur ${echec.path} : ${echec.message}`);
  }

  return bilan;
}

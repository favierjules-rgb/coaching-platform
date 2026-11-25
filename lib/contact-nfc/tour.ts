import "server-only";

import type { CoachHts, IdentifiantCoachHts } from "@/lib/contact-nfc/config";
import { coachDuCompteur, NOMBRE_COACHS_HTS, rangDuCoach } from "@/lib/contact-nfc/rotation";

/**
 * COMPTEUR DU TOUR DE RÔLE Jules / Yoann — serveur uniquement.
 *
 * Un seul entier, partagé par tous les visiteurs : `compteur % 2` désigne le
 * coach dont c'est le tour. Il n'avance QUE lorsqu'un visiteur ouvre
 * l'application SMS (le simple scan ne compte pas — décision du 25/11/2026).
 *
 * ⚠️ AUCUNE DONNÉE PERSONNELLE. Le magasin ne contient qu'un entier. Ni
 * numéro, ni IP (l'IP sert seulement, de façon transitoire, à la limitation
 * de fréquence existante de `lib/security/rate-limit.ts`).
 *
 * ⚠️ L'AVANCE EST CONDITIONNELLE ET ATOMIQUE. Le navigateur signale « j'ai
 * ouvert le SMS de Jules ». Le tour n'avance que si c'était bien le tour de
 * Jules : un double appui, un rejeu réseau, ou deux visiteurs qui ouvrent la
 * page au même instant ne font avancer le tour qu'UNE fois. Sur Upstash, la
 * comparaison et l'incrément tiennent dans un script Lua exécuté d'un bloc
 * par Redis ; aucun autre client ne peut s'intercaler.
 *
 * ⚠️ LE SITE NE SAIT PAS SI LE SMS EST PARTI. Il compte des OUVERTURES de
 * l'application SMS, pas des envois : une ouverture suivie d'une annulation
 * fait quand même avancer le tour. Limite assumée, la seule mesurable.
 */

export interface ResultatAvance {
  /** Valeur du compteur APRÈS l'opération. */
  compteur: number;
  /** `true` si le tour a effectivement avancé. */
  avance: boolean;
}

export interface MagasinTour {
  nom: "upstash" | "memoire";
  lireCompteur(): Promise<number>;
  /** Avance le compteur de 1 si `compteur % nombre === rangAttendu`, sinon ne fait rien. */
  avancerSi(rangAttendu: number, nombre: number): Promise<ResultatAvance>;
}

/** Clé du compteur — distincte des clés `rl:*` de la limitation de fréquence. */
export const CLE_COMPTEUR_TOUR = "contact_nfc:tour";

/**
 * Comparaison + incrément, exécutés atomiquement par Redis.
 * `GET` rend `false` (Lua) pour une clé absente : le compteur démarre à 0,
 * c'est-à-dire au tour de Jules.
 */
export const SCRIPT_AVANCER_SI = [
  "local n = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if n % tonumber(ARGV[2]) == tonumber(ARGV[1]) then",
  "  n = redis.call('INCR', KEYS[1])",
  "  return {n, 1}",
  "end",
  "return {n, 0}",
].join("\n");

function compteurValide(valeur: unknown): number {
  const nombre = typeof valeur === "string" ? Number(valeur) : valeur;
  if (typeof nombre !== "number" || !Number.isSafeInteger(nombre) || nombre < 0) {
    throw new Error("Réponse du compteur de tour illisible.");
  }
  return nombre;
}

/* ─────────────── Magasin mémoire (développement, tests, repli) ─────────────── */

/**
 * Compteur en mémoire de processus.
 * ⚠️ NON PARTAGÉ ENTRE INSTANCES SERVERLESS : en production, il ne sert que
 * de repli si Upstash n'est pas configuré, et l'alternance n'est alors
 * garantie qu'au sein d'une même instance. Le repli est journalisé.
 */
export function creerMagasinMemoire(depart = 0): MagasinTour {
  let compteur = compteurValide(depart);
  return {
    nom: "memoire",
    async lireCompteur() {
      return compteur;
    },
    async avancerSi(rangAttendu, nombre) {
      if (compteur % nombre === rangAttendu) {
        compteur += 1;
        return { compteur, avance: true };
      }
      return { compteur, avance: false };
    },
  };
}

/* ─────────────── Magasin Upstash (production) ─────────────── */

/** Exécute UNE commande Redis et rend son champ `result`. */
export type ExecuteurRedis = (commande: string[]) => Promise<unknown>;

/**
 * Client REST Upstash minimal : même magasin, mêmes variables
 * (`UPSTASH_REDIS_REST_URL` / `_TOKEN`) et même choix « sans dépendance npm »
 * que `lib/security/rate-limit.ts`.
 */
export function executeurUpstash(url: string, jeton: string, fetchImpl: typeof fetch = fetch): ExecuteurRedis {
  return async (commande) => {
    const reponse = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify(commande),
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });
    if (!reponse.ok) throw new Error(`Upstash a répondu ${reponse.status}.`);
    const contenu = (await reponse.json()) as { result?: unknown; error?: string };
    if (contenu.error) throw new Error("Upstash a refusé la commande.");
    return contenu.result ?? null;
  };
}

export function creerMagasinUpstash(executer: ExecuteurRedis): MagasinTour {
  return {
    nom: "upstash",
    async lireCompteur() {
      const valeur = await executer(["GET", CLE_COMPTEUR_TOUR]);
      return valeur === null ? 0 : compteurValide(valeur);
    },
    async avancerSi(rangAttendu, nombre) {
      const valeur = await executer([
        "EVAL",
        SCRIPT_AVANCER_SI,
        "1",
        CLE_COMPTEUR_TOUR,
        String(rangAttendu),
        String(nombre),
      ]);
      if (!Array.isArray(valeur) || valeur.length !== 2) {
        throw new Error("Réponse du script de tour illisible.");
      }
      return { compteur: compteurValide(valeur[0]), avance: compteurValide(valeur[1]) === 1 };
    },
  };
}

/* ─────────────── Choix du magasin ─────────────── */

let magasinMemoireDuProcessus: MagasinTour | null = null;
let repliSignale = false;

/** Upstash s'il est configuré, sinon la mémoire du processus. */
export function magasinDuTour(): MagasinTour {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const jeton = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (url && jeton) return creerMagasinUpstash(executeurUpstash(url, jeton));

  if (process.env.NODE_ENV === "production" && !repliSignale) {
    repliSignale = true;
    console.error("[ContactNfc] Upstash non configuré : tour de rôle en mémoire, non partagé entre instances.");
  }
  magasinMemoireDuProcessus ??= creerMagasinMemoire();
  return magasinMemoireDuProcessus;
}

/** Réinitialise le compteur mémoire — réservé aux tests. */
export function reinitialiserTourMemoire(): void {
  magasinMemoireDuProcessus = null;
}

/* ─────────────── Opérations ─────────────── */

/** Coach dont c'est le tour, sans rien faire avancer. */
export async function lireTour(magasin: MagasinTour): Promise<CoachHts> {
  return coachDuCompteur(await magasin.lireCompteur());
}

/**
 * Le visiteur a ouvert l'application SMS vers `coach`. Le tour avance si
 * c'était bien le tour de ce coach ; dans tous les cas, on rend le coach dont
 * c'est désormais le tour.
 */
export async function signalerOuverture(
  magasin: MagasinTour,
  coach: IdentifiantCoachHts,
): Promise<{ prochain: CoachHts; avance: boolean }> {
  const { compteur, avance } = await magasin.avancerSi(rangDuCoach(coach), NOMBRE_COACHS_HTS);
  return { prochain: coachDuCompteur(compteur), avance };
}

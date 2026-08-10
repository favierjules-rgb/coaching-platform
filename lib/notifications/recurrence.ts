/**
 * QUAND UNE CAMPAGNE DOIT PARTIR — ET POURQUOI 08:00 RESTE 08:00.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE PIÈGE QUE CE MODULE EXISTE POUR ÉVITER
 * ════════════════════════════════════════════════════════════════════════
 * « Chaque lundi à 08:00 » n'est pas un intervalle. Ajouter sept jours en
 * millisecondes à une échéance donne 07:00 ou 09:00 après le changement
 * d'heure — l'élève reçoit son rappel de poids une heure trop tôt pendant
 * six mois, et personne ne le signale.
 *
 * La règle est donc stockée en heure LOCALE (`hour`, `minute`, fuseau de la
 * campagne) et l'échéance suivante est RECALCULÉE à partir du calendrier de
 * ce fuseau, jamais par addition d'une durée.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUNE DÉPENDANCE
 * ════════════════════════════════════════════════════════════════════════
 * `Intl.DateTimeFormat` connaît déjà la base de données des fuseaux — y
 * compris les changements d'heure passés et à venir. On lui demande l'heure
 * locale d'un instant, et on en déduit le décalage. Rien d'autre n'est
 * nécessaire, et surtout pas une bibliothèque de dates de plus.
 */

export type FrequenceRecurrence = "daily" | "weekly" | "monthly";

export interface RegleRecurrence {
  freq: FrequenceRecurrence;
  /**
   * Jours ISO : 1 = lundi … 7 = dimanche. Utilisé par `weekly`.
   * « Certains jours » n'est pas une quatrième fréquence : c'est `weekly`
   * avec plusieurs jours.
   */
  weekdays?: number[];
  /** Jour du mois 1..31, utilisé par `monthly`. */
  monthday?: number;
  hour: number;
  minute: number;
}

export const FUSEAU_PAR_DEFAUT = "Europe/Paris";

/** Les fuseaux acceptés. Une campagne n'a aucune raison d'en viser un autre. */
export const FUSEAUX_AUTORISES = [FUSEAU_PAR_DEFAUT] as const;

function entierDans(valeur: unknown, min: number, max: number): number | null {
  if (typeof valeur !== "number" || !Number.isInteger(valeur)) return null;
  return valeur >= min && valeur <= max ? valeur : null;
}

/**
 * Lit une règle venue de la base ou du navigateur. Tout ce qui n'est pas
 * exactement conforme rend `null` : une règle approximative produirait une
 * échéance approximative, et personne ne s'en apercevrait avant l'envoi.
 */
export function lireRegle(valeur: unknown): RegleRecurrence | null {
  if (!valeur || typeof valeur !== "object") return null;
  const brut = valeur as Record<string, unknown>;

  const freq = brut.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") return null;

  const hour = entierDans(brut.hour, 0, 23);
  const minute = entierDans(brut.minute, 0, 59);
  if (hour === null || minute === null) return null;

  if (freq === "weekly") {
    if (!Array.isArray(brut.weekdays) || brut.weekdays.length === 0) return null;
    const jours: number[] = [];
    for (const j of brut.weekdays) {
      const n = entierDans(j, 1, 7);
      if (n === null || jours.includes(n)) return null;
      jours.push(n);
    }
    return { freq, weekdays: jours.sort((a, b) => a - b), hour, minute };
  }

  if (freq === "monthly") {
    // 1..28 seulement : au-delà, le 31 n'existe pas tous les mois et la
    // campagne sauterait février sans que personne ne l'ait décidé.
    const jour = entierDans(brut.monthday, 1, 28);
    if (jour === null) return null;
    return { freq, monthday: jour, hour, minute };
  }

  return { freq, hour, minute };
}

interface PartiesLocales {
  annee: number;
  mois: number;
  jour: number;
  heure: number;
  minute: number;
  seconde: number;
}

const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: fuseau,
      hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

/** L'heure qu'il est DANS ce fuseau, à cet instant précis. */
export function partiesLocales(fuseau: string, instant: Date): PartiesLocales {
  const parts = formateur(fuseau).formatToParts(instant);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    annee: n("year"), mois: n("month"), jour: n("day"),
    heure: n("hour"), minute: n("minute"), seconde: n("second"),
  };
}

/** Décalage du fuseau à cet instant, en millisecondes (positif à l'est). */
function decalage(fuseau: string, instant: Date): number {
  const p = partiesLocales(fuseau, instant);
  const commeUtc = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
  return commeUtc - instant.getTime();
}

/**
 * L'INSTANT qui correspond à « ce jour-là, à cette heure-là, dans ce fuseau ».
 *
 * Deux passes, et c'est nécessaire : le décalage à appliquer dépend de
 * l'instant qu'on cherche. La première passe donne une approximation, la
 * seconde la corrige avec le décalage réellement en vigueur à ce
 * moment-là — c'est ce qui fait que 08:00 reste 08:00 des deux côtés du
 * changement d'heure.
 *
 * Cas limite assumé : une heure locale qui N'EXISTE PAS (le passage à
 * l'heure d'été supprime 02:00→03:00) est ramenée à l'heure suivante
 * réellement vécue. Aucun de nos rappels ne tombe dans cette fenêtre, et
 * décaler d'une heure vaut mieux que ne pas partir.
 */
export function instantPourHeureLocale(
  fuseau: string,
  annee: number,
  mois: number,
  jour: number,
  heure: number,
  minute: number,
): Date {
  const naif = Date.UTC(annee, mois - 1, jour, heure, minute, 0);
  const premier = naif - decalage(fuseau, new Date(naif));
  const second = naif - decalage(fuseau, new Date(premier));
  return new Date(second);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'une date civile. */
function jourIso(annee: number, mois: number, jour: number): number {
  const j = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay();
  return j === 0 ? 7 : j;
}

function jourSuivant(annee: number, mois: number, jour: number) {
  const d = new Date(Date.UTC(annee, mois - 1, jour + 1));
  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate() };
}

function jourRetenu(regle: RegleRecurrence, annee: number, mois: number, jour: number): boolean {
  if (regle.freq === "daily") return true;
  if (regle.freq === "weekly") return (regle.weekdays ?? []).includes(jourIso(annee, mois, jour));
  return jour === regle.monthday;
}

/**
 * La prochaine échéance STRICTEMENT après `apres`.
 *
 * On parcourt les jours civils du fuseau, pas des intervalles : c'est la
 * seule façon d'obtenir « lundi 08:00 » et non « 168 heures plus tard ».
 * La borne de 400 jours couvre le cas mensuel le plus défavorable ; au-delà
 * il n'y a rien à trouver et boucler serait pire que rendre `null`.
 */
export function prochaineEcheance(
  regle: RegleRecurrence,
  fuseau: string,
  apres: Date,
): Date | null {
  const debut = partiesLocales(fuseau, apres);
  let { annee, mois, jour } = debut;

  for (let i = 0; i < 400; i += 1) {
    if (jourRetenu(regle, annee, mois, jour)) {
      const candidat = instantPourHeureLocale(fuseau, annee, mois, jour, regle.hour, regle.minute);
      if (candidat.getTime() > apres.getTime()) return candidat;
    }
    ({ annee, mois, jour } = jourSuivant(annee, mois, jour));
  }
  return null;
}

/** Résumé lisible d'une règle — « Chaque lundi · 08:00 ». */
export function decrireRegle(regle: RegleRecurrence): string {
  const heure = `${String(regle.hour).padStart(2, "0")}:${String(regle.minute).padStart(2, "0")}`;
  if (regle.freq === "daily") return `Chaque jour · ${heure}`;
  if (regle.freq === "monthly") return `Le ${regle.monthday} de chaque mois · ${heure}`;
  const noms = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
  const jours = (regle.weekdays ?? []).map((j) => noms[j - 1]);
  if (jours.length === 7) return `Chaque jour · ${heure}`;
  const liste = jours.length > 1 ? `${jours.slice(0, -1).join(", ")} et ${jours[jours.length - 1]}` : jours[0];
  return `Chaque ${liste} · ${heure}`;
}

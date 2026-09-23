/**
 * LA RÉFÉRENCE DE PROGRESSION — fonctions PURES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÉFÉRENCE N'EST PAS UNE SÉRIE, C'EST LA MOYENNE DES SÉRIES
 * ════════════════════════════════════════════════════════════════════════
 * Une seule série ne dit pas ce qu'a valu un exercice. Quatre séries à
 * 10 · 11 · 12 · 13 répétitions valent 11,5 en moyenne, soit 12 après
 * arrondi — ni 10 (la première), ni 13 (la dernière).
 *
 * ⚠️ LA MOYENNE PORTE SUR LES SÉRIES RÉELLEMENT ENREGISTRÉES. Une série
 * absente du retour n'est PAS une série à zéro : elle n'existe pas, et
 * l'inclure ferait chuter la moyenne sans qu'aucun effort ne l'explique.
 *
 * ⚠️ AUCUNE DEMI-RÉPÉTITION NE SORT D'ICI. 11,5 devient 12 ; on ne
 * recommande pas un demi-mouvement. L'arrondi est commercial et il est
 * énoncé sans détour : 10,4 → 10 · 10,5 → 11 · 10,6 → 11.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES ANALYSEURS SONT STRICTS, ET C'EST MESURÉ
 * ════════════════════════════════════════════════════════════════════════
 * `parseRepRange` existe déjà dans `lib/training-metrics.ts` et convient très
 * bien à ce pour quoi elle a été écrite : ESTIMER un tonnage. Elle est
 * volontairement permissive — « 6-10, 8-13, 8-13 » lui rend {6, 10} en
 * ignorant le reste, et « 11-10-9 » lui rend {11, 10}, donc un maximum
 * INFÉRIEUR au minimum. Une estimation de volume survit à cela ; une
 * RECOMMANDATION adressée à un élève, non.
 *
 * D'où un analyseur distinct, qui REFUSE ce qu'il ne sait pas lire au lieu
 * d'en deviner la moitié. Mesuré sur les 3 201 exercices en production :
 *   · « N-M »                    2 956 (92,3 %) — accepté ;
 *   · « N » seul                   183 (5,7 %)  — accepté, plage d'un point ;
 *   · liste par série à virgules    54 (1,7 %)  — REFUSÉ, motif nommé ;
 *   · séquence « 11-10-9 »            7        — REFUSÉ, motif nommé ;
 *   · illisible                       2        — REFUSÉ.
 *
 * Même exigence sur les valeurs réalisées. Mesuré sur 1 794 séries :
 * `reps_done` est un entier simple 1 757 fois (97,9 %) ; les rares autres
 * sont du cardio (« Distance 1.4 km », déjà écarté en amont par
 * `isCardioResultEntryName`) ou une saisie libre. `load_used` est numérique
 * 1 740 fois (97,0 %) ; le reste est « Pdc » (poids du corps, non chiffrable
 * par nature) ou ambigu (« 11, 3 », « 6'8 »).
 */
import { getEffectiveLoadKg, parseLoad } from "@/lib/training-metrics";

/** Une plage de répétitions prescrite, bornes incluses. */
export interface PlageReps {
  readonly min: number;
  readonly max: number;
}

export type MotifPlageRefusee =
  /** Champ vide : aucune prescription, donc aucune progression à calculer. */
  | "aucune-prescription"
  /** « 6-10, 8-13, 8-13 » : une plage par série. Laquelle fait référence ? Non tranché. */
  | "plage-par-serie"
  /** « 11-10-9 » : une séquence par série, pas une plage. */
  | "sequence-de-series"
  /** « 13-8 » : maximum inférieur au minimum. */
  | "bornes-inversees"
  /** Ni un nombre, ni une plage — « AMRAP », « au feeling »… */
  | "illisible";

export type PlageLue =
  | { readonly ok: true; readonly plage: PlageReps }
  | { readonly ok: false; readonly motif: MotifPlageRefusee };

/** Espaces de toute nature (insécables compris) repliés en espaces simples. */
function replierEspaces(texte: string): string {
  return texte.replace(/\s+/gu, " ").trim();
}

/**
 * Lit une plage de répétitions prescrite, ou dit précisément pourquoi elle
 * est inexploitable. N'accepte QUE « N » et « N-M », bornes entières.
 *
 * ⚠️ LES DEUX BORNES SONT DES ENTIERS. Une prescription « 8,5-12 » n'a pas de
 * sens pour des répétitions et serait le premier pas vers une demi-rep
 * recommandée.
 */
export function lirePlageReps(texte: string | null | undefined): PlageLue {
  const brut = replierEspaces(texte ?? "");
  if (brut === "") return { ok: false, motif: "aucune-prescription" };
  if (brut.includes(",") || brut.includes(";")) return { ok: false, motif: "plage-par-serie" };

  const morceaux = brut.split("-").map((m) => m.trim());
  if (morceaux.length > 2) return { ok: false, motif: "sequence-de-series" };
  if (!morceaux.every((m) => /^\d+$/.test(m))) return { ok: false, motif: "illisible" };

  const min = Number(morceaux[0]);
  const max = morceaux.length === 2 ? Number(morceaux[1]) : min;
  if (min < 1) return { ok: false, motif: "illisible" };
  if (max < min) return { ok: false, motif: "bornes-inversees" };
  return { ok: true, plage: { min, max } };
}

/**
 * Arrondi commercial d'un nombre de répétitions : 10,4 → 10 · 10,5 → 11 ·
 * 10,6 → 11. Jamais de demi-rep en sortie.
 *
 * ⚠️ `Math.round` FAIT EXACTEMENT CELA POUR UN NOMBRE POSITIF, et les
 * répétitions le sont toujours. L'écrire à la main n'ajouterait qu'un risque.
 */
export function arrondirReps(valeur: number): number {
  return Math.round(valeur);
}

/** Une série réalisée, telle que l'historique la porte (deux champs TEXTE). */
export interface SerieRealisee {
  readonly loadUsed: string;
  readonly repsDone: string;
}

export interface MoyenneReps {
  /** Moyenne arrondie, jamais une demi-rep. */
  readonly reps: number;
  /** Nombre de séries entrées dans la moyenne. */
  readonly seriesRetenues: number;
  /** Séries enregistrées mais dont les répétitions sont illisibles. */
  readonly seriesIgnorees: number;
}

/**
 * Moyenne arrondie des répétitions RÉELLEMENT enregistrées, ou `null` si
 * aucune série n'est chiffrable.
 *
 * ⚠️ UNE SÉRIE ILLISIBLE EST ÉCARTÉE, PAS COMPTÉE À ZÉRO, et le compte des
 * écartées remonte à l'appelant : c'est ce qui lui permet de rester honnête
 * à l'affichage plutôt que de présenter une moyenne partielle comme
 * complète.
 */
export function moyenneRepsRealisees(series: readonly SerieRealisee[]): MoyenneReps | null {
  const valeurs: number[] = [];
  let ignorees = 0;
  for (const serie of series) {
    const brut = replierEspaces(serie.repsDone ?? "");
    if (brut === "") continue; // série non renseignée : elle n'existe pas.
    if (!/^\d+$/.test(brut)) {
      ignorees += 1;
      continue;
    }
    valeurs.push(Number(brut));
  }
  if (valeurs.length === 0) return null;
  const somme = valeurs.reduce((total, v) => total + v, 0);
  return {
    reps: arrondirReps(somme / valeurs.length),
    seriesRetenues: valeurs.length,
    seriesIgnorees: ignorees,
  };
}

export type MotifChargeRefusee =
  /** Aucune série ne porte de charge chiffrable (poids du corps, élastique, vide). */
  | "charge-non-chiffrable"
  /** Les séries n'ont pas toutes la même charge : laquelle fait référence ? Non tranché. */
  | "charge-non-constante";

export type ChargeLue =
  | { readonly ok: true; readonly kg: number }
  | { readonly ok: false; readonly motif: MotifChargeRefusee };

/**
 * La charge de référence d'un exercice sur une séance.
 *
 * ⚠️ ELLE EXIGE UNE CHARGE CONSTANTE SUR LES SÉRIES CHIFFRABLES. La règle
 * énoncée raisonne sur une charge unique (« 10 kg × 12 »), et rien ne dit
 * quoi faire de 10 kg puis 12,5 kg dans la même série d'exercices : prendre
 * la plus lourde, la plus légère ou la moyenne sont trois décisions produit
 * différentes. On refuse donc, en nommant le motif, au lieu d'en choisir une.
 *
 * Les séries sans charge chiffrable sont ignorées — pas comptées à 0 kg.
 */
export function chargeDeReference(series: readonly SerieRealisee[]): ChargeLue {
  const charges: number[] = [];
  for (const serie of series) {
    const kg = getEffectiveLoadKg(parseLoad(serie.loadUsed ?? ""));
    if (kg !== null && kg > 0) charges.push(kg);
  }
  if (charges.length === 0) return { ok: false, motif: "charge-non-chiffrable" };
  const premiere = charges[0];
  if (charges.some((kg) => kg !== premiere)) return { ok: false, motif: "charge-non-constante" };
  return { ok: true, kg: premiere };
}

export interface ReferenceDeProgression {
  readonly chargeKg: number;
  readonly reps: number;
  readonly seriesRetenues: number;
  readonly seriesIgnorees: number;
}

export type MotifReferenceRefusee = MotifChargeRefusee | "aucune-serie-chiffrable";

export type ReferenceLue =
  | { readonly ok: true; readonly reference: ReferenceDeProgression }
  | { readonly ok: false; readonly motif: MotifReferenceRefusee };

/* ═══════════════════════════════════════════════════════════════════════
 * RÉFÉRENCE DE SURCHARGE — la charge la plus lourde réellement utilisée
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * LA RÉFÉRENCE QUI SERT À CALCULER LA PROCHAINE SÉANCE.
 *
 * ⚠️ CE N'EST PAS `referenceDeProgression`, ET LES DEUX DOIVENT COEXISTER.
 * `referenceDeProgression` répond à « quelle charge cette séance a-t-elle
 * porté ? » — une question qui n'a pas de réponse quand les séries ne
 * partagent pas la même charge, d'où son refus `charge-non-constante`. C'est
 * ce qu'il faut pour tracer un point sur une courbe. Celle-ci répond à
 * « sur quoi faire progresser l'élève ? », et cette question a une réponse
 * même quand la charge varie : la charge la plus LOURDE qu'il a réellement
 * tenue, et ce qu'il a fait à cette charge.
 *
 * Règle verrouillée le 23/09/2026 sur le cas de référence du propriétaire du
 * projet, prescription 8–13 :
 *
 *     série 1 : 45 kg × 13
 *     série 2 : 45 kg × 14
 *     série 3 : 47 kg × 10
 *
 * La charge la plus lourde est 47 kg ; à cette charge, 10 répétitions ; 10 est
 * dans la plage, donc le moteur rend 47 kg × 11 — exactement le résultat
 * attendu, appliqué ensuite à TOUTES les séries.
 *
 * ⚠️ ELLE GÉNÉRALISE L'ANCIENNE RÈGLE PLUTÔT QUE DE LA CONTREDIRE. Quand la
 * charge est constante, « la plus lourde » est cette charge unique et les
 * séries retenues sont toutes les séries : le résultat est identique à la
 * moyenne de toutes les séries. Mesuré sur 50 kg × 12 / 10 / 8 : les deux
 * règles rendent 50 kg × 10. Aucun comportement validé ne change.
 *
 * ⚠️ LA MOYENNE DE TOUTES LES SÉRIES AURAIT DONNÉ 12 — (13+14+10)/3 = 12,33.
 * Ce n'est pas la règle retenue : une moyenne mélange une performance à 45 kg
 * avec une performance à 47 kg, et fait croire à 12 répétitions sur une charge
 * que l'élève n'a jamais tenue 12 fois.
 */
export function referenceDeSurcharge(series: readonly SerieRealisee[]): ReferenceLue {
  let plusLourde: number | null = null;
  for (const serie of series) {
    const kg = getEffectiveLoadKg(parseLoad(serie.loadUsed ?? ""));
    if (kg === null || kg <= 0) continue;
    if (plusLourde === null || kg > plusLourde) plusLourde = kg;
  }
  if (plusLourde === null) return { ok: false, motif: "charge-non-chiffrable" };

  // Les séries faites À CETTE CHARGE, et elles seules. Une série plus légère
  // ne dit rien de ce que l'élève peut tenir à la charge la plus lourde.
  const aLaPlusLourde = series.filter((serie) => {
    const kg = getEffectiveLoadKg(parseLoad(serie.loadUsed ?? ""));
    return kg !== null && kg === plusLourde;
  });
  const moyenne = moyenneRepsRealisees(aLaPlusLourde);
  if (!moyenne) return { ok: false, motif: "aucune-serie-chiffrable" };

  return {
    ok: true,
    reference: {
      chargeKg: plusLourde,
      reps: moyenne.reps,
      seriesRetenues: moyenne.seriesRetenues,
      seriesIgnorees: moyenne.seriesIgnorees,
    },
  };
}

/**
 * La référence complète d'un exercice sur la séance de référence :
 * « 10 kg × 12 », charge constante et moyenne arrondie des répétitions.
 */
export function referenceDeProgression(series: readonly SerieRealisee[]): ReferenceLue {
  const charge = chargeDeReference(series);
  if (!charge.ok) return { ok: false, motif: charge.motif };
  const moyenne = moyenneRepsRealisees(series);
  if (!moyenne) return { ok: false, motif: "aucune-serie-chiffrable" };
  return {
    ok: true,
    reference: {
      chargeKg: charge.kg,
      reps: moyenne.reps,
      seriesRetenues: moyenne.seriesRetenues,
      seriesIgnorees: moyenne.seriesIgnorees,
    },
  };
}

/**
 * DOUBLE DE BASE POUR N1.2 — LES LISTES D'ALIMENTS DU COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER N'EST PAS UNE COPIE DE `supabase-double.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * L'autre double existe pour la chaîne des retours d'entraînement : il porte
 * les DÉFAUTS de `workout_feedback` / `exercise_feedback` et reproduit leurs
 * TRIGGERS. Il ne connaît ni `upsert`, ni `is`, et son `order` est un no-op
 * (`order: () => chaîne`, ligne 261). Le rendre trirant changerait le résultat
 * de toutes les suites qui l'utilisent déjà : ce serait toucher à un socle
 * partagé pour un besoin qui ne le concerne pas.
 *
 * Ici on reproduit d'AUTRES contraintes, celles de la migration N1.1 — et une
 * en particulier, sans laquelle rien de ce lot ne serait prouvé :
 *
 * ⚠️ `food_list_items_position_unique` N'EST PAS DÉFERRABLE.
 * Mesuré sur la base (`condeferrable = f`). Une permutation écrite en UNE
 * passe échoue donc : poser la position 2 sur A alors que B la détient encore
 * lève `23505`, immédiatement, avant la fin de l'instruction. Ce double
 * VÉRIFIE chaque ligne au moment où elle est écrite, contre l'état courant de
 * la table — c'est exactement ce que fait un index unique non déferrable, et
 * c'est ce qui rend le contrôle négatif N1.2-NC1 capable d'échouer.
 *
 * CE QU'IL REPRODUIT
 *   - `food_lists` : RLS `coach_id = current_coach_id()` en lecture ET en
 *     écriture ; une écriture hors périmètre ne lève pas, elle ne touche
 *     AUCUNE ligne (comportement d'une policy, pas d'une erreur) ;
 *   - `food_list_items` : `unique (list_id, position)` non déferrable,
 *     les deux index uniques partiels d'identité, `position >= 1`, et
 *     l'exclusivité `catalog_food_id` XOR `product_id` ;
 *   - la RLS des items, qui passe par la liste parente ;
 *   - `meal_choice_options` : présente, remplie, et SANS AUCUN LIEN vers
 *     `food_list_items` — c'est la garantie d'instantané de N1.1, et elle se
 *     démontre par l'absence de chemin, pas par un drapeau.
 *
 * CE QU'IL NE REMPLACE PAS
 *   Le vrai PostgreSQL. Les contraintes et les policies font foi dans
 *   `supabase/tests/nutrition_n1_listes_checklist.sql` (102 vérifications).
 *   Ici on prouve le comportement de l'APPLICATION : quelles requêtes la
 *   couche `lib/supabase/food-lists.ts` émet, dans quel ordre, et ce qu'elle
 *   fait des réponses.
 */

export type Ligne = Record<string, unknown>;

export interface ErreurPg {
  readonly code: string;
  readonly message: string;
}

export interface BaseListes {
  /** À passer aux fonctions de `lib/supabase/food-lists.ts`. */
  client: never;
  /** Accès direct à une table, pour préparer un décor ou constater un état. */
  table: (nom: string) => Ligne[];
  /** Le coach que la RLS considère comme connecté. */
  connecter: (coachId: string) => void;
  /** Les positions d'une liste, dans l'ordre de tri. */
  positions: (listId: string) => number[];
  /** Journal des instructions d'écriture émises — `upsert:food_list_items:4`… */
  journal: string[];
  /**
   * Écrit des positions en UNE SEULE passe, sans le détour par 1000.
   * N'existe que pour le contrôle négatif : il doit échouer.
   */
  ecrirePositionsEnUnePasse: (listId: string, idsDansLOrdre: readonly string[]) => ErreurPg | null;
  /**
   * Fait échouer les `fois` prochaines opérations `op` sur `table`.
   *
   * ⚠️ SANS CELA, LES CHEMINS D'ERREUR NE SONT JAMAIS PARCOURUS. Un double qui
   * ne sait que réussir prouve seulement le beau temps : c'est exactement ce
   * qui laissait passer « erreur de lecture rendue comme liste vide ».
   * L'échec est posé AVANT toute écriture — une insertion refusée ne laisse
   * donc aucune ligne, comme en base.
   */
  injecter: (spec: InjectionErreur) => void;
}

export interface InjectionErreur {
  readonly op: "select" | "insert" | "update" | "delete" | "upsert";
  readonly table: string;
  readonly erreur: ErreurPg;
  /** Nombre d'opérations à faire échouer. 1 par défaut. */
  readonly fois?: number;
}

export function creerBaseListes(): BaseListes {
  const tables = new Map<string, Ligne[]>();
  const table = (nom: string) => {
    if (!tables.has(nom)) tables.set(nom, []);
    return tables.get(nom)!;
  };
  const journal: string[] = [];
  const injections: { op: string; table: string; erreur: ErreurPg; reste: number }[] = [];
  let coachCourant = "";
  let compteur = 0;
  const identifiant = (prefixe: string) =>
    `${prefixe}-${String((compteur += 1)).padStart(4, "0")}`;

  /** La RLS de `food_lists`, et par ricochet celle des items. */
  const listeVisible = (listId: unknown): boolean => {
    const liste = table("food_lists").find((l) => l.id === listId);
    return !!liste && liste.coach_id === coachCourant;
  };
  const visible = (nom: string, l: Ligne): boolean => {
    if (nom === "food_lists") return l.coach_id === coachCourant;
    if (nom === "food_list_items") return listeVisible(l.list_id);
    return true; // `food_catalog` et `food_products` sont lisibles par tous.
  };

  /**
   * Les contraintes de `food_list_items`, vérifiées LIGNE À LIGNE contre
   * l'état courant — comme un index unique non déferrable.
   *
   * `sauf` est l'identifiant de la ligne en cours de mise à jour : une ligne
   * ne peut pas entrer en conflit avec elle-même.
   */
  const conflitItem = (candidate: Ligne, sauf: unknown): ErreurPg | null => {
    const aliment = candidate.catalog_food_id ?? null;
    const produit = candidate.product_id ?? null;
    if ((aliment === null) === (produit === null)) {
      return {
        code: "23514",
        message: 'new row violates check constraint "food_list_items_cible_unique"',
      };
    }
    if (typeof candidate.position !== "number" || candidate.position < 1) {
      return {
        code: "23514",
        message: 'new row violates check constraint "food_list_items_position_positive"',
      };
    }
    for (const autre of table("food_list_items")) {
      if (autre.id === sauf) continue;
      if (autre.list_id !== candidate.list_id) continue;
      if (autre.position === candidate.position) {
        return {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "food_list_items_position_unique"',
        };
      }
      if (aliment !== null && autre.catalog_food_id === aliment) {
        return {
          code: "23505",
          message:
            'duplicate key value violates unique index "food_list_items_food_unique"',
        };
      }
      if (produit !== null && autre.product_id === produit) {
        return {
          code: "23505",
          message:
            'duplicate key value violates unique index "food_list_items_product_unique"',
        };
      }
    }
    return null;
  };

  const defauts: Record<string, Ligne> = {
    food_lists: { archived_at: null, created_at: "2026-08-09T10:00:00Z", updated_at: "2026-08-09T10:00:00Z" },
    food_list_items: { catalog_food_id: null, product_id: null, created_at: "2026-08-09T10:00:00Z" },
  };

  function from(nom: string) {
    const état: {
      op: "select" | "insert" | "update" | "delete" | "upsert";
      valeurs?: Ligne | Ligne[];
      filtres: [string, unknown][];
      nuls: [string, unknown][];
      dans: [string, unknown[]][];
      tri?: { colonne: string; croissant: boolean };
      limite?: number;
    } = { op: "select", filtres: [], nuls: [], dans: [] };

    const correspond = (l: Ligne) =>
      état.filtres.every(([c, v]) => l[c] === v) &&
      état.nuls.every(([c, v]) => (v === null ? l[c] === null : l[c] === v)) &&
      état.dans.every(([c, vs]) => vs.includes(l[c]));

    const exécuter = (): { data: Ligne[] | null; error: ErreurPg | null } => {
      const lignes = table(nom);

      // ⚠️ AVANT TOUTE ÉCRITURE. Une opération injectée en échec ne doit rien
      // laisser derrière elle, exactement comme un ordre refusé par la base.
      const injection = injections.find((i) => i.op === état.op && i.table === nom && i.reste > 0);
      if (injection) {
        injection.reste -= 1;
        journal.push(`échec-injecté:${état.op}:${nom}`);
        return { data: null, error: injection.erreur };
      }

      if (état.op === "select") {
        let trouvées = lignes.filter((l) => visible(nom, l) && correspond(l)).map((l) => ({ ...l }));
        if (état.tri) {
          const { colonne, croissant } = état.tri;
          trouvées = [...trouvées].sort((a, b) => {
            const x = a[colonne] as string | number;
            const y = b[colonne] as string | number;
            const signe = x === y ? 0 : x < y ? -1 : 1;
            return croissant ? signe : -signe;
          });
        }
        if (état.limite !== undefined) trouvées = trouvées.slice(0, état.limite);
        return { data: trouvées, error: null };
      }

      if (état.op === "insert") {
        const valeurs = Array.isArray(état.valeurs) ? état.valeurs : [état.valeurs ?? {}];
        journal.push(`insert:${nom}:${valeurs.length}`);
        const écrites: Ligne[] = [];
        for (const v of valeurs) {
          // La RLS `with check` : on n'insère pas dans la liste d'un autre.
          if (nom === "food_list_items" && !listeVisible(v.list_id)) {
            return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
          }
          if (nom === "food_lists" && v.coach_id !== coachCourant) {
            return { data: null, error: { code: "42501", message: "new row violates row-level security policy" } };
          }
          const ligne: Ligne = { id: identifiant(nom), ...(defauts[nom] ?? {}), ...v };
          if (nom === "food_list_items") {
            const conflit = conflitItem(ligne, ligne.id);
            // ⚠️ UNE ERREUR AVORTE TOUT L'ORDRE, comme en base : les lignes
            // déjà posées par cette instruction sont retirées.
            if (conflit) {
              for (const posée of écrites) {
                const i = lignes.indexOf(posée);
                if (i >= 0) lignes.splice(i, 1);
              }
              return { data: null, error: conflit };
            }
          }
          lignes.push(ligne);
          écrites.push(ligne);
        }
        return { data: écrites.map((l) => ({ ...l })), error: null };
      }

      if (état.op === "upsert") {
        const valeurs = Array.isArray(état.valeurs) ? état.valeurs : [état.valeurs ?? {}];
        journal.push(`upsert:${nom}:${valeurs.length}`);
        const avant = lignes.map((l) => ({ ...l }));
        for (const v of valeurs) {
          const existante = lignes.find((l) => l.id === v.id);
          if (existante && !visible(nom, existante)) {
            tables.set(nom, avant);
            return { data: null, error: { code: "42501", message: "row-level security policy" } };
          }
          const candidate: Ligne = existante ? { ...existante, ...v } : { id: identifiant(nom), ...(defauts[nom] ?? {}), ...v };
          if (nom === "food_list_items") {
            const conflit = conflitItem(candidate, candidate.id);
            if (conflit) {
              // Retour à l'état d'avant l'instruction.
              tables.set(nom, avant);
              return { data: null, error: conflit };
            }
          }
          if (existante) Object.assign(existante, v);
          else lignes.push(candidate);
        }
        return { data: [], error: null };
      }

      if (état.op === "update") {
        journal.push(`update:${nom}`);
        const touchées = lignes.filter((l) => visible(nom, l) && correspond(l));
        for (const l of touchées) Object.assign(l, état.valeurs);
        return { data: touchées.map((l) => ({ ...l })), error: null };
      }

      journal.push(`delete:${nom}`);
      const gardées = lignes.filter((l) => !(visible(nom, l) && correspond(l)));
      tables.set(nom, gardées);
      return { data: [], error: null };
    };

    const chaîne: Record<string, unknown> = {
      select: () => chaîne,
      insert(v: Ligne | Ligne[]) { état.op = "insert"; état.valeurs = v; return chaîne; },
      upsert(v: Ligne | Ligne[]) { état.op = "upsert"; état.valeurs = v; return chaîne; },
      update(v: Ligne) { état.op = "update"; état.valeurs = v; return chaîne; },
      delete() { état.op = "delete"; return chaîne; },
      eq(c: string, v: unknown) { état.filtres.push([c, v]); return chaîne; },
      is(c: string, v: unknown) { état.nuls.push([c, v]); return chaîne; },
      in(c: string, v: unknown[]) { état.dans.push([c, v]); return chaîne; },
      order(c: string, o?: { ascending?: boolean }) {
        état.tri = { colonne: c, croissant: o?.ascending !== false };
        return chaîne;
      },
      limit(n: number) { état.limite = n; return chaîne; },
      maybeSingle: () => {
        const { data, error } = exécuter();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      then: (résoudre: (v: { data: Ligne[] | null; error: ErreurPg | null }) => void) =>
        résoudre(exécuter()),
    };
    return chaîne;
  }

  /**
   * L'écriture NAÏVE, celle qui semble évidente et qui échoue.
   * Elle n'est appelée que par le contrôle négatif N1.2-NC1.
   */
  function ecrirePositionsEnUnePasse(
    listId: string,
    idsDansLOrdre: readonly string[],
  ): ErreurPg | null {
    const lignes = table("food_list_items");
    const avant = lignes.map((l) => ({ ...l }));
    for (const [index, id] of idsDansLOrdre.entries()) {
      const ligne = lignes.find((l) => l.id === id);
      if (!ligne || ligne.list_id !== listId) continue;
      const candidate = { ...ligne, position: index + 1 };
      const conflit = conflitItem(candidate, ligne.id);
      if (conflit) {
        tables.set("food_list_items", avant);
        return conflit;
      }
      ligne.position = index + 1;
    }
    return null;
  }

  return {
    client: { from } as never,
    table,
    connecter: (coachId: string) => { coachCourant = coachId; },
    positions: (listId: string) =>
      table("food_list_items")
        .filter((l) => l.list_id === listId)
        .map((l) => l.position as number)
        .sort((a, b) => a - b),
    journal,
    ecrirePositionsEnUnePasse,
    injecter: (spec: InjectionErreur) =>
      injections.push({ op: spec.op, table: spec.table, erreur: spec.erreur, reste: spec.fois ?? 1 }),
  };
}

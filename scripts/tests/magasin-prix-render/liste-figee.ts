import type { EtatListePersistante } from "@/hooks/useListePersistante";

/**
 * LA SEULE FRONTIÈRE INJECTÉE : LA SOURCE DE LA LISTE.
 *
 * `esbuild` substitue ce module à `@/hooks/useListePersistante`. Tout le reste
 * — `ListeDeCoursesPersistante`, `BlocMinimumObserve`, `ChoixMagasinProche`,
 * `useBudgetObserve`, et surtout LE CÂBLAGE ENTRE EUX — est le code de
 * production. C'est ce câblage qui est sous test : le remplacer par une copie
 * dans le harnais reviendrait à tester le harnais.
 *
 * ⚠️ DEUX SITUATIONS, UN SEUL PAQUET. `?sansListe` rejoue le moment où l'élève
 * n'a encore rien généré — celui où le sélecteur de magasin disparaissait.
 * Le mode est lu dans l'URL plutôt que fixé à la compilation : les deux cas
 * jouent ainsi exactement le même code.
 */
export const LISTE_ID = "11111111-2222-4333-8444-555555555555";

function sansListe(): boolean {
  return globalThis.location?.search.includes("sansListe") === true;
}

const COMMUN = {
  chargement: false,
  ok: true,
  enCours: false,
  erreur: null,
  recharger: () => {},
  regenerer: async () => true,
  basculer: async () => true,
  ajouter: async () => true,
  modifier: async () => true,
  supprimer: async () => true,
} as const;

export function useListePersistante(): EtatListePersistante {
  if (sansListe()) {
    // ⚠️ L'ÉTAT EXACT D'UN ÉLÈVE QUI N'A RIEN GÉNÉRÉ : aucune liste, aucune
    // ligne, et `etat: "absente"` — donc aucun identifiant à donner à
    // `useBudgetObserve`, donc aucune lecture des relevés.
    return {
      ...COMMUN,
      liste: null,
      lignes: [],
      progression: { coches: 0, total: 0, libelle: "0 / 0 article" },
      etat: "absente",
    };
  }
  return {
    ...COMMUN,
    liste: {
      id: LISTE_ID,
      debut: "2026-08-17",
      fin: "2026-08-23",
      majLe: "2026-08-17T08:00:00.000Z",
      budgetCents: null,
      lignes: [],
    },
    lignes: [],
    progression: { coches: 0, total: 0, libelle: "0 / 0 article" },
    etat: "a_jour",
  };
}

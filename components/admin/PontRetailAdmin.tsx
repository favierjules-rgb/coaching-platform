"use client";

import { useCallback, useState } from "react";

import { FoodSearchPicker } from "@/components/admin/FoodSearchPicker";
import { NBSP } from "@/lib/nutrition/basis-points";
import type { EtatRapprochement, StatutRevue } from "@/lib/nutrition/pont-retail";
import type { CibleAliment } from "@/lib/supabase/food-lists";

/**
 * COURSES C4.1 — L'ADMINISTRATION DU PONT ALIMENT → PRODUIT RÉEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CET ÉCRAN REMPLACE UNE QUESTION PAR UNE AUTRE
 * ════════════════════════════════════════════════════════════════════════════
 * L'écran C3 demandait :   « quel PRIX pour cet aliment ? »
 * Celui-ci demande :       « quel PRODUIT RÉEL pour cet aliment ? »
 *
 * La différence n'est pas d'ergonomie, elle est de nature. Un prix saisi à la
 * main est une affirmation invérifiable qui vieillit en silence. Un produit
 * rapproché est un fait : il a un code-barres, il existe en rayon, et son prix
 * — quand il en a un — est observé par quelqu'un d'autre, daté, et
 * photographié.
 *
 * ⚠️ IL N'Y A DONC AUCUN CHAMP DE SAISIE MONÉTAIRE DANS CE FICHIER, et son
 * absence est le contrat. Les montants affichés sont des APERÇUS lus chez Open
 * Prices, en lecture seule, avec leur date — jamais un total, jamais une
 * estimation, jamais quelque chose qu'on enregistre.
 *
 * ⚠️ ET AUCUNE RECHERCHE PAR NOM. Les candidats viennent du CODE CIQUAL de
 * l'aliment (`food_catalog.source_ref`, renseigné à 100 % en production).
 * Chercher « beurre » en texte ramènerait du beurre de cacahuète, du beurre de
 * karité et des gâteaux au beurre — et le rapprochement porterait le prix de
 * l'un sur l'autre. Le seul champ texte de l'écran est celui du
 * `FoodSearchPicker`, qui sert à trouver L'ALIMENT, pas le produit.
 */

interface CandidatDTO {
  readonly gtin: string;
  readonly name: string;
  readonly brand: string | null;
  readonly imageUrl: string | null;
  readonly netQuantity: number | null;
  readonly netUnit: "g" | "ml" | null;
  readonly nutritionUnit: "g" | "ml";
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
  readonly prix: {
    readonly statut: "connu" | "aucun" | "indetermine";
    readonly nombre: number;
    readonly nombreCommunity: number;
    readonly observeLe: string | null;
  } | null;
  readonly dejaRapproche: boolean;
}

interface ReponseCandidats {
  readonly aliment: { readonly id: string; readonly name: string; readonly codeCiqual: string | null };
  readonly etat: EtatRapprochement;
  readonly produitsLies: readonly { readonly gtin: string; readonly name: string }[];
  readonly candidats: readonly CandidatDTO[];
  readonly nonImportables: readonly {
    readonly gtin: string | null;
    readonly name: string | null;
    readonly raison: string;
  }[];
  readonly totalOff: number;
  readonly sansCodeCiqual?: boolean;
  readonly prixIndisponibles?: boolean;
  readonly attribution?: { readonly text?: string };
}

const LIBELLE_ETAT: Record<EtatRapprochement, string> = {
  matched: "Rapproché",
  needs_raw_redirect: "Forme cuite — hors flux",
  unsupported: "Hors périmètre",
  needs_review: "À revoir",
  unreviewed: "Jamais examiné",
};

const TON_ETAT: Record<EtatRapprochement, string> = {
  matched: "text-success",
  needs_raw_redirect: "text-warning",
  unsupported: "text-muted-foreground",
  needs_review: "text-warning",
  unreviewed: "text-muted-foreground",
};

export function PontRetailAdmin() {
  const [donnees, setDonnees] = useState<ReponseCandidats | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<{ ton: "ok" | "ko"; texte: string } | null>(null);

  const charger = useCallback(async (catalogFoodId: string) => {
    setEnCours(true);
    setMessage(null);
    setSelection(new Set());
    try {
      const reponse = await fetch(
        `/api/admin/food-bridge/candidates?catalogFoodId=${encodeURIComponent(catalogFoodId)}`,
        { cache: "no-store" },
      );
      const corps = (await reponse.json()) as ReponseCandidats & { error?: string };
      if (!reponse.ok) {
        setDonnees(null);
        setMessage({ ton: "ko", texte: corps.error ?? "Recherche impossible." });
        return;
      }
      setDonnees(corps);
    } catch {
      setDonnees(null);
      setMessage({ ton: "ko", texte: "Recherche impossible." });
    } finally {
      setEnCours(false);
    }
  }, []);

  const choisirAliment = useCallback(
    async (cible: CibleAliment) => {
      // ⚠️ SEUL UN ALIMENT GÉNÉRIQUE A UN CODE CIQUAL. Le `FoodSearchPicker`
      // rend aussi des PRODUITS (identité XOR de N1.2) ; un produit est déjà
      // l'aboutissement du pont, il n'a rien à rapprocher.
      if (cible.type !== "aliment") {
        setDonnees(null);
        setMessage({
          ton: "ko",
          texte: "Choisis un aliment générique : un produit est déjà le bout du pont.",
        });
        return;
      }
      await charger(cible.id);
    },
    [charger],
  );

  const basculer = useCallback((gtin: string) => {
    setSelection((precedente) => {
      const suivante = new Set(precedente);
      if (suivante.has(gtin)) suivante.delete(gtin);
      else suivante.add(gtin);
      return suivante;
    });
  }, []);

  const valider = useCallback(async () => {
    if (!donnees || selection.size === 0) return;
    setEnCours(true);
    setMessage(null);
    try {
      const reponse = await fetch("/api/admin/food-bridge/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogFoodId: donnees.aliment.id, gtins: [...selection] }),
      });
      const corps = (await reponse.json()) as { ok?: boolean; rapproches?: number; error?: string };
      if (!reponse.ok || !corps.ok) {
        setMessage({ ton: "ko", texte: corps.error ?? "Le rapprochement a échoué." });
        return;
      }
      setMessage({
        ton: "ok",
        texte: `${corps.rapproches ?? 0} produit(s) rapproché(s) de « ${donnees.aliment.name} ».`,
      });
      await charger(donnees.aliment.id);
    } finally {
      setEnCours(false);
    }
  }, [donnees, selection, charger]);

  const classer = useCallback(
    async (status: StatutRevue) => {
      if (!donnees) return;
      setEnCours(true);
      setMessage(null);
      try {
        const reponse = await fetch("/api/admin/food-bridge/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ catalogFoodId: donnees.aliment.id, status }),
        });
        const corps = (await reponse.json()) as { ok?: boolean; error?: string };
        if (!reponse.ok || !corps.ok) {
          setMessage({ ton: "ko", texte: corps.error ?? "Enregistrement refusé." });
          return;
        }
        setMessage({ ton: "ok", texte: `Aliment classé « ${LIBELLE_ETAT[status]} ».` });
        await charger(donnees.aliment.id);
      } finally {
        setEnCours(false);
      }
    },
    [donnees, charger],
  );

  return (
    <section className="flex flex-col gap-6 p-4" aria-label="Pont aliment vers produit réel">
      <header className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">PONT PRODUITS</h1>
        <p className="text-sm text-muted-foreground">
          Rattache un aliment du catalogue à des produits <strong>réels</strong>, trouvés par son
          code Ciqual. Aucun prix ne se saisit ici&nbsp;: les montants affichés sont des relevés
          Open&nbsp;Prices, avec leur date.
        </p>
      </header>

      <FoodSearchPicker onChoisir={choisirAliment} dejaPresents={new Set()} occupe={enCours} />

      {message && (
        <p
          className={`text-sm ${message.ton === "ok" ? "text-success" : "text-destructive"}`}
          role={message.ton === "ok" ? "status" : "alert"}
        >
          {message.texte}
        </p>
      )}

      {donnees && (
        <article className="flex flex-col gap-4 rounded-card border border-border bg-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">{donnees.aliment.name}</h2>
            <span className="text-sm text-muted-foreground">
              Ciqual{NBSP}
              {donnees.aliment.codeCiqual ?? "—"} ·{" "}
              <span className={TON_ETAT[donnees.etat]}>{LIBELLE_ETAT[donnees.etat]}</span>
            </span>
          </div>

          {donnees.produitsLies.length > 0 && (
            <p className="text-sm text-success">
              Déjà rapproché à {donnees.produitsLies.length} produit(s)&nbsp;:{" "}
              {donnees.produitsLies.map((p) => p.name).join(" · ")}
            </p>
          )}

          {/*
            ⚠️ AUCUN CODE CIQUAL ⇒ AUCUN CANDIDAT, ET ON LE DIT.
            Il n'existe aucun repli par nom. Le taire ferait croire à une panne
            de recherche, et quelqu'un finirait par en ajouter un.
          */}
          {donnees.sansCodeCiqual ? (
            <p className="text-sm text-warning" role="status">
              Cet aliment n&apos;a pas de code Ciqual exploitable. Aucun rapprochement structuré
              n&apos;est possible, et aucune recherche par nom ne sera tentée.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {donnees.totalOff} produit(s) portent ce code Ciqual en France · {" "}
                {donnees.candidats.length} affiché(s)
                {donnees.prixIndisponibles && (
                  <>
                    {" · "}
                    <span className="text-warning">
                      relevés Open Prices indisponibles (ce n&apos;est pas « aucun prix »)
                    </span>
                  </>
                )}
              </p>

              <ul className="flex flex-col gap-2">
                {donnees.candidats.map((candidat) => (
                  <li
                    key={candidat.gtin}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-panel border border-border p-3"
                  >
                    <label className="flex flex-1 items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 size-5"
                        checked={selection.has(candidat.gtin)}
                        onChange={() => basculer(candidat.gtin)}
                        aria-label={`Rapprocher ${candidat.name}`}
                      />
                      <span className="flex flex-col gap-1">
                        <span className="text-sm font-medium">{candidat.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {candidat.gtin}
                          {candidat.brand && ` · ${candidat.brand}`}
                          {candidat.netQuantity !== null &&
                            ` · ${candidat.netQuantity}${NBSP}${candidat.netUnit ?? ""}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          <ApercuPrixLigne prix={candidat.prix} />
                        </span>
                        {candidat.dejaRapproche && (
                          <span className="text-xs text-success">Déjà rapproché</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>

              {/*
                ⚠️ LES NON-IMPORTABLES SONT MONTRÉS, PAS MASQUÉS.
                `food_products` exige les trois macros en NOT NULL : un produit
                réel dont Open Food Facts ne publie pas la nutrition ne peut pas
                y entrer. Fabriquer des zéros serait un mensonge ; le cacher
                ferait croire à un bug. On le montre, avec sa raison.
              */}
              {donnees.nonImportables.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {donnees.nonImportables.length} candidat(s) réel(s) non importable(s)
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {donnees.nonImportables.map((n, i) => (
                      <li key={`${n.gtin ?? "sans-code"}-${i}`}>
                        {n.name ?? "Produit sans dénomination"} — {n.raison}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => void valider()}
              disabled={enCours || selection.size === 0}
              className="min-h-11 rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-50"
            >
              {enCours ? "Enregistrement…" : `VALIDER ${selection.size || ""}`.trim()}
            </button>
            <button
              type="button"
              onClick={() => void classer("needs_raw_redirect")}
              disabled={enCours}
              className="min-h-11 rounded-pill border border-border px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
            >
              FORME CUITE
            </button>
            <button
              type="button"
              onClick={() => void classer("unsupported")}
              disabled={enCours}
              className="min-h-11 rounded-pill border border-border px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
            >
              HORS PÉRIMÈTRE
            </button>
            <button
              type="button"
              onClick={() => void classer("needs_review")}
              disabled={enCours}
              className="min-h-11 rounded-pill border border-border px-4 py-2 text-sm transition hover:bg-muted disabled:opacity-50"
            >
              À REVOIR
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            Produits&nbsp;: Open Food Facts (ODbL) · Relevés&nbsp;: Open Prices (ODbL). Aucune
            estimation n&apos;est calculée sur cet écran.
          </p>
        </article>
      )}
    </section>
  );
}

/**
 * L'aperçu d'un candidat.
 *
 * ⚠️ QUATRE FORMULATIONS, PARCE QU'IL Y A QUATRE SITUATIONS. « Aucun prix
 * connu » et « on n'a pas pu savoir » ne sont pas la même information, et
 * l'administrateur écarterait un bon candidat sur la seconde s'il lisait la
 * première.
 */
function ApercuPrixLigne({ prix }: { readonly prix: CandidatDTO["prix"] }) {
  if (prix === null) return <>Relevés indisponibles</>;
  if (prix.statut === "indetermine") return <>Relevés non déterminés pour ce lot</>;
  if (prix.statut === "aucun" || prix.nombre === 0) return <>Aucun relevé Open Prices</>;
  return (
    <>
      {prix.nombre} relevé(s) Open Prices
      {prix.nombreCommunity > 0 && ` · ${prix.nombreCommunity} en rayon`}
      {/* La date est TOUJOURS affichée, sans seuil de fraîcheur : masquer un
          relevé de sept mois donnerait « aucun prix ». */}
      {prix.observeLe && ` · dernier le ${prix.observeLe}`}
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { Download, FileJson, Upload } from "lucide-react";

import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import {
  analyzeRecipeImport,
  buildImportTemplate,
  toImportRpcPayload,
  type ImportAnalysis,
} from "@/lib/nutrition/recipe-import";
import type { ImportRecipesResult } from "@/lib/supabase/nutrition-recipes-write";

/**
 * IMPORT DE RECETTES — deux temps, jamais un seul.
 *
 * TEMPS 1 : le fichier est LU, analysé, et RIEN n'est écrit. Le coach voit
 * combien de recettes ont été détectées, lesquelles sont valides, et pour
 * chaque recette refusée la liste exacte de ce qui cloche, ingrédient par
 * ingrédient. Tant qu'il n'a pas cliqué, la base n'a pas bougé d'un octet.
 *
 * TEMPS 2 : sur confirmation seulement, le lot part en UNE transaction.
 *
 * POURQUOI CETTE SÉPARATION. Un import « qui marche » écrit une partie du
 * fichier et laisse le reste de côté, et l'on passe la soirée à comparer un
 * catalogue avec un tableur. Ici, soit tout passe, soit rien — et on sait
 * AVANT lequel des deux va se produire.
 *
 * LES DOUBLONS NE BLOQUENT PAS, ILS SE DÉCOCHENT. Deux recettes peuvent
 * légitimement porter le même nom (« Omelette » de deux façons). On signale,
 * on pré-décoche, et le coach tranche. Rien n'est JAMAIS écrasé : importer un
 * doublon crée une SECONDE recette, il ne remplace pas la première.
 *
 * AUCUNE DÉPENDANCE AJOUTÉE. `File.text()` et `JSON.parse` sont natifs ; le
 * modèle se télécharge via un `Blob` et un `<a download>` — le même procédé
 * que l'export CSV de la newsletter, déjà présent dans le dépôt.
 */
export function RecipeImportDialog({
  onImport,
  disabled = false,
  existingNames,
}: {
  readonly onImport: (payload: { recipes: unknown[] }) => Promise<ImportRecipesResult>;
  readonly disabled?: boolean;
  /** Noms déjà au catalogue du coach — sert UNIQUEMENT à signaler les doublons. */
  readonly existingNames: readonly string[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [nomFichier, setNomFichier] = useState<string | null>(null);
  const [analyse, setAnalyse] = useState<ImportAnalysis | null>(null);
  const [retenues, setRetenues] = useState<ReadonlySet<number>>(new Set());
  const [enCours, setEnCours] = useState(false);
  const [resultat, setResultat] = useState<ImportRecipesResult | null>(null);
  const champFichier = useRef<HTMLInputElement | null>(null);

  function fermer() {
    setOuvert(false);
    setNomFichier(null);
    setAnalyse(null);
    setRetenues(new Set());
    setResultat(null);
    setEnCours(false);
  }

  async function lireFichier(fichier: File) {
    const contenu = await fichier.text();
    const résultat = analyzeRecipeImport(contenu, existingNames);
    setNomFichier(fichier.name);
    setAnalyse(résultat);
    setResultat(null);
    // Pré-sélection : tout ce qui est valide ET non douteux. Les doublons
    // partent décochés — c'est un choix, pas un refus.
    setRetenues(new Set(résultat.recipes.filter((r) => r.valid && !r.duplicate).map((r) => r.line)));
  }

  function basculer(line: number) {
    setRetenues((courant) => {
      const suivant = new Set(courant);
      if (suivant.has(line)) suivant.delete(line);
      else suivant.add(line);
      return suivant;
    });
  }

  async function importer() {
    if (!analyse) return;
    setEnCours(true);
    const résultat = await onImport(toImportRpcPayload(analyse, retenues));
    setEnCours(false);
    setResultat(résultat);
  }

  function téléchargerModèle() {
    const blob = new Blob([buildImportTemplate()], { type: "application/json;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = "modele-import-recettes.json";
    lien.click();
    URL.revokeObjectURL(url);
  }

  const nbRetenues = analyse ? analyse.recipes.filter((r) => retenues.has(r.line)).length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        disabled={disabled}
        className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Upload size={14} />
        Importer un fichier
      </button>

      {ouvert && (
        <Modal title="Importer des recettes" onClose={fermer} maxWidth="max-w-3xl">
          {resultat ? (
            <div className="flex flex-col gap-4">
              {resultat.ok ? (
                <p className="rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success" role="status">
                  {resultat.count} recette{resultat.count > 1 ? "s" : ""} importée
                  {resultat.count > 1 ? "s" : ""} en brouillon, {resultat.ingredients} ingrédient
                  {resultat.ingredients > 1 ? "s" : ""} au total. Rien n&apos;a été publié : relis-les,
                  puis publie celles que tu veux rendre visibles.
                </p>
              ) : (
                <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {resultat.message}
                </p>
              )}
              <div>
                <OutlineButton onClick={fermer}>Fermer</OutlineButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* ── Choix du fichier ─────────────────────────────────── */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => champFichier.current?.click()}
                  className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <FileJson size={14} />
                  {nomFichier ? "Choisir un autre fichier" : "Choisir un fichier JSON"}
                </button>
                <button
                  type="button"
                  onClick={téléchargerModèle}
                  className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Download size={14} />
                  Télécharger le modèle
                </button>
                {nomFichier && <span className="text-xs text-muted-foreground">{nomFichier}</span>}
                <input
                  ref={champFichier}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const fichier = e.target.files?.[0];
                    if (fichier) void lireFichier(fichier);
                    e.target.value = "";
                  }}
                />
              </div>

              {!analyse && (
                <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                  Le fichier sera d&apos;abord ANALYSÉ : rien n&apos;est écrit tant que tu n&apos;as pas
                  confirmé. Le modèle contient deux recettes commentées qui montrent tout ce qui se
                  documente mal — quantité variable, ingrédient fixe, unité comptée, liaison entre
                  ingrédients.
                </p>
              )}

              {/* ── Le diagnostic ────────────────────────────────────── */}
              {analyse?.fileError && (
                <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                  {analyse.fileError}
                </p>
              )}

              {analyse && !analyse.fileError && (
                <>
                  <dl className="grid grid-cols-2 gap-2 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Détectées</dt>
                      <dd className="font-bold text-foreground">{analyse.total}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Valides</dt>
                      <dd className="font-bold text-success">{analyse.valid}</dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">En erreur</dt>
                      <dd className={`font-bold ${analyse.invalid > 0 ? "text-destructive" : "text-foreground"}`}>
                        {analyse.invalid}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">Doublons</dt>
                      <dd className={`font-bold ${analyse.duplicates > 0 ? "text-warning" : "text-foreground"}`}>
                        {analyse.duplicates}
                      </dd>
                    </div>
                  </dl>

                  <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
                    {analyse.recipes.map((recette) => (
                      <li
                        key={recette.line}
                        className="rounded-panel border border-border px-4 py-3 text-sm"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={retenues.has(recette.line)}
                              disabled={!recette.valid}
                              onChange={() => basculer(recette.line)}
                              className="mt-1 h-4 w-4 flex-shrink-0 accent-[var(--primary)]"
                            />
                            <span>
                              <span className="font-bold text-foreground">
                                {recette.name || `Recette ${recette.line}`}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                {recette.ingredientCount} ingrédient
                                {recette.ingredientCount > 1 ? "s" : ""}
                              </span>
                            </span>
                          </label>
                          {recette.duplicate && (
                            <span className="text-xs font-bold uppercase tracking-widest text-warning">
                              Nom déjà utilisé
                            </span>
                          )}
                        </div>
                        {recette.duplicate && (
                          <p className="mt-2 text-xs leading-relaxed text-warning">
                            Une recette portant déjà ce nom existe. Elle ne sera JAMAIS remplacée —
                            coche cette ligne si tu veux quand même en créer une seconde.
                          </p>
                        )}
                        {recette.issues.length > 0 && (
                          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-destructive">
                            {recette.issues.map((problème, i) => (
                              <li key={`${recette.line}-${i}`}>
                                <span className="uppercase tracking-wide">{problème.where}</span> —{" "}
                                {problème.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>

                  <div className="flex flex-wrap items-center gap-3">
                    <PrimaryButton
                      onClick={() => void importer()}
                      disabled={enCours || nbRetenues === 0}
                    >
                      {enCours
                        ? "Import en cours…"
                        : `Importer ${nbRetenues} recette${nbRetenues > 1 ? "s" : ""} en brouillon`}
                    </PrimaryButton>
                    <OutlineButton onClick={fermer}>Annuler</OutlineButton>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tout part en une seule fois : si une seule recette est refusée par la base, AUCUNE
                    n&apos;est créée. Jamais de catalogue à moitié écrit.
                  </p>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";

import { CheckboxField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import {
  RECIPE_FIXTURES,
  describeFixtureImport,
  type FixtureImportReport,
} from "@/lib/nutrition/recipe-fixtures-import";

/**
 * Import EXPLICITE des recettes de démonstration.
 *
 * JAMAIS AUTOMATIQUE. L'import ne part qu'au clic sur « Importer », après
 * confirmation dans cette modale. Aucun `useEffect` ne le déclenche, aucun
 * chargement de page ne l'appelle, et la migration ne l'exécute pas.
 *
 * REJOUABLE. L'identité vient de `source_key` (« fixture:<cle_technique> »),
 * jamais du nom affiché : une recette saisie à la main portant le même nom
 * n'est donc jamais touchée. Par défaut, une fixture déjà importée est
 * IGNORÉE ; la mettre à jour est une case à cocher, décochée.
 */
export function RecipeFixtureImportDialog({
  onImport,
  disabled,
}: {
  onImport: (updateExisting: boolean) => Promise<FixtureImportReport>;
  disabled?: boolean;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [mettreÀJour, setMettreÀJour] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [rapport, setRapport] = useState<FixtureImportReport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  // Numéro de l'import en cours. Fermer la modale l'incrémente : un rapport
  // qui arrive après coup porte un numéro périmé et n'est plus affiché.
  // Sans cela, rouvrir la modale montrait le rapport d'un import abandonné
  // à la place de l'écran de confirmation.
  const tentative = useRef(0);

  function fermer() {
    tentative.current += 1;
    setOuvert(false);
    setRapport(null);
    setErreur(null);
    setEnCours(false);
    setMettreÀJour(false);
  }

  function lancer() {
    const numéro = tentative.current;
    setEnCours(true);
    setErreur(null);
    void onImport(mettreÀJour)
      .then((r) => {
        if (tentative.current === numéro) setRapport(r);
      })
      .catch(() => {
        // Un rejet non traité laissait la modale revenir à l'écran de
        // confirmation SANS le moindre message : l'échec passait pour un
        // clic sans effet.
        if (tentative.current === numéro) {
          setErreur("L'import a échoué. Rien n'a été laissé à moitié écrit — réessaie.");
        }
      })
      .finally(() => {
        if (tentative.current === numéro) setEnCours(false);
      });
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOuvert(true)}
        className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Download size={14} />
        Importer les recettes de démonstration
      </button>

      {ouvert && (
        <Modal title="Importer les recettes de démonstration ?" onClose={fermer} maxWidth="max-w-lg">
          {rapport ? (
            <div className="flex flex-col gap-4">
              <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-foreground">
                {describeFixtureImport(rapport)}
              </p>
              <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {rapport.entries.map((e) => (
                  <li key={e.sourceKey} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-2 last:border-0">
                    <span className="text-foreground">{e.name}</span>
                    <span
                      className={
                        e.outcome === "failed"
                          ? "text-destructive"
                          : e.outcome === "skipped"
                            ? "text-muted-foreground"
                            : "text-success"
                      }
                    >
                      {e.outcome === "imported" && "importée"}
                      {e.outcome === "updated" && "mise à jour"}
                      {e.outcome === "skipped" && "ignorée"}
                      {e.outcome === "failed" && `échec — ${e.message ?? ""}`}
                    </span>
                  </li>
                ))}
              </ul>
              <OutlineButton onClick={fermer}>Fermer</OutlineButton>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {RECIPE_FIXTURES.length} recettes de démonstration seront ajoutées à ton catalogue,
                en <strong className="text-foreground">brouillon</strong>. Elles te servent de point
                de départ : à toi de les compléter, de les étiqueter puis de les activer.
              </p>
              <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Une recette déjà importée est reconnue par sa clé d&apos;origine, jamais par son nom.
                Tes recettes saisies à la main ne sont donc jamais modifiées, même si elles portent
                le même nom.
              </p>
              <CheckboxField
                label="Mettre à jour les recettes de démonstration déjà importées"
                checked={mettreÀJour}
                onChange={setMettreÀJour}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                La mise à jour rafraîchit le nom, le créneau et les ingrédients d&apos;origine. Ton
                statut, ta description et tes étiquettes sont conservés.
              </p>
              {erreur && (
                <p
                  className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {erreur}
                </p>
              )}
              <div className="flex flex-col gap-3">
                <PrimaryButton disabled={enCours} onClick={lancer}>
                  {enCours ? "Import en cours…" : "Importer"}
                </PrimaryButton>
                <OutlineButton onClick={fermer}>Annuler</OutlineButton>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, PencilLine, Search, X } from "lucide-react";

import { NBSP, formatDecimalFr } from "@/lib/nutrition/basis-points";
import {
  CONSUMED_UNIT_LABELS_FR,
  type ConsumedUnit,
  lireMacroPour100,
  lireQuantite,
} from "@/lib/nutrition/consumed";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type CatalogFood,
  searchCatalogFoods,
  unitesAutorisees,
} from "@/lib/supabase/consumed-meals";

/**
 * AJOUTER UN ALIMENT — deux parcours, aucun cul-de-sac.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI LA SAISIE MANUELLE EST UN PARCOURS DE PLEIN DROIT
 * ────────────────────────────────────────────────────────────────────────────
 * `food_catalog` compte ZÉRO ligne en Production (mesuré le 13/08/2026). Un
 * écran qui n'offrirait que la recherche serait donc un écran qui ne rend
 * jamais rien. La saisie manuelle n'est pas un repli caché derrière un lien
 * discret : c'est un onglet de même rang, et c'est aujourd'hui le chemin
 * principal.
 *
 * Quand la recherche ne trouve rien, elle ne s'arrête pas sur « Aucun
 * résultat » : elle propose de saisir l'aliment à la main, en reprenant le
 * terme déjà tapé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN N'ENVOIE JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Aucune macro finale. Pour un aliment du catalogue : (aliment, quantité,
 * unité). Pour un aliment manuel : (libellé, quantité, unité, et les valeurs
 * POUR 100 lues sur l'emballage) — la RÉFÉRENCE, jamais le RÉSULTAT. Le
 * serveur multiplie, applique le 4/4/9 et fige l'instantané.
 *
 * Aucun aperçu chiffré n'est affiché avant l'enregistrement : il serait
 * calculé par le navigateur, donc par une seconde convention, et pourrait ne
 * pas coïncider avec ce que le serveur écrira.
 */

type Onglet = "recherche" | "manuel";

export function AddFoodSheet({
  titreRepas,
  enCours,
  erreur,
  onFermer,
  onAjouterCatalogue,
  onAjouterManuel,
}: {
  titreRepas: string;
  enCours: boolean;
  erreur: string | null;
  onFermer: () => void;
  onAjouterCatalogue: (foodId: string, quantité: number, unité: ConsumedUnit) => Promise<boolean>;
  onAjouterManuel: (
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    protéinesPour100: number,
    glucidesPour100: number,
    lipidesPour100: number,
  ) => Promise<boolean>;
}) {
  const [onglet, setOnglet] = useState<Onglet>("recherche");

  // ── Recherche ────────────────────────────────────────────────────────────
  const [terme, setTerme] = useState("");
  const [résultats, setRésultats] = useState<readonly CatalogFood[]>([]);
  const [cherche, setCherche] = useState(false);
  const [aCherché, setACherché] = useState(false);
  const [choisi, setChoisi] = useState<CatalogFood | null>(null);
  const [quantitéCatalogue, setQuantitéCatalogue] = useState("100");
  const [unitéCatalogue, setUnitéCatalogue] = useState<ConsumedUnit>("g");

  // ── Saisie manuelle ──────────────────────────────────────────────────────
  const [nom, setNom] = useState("");
  const [protéines, setProtéines] = useState("");
  const [glucides, setGlucides] = useState("");
  const [lipides, setLipides] = useState("");
  const [quantitéManuelle, setQuantitéManuelle] = useState("");
  const [unitéManuelle, setUnitéManuelle] = useState<"g" | "ml">("g");

  const requête = useRef(0);

  const chercher = useCallback(async (valeur: string) => {
    const numéro = ++requête.current;
    if (valeur.trim().length < 2) {
      setRésultats([]);
      setACherché(false);
      setCherche(false);
      return;
    }
    setCherche(true);
    try {
      const client = createSupabaseBrowserClient();
      if (!client) {
        setRésultats([]);
        setACherché(true);
        return;
      }
      const trouvés = await searchCatalogFoods(client, valeur);
      if (requête.current !== numéro) return;
      setRésultats(trouvés);
      setACherché(true);
    } catch (e) {
      if (requête.current !== numéro) return;
      console.error("[AddFoodSheet] recherche", e);
      setRésultats([]);
      setACherché(true);
    } finally {
      if (requête.current === numéro) setCherche(false);
    }
  }, []);

  // Anti-rebond : une requête par pause de frappe, pas une par caractère.
  useEffect(() => {
    const minuterie = setTimeout(() => void chercher(terme), 250);
    return () => clearTimeout(minuterie);
  }, [terme, chercher]);

  function basculerVersManuel() {
    setNom(terme.trim());
    setOnglet("manuel");
  }

  // ── VALIDATION ───────────────────────────────────────────────────────────
  // `lireQuantite` et `lireMacroPour100` viennent de lib/nutrition/consumed.ts :
  // un seul lecteur, testable hors React, qui accepte « 1,5 » comme « 1.5 »,
  // refuse « 1,5.2 », et distingue un champ VIDE d'un champ ILLISIBLE. Un
  // `Number("")` vaut 0 : s'appuyer dessus ferait passer un champ oublié pour
  // un zéro délibéré.
  const qCatalogue = lireQuantite(quantitéCatalogue);
  const catalogueValide = choisi !== null && qCatalogue !== null;

  const macroP = lireMacroPour100(protéines);
  const macroG = lireMacroPour100(glucides);
  const macroL = lireMacroPour100(lipides);
  const qManuelle = lireQuantite(quantitéManuelle);
  const manuelValide =
    nom.trim().length > 0 &&
    macroP !== null &&
    macroG !== null &&
    macroL !== null &&
    qManuelle !== null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Ajouter un aliment à ${titreRepas}`}
      className="modal-overlay-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
    >
      <div className="modal-content-scale-in flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-card border border-border bg-card shadow-soft sm:max-w-lg sm:rounded-card">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5 pb-4">
          <div className="min-w-0">
            <h3 className="font-heading text-base font-bold uppercase text-foreground">
              Ajouter un aliment
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{titreRepas}</p>
          </div>
          <button
            type="button"
            onClick={onFermer}
            aria-label="Fermer"
            className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>

        {/* Deux onglets de MÊME RANG : la saisie manuelle n'est pas reléguée. */}
        <div role="tablist" aria-label="Mode d'ajout" className="flex border-b border-border">
          {(
            [
              { clé: "recherche" as const, libellé: "Rechercher", icône: Search },
              { clé: "manuel" as const, libellé: "Saisir à la main", icône: PencilLine },
            ]
          ).map(({ clé, libellé, icône: Icône }) => (
            <button
              key={clé}
              type="button"
              role="tab"
              aria-selected={onglet === clé}
              onClick={() => setOnglet(clé)}
              className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 border-b-2 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                onglet === clé
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icône size={14} />
              {libellé}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {erreur && (
            <div className="mb-4 flex items-start gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{erreur}</span>
            </div>
          )}

          {onglet === "recherche" ? (
            <div className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="recherche-aliment"
                  className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Rechercher dans le catalogue
                </label>
                <input
                  id="recherche-aliment"
                  type="search"
                  value={terme}
                  onChange={(e) => {
                    setTerme(e.target.value);
                    setChoisi(null);
                  }}
                  placeholder="banane, riz, poulet…"
                  className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base text-foreground transition-colors focus:border-primary focus:outline-none"
                />
              </div>

              {choisi ? (
                <FormulaireQuantitéCatalogue
                  aliment={choisi}
                  quantité={quantitéCatalogue}
                  unité={unitéCatalogue}
                  enCours={enCours}
                  valide={catalogueValide}
                  onQuantité={setQuantitéCatalogue}
                  onUnité={setUnitéCatalogue}
                  onRetour={() => setChoisi(null)}
                  onAjouter={() => {
                    if (!catalogueValide || enCours) return;
                    void onAjouterCatalogue(choisi.id, qCatalogue, unitéCatalogue);
                  }}
                />
              ) : cherche ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Recherche…</p>
              ) : résultats.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {résultats.map((aliment) => (
                    <li key={aliment.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setChoisi(aliment);
                          setUnitéCatalogue(unitesAutorisees(aliment)[0]);
                          setQuantitéCatalogue("100");
                        }}
                        className="pressable flex min-h-[56px] w-full flex-col items-start justify-center rounded-control border border-border bg-surface-soft/40 px-3 py-2 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <span className="text-sm font-semibold text-foreground">{aliment.name}</span>
                        <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                          Pour 100{NBSP}
                          {aliment.nutritionUnit} · P{NBSP}
                          {formatDecimalFr(aliment.proteinPer100, 1)} · G{NBSP}
                          {formatDecimalFr(aliment.carbPer100, 1)} · L{NBSP}
                          {formatDecimalFr(aliment.fatPer100, 1)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                /* JAMAIS DE CUL-DE-SAC : que la recherche n'ait rien trouvé ou
                   que rien n'ait encore été tapé, la sortie est la même et elle
                   est offerte, pas cachée. */
                <div className="rounded-panel border border-dashed border-border px-4 py-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    {aCherché
                      ? "Aucun aliment trouvé dans le catalogue."
                      : "Le catalogue se remplit petit à petit. Tu peux saisir n'importe quel aliment toi-même, à partir de son emballage."}
                  </p>
                  <button
                    type="button"
                    onClick={basculerVersManuel}
                    className="pressable mt-4 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-control bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <PencilLine size={14} />
                    {aCherché && terme.trim() ? "Ajouter cet aliment manuellement" : "Saisir un aliment à la main"}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Le texte suit l'unité choisie. Il ne parle NI de serveur, NI
                  d'instantané : ce sont des mots d'architecture, et l'élève n'a
                  pas à connaître l'architecture pour saisir une banane. */}
              <p className="rounded-panel border border-border bg-surface-soft/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                Recopie les valeurs indiquées sur l&apos;emballage{" "}
                <strong className="text-foreground">pour 100&nbsp;{unitéManuelle}</strong>, puis
                renseigne la quantité réellement consommée. Les calculs sont effectués
                automatiquement.
              </p>

              <Champ
                id="manuel-nom"
                label="Nom de l'aliment"
                value={nom}
                onChange={setNom}
                placeholder="Banane"
              />

              <fieldset className="rounded-panel border border-border p-3">
                {/* LA RÉFÉRENCE SUIT L'UNITÉ, sans exception : en g elle vaut
                    pour 100 g, en ml pour 100 ml. Le serveur multiplie par la
                    quantité dans CETTE MÊME unité — 250 ml de valeurs /100 ml
                    donnent × 2,5 — et n'invente aucune densité pour passer de
                    l'une à l'autre. */}
                <legend className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Valeurs pour 100&nbsp;{unitéManuelle}
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  <ChampNombre id="manuel-p" label="Protéines" value={protéines} onChange={setProtéines} />
                  <ChampNombre id="manuel-g" label="Glucides" value={glucides} onChange={setGlucides} />
                  <ChampNombre id="manuel-l" label="Lipides" value={lipides} onChange={setLipides} />
                </div>
              </fieldset>

              <div>
                <label
                  htmlFor="manuel-quantite"
                  className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Quantité consommée ({unitéManuelle})
                </label>
                <div className="flex gap-2">
                  <input
                    id="manuel-quantite"
                    type="text"
                    inputMode="decimal"
                    value={quantitéManuelle}
                    onChange={(e) => setQuantitéManuelle(e.target.value)}
                    placeholder="120"
                    className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none"
                  />
                  <div className="flex flex-shrink-0 gap-1" role="group" aria-label="Unité">
                    {(["g", "ml"] as const).map((u) => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setUnitéManuelle(u)}
                        aria-pressed={unitéManuelle === u}
                        className={`pressable min-h-[48px] w-14 rounded-control border text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                          unitéManuelle === u
                            ? "border-primary bg-primary/10 font-bold text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  // Garde de double soumission EN PLUS de `disabled` : deux
                  // tapes très rapprochées peuvent partir avant que React n'ait
                  // repeint le bouton désactivé. Le hook porte le même garde,
                  // pour que ni l'un ni l'autre ne soit le seul rempart.
                  if (!manuelValide || enCours) return;
                  void onAjouterManuel(
                    nom.trim(),
                    qManuelle,
                    unitéManuelle,
                    macroP,
                    macroG,
                    macroL,
                  );
                }}
                disabled={!manuelValide || enCours}
                className="pressable min-h-[48px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
              >
                {enCours ? "Ajout en cours…" : "Ajouter cet aliment"}
              </button>
              <p className="text-center text-[11px] text-muted-foreground">
                Cet aliment sera marqué « saisi à la main ». Il n&apos;est pas ajouté au catalogue
                partagé.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FormulaireQuantitéCatalogue({
  aliment,
  quantité,
  unité,
  enCours,
  valide,
  onQuantité,
  onUnité,
  onRetour,
  onAjouter,
}: {
  aliment: CatalogFood;
  quantité: string;
  unité: ConsumedUnit;
  enCours: boolean;
  valide: boolean;
  onQuantité: (v: string) => void;
  onUnité: (u: ConsumedUnit) => void;
  onRetour: () => void;
  onAjouter: () => void;
}) {
  // Les unités proposées sont EXACTEMENT celles que le serveur sait convertir.
  // Sans `piece_weight_g`, la pièce n'apparaît pas : proposer un choix qui se
  // fera refuser serait une estimation cachée déguisée en liberté.
  const unités = unitesAutorisees(aliment);
  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">{aliment.name}</p>
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            Pour 100{NBSP}
            {aliment.nutritionUnit} · P{NBSP}
            {formatDecimalFr(aliment.proteinPer100, 1)} · G{NBSP}
            {formatDecimalFr(aliment.carbPer100, 1)} · L{NBSP}
            {formatDecimalFr(aliment.fatPer100, 1)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetour}
          className="flex-shrink-0 text-xs uppercase tracking-widest text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Changer
        </button>
      </div>

      <label
        htmlFor="catalogue-quantite"
        className="mb-2 mt-4 block text-xs uppercase tracking-wide text-muted-foreground"
      >
        Quantité consommée
      </label>
      <div className="flex gap-2">
        <input
          id="catalogue-quantite"
          type="text"
          inputMode="decimal"
          value={quantité}
          onChange={(e) => onQuantité(e.target.value)}
          className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none"
        />
        <div className="flex flex-shrink-0 gap-1" role="group" aria-label="Unité">
          {unités.map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => onUnité(u)}
              aria-pressed={unité === u}
              className={`pressable min-h-[48px] min-w-[56px] rounded-control border px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                unité === u
                  ? "border-primary bg-primary/10 font-bold text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {CONSUMED_UNIT_LABELS_FR[u]}
            </button>
          ))}
        </div>
      </div>
      {unité === "piece" && aliment.pieceWeightG !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          1 pièce = {formatDecimalFr(aliment.pieceWeightG, 0)}
          {NBSP}g, d&apos;après le catalogue.
        </p>
      )}

      <button
        type="button"
        onClick={onAjouter}
        disabled={!valide || enCours}
        className="pressable mt-4 min-h-[48px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
      >
        {enCours ? "Ajout en cours…" : "Ajouter cet aliment"}
      </button>
    </div>
  );
}

function Champ({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base text-foreground transition-colors focus:border-primary focus:outline-none"
      />
    </div>
  );
}

function ChampNombre({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        className="min-h-[48px] w-full rounded-control border border-border bg-background px-3 py-3 text-base tabular-nums text-foreground transition-colors focus:border-primary focus:outline-none"
      />
    </div>
  );
}

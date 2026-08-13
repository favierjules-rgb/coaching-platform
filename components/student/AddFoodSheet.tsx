"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, PencilLine, Package, ScanBarcode, Search, X } from "lucide-react";

import { NBSP, formatDecimalFr } from "@/lib/nutrition/basis-points";
import {
  CONSUMED_UNIT_LABELS_FR,
  type ConsumedUnit,
  kcalFromMacros,
  lireMacroPour100,
  lireQuantite,
} from "@/lib/nutrition/consumed";
import {
  type Fetch,
  hydraterProduit,
  lireProduitParGtin,
  rechercherProduitsExternes,
} from "@/lib/nutrition/produits-client";
import {
  type EchecLookup,
  LIBELLE_ACTION,
  MESSAGE_LOOKUP,
  actionsPourLookup,
} from "@/lib/scan/parcours";
import { ScannerCodeBarres } from "@/components/student/ScannerCodeBarres";
import {
  doitHydrater,
  fusionnerProduits,
  remplacerParFicheHydratee,
  unitesPourAliment,
  unitesPourProduit,
} from "@/lib/nutrition/selection-aliment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type CatalogFood,
  type ProduitLocal,
  searchCachedProducts,
  searchCatalogFoods,
} from "@/lib/supabase/consumed-meals";

/**
 * AJOUTER UN ALIMENT — deux parcours, aucun cul-de-sac.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUI SE PASSE PENDANT LA FRAPPE, ET CE QUI N'ARRIVE JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * La frappe interroge NOTRE base, et elle seule : les 3 330 aliments Ciqual de
 * `food_catalog`, et les produits déjà rencontrés dans `food_products`. Aucun
 * appel sortant, pas un seul.
 *
 * Ce n'est pas une préférence : Open Food Facts limite les recherches à dix
 * par minute et par IP — celle du SERVEUR, partagée par tous les élèves — et
 * sa documentation dit littéralement de ne pas s'en servir au fil de la
 * frappe. Un élève tapant « chocolat » lettre par lettre ferait bannir SETH
 * entier. La recherche des produits en ligne est donc une ACTION, avec un
 * bouton, jamais un effet de bord du clavier.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE TAP SUR UN PRODUIT PEUT DÉCLENCHER UNE HYDRATATION
 * ────────────────────────────────────────────────────────────────────────────
 * Un produit trouvé par son NOM arrive sans `nutrition_data_per` : son unité
 * vaut « g » par défaut — un repli, pas une observation. Si sa fiche complète
 * dit « pour 100 ml », le consommer en grammes écrirait un instantané faux,
 * définitivement. Avant d'ouvrir l'étape quantité, l'écran demande donc la
 * fiche complète (phase 4.1). L'élève ne voit qu'un court « Chargement de la
 * fiche… » ; il n'a pas à connaître cette mécanique.
 *
 * Si la fiche ne peut pas être chargée, le produit N'EST PAS consommable — et
 * la saisie manuelle reste offerte. Mieux vaut dire « pas maintenant » que
 * d'enregistrer 250 g là où il y avait 250 ml.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CET ÉCRAN N'ENVOIE JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * Aucune macro finale. Aliment du catalogue : (aliment, quantité, unité).
 * Produit : (produit, quantité, unité). Aliment manuel : (libellé, quantité,
 * unité, valeurs POUR 100 lues sur l'emballage) — la RÉFÉRENCE, jamais le
 * RÉSULTAT. Le serveur multiplie, applique le 4/4/9 et fige l'instantané.
 */

type Onglet = "recherche" | "manuel";

/** Ce que l'élève a choisi, avant l'étape quantité. */
type Choix =
  | { readonly type: "aliment"; readonly aliment: CatalogFood }
  | { readonly type: "produit"; readonly produit: ProduitLocal };

export function AddFoodSheet({
  titreRepas,
  enCours,
  erreur,
  onFermer,
  onAjouterCatalogue,
  onAjouterProduit,
  onAjouterManuel,
  fetcher,
}: {
  titreRepas: string;
  enCours: boolean;
  erreur: string | null;
  onFermer: () => void;
  onAjouterCatalogue: (foodId: string, quantité: number, unité: ConsumedUnit) => Promise<boolean>;
  onAjouterProduit?: (
    productId: string,
    quantité: number,
    unité: ConsumedUnit,
  ) => Promise<boolean>;
  onAjouterManuel: (
    libellé: string,
    quantité: number,
    unité: "g" | "ml",
    protéinesPour100: number,
    glucidesPour100: number,
    lipidesPour100: number,
  ) => Promise<boolean>;
  /** Injectable pour les tests ; `fetch` du navigateur en production. */
  fetcher?: Fetch;
}) {
  const [onglet, setOnglet] = useState<Onglet>("recherche");

  // ── Recherche ────────────────────────────────────────────────────────────
  const [terme, setTerme] = useState("");
  const [aliments, setAliments] = useState<readonly CatalogFood[]>([]);
  const [produits, setProduits] = useState<readonly ProduitLocal[]>([]);
  const [cherche, setCherche] = useState(false);
  const [aCherché, setACherché] = useState(false);

  // Recherche EXTERNE — état séparé, parce qu'elle n'a ni le même déclencheur
  // ni les mêmes conséquences que la recherche locale.
  const [externeEnCours, setExterneEnCours] = useState(false);
  const [externeFaite, setExterneFaite] = useState(false);
  const [externeIndisponible, setExterneIndisponible] = useState(false);

  const [choix, setChoix] = useState<Choix | null>(null);
  const [hydratation, setHydratation] = useState(false);
  const [échecHydratation, setÉchecHydratation] = useState(false);
  const [quantitéChoix, setQuantitéChoix] = useState("100");
  const [unitéChoix, setUnitéChoix] = useState<ConsumedUnit>("g");

  // ── Scan ─────────────────────────────────────────────────────────────────
  // `sessionScan` est un COMPTEUR, pas un booléen : il sert de `key` au
  // scanner. Chaque ouverture monte donc un composant NEUF — flux, moteur,
  // verrou, état d'erreur, tout repart de zéro. C'est ce qui rend la
  // réouverture après un scan aussi propre que la première fois, sans une
  // seule ligne de remise à zéro à écrire ni à oublier.
  const [scanOuvert, setScanOuvert] = useState(false);
  const [sessionScan, setSessionScan] = useState(0);
  const [scanEnCours, setScanEnCours] = useState(false);
  const [échecScan, setÉchecScan] = useState<EchecLookup | null>(null);

  // ── Saisie manuelle ──────────────────────────────────────────────────────
  const [nom, setNom] = useState("");
  const [protéines, setProtéines] = useState("");
  const [glucides, setGlucides] = useState("");
  const [lipides, setLipides] = useState("");
  const [quantitéManuelle, setQuantitéManuelle] = useState("");
  const [unitéManuelle, setUnitéManuelle] = useState<"g" | "ml">("g");

  const requête = useRef(0);
  // Gardes de double soumission, posés AVANT l'appel : deux tapes très
  // rapprochées peuvent partir avant que React n'ait repeint le bouton
  // désactivé, et `disabled` ne serait alors pas encore posé.
  const externeRef = useRef(false);
  const hydratationRef = useRef(false);

  const appeler: Fetch = useCallback(
    (url, init) => (fetcher ?? ((u, i) => fetch(u, i)))(url, init),
    [fetcher],
  );

  const chercher = useCallback(async (valeur: string) => {
    const numéro = ++requête.current;
    if (valeur.trim().length < 2) {
      setAliments([]);
      setProduits([]);
      setACherché(false);
      setCherche(false);
      return;
    }
    setCherche(true);
    try {
      const client = createSupabaseBrowserClient();
      if (!client) {
        setAliments([]);
        setProduits([]);
        setACherché(true);
        return;
      }
      // Les deux recherches LOCALES partent ensemble : ce sont deux tables,
      // pas deux étapes.
      const [trouvésAliments, trouvésProduits] = await Promise.all([
        searchCatalogFoods(client, valeur),
        searchCachedProducts(client, valeur),
      ]);
      if (requête.current !== numéro) return;
      setAliments(trouvésAliments);
      setProduits(trouvésProduits);
      setACherché(true);
    } catch (e) {
      if (requête.current !== numéro) return;
      console.error("[AddFoodSheet] recherche", e);
      setAliments([]);
      setProduits([]);
      setACherché(true);
    } finally {
      if (requête.current === numéro) setCherche(false);
    }
  }, []);

  // Anti-rebond : une requête par pause de frappe, pas une par caractère. Elle
  // ne vise que NOTRE base — voir l'en-tête.
  useEffect(() => {
    const minuterie = setTimeout(() => void chercher(terme), 250);
    return () => clearTimeout(minuterie);
  }, [terme, chercher]);

  async function chercherLesProduits() {
    if (externeRef.current || externeEnCours) return;
    externeRef.current = true;
    setExterneEnCours(true);
    setExterneIndisponible(false);
    try {
      const { produits: trouvés, indisponible } = await rechercherProduitsExternes(terme, appeler);
      // LES RÉSULTATS LOCAUX NE SONT JAMAIS REMPLACÉS. Les produits externes
      // s'ajoutent, dédoublonnés par identifiant — un produit déjà en cache est
      // le même objet, pas un doublon.
      setProduits((actuels) => fusionnerProduits(actuels, trouvés));
      setExterneIndisponible(indisponible);
      setExterneFaite(true);
    } finally {
      externeRef.current = false;
      setExterneEnCours(false);
    }
  }

  async function choisirProduit(produit: ProduitLocal) {
    setÉchecHydratation(false);
    // Fiche déjà hydratée : aucun appel, on ouvre la quantité tout de suite.
    if (!doitHydrater(produit)) {
      ouvrirQuantitéProduit(produit);
      return;
    }
    if (hydratationRef.current) return;
    hydratationRef.current = true;
    setHydratation(true);
    try {
      const complet = await hydraterProduit(produit.gtin, appeler);
      if (complet) {
        // La fiche complète REMPLACE la fiche partielle dans la liste : l'unité
        // qu'elle établit est la bonne, et un second tap n'appellera plus rien.
        setProduits((actuels) => remplacerParFicheHydratee(actuels, complet));
        ouvrirQuantitéProduit(complet);
      } else {
        // Pas de repli sur la fiche partielle : son unité n'a pas été vérifiée.
        setÉchecHydratation(true);
      }
    } finally {
      hydratationRef.current = false;
      setHydratation(false);
    }
  }

  function ouvrirQuantitéProduit(produit: ProduitLocal) {
    setChoix({ type: "produit", produit });
    setUnitéChoix(produit.nutritionUnit);
    setQuantitéChoix("100");
  }

  function basculerVersManuel() {
    setNom(terme.trim());
    fermerScan();
    setOnglet("manuel");
  }

  /* ── LE SCAN ────────────────────────────────────────────────────────────
   *
   * LE SCANNER EST UNE MÉTHODE DE RECHERCHE, PAS UN TROISIÈME ONGLET.
   *
   * Un onglet supplémentaire raconterait qu'il existe trois façons d'ajouter un
   * aliment. Il en existe deux : le retrouver, ou le saisir. Viser un
   * code-barres est une manière de le retrouver — plus rapide qu'un nom tapé au
   * clavier, mais qui aboutit exactement au même endroit : la fiche produit et
   * son étape quantité.
   */
  function ouvrirScan() {
    setÉchecScan(null);
    setChoix(null);
    setÉchecHydratation(false);
    setSessionScan((n) => n + 1);
    setScanOuvert(true);
  }

  function fermerScan() {
    setScanOuvert(false);
    setScanEnCours(false);
    setÉchecScan(null);
  }

  /**
   * LE GTIN EST ARRIVÉ — et la caméra est DÉJÀ éteinte quand on entre ici.
   *
   * Le scanner l'a arrêtée avant d'appeler, verrou posé : un code-barres reste
   * visible une vingtaine d'images, et sans ce verrou ce seraient vingt appels
   * à la route produit pour un seul geste de l'élève.
   *
   * Un scan aboutit à la MÊME étape quantité qu'un produit choisi dans la
   * liste. Pas de seconde interface produit : ce serait deux endroits à
   * maintenir, et deux occasions de diverger sur l'unité.
   */
  async function traiterGtin(gtin: string) {
    setScanOuvert(false);
    setScanEnCours(true);
    setÉchecScan(null);
    try {
      const issue = await lireProduitParGtin(gtin, appeler);
      if (issue.type === "produit") {
        // La fiche revient de `/api/food-products/{gtin}` : elle est hydratée
        // par construction, son unité est observée et non supposée.
        setProduits((actuels) => fusionnerProduits(actuels, [issue.produit]));
        ouvrirQuantitéProduit(issue.produit);
        return;
      }
      setÉchecScan(issue.type);
    } finally {
      setScanEnCours(false);
    }
  }

  // ── VALIDATION ───────────────────────────────────────────────────────────
  // `lireQuantite` et `lireMacroPour100` viennent de lib/nutrition/consumed.ts :
  // un seul lecteur, testable hors React, qui accepte « 1,5 » comme « 1.5 »,
  // refuse « 1,5.2 », et distingue un champ VIDE d'un champ ILLISIBLE. Un
  // `Number("")` vaut 0 : s'appuyer dessus ferait passer un champ oublié pour
  // un zéro délibéré.
  const qChoix = lireQuantite(quantitéChoix);
  const choixValide = choix !== null && qChoix !== null;

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

  const riensTrouvé = aliments.length === 0 && produits.length === 0;

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
            scanOuvert ? (
              /* LA VUE SCANNER PREND TOUTE LA FEUILLE. Sur un téléphone de
                 375 px, garder le champ de recherche, la liste et les
                 attributions autour d'une image de caméra donnerait un écran
                 illisible et une image minuscule. Le bouton « Fermer » du
                 scanner ramène tout cela.

                 `key={sessionScan}` : chaque ouverture monte un composant NEUF.
                 C'est ce qui garantit la réouverture propre — aucun flux mort
                 réutilisé, aucun verrou resté fermé, aucune erreur d'avant. */
              <ScannerCodeBarres
                key={sessionScan}
                onGtin={(gtin) => void traiterGtin(gtin)}
                onFermer={fermerScan}
                onRechercheParNom={fermerScan}
                onSaisieManuelle={basculerVersManuel}
              />
            ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label
                  htmlFor="recherche-aliment"
                  className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Rechercher un aliment
                </label>
                <input
                  id="recherche-aliment"
                  type="search"
                  value={terme}
                  onChange={(e) => {
                    setTerme(e.target.value);
                    setChoix(null);
                    setExterneFaite(false);
                    setExterneIndisponible(false);
                    setÉchecHydratation(false);
                    setÉchecScan(null);
                  }}
                  placeholder="banane, riz, poulet…"
                  className="min-h-[48px] w-full rounded-control border border-border bg-background px-4 py-3 text-base text-foreground transition-colors focus:border-primary focus:outline-none"
                />
              </div>

              {/* LE SCAN, JUSTE SOUS LE CHAMP. C'est le geste le plus rapide
                  pour un produit emballé : viser vaut mieux que taper une
                  marque au clavier d'une main, l'autre tenant le paquet. */}
              {!choix && !scanEnCours && (
                <button
                  type="button"
                  onClick={ouvrirScan}
                  className="pressable inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control border border-border py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ScanBarcode size={14} />
                  Scanner un code-barres
                </button>
              )}

              {scanEnCours && (
                <p className="py-2 text-center text-sm text-muted-foreground" role="status">
                  Recherche du produit…
                </p>
              )}

              {/* APRÈS UN SCAN QUI N'A PAS ABOUTI — jamais un cul-de-sac.
                  Trois issues, trois messages, et à chaque fois au moins deux
                  gestes possibles. Aucun code HTTP, aucun nom de fournisseur :
                  « 429 » n'apprend rien à quelqu'un debout dans un rayon. */}
              {échecScan && (
                <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface-soft/40 p-4">
                  <p className="text-sm text-foreground">{MESSAGE_LOOKUP[échecScan]}</p>
                  {actionsPourLookup(échecScan).map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => {
                        if (action === "rescanner") ouvrirScan();
                        else if (action === "recherche") setÉchecScan(null);
                        else basculerVersManuel();
                      }}
                      className="pressable inline-flex min-h-[48px] w-full items-center justify-center rounded-control border border-border bg-card py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      {LIBELLE_ACTION[action]}
                    </button>
                  ))}
                </div>
              )}

              {choix ? (
                <FormulaireQuantité
                  choix={choix}
                  quantité={quantitéChoix}
                  unité={unitéChoix}
                  enCours={enCours}
                  valide={choixValide}
                  onQuantité={setQuantitéChoix}
                  onUnité={setUnitéChoix}
                  onRetour={() => setChoix(null)}
                  onAjouter={() => {
                    if (!choixValide || enCours) return;
                    if (choix.type === "aliment") {
                      void onAjouterCatalogue(choix.aliment.id, qChoix, unitéChoix);
                    } else if (onAjouterProduit) {
                      void onAjouterProduit(choix.produit.id, qChoix, unitéChoix);
                    }
                  }}
                />
              ) : (
                <>
                  {hydratation && (
                    <p className="py-2 text-center text-sm text-muted-foreground" role="status">
                      Chargement de la fiche produit…
                    </p>
                  )}
                  {échecHydratation && (
                    <p className="rounded-panel border border-border bg-surface-soft/40 px-4 py-3 text-xs text-muted-foreground">
                      Impossible de charger la fiche complète de ce produit pour l&apos;instant. Tu
                      peux réessayer, ou le saisir à la main depuis son emballage.
                    </p>
                  )}

                  {cherche && aliments.length === 0 && produits.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Recherche…</p>
                  ) : null}

                  {aliments.length > 0 && (
                    <section aria-labelledby="titre-aliments">
                      <h4
                        id="titre-aliments"
                        className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Aliments
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {aliments.map((aliment) => (
                          <li key={aliment.id}>
                            <LigneRésultat
                              nom={aliment.name}
                              secondaire="Aliment générique"
                              unité={aliment.nutritionUnit}
                              p={aliment.proteinPer100}
                              g={aliment.carbPer100}
                              l={aliment.fatPer100}
                              onChoisir={() => {
                                setChoix({ type: "aliment", aliment });
                                setUnitéChoix(unitesPourAliment(aliment)[0]);
                                setQuantitéChoix("100");
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {produits.length > 0 && (
                    <section aria-labelledby="titre-produits">
                      <h4
                        id="titre-produits"
                        className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground"
                      >
                        Produits
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {produits.map((produit) => (
                          <li key={produit.id}>
                            <LigneRésultat
                              nom={produit.name}
                              secondaire={produit.brand ?? "Produit"}
                              unité={produit.nutritionUnit}
                              p={produit.proteinPer100}
                              g={produit.carbPer100}
                              l={produit.fatPer100}
                              imageUrl={produit.imageUrl}
                              désactivé={hydratation}
                              onChoisir={() => void choisirProduit(produit)}
                            />
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* L'ACTION EXTERNE — explicite, jamais déclenchée par la
                      frappe. Elle n'apparaît qu'une fois quelque chose de
                      cherchable tapé, et disparaît une fois faite. */}
                  {terme.trim().length >= 3 && !externeFaite && (
                    <button
                      type="button"
                      onClick={() => void chercherLesProduits()}
                      disabled={externeEnCours}
                      className="pressable inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control border border-border py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Package size={14} />
                      {externeEnCours ? "Recherche des produits…" : "Rechercher aussi les produits"}
                    </button>
                  )}

                  {externeIndisponible && (
                    <p className="text-center text-xs text-muted-foreground">
                      Recherche des produits momentanément indisponible.
                    </p>
                  )}

                  {/* JAMAIS DE CUL-DE-SAC : quoi qu'il arrive, la sortie
                      manuelle est offerte, pas cachée. */}
                  {riensTrouvé && (
                    <div className="rounded-panel border border-dashed border-border px-4 py-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        {!aCherché
                          ? "Cherche un aliment par son nom, ou saisis-le toi-même à partir de son emballage."
                          : externeFaite
                            ? "Aucun produit trouvé."
                            : "Aucun aliment trouvé dans le catalogue."}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={basculerVersManuel}
                    className="pressable inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-control bg-primary px-5 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <PencilLine size={14} />
                    {aCherché && terme.trim()
                      ? "Ajouter cet aliment manuellement"
                      : "Saisir un aliment à la main"}
                  </button>

                  {/* ATTRIBUTION — une fois, en pied de feuille. Open Food
                      Facts publie sa base sous ODbL et exige la mention et le
                      lien ; l'Anses publie Ciqual sous Licence Ouverte. La
                      répéter sur chaque barre du journal serait juridiquement
                      inutile et visuellement insupportable. */}
                  {(aliments.length > 0 || produits.length > 0) && (
                    <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                      Données génériques : Anses — Table Ciqual 2025.
                      {produits.length > 0 && (
                        <>
                          {" "}
                          Données produits :{" "}
                          <a
                            href="https://openfoodfacts.org"
                            target="_blank"
                            rel="noreferrer noopener"
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            Open Food Facts
                          </a>{" "}
                          (ODbL).
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
            )
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

/**
 * Une ligne de résultat, la même forme pour un aliment et pour un produit.
 *
 * La distinction se lit dans la LIGNE SECONDAIRE — « Aliment générique » ou la
 * marque —, pas dans une mise en page différente : l'élève choisit un aliment,
 * pas une table de base de données.
 */
function LigneRésultat({
  nom,
  secondaire,
  unité,
  p,
  g,
  l,
  imageUrl,
  désactivé,
  onChoisir,
}: {
  nom: string;
  secondaire: string;
  unité: "g" | "ml";
  p: number;
  g: number;
  l: number;
  imageUrl?: string | null;
  désactivé?: boolean;
  onChoisir: () => void;
}) {
  // Les kcal suivent l'unique convention SETH — 4/4/9 — et sont dérivées à
  // l'affichage. Aucune calorie n'est stockée nulle part.
  const kcal = kcalFromMacros(p, g, l);
  return (
    <button
      type="button"
      onClick={onChoisir}
      disabled={désactivé}
      className="pressable flex min-h-[56px] w-full items-center gap-3 rounded-control border border-border bg-surface-soft/40 px-3 py-2 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {imageUrl ? (
        // Vignette DISTANTE : l'image appartient à Open Food Facts sous
        // CC BY-SA, et n'est jamais recopiée dans notre Storage.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 flex-shrink-0 rounded-control object-cover"
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-foreground">{nom}</span>
        <span className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
          {secondaire}
        </span>
        <span className="mt-0.5 text-xs tabular-nums text-muted-foreground">
          {formatDecimalFr(kcal, 0)}
          {NBSP}kcal / 100{NBSP}
          {unité} · P{NBSP}
          {formatDecimalFr(p, 1)} · G{NBSP}
          {formatDecimalFr(g, 1)} · L{NBSP}
          {formatDecimalFr(l, 1)}
        </span>
      </span>
    </button>
  );
}

/**
 * L'étape quantité, UNE seule pour les deux sources.
 *
 * Un aliment générique et un produit se saisissent de la même façon ; les
 * distinguer ici obligerait l'élève à réapprendre un geste qu'il connaît déjà.
 * Seules changent les unités proposées — celles que le serveur sait convertir,
 * et rien d'autre.
 */
function FormulaireQuantité({
  choix,
  quantité,
  unité,
  enCours,
  valide,
  onQuantité,
  onUnité,
  onRetour,
  onAjouter,
}: {
  choix: Choix;
  quantité: string;
  unité: ConsumedUnit;
  enCours: boolean;
  valide: boolean;
  onQuantité: (v: string) => void;
  onUnité: (u: ConsumedUnit) => void;
  onRetour: () => void;
  onAjouter: () => void;
}) {
  const estAliment = choix.type === "aliment";
  const nom = estAliment ? choix.aliment.name : choix.produit.name;
  const secondaire = estAliment ? "Aliment générique" : (choix.produit.brand ?? "Produit");
  const uniténutritionnelle = estAliment
    ? choix.aliment.nutritionUnit
    : choix.produit.nutritionUnit;
  const p = estAliment ? choix.aliment.proteinPer100 : choix.produit.proteinPer100;
  const g = estAliment ? choix.aliment.carbPer100 : choix.produit.carbPer100;
  const l = estAliment ? choix.aliment.fatPer100 : choix.produit.fatPer100;

  // Les unités proposées sont EXACTEMENT celles que le serveur sait convertir.
  // Pour un produit, c'est son unité nutritionnelle et elle seule : proposer
  // des grammes sur une fiche « pour 100 ml » demanderait une densité, et nous
  // n'en inventons aucune — la RPC refuserait de toute façon.
  const unités: readonly ConsumedUnit[] = estAliment
    ? unitesPourAliment(choix.aliment)
    : unitesPourProduit(choix.produit);
  const imageUrl = estAliment ? null : choix.produit.imageUrl;

  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 flex-shrink-0 rounded-control object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{nom}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{secondaire}</p>
            <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
              {formatDecimalFr(kcalFromMacros(p, g, l), 0)}
              {NBSP}kcal / 100{NBSP}
              {uniténutritionnelle} · P{NBSP}
              {formatDecimalFr(p, 1)} · G{NBSP}
              {formatDecimalFr(g, 1)} · L{NBSP}
              {formatDecimalFr(l, 1)}
            </p>
          </div>
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
      {estAliment && unité === "piece" && choix.aliment.pieceWeightG !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          1 pièce = {formatDecimalFr(choix.aliment.pieceWeightG, 0)}
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

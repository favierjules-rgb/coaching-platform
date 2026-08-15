"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Loader2, X } from "lucide-react";

import { Field } from "@/components/admin/AdminFormFields";
import { FoodSearchPicker, cleIdentite } from "@/components/admin/FoodSearchPicker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type CibleAliment,
  type FoodListDetail,
  type FoodListItem,
  ajouterAlimentAListe,
  archiverFoodList,
  definirPortionOverride,
  nomPropre,
  portionEffective,
  renommerFoodList,
  reordonnerFoodList,
  retirerAlimentDeListe,
  uniteDePortion,
} from "@/lib/supabase/food-lists";

/**
 * N1.2 — L'ÉDITEUR D'UNE LISTE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PAS DE BOUTON « ENREGISTRER » POUR LES ALIMENTS, ET C'EST DÉLIBÉRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Ajouter, retirer et réordonner écrivent immédiatement. Un brouillon local
 * qu'il faudrait valider ferait perdre le travail au premier onglet fermé, et
 * obligerait à réconcilier deux ordres — celui de l'écran et celui de la base.
 *
 * Le NOM, lui, a un bouton : c'est une frappe continue, et écrire à chaque
 * lettre enverrait vingt requêtes pour un mot.
 *
 * ⚠️ AUCUNE MACRO, AUCUN RÔLE n'est demandé au coach. Les valeurs affichées
 * sous chaque aliment sont LUES à la source, jamais saisies.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * N1.5.1 — LA SEULE QUANTITÉ QUE LE COACH SAISIT, ET CE QU'ELLE VEUT DIRE
 * ────────────────────────────────────────────────────────────────────────────
 * La PORTION PRÉFÉRÉE n'est pas une quantité à manger : c'est une indication
 * pour le calcul. « À macros égales, approche plutôt 25 g de whey. » Le
 * solveur s'en écarte dès que la cible du repas l'exige, et les plafonds de
 * faisabilité restent prioritaires.
 *
 * ⚠️ ELLE N'EST JAMAIS OBLIGATOIRE. Une liste sans aucune portion fonctionne
 * exactement comme avant N1.5.1 — c'est le cas de toutes les listes
 * existantes, et aucun écran ne réclame de la remplir.
 *
 * ⚠️ ET LE VOCABULAIRE EST CELUI DU COACH. « Portion standard », « portion
 * personnalisée » — jamais « quantité de référence », « coefficient » ni
 * « solveur ».
 */
export function FoodListEditor({
  liste,
  onChange,
}: {
  readonly liste: FoodListDetail;
  readonly onChange: () => Promise<void>;
}) {
  const [nom, setNom] = useState(liste.name);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const dejaPresents = useMemo(
    () =>
      new Set(
        liste.items.map((item) =>
          item.source === "aliment"
            ? cleIdentite({ type: "aliment", id: item.aliment.id })
            : cleIdentite({ type: "produit", id: item.produit.id }),
        ),
      ),
    [liste.items],
  );

  const nomModifie = nomPropre(nom) !== liste.name && nomPropre(nom) !== "";

  const avec = useCallback(
    async (action: (client: NonNullable<ReturnType<typeof createSupabaseBrowserClient>>) => Promise<boolean | string>) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setErreur("Connexion indisponible.");
        return;
      }
      setOccupe(true);
      setErreur(null);
      setInfo(null);
      try {
        const resultat = await action(supabase);
        if (resultat === "deja-present") {
          setInfo("Cet aliment est déjà dans la liste.");
        } else if (resultat === false || resultat === "erreur") {
          setErreur("L'opération n'a pas abouti.");
        }
        await onChange();
      } finally {
        setOccupe(false);
      }
    },
    [onChange],
  );

  const ajouter = useCallback(
    (cible: CibleAliment) => avec((c) => ajouterAlimentAListe(c, liste.id, cible)),
    [avec, liste.id],
  );

  const retirer = useCallback(
    (itemId: string) => avec((c) => retirerAlimentDeListe(c, liste.id, itemId)),
    [avec, liste.id],
  );

  // ⚠️ PAS D'ÉCRITURE À CHAQUE FRAPPE. Le champ portion est un nombre qu'on
  // tape chiffre par chiffre : écrire à chaque touche enverrait « 2 », puis
  // « 25 », puis « 250 ». On valide explicitement, comme le nom de la liste.
  const definirPortion = useCallback(
    (itemId: string, valeur: number | null) => avec((c) => definirPortionOverride(c, itemId, valeur)),
    [avec],
  );

  const deplacer = useCallback(
    (index: number, direction: -1 | 1) => {
      const cible = index + direction;
      if (cible < 0 || cible >= liste.items.length) return;
      const ordre = liste.items.map((i) => i.id);
      [ordre[index], ordre[cible]] = [ordre[cible], ordre[index]];
      return avec((c) => reordonnerFoodList(c, liste.id, ordre));
    },
    [avec, liste.id, liste.items],
  );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {erreur && (
        <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {erreur}
        </p>
      )}
      {info && (
        <p className="rounded-panel border border-border bg-card px-4 py-3 text-sm text-muted-foreground" role="status">
          {info}
        </p>
      )}

      {liste.archivedAt !== null && (
        <p className="rounded-panel border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
          Cette liste est archivée : elle n&apos;est plus proposée quand tu construis un repas.
          Les repas déjà construits à partir d&apos;elle ne changent pas.
        </p>
      )}

      {/* ── LE NOM ───────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="min-w-0 sm:max-w-sm">
          <Field label="Nom de la liste" value={nom} onChange={setNom} disabled={occupe} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!nomModifie || occupe}
            onClick={() => void avec((c) => renommerFoodList(c, liste.id, nom))}
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {occupe && <Loader2 size={14} className="animate-spin" />}
            Renommer
          </button>
          <button
            type="button"
            disabled={occupe}
            onClick={() => void avec((c) => archiverFoodList(c, liste.id, liste.archivedAt === null))}
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {liste.archivedAt === null ? "Archiver" : "Désarchiver"}
          </button>
        </div>
      </section>

      {/* ── LES ALIMENTS ─────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Aliments{" "}
          <span className="font-body text-sm font-normal normal-case text-muted-foreground">
            ({liste.items.length})
          </span>
        </h2>

        {liste.items.length === 0 ? (
          <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Cette liste est vide. Cherche un aliment ci-dessous pour la remplir.
          </p>
        ) : (
          <ol className="flex min-w-0 flex-col gap-1">
            {liste.items.map((item, index) => (
              <LigneAliment
                key={item.id}
                item={item}
                index={index}
                total={liste.items.length}
                occupe={occupe}
                onMonter={() => void deplacer(index, -1)}
                onDescendre={() => void deplacer(index, 1)}
                onRetirer={() => void retirer(item.id)}
                onDefinirPortion={(valeur) => void definirPortion(item.id, valeur)}
              />
            ))}
          </ol>
        )}
      </section>

      <section className="min-w-0 sm:max-w-lg">
        <FoodSearchPicker onChoisir={ajouter} dejaPresents={dejaPresents} occupe={occupe} />
      </section>
    </div>
  );
}

function LigneAliment({
  item,
  index,
  total,
  occupe,
  onMonter,
  onDescendre,
  onRetirer,
  onDefinirPortion,
}: {
  readonly item: FoodListItem;
  readonly index: number;
  readonly total: number;
  readonly occupe: boolean;
  readonly onMonter: () => void;
  readonly onDescendre: () => void;
  readonly onRetirer: () => void;
  readonly onDefinirPortion: (valeur: number | null) => void;
}) {
  const nom =
    item.source === "aliment"
      ? item.aliment.name
      : item.produit.brand
        ? `${item.produit.brand} — ${item.produit.name}`
        : item.produit.name;
  const source = item.source === "aliment" ? item.aliment : item.produit;
  const detail = `${source.proteinPer100} P · ${source.carbPer100} G · ${source.fatPer100} L pour 100 ${source.nutritionUnit}`;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2">
      <span className="w-6 flex-shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{nom}</span>
        {/* Lues à la source, jamais stockées dans la liste. */}
        <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
        <PortionPreferee item={item} occupe={occupe} onDefinir={onDefinirPortion} />
      </span>
      <span className="flex flex-shrink-0 items-center gap-1">
        <BoutonIcone
          onClick={onMonter}
          disabled={index === 0 || occupe}
          libelle={`Monter ${nom}`}
        >
          <ArrowUp size={16} />
        </BoutonIcone>
        <BoutonIcone
          onClick={onDescendre}
          disabled={index === total - 1 || occupe}
          libelle={`Descendre ${nom}`}
        >
          <ArrowDown size={16} />
        </BoutonIcone>
        <BoutonIcone onClick={onRetirer} disabled={occupe} libelle={`Retirer ${nom}`} danger>
          <X size={16} />
        </BoutonIcone>
      </span>
    </li>
  );
}

function BoutonIcone({
  onClick,
  disabled,
  libelle,
  danger = false,
  children,
}: {
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly libelle: string;
  readonly danger?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={libelle}
      className={`pressable flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-border transition-colors disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        danger
          ? "text-muted-foreground hover:border-destructive hover:text-destructive"
          : "text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}


/**
 * N1.5.1 — LA PORTION PRÉFÉRÉE D'UNE LIGNE DE LISTE.
 *
 * Trois états, et un seul visible à la fois :
 *
 *   STANDARD        — l'identité porte une portion, le coach ne l'a pas
 *                     touchée. On l'affiche, et on propose de personnaliser.
 *   PERSONNALISÉE   — le coach a posé sa valeur pour CETTE liste. On l'affiche
 *                     en champ, avec le standard rappelé dessous, et de quoi
 *                     revenir au standard.
 *   AUCUNE          — ni standard ni override. Un champ vide, sans reproche :
 *                     la portion n'est pas obligatoire, et l'immense majorité
 *                     des aliments n'en aura jamais.
 *
 * ⚠️ ON N'ÉCRIT PAS UN STANDARD DEPUIS CET ÉCRAN, ET C'EST STRUCTUREL, pas un
 * oubli : sur un aliment global, seule l'administration peut l'écrire ; sur un
 * produit, la table est en lecture seule côté application. Ce que le coach
 * pose ici est TOUJOURS un override, propre à sa liste.
 */
function PortionPreferee({
  item,
  occupe,
  onDefinir,
}: {
  readonly item: FoodListItem;
  readonly occupe: boolean;
  readonly onDefinir: (valeur: number | null) => void;
}) {
  const unite = uniteDePortion(item);
  const personnalisee = item.portionOverride !== null;
  const [ouvert, setOuvert] = useState(personnalisee);
  const [saisie, setSaisie] = useState(
    item.portionOverride === null ? "" : String(item.portionOverride),
  );

  const valeur = Number(saisie.replace(",", "."));
  const valide = saisie.trim() !== "" && Number.isFinite(valeur) && valeur > 0;
  const modifiee = valide && valeur !== item.portionOverride;

  // État REPLIÉ : on montre ce qui s'applique, et on propose de le changer.
  if (!ouvert) {
    const effective = portionEffective(item);
    return (
      <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {effective === null ? (
          <span>Aucune portion préférée</span>
        ) : (
          <span>
            Portion standard{" "}
            <span className="font-bold tabular-nums text-foreground">
              {effective} {unite}
            </span>
          </span>
        )}
        <button
          type="button"
          disabled={occupe}
          onClick={() => setOuvert(true)}
          className="pressable rounded-control border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {effective === null ? "Définir une portion" : "Personnaliser"}
        </button>
      </span>
    );
  }

  // État OUVERT : le champ, sa validation, et le retour au standard.
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <label className="flex items-center gap-1">
        <span>{personnalisee ? "Portion personnalisée" : "Portion préférée"}</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step="any"
          value={saisie}
          disabled={occupe}
          onChange={(e) => setSaisie(e.target.value)}
          aria-label={`Portion préférée pour ${
            item.source === "aliment" ? item.aliment.name : item.produit.name
          }`}
          className="w-20 rounded-control border border-border bg-card px-2 py-1 text-right text-xs tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <span>{unite}</span>
      </label>

      {/* ⚠️ VALIDATION EXPLICITE. Écrire à chaque frappe enverrait « 2 » puis
          « 25 » puis « 250 » : trois portions, dont deux fausses. */}
      <button
        type="button"
        disabled={occupe || !modifiee}
        onClick={() => onDefinir(valeur)}
        className="pressable flex items-center gap-1 rounded-control border border-primary px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Check size={12} aria-hidden="true" />
        Enregistrer
      </button>

      {/* Revenir au standard, sans avoir à retirer puis remettre l'aliment. */}
      {personnalisee && (
        <button
          type="button"
          disabled={occupe}
          onClick={() => {
            setSaisie("");
            setOuvert(false);
            onDefinir(null);
          }}
          className="pressable rounded-control border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Revenir au standard
        </button>
      )}

      {item.portionStandard !== null && (
        <span className="tabular-nums">
          Standard : {item.portionStandard} {unite}
        </span>
      )}
    </span>
  );
}

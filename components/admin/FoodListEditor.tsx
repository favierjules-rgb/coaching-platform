"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, X } from "lucide-react";

import { Field } from "@/components/admin/AdminFormFields";
import { FoodSearchPicker, cleIdentite } from "@/components/admin/FoodSearchPicker";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type CibleAliment,
  type FoodListDetail,
  type FoodListItem,
  ajouterAlimentAListe,
  archiverFoodList,
  nomPropre,
  renommerFoodList,
  reordonnerFoodList,
  retirerAlimentDeListe,
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
 * ⚠️ AUCUNE MACRO, AUCUNE QUANTITÉ, AUCUN RÔLE n'est demandé au coach. Les
 * valeurs affichées sous chaque aliment sont LUES à la source, jamais saisies.
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
}: {
  readonly item: FoodListItem;
  readonly index: number;
  readonly total: number;
  readonly occupe: boolean;
  readonly onMonter: () => void;
  readonly onDescendre: () => void;
  readonly onRetirer: () => void;
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
    <li className="flex min-w-0 items-center gap-2 rounded-control border border-border px-3 py-2">
      <span className="w-6 flex-shrink-0 text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm text-foreground">{nom}</span>
        {/* Lues à la source, jamais stockées dans la liste. */}
        <span className="truncate text-[11px] text-muted-foreground">{detail}</span>
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

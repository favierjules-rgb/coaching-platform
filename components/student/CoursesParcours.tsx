"use client";

import { useState } from "react";

import { CoursesListe } from "@/components/student/CoursesListe";
import { useCourses } from "@/hooks/useCourses";
import type { ModeGeneration } from "@/lib/courses/besoins";
import { libellePeriode } from "@/lib/courses/periode";
import {
  CATEGORIES_ENVIES,
  LIBELLES_CATEGORIES,
  SUGGESTIONS,
  type CategorieEnvie,
  normaliserLibelle,
} from "@/lib/courses/preferences";
import type { ConsumedMeal } from "@/lib/nutrition/consumed";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import type { AlimentRapide } from "@/lib/supabase/consumed-meals";

/**
 * COURSES C1 — LE PARCOURS ÉLÈVE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUATRE ÉTAPES, DONT TROIS FACULTATIVES
 * ────────────────────────────────────────────────────────────────────────────
 * Seule la durée est obligatoire. Les envies, les exclusions et le mode ont
 * tous une valeur par défaut utilisable — un élève pressé tape « 3 » puis
 * « Générer », et cela doit marcher.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CET ÉCRAN NE CALCULE RIEN ET N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Il ne contient ni client Supabase, ni RPC, ni la moindre règle de
 * sélection : `useCourses` porte l'état, `genererCourses` fait le travail. Une
 * règle recopiée ici échapperait aux 35 tests du moteur.
 */

const DUREES = [1, 2, 3, 4, 5, 6, 7] as const;

const LIBELLES_MODES: Readonly<Record<ModeGeneration, string>> = {
  plan_envies: "Mon plan + mes envies",
  plan_habitudes: "Mon plan + mes habitudes",
  plan_seul: "Mon plan uniquement",
};

/** Une pastille sélectionnable. Rien de plus qu'un bouton qui sait son état. */
export function Pastille({
  texte,
  actif,
  onClick,
}: {
  texte: string;
  actif: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={actif}
      className={`pressable min-h-[44px] rounded-control border px-3 py-2 text-xs uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        actif
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {texte}
    </button>
  );
}

function SectionEnvies({
  categorie,
  choisies,
  onBasculer,
  onAjouter,
}: {
  categorie: CategorieEnvie;
  choisies: readonly string[];
  onBasculer: (v: string) => void;
  onAjouter: (v: string) => void;
}) {
  const [saisie, setSaisie] = useState("");
  const estChoisie = (v: string) =>
    choisies.some((c) => normaliserLibelle(c) === normaliserLibelle(v));
  // Les envies libres, celles qui ne sont pas dans les suggestions.
  const libres = choisies.filter(
    (c) => !SUGGESTIONS[categorie].some((s) => normaliserLibelle(s) === normaliserLibelle(c)),
  );

  return (
    <div className="rounded-panel border border-border bg-card px-3 py-3">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-foreground">
        {LIBELLES_CATEGORIES[categorie]}
      </h4>
      {/* ⚠️ `flex-wrap` ET RIEN D'AUTRE. Une grille à colonnes fixes couperait
          « Beurre de cacahuète » sur un écran de 375 px. */}
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS[categorie].map((s) => (
          <Pastille key={s} texte={s} actif={estChoisie(s)} onClick={() => onBasculer(s)} />
        ))}
        {libres.map((s) => (
          <Pastille key={s} texte={s} actif onClick={() => onBasculer(s)} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            onAjouter(saisie);
            setSaisie("");
          }}
          placeholder="Ajouter une envie"
          aria-label={`Ajouter une envie dans ${LIBELLES_CATEGORIES[categorie]}`}
          className="min-h-[44px] min-w-0 flex-1 rounded-control border border-border bg-surface-soft px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
        <button
          type="button"
          onClick={() => {
            onAjouter(saisie);
            setSaisie("");
          }}
          className="pressable min-h-[44px] flex-shrink-0 rounded-control border border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Ajouter
        </button>
      </div>
    </div>
  );
}

export function CoursesParcours({
  aujourdHui,
  week,
  recettes,
  favoris,
  repasRecents,
  repasLongs,
  chargement = false,
}: {
  aujourdHui: string;
  week: PlanV2Week | null;
  recettes: readonly RecipeWithTags[];
  favoris: readonly AlimentRapide[];
  repasRecents: readonly ConsumedMeal[];
  repasLongs?: readonly ConsumedMeal[];
  chargement?: boolean;
}) {
  const c = useCourses({ aujourdHui, week, recettes, favoris, repasRecents, repasLongs });
  const [dateOuverte, setDateOuverte] = useState(false);
  const [exclusion, setExclusion] = useState("");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* ── ÉTAPE 1 — LA DURÉE ─────────────────────────────────────────── */}
      <section aria-label="Durée des courses" className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-foreground">
          Pour combien de jours fais-tu tes courses&nbsp;?
        </h3>
        {/* Sept boutons qui passent à la ligne : sur 375 px ils tiennent en
            deux rangées plutôt que de déborder. */}
        <div className="flex flex-wrap gap-2">
          {DUREES.map((n) => (
            <Pastille
              key={n}
              texte={String(n)}
              actif={c.nbJours === n}
              onClick={() => c.setNbJours(n)}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {c.periode ? libellePeriode(c.periode) : "Période invalide."}
        </p>

        {dateOuverte ? (
          <input
            type="date"
            value={c.debut}
            onChange={(e) => c.setDebut(e.target.value)}
            aria-label="Date de départ"
            className="min-h-[44px] w-full max-w-xs rounded-control border border-border bg-surface-soft px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        ) : (
          <button
            type="button"
            onClick={() => setDateOuverte(true)}
            className="self-start text-xs uppercase tracking-widest text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Changer la date de départ
          </button>
        )}
      </section>

      {/* ── ÉTAPE 2 — LES ENVIES ───────────────────────────────────────── */}
      <section aria-label="Envies" className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-foreground">
          Qu&apos;aimerais-tu manger ces prochains jours&nbsp;?
        </h3>
        <p className="text-xs text-muted-foreground">
          Facultatif. Ne rien cocher revient à dire «&nbsp;peu importe&nbsp;»&nbsp;: les habitudes
          et les favoris prennent alors le relais.
        </p>
        <div className="flex flex-col gap-2">
          {CATEGORIES_ENVIES.map((cat) => (
            <SectionEnvies
              key={cat}
              categorie={cat}
              choisies={c.preferences.envies[cat] ?? []}
              onBasculer={(v) => c.basculerEnvie(cat, v)}
              onAjouter={(v) => c.ajouterEnvie(cat, v)}
            />
          ))}
        </div>
      </section>

      {/* ── ÉTAPE 3 — LES EXCLUSIONS TEMPORAIRES ───────────────────────── */}
      <section aria-label="Exclusions temporaires" className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-foreground">
          Je préfère éviter cette fois-ci
        </h3>
        {/* ⚠️ « CETTE FOIS-CI » N'EST PAS UNE FORMULE DE STYLE. Ces exclusions
            ne touchent ni le profil, ni les allergies, ni aucune préférence
            durable : elles vivent le temps de cette génération. */}
        <p className="text-xs text-muted-foreground">
          Facultatif, et valable uniquement pour cette liste. Ton profil n&apos;est pas modifié.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={exclusion}
            onChange={(e) => setExclusion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              c.basculerExclusion(exclusion);
              setExclusion("");
            }}
            placeholder="Poulet, poisson, riz…"
            aria-label="Aliment à éviter cette fois-ci"
            className="min-h-[44px] min-w-0 flex-1 rounded-control border border-border bg-surface-soft px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <button
            type="button"
            onClick={() => {
              c.basculerExclusion(exclusion);
              setExclusion("");
            }}
            className="pressable min-h-[44px] flex-shrink-0 rounded-control border border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Éviter
          </button>
        </div>
        {c.preferences.exclusions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {c.preferences.exclusions.map((e) => (
              <Pastille key={e} texte={e} actif onClick={() => c.basculerExclusion(e)} />
            ))}
          </div>
        )}
      </section>

      {/* ── ÉTAPE 4 — LE MODE ──────────────────────────────────────────── */}
      <section aria-label="Mode de génération" className="flex flex-col gap-2">
        <h3 className="font-heading text-sm font-bold uppercase tracking-widest text-foreground">
          Comment veux-tu construire tes courses&nbsp;?
        </h3>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(LIBELLES_MODES) as ModeGeneration[]).map((m) => (
            <Pastille
              key={m}
              texte={LIBELLES_MODES[m]}
              actif={c.mode === m}
              onClick={() => c.setMode(m)}
            />
          ))}
        </div>
        {c.modeChoisi === null && (
          <p className="text-xs text-muted-foreground">
            Mode recommandé automatiquement. Tu peux en choisir un autre.
          </p>
        )}
      </section>

      {/* ── ÉTAPE 5 — GÉNÉRER ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={c.generer}
        disabled={chargement || c.periode === null}
        className="pressable min-h-[48px] w-full rounded-control border border-primary bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {chargement ? "Chargement…" : "Générer mes courses"}
      </button>

      {c.resultat && c.periode && (
        <CoursesListe
          titre={`Courses · ${c.nbJours} jour${c.nbJours > 1 ? "s" : ""}`}
          periode={libellePeriode(c.periode)}
          lignes={c.resultat.lignes}
          avertissements={c.resultat.avertissements}
        />
      )}
    </div>
  );
}

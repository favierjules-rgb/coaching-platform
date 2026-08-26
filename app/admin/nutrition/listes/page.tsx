"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus } from "lucide-react";

import { FoodListRow } from "@/components/admin/FoodListRow";
import { useCurrentCoachId } from "@/hooks/useCurrentCoachId";
import { useFoodLists } from "@/hooks/useFoodLists";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  type FoodListSummary,
  creerFoodList,
  dupliquerFoodList,
  nomDeCopie,
  nomPropre,
} from "@/lib/supabase/food-lists";
import { Loader } from "@/components/ui/Loader";

/**
 * N1.2 — MES LISTES D'ALIMENTS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DANS L'EXISTANT, PAS À CÔTÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Cet écran vit sous `/admin/nutrition/listes`, atteint par un bouton de
 * `/admin/nutrition` — exactement le chemin de « Recettes ». La barre latérale
 * n'est PAS touchée : « Nutrition » y est un lien plat, sans sous-navigation,
 * et en ajouter une ici créerait deux façons d'arriver au même endroit.
 *
 * ⚠️ ARCHIVÉES MASQUÉES PAR DÉFAUT. Elles ne sont pas supprimées — le bouton
 * les rappelle, et l'écran dit combien il en cache. Ne rien dire ferait croire
 * à une perte.
 */
export default function AdminFoodListsPage() {
  const router = useRouter();
  const { coachId, loading: chargementCoach } = useCurrentCoachId();
  const { listes, chargement, erreur, avecArchivees, setAvecArchivees, refetch } = useFoodLists();

  const [nouveauNom, setNouveauNom] = useState("");
  const [occupe, setOccupe] = useState<string | null>(null);
  const [erreurAction, setErreurAction] = useState<string | null>(null);

  const creer = useCallback(async () => {
    const propre = nomPropre(nouveauNom);
    if (propre === "" || !coachId) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setErreurAction("Connexion indisponible. Aucune liste n'a été créée.");
      return;
    }
    setErreurAction(null);
    setOccupe("creation");
    const id = await creerFoodList(supabase, coachId, propre);
    setOccupe(null);
    if (!id) {
      setErreurAction("La liste n'a pas pu être créée.");
      return;
    }
    setNouveauNom("");
    // On ouvre la liste tout de suite : elle est vide, et la remplir est la
    // seule chose à faire ensuite.
    router.push(`/admin/nutrition/listes/${id}`);
  }, [coachId, nouveauNom, router]);

  const dupliquer = useCallback(
    async (liste: FoodListSummary) => {
      if (!coachId) return;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        setErreurAction("Connexion indisponible. Aucune copie n'a été créée.");
        return;
      }
      setErreurAction(null);
      setOccupe(liste.id);
      const id = await dupliquerFoodList(supabase, coachId, liste.id, nomDeCopie(liste.name));
      setOccupe(null);
      if (!id) {
        setErreurAction("La liste n'a pas pu être dupliquée.");
        return;
      }
      await refetch();
    },
    [coachId, refetch],
  );

  const nbArchivees = listes.filter((l) => l.archivedAt !== null).length;
  const peutCreer = nomPropre(nouveauNom) !== "" && !!coachId && occupe === null;

  return (
    <div className="min-w-0">
      <Link
        href="/admin/nutrition"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Mes listes d&apos;aliments
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Des groupes d&apos;aliments réutilisables. Une liste ne contient ni quantité, ni rôle :
            seulement des aliments.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAvecArchivees(!avecArchivees)}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {avecArchivees ? "Masquer les archivées" : "Voir les archivées"}
        </button>
      </div>

      {/* ── CRÉER ────────────────────────────────────────────────────────── */}
      <div className="mb-8 flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-card p-4 sm:flex-row sm:items-center">
        <input
          type="text"
          value={nouveauNom}
          onChange={(e) => setNouveauNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && peutCreer) void creer();
          }}
          placeholder="Nom de la nouvelle liste"
          aria-label="Nom de la nouvelle liste"
          disabled={occupe !== null}
          className="min-h-[44px] w-full min-w-0 rounded-control border border-border bg-surface-soft px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          onClick={() => void creer()}
          disabled={!peutCreer}
          className="pressable flex min-h-[44px] flex-shrink-0 items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {occupe === "creation" ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Créer une liste
        </button>
      </div>

      {erreurAction && (
        <p
          className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {erreurAction}
        </p>
      )}

      {/* ── LES ÉTATS ────────────────────────────────────────────────────── */}
      {/* ⚠️ JAMAIS D'ÉCRAN BLANC : chargement, erreur, vide et « rien à
          afficher » ont chacun leur phrase. */}
      {chargement || chargementCoach ? (
        <Loader libelle="Chargement…" variante="ligne" />
      ) : erreur ? (
        <p
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {erreur}
        </p>
      ) : listes.length === 0 ? (
        <p className="rounded-panel border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {avecArchivees
            ? "Aucune liste, même archivée. Crée la première ci-dessus."
            : "Aucune liste pour le moment. Crée la première ci-dessus."}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {listes.map((liste) => (
            <FoodListRow
              key={liste.id}
              liste={liste}
              occupe={occupe === liste.id}
              desactive={occupe !== null || !coachId}
              onDupliquer={() => void dupliquer(liste)}
            />
          ))}
        </ul>
      )}

      {!chargement && !erreur && !avecArchivees && (
        <p className="mt-4 text-xs text-muted-foreground">
          Les listes archivées ne sont pas affichées. Elles ne sont pas supprimées.
        </p>
      )}
      {!chargement && !erreur && avecArchivees && nbArchivees > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          Dont {nbArchivees} archivée{nbArchivees > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}

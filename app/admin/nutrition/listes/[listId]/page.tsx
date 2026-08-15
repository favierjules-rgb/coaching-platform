"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { FoodListEditor } from "@/components/admin/FoodListEditor";
import { useFoodList } from "@/hooks/useFoodLists";

/**
 * N1.2 — UNE LISTE.
 *
 * ⚠️ « INTROUVABLE » NE DIT PAS LAQUELLE DES DEUX. La RLS rend exactement la
 * même chose pour la liste d'un autre coach et pour une liste qui n'existe pas.
 * Distinguer les deux messages révélerait l'existence d'une liste qu'on n'a pas
 * le droit de voir.
 */
export default function AdminFoodListPage() {
  const params = useParams<{ listId: string }>();
  const listId = typeof params?.listId === "string" ? params.listId : null;
  const { liste, chargement, erreur, introuvable, refetch } = useFoodList(listId);

  return (
    <div className="min-w-0">
      <Link
        href="/admin/nutrition/listes"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Mes listes d&apos;aliments
      </Link>

      <h1 className="mb-8 font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
        {liste ? liste.name : "Liste d'aliments"}
      </h1>

      {chargement ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : erreur ? (
        <p
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {erreur}
        </p>
      ) : introuvable || !liste ? (
        <p className="rounded-panel border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Cette liste est introuvable.
        </p>
      ) : (
        <FoodListEditor liste={liste} onChange={refetch} />
      )}
    </div>
  );
}

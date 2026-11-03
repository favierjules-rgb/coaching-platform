"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, PlayCircle } from "lucide-react";

import type { AdminProgram } from "@/types";

/**
 * « DÉMARRER EN MODE PRÉSENTIEL » — depuis la fiche de l'élève.
 *
 * ⚠️ LA SÉANCE EST CHOISIE, JAMAIS DEVINÉE. Un programme contient des dizaines
 * de séances réparties sur plusieurs semaines ; ouvrir « la prochaine » aurait
 * supposé connaître où en est l'élève, et se serait trompé un jour sur deux en
 * salle — où l'on fait justement la séance qu'on décide de faire. Le coach
 * choisit, et le programme voyage dans l'URL avec elle.
 *
 * ⚠️ CE BOUTON N'ACCORDE AUCUN DROIT. Il ne fait que construire un lien : la
 * page cible revérifie tout côté serveur (`requirePresentielAccess`), et la
 * route d'enregistrement aussi. Un coach qui forgerait l'URL d'un élève qui
 * n'est pas le sien arriverait sur une redirection.
 */
export function BoutonPresentiel({
  studentId,
  programme,
}: {
  readonly studentId: string;
  readonly programme: AdminProgram;
}) {
  const [ouvert, setOuvert] = useState(false);

  const seances = programme.sessions ?? [];
  if (seances.length === 0) return null;

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOuvert((o) => !o)}
        aria-expanded={ouvert}
        className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-primary bg-primary/10 px-4 text-xs font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:w-auto"
      >
        <PlayCircle size={16} aria-hidden />
        Démarrer en mode présentiel
        <ChevronDown
          size={14}
          aria-hidden
          className={`transition-transform motion-reduce:transition-none ${ouvert ? "rotate-180" : ""}`}
        />
      </button>

      {ouvert ? (
        <div className="mt-3 flex flex-col gap-1.5 rounded-panel border border-border bg-surface-soft/40 p-2">
          <p className="px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            Quelle séance faites-vous ensemble ?
          </p>
          {/* `max-h` + défilement : un programme de douze semaines ne doit pas
              repousser le reste de la fiche hors de l'écran. */}
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {seances.map((seance) => (
              <li key={seance.id}>
                <Link
                  href={`/admin/eleves/${studentId}/seance/${seance.id}?programme=${programme.id}`}
                  className="pressable flex min-h-[44px] min-w-0 items-center justify-between gap-3 rounded-control px-3 text-sm text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="min-w-0 truncate">{seance.name}</span>
                  <span className="flex-shrink-0 text-[11px] uppercase tracking-widest text-muted-foreground">
                    {typeof seance.weekNumber === "number" ? `S${seance.weekNumber}` : ""}
                    {seance.day ? ` · ${seance.day}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

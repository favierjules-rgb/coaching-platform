"use client";

/**
 * ENCART DE DIAGNOSTIC — PREVIEW UNIQUEMENT.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI IL EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Un iPhone en mode avion ne se laisse pas inspecter : pas de console
 * ouverte, pas de React DevTools, et une capture d'écran ne dit pas quelle
 * BRANCHE a produit ce qu'elle montre. Deux écrans peuvent être
 * rigoureusement identiques et venir de sources opposées — c'est
 * exactement ce qui a fait perdre un aller-retour le 09/08/2026.
 *
 * Cet encart affiche donc la seule chose qu'une capture ne peut pas
 * mentir : l'état retenu, l'identifiant de séance, et les drapeaux qui
 * commandent le rendu.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL NE S'AFFICHE JAMAIS EN PRODUCTION
 * ════════════════════════════════════════════════════════════════════════
 * Il est conditionné à `NEXT_PUBLIC_DIAGNOSTIC_OFFLINE === "1"`, une
 * variable à poser sur l'environnement Preview de Vercel et NULLE PART
 * ailleurs. Sans elle, ce composant rend `null` — et le compilateur élimine
 * tout le reste.
 *
 * Il n'affiche aucune donnée personnelle : des identifiants techniques, des
 * booléens, des compteurs. Jamais un nom, jamais une mesure, jamais un
 * jeton.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ET AUCUN IDENTIFIANT D'UTILISATEUR EN ENTIER
 * ════════════════════════════════════════════════════════════════════════
 * Cet encart finit en capture d'écran, envoyée par messagerie. Un
 * identifiant de séance ou de programme s'y lit sans risque — ce sont des
 * objets, pas des personnes. Un `auth.users.id` ou un `students.id`, non :
 * il désigne quelqu'un.
 *
 * Les clés qui en portent un sont donc TRONQUÉES ici, dans le composant, et
 * pas seulement chez l'appelant. Une garde posée au seul endroit où la
 * valeur s'affiche ne peut pas être oubliée par un futur appelant.
 */

/** Une valeur ressemble-t-elle à un UUID ? */
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Les clés qui désignent une PERSONNE, et jamais un objet. */
const CLES_PERSONNELLES = /user|eleve|student/i;

function afficher(cle: string, valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "—";
  const texte = String(valeur);
  if (CLES_PERSONNELLES.test(cle) && UUID.test(texte)) {
    // Assez pour comparer deux valeurs d'un coup d'œil, trop peu pour
    // identifier qui que ce soit.
    return `${texte.slice(0, 8)}…`;
  }
  return texte;
}
export function DiagnosticOffline({
  titre,
  lignes,
}: {
  titre: string;
  lignes: Record<string, string | number | boolean | null | undefined>;
}) {
  if (process.env.NEXT_PUBLIC_DIAGNOSTIC_OFFLINE !== "1") {
    return null;
  }
  return (
    <div
      data-diagnostic-offline={titre}
      className="mb-6 rounded-card border border-dashed border-primary/60 bg-primary/5 p-4"
    >
      <p className="mb-2 font-heading text-xs font-bold uppercase tracking-widest text-primary">
        Diagnostic · {titre}
      </p>
      <dl className="grid grid-cols-1 gap-1 font-mono text-[11px] leading-relaxed text-foreground">
        {Object.entries(lignes).map(([cle, valeur]) => (
          <div key={cle} className="flex flex-wrap gap-2">
            <dt className="text-muted-foreground">{cle}</dt>
            <dd className="break-all">{afficher(cle, valeur)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

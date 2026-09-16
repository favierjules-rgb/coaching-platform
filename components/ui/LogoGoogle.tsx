/**
 * LE « G » DE GOOGLE — la marque officielle, reproduite sans retouche.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI IL EST LÀ ALORS QU'IL ÉTAIT INTERDIT
 * ════════════════════════════════════════════════════════════════════════
 * Le harnais `avis-google.mts` interdisait explicitement tout logo, au motif
 * que « reproduire la marque ne nous appartient pas ». C'était trop prudent
 * pour CE cas précis, et l'interdit a été levé le 16/09/2026 sur demande.
 *
 * La raison qui le justifie : afficher un avis Google SANS l'attribuer à
 * Google serait le problème inverse, et un problème réel. Les règles de la
 * fiche d'établissement demandent que les avis repris ailleurs restent
 * identifiables comme venant de Google — c'est ce que fait ce « G », et
 * c'est ce que font tous les widgets d'avis.
 *
 * ⚠️ CE QUI RESTE INTERDIT, ET QU'UN TEST VERROUILLE : le redessiner, le
 * recolorer, le déformer. Les quatre couleurs ci-dessous sont les valeurs de
 * marque officielles, et les tracés sont ceux du logo. On affiche la marque
 * telle qu'elle est, ou on ne l'affiche pas.
 *
 * ⚠️ LE JAUNE DU LOGO N'EST PAS CELUI DES ÉTOILES. `#FBBC05` ici, `#fbbc04`
 * pour les étoiles de notation (`--avis-g-etoile`). Les deux existent chez
 * Google et servent à deux choses différentes ; les confondre en un seul
 * jeton ferait dériver l'un ou l'autre.
 *
 * ⚠️ `aria-hidden` : l'attribution est portée par le texte « Avis Google »
 * de la carte, réservé aux lecteurs d'écran. Un logo annoncé en plus du
 * texte dirait deux fois la même chose.
 */
export function LogoGoogle({ className = "" }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={`logo-google ${className}`.trim()}
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}

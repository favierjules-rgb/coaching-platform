import type { GoogleReview } from "@/lib/reviews/types";

/**
 * ⚠️⚠️⚠️  DONNÉES DE DÉMONSTRATION — CE NE SONT PAS DE VRAIS AVIS.  ⚠️⚠️⚠️
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER EST, ET CE QU'IL N'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Aucune de ces personnes n'existe. Aucun de ces textes n'a été écrit par un
 * client. Aucun n'a jamais été publié sur Google. Ils servent UNIQUEMENT à
 * construire et à éprouver l'interface pendant que la demande d'accès à
 * l'API Google Business Profile est en cours d'examen.
 *
 * La section qui les affiche porte un bandeau visible à l'écran disant que
 * ces avis sont une démonstration — voir `lib/reviews/source.ts`, drapeau
 * `demonstration`. Ce bandeau n'est pas décoratif : c'est ce qui empêche de
 * présenter un faux témoignage comme un vrai.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI IL Y A DES 3 ET DES 4 ÉTOILES ICI
 * ════════════════════════════════════════════════════════════════════════
 * Parce qu'un filtre qu'on ne peut pas voir échouer n'est pas testé. Si ce
 * fichier ne contenait que des 5 étoiles, le test « seuls les 5 étoiles sont
 * affichés » serait vert même avec le filtre supprimé. Les deux avis en
 * dessous de cinq étoiles, et celui à cinq étoiles SANS TEXTE, existent pour
 * que la garde travaille réellement à chaque exécution.
 *
 * Ils ne doivent JAMAIS apparaître dans la section publique.
 *
 * ════════════════════════════════════════════════════════════════════════
 * PHASE B
 * ════════════════════════════════════════════════════════════════════════
 * Ce fichier disparaîtra, ou restera comme jeu d'essai. Rien d'autre ne
 * changera : `lib/reviews/source.ts` cessera de l'importer, et l'interface
 * ne s'apercevra de rien.
 */

/** Le préfixe des identifiants : lisible dans le DOM, impossible à confondre. */
const PREFIXE_DEMO = "demo-";

/**
 * ⚠️ AUCUNE PHOTO. `authorPhoto` vaut `null` partout, délibérément : aller
 * chercher un portrait sur un service d'images libres donnerait un visage
 * réel à un témoignage inventé. Les cartes affichent donc l'initiale, ce qui
 * est aussi le comportement réel quand un client Google n'a pas de photo de
 * profil — le rendu éprouvé ici est donc un rendu qui existera vraiment.
 *
 * ⚠️ AUCUNE URL GOOGLE. `googleUrl` vaut `null` partout : une URL
 * `google.com/maps/...` fabriquée mènerait quelque part, ou nulle part, et
 * dans les deux cas ce serait un lien inventé.
 */
export const AVIS_DEMONSTRATION: readonly GoogleReview[] = [
  {
    id: `${PREFIXE_DEMO}01`,
    authorName: "Exemple — Camille",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Programme adapté à mon emploi du temps, avec des séances courtes mais denses. J'ai enfin arrêté de m'entraîner au hasard.",
    date: "2026-07-28T09:12:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}02`,
    authorName: "Exemple — Thomas",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Le suivi nutritionnel est ce qui a fait la différence pour moi : des repères clairs, pas un régime.",
    date: "2026-07-14T17:40:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}03`,
    authorName: "Exemple — Léa",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Reprise après une blessure au genou. Les charges ont été remontées progressivement, sans jamais forcer.",
    date: "2026-06-30T08:05:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}04`,
    authorName: "Exemple — Mehdi",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Trois séances par semaine pendant six mois. Les progrès sont mesurés, on ne travaille pas à l'aveugle.",
    date: "2026-06-11T19:22:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}05`,
    authorName: "Exemple — Sarah",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Ce que j'apprécie le plus, c'est qu'on m'explique pourquoi je fais chaque exercice.",
    date: "2026-05-23T12:00:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}06`,
    authorName: "Exemple — Antoine",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. J'avais essayé plusieurs salles sans accroche. Ici le plan est écrit pour moi, et il évolue quand mon quotidien change.",
    date: "2026-05-02T10:35:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}07`,
    authorName: "Exemple — Inès",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Préparation d'un semi-marathon menée sans perdre de force sur le haut du corps.",
    date: "2026-04-19T07:48:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}08`,
    authorName: "Exemple — Julien",
    authorPhoto: null,
    rating: 5,
    text: "Exemple de démonstration. Les retours après chaque séance sont précis et rapides, ça évite de répéter les mêmes erreurs pendant des semaines.",
    date: "2026-03-30T16:15:00.000Z",
    googleUrl: null,
  },

  /* ── LES TROIS SUIVANTS NE DOIVENT JAMAIS S'AFFICHER ────────────────────
   * Ils sont ici pour que le filtre travaille. Un mock qui ne contiendrait
   * que des 5 étoiles rendrait le test du filtre vert même sans filtre.
   */
  {
    id: `${PREFIXE_DEMO}09-quatre-etoiles`,
    authorName: "Exemple — Ne doit pas s'afficher (4★)",
    authorPhoto: null,
    rating: 4,
    text: "Exemple de démonstration à QUATRE étoiles. Si ce texte apparaît sur la page d'accueil, le filtre 5 étoiles est cassé.",
    date: "2026-08-01T09:00:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}10-trois-etoiles`,
    authorName: "Exemple — Ne doit pas s'afficher (3★)",
    authorPhoto: null,
    rating: 3,
    text: "Exemple de démonstration à TROIS étoiles. Si ce texte apparaît sur la page d'accueil, le filtre 5 étoiles est cassé.",
    date: "2026-08-02T09:00:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_DEMO}11-cinq-sans-texte`,
    authorName: "Exemple — Ne doit pas s'afficher (5★ sans texte)",
    authorPhoto: null,
    rating: 5,
    text: "   ",
    date: "2026-08-03T09:00:00.000Z",
    googleUrl: null,
  },
];

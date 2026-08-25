import type { GoogleReview } from "@/lib/reviews/types";

/**
 * AVIS GOOGLE RÉELS — RECOPIÉS À LA MAIN, PAS SYNCHRONISÉS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE FICHIER EST — ET CE QU’IL N’EST PLUS
 * ════════════════════════════════════════════════════════════════════════
 * Les neuf avis de `AVIS_RECOPIES` sont de VRAIS avis Google, écrits par de
 * VRAIES personnes, réellement publiés sur la fiche. Ils ont été recopiés
 * caractère par caractère depuis des captures d’écran fournies le
 * 25 août 2026.
 *
 * ⚠️ LA VERSION PRÉCÉDENTE DE CE FICHIER DISAIT « aucune de ces personnes
 * n’existe ». CE N’EST PLUS VRAI, et c’est le changement le plus important
 * ici : ces textes appartiennent à des clients. On ne les reformule pas, on
 * ne les abrège pas, on ne les corrige pas — ni l’orthographe, ni la
 * ponctuation, ni les emoji, ni les sauts de ligne.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI RESTE UN MOCK, ET POURQUOI ON LE DIT QUAND MÊME
 * ════════════════════════════════════════════════════════════════════════
 * Le CONTENU est réel ; le CIRCUIT ne l’est pas. Rien ici ne vient de l’API
 * Google Business Profile : c’est un tableau figé dans le dépôt. Un nouvel
 * avis publié demain n’apparaîtra pas tout seul, et un avis supprimé par son
 * auteur resterait affiché.
 *
 * Le risque à couvrir a donc CHANGÉ DE SENS. Avant, il fallait empêcher de
 * faire passer de faux avis pour vrais. Maintenant, il faut empêcher de faire
 * passer une recopie figée pour un flux vivant. C’est ce que disent :
 *   • `SOURCE_DES_AVIS` ci-dessous, lisible sans lire le contenu ;
 *   • le préfixe `mock-google-` sur chaque identifiant, visible dans le DOM ;
 *   • le drapeau `demonstration` de `lib/reviews/source.ts`, resté à `true` ;
 *   • le bandeau que la section affiche tant que ce drapeau vaut `true`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI TOUTES LES DATES VALENT `null`
 * ════════════════════════════════════════════════════════════════════════
 * L’interface Google n’affiche jamais de date absolue : elle écrit « il y a
 * 4 jours », « 6 days ago », « Edited a day ago ». Une capture ne peut donc
 * pas en livrer une. Convertir ces mentions en date ISO reviendrait à
 * FABRIQUER une donnée à partir de l’instant de la capture — exactement ce
 * qu’on s’interdit. L’ancienneté relevée est donc conservée EN COMMENTAIRE,
 * à titre de trace, et jamais dans le champ `date`.
 *
 * Conséquence assumée : les cartes n’affichent pas de date, et l’ordre
 * d’affichage est l’ordre de ce tableau (voir `avisPubliables` dans
 * `types.ts`).
 *
 * ⚠️ « Visited in August » N’EST PAS UNE DATE DE PUBLICATION. C’est le mois
 * de la visite déclaré par l’auteur. L’utiliser comme date de l’avis serait
 * une erreur de sens, pas une approximation.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI AUCUNE PHOTO DE PROFIL
 * ════════════════════════════════════════════════════════════════════════
 * Trois de ces neuf comptes ont une vraie photo de profil (Alice Raveau,
 * Vincent Métamorph’Ose, Arthur C.I). Elle n’est PAS reprise : l’afficher
 * supposerait soit une URL `googleusercontent.com` fabriquée, soit un
 * téléchargement — deux choses exclues à cette étape. Les cartes affichent
 * donc l’initiale, ce qui est déjà le rendu réel des six autres comptes.
 * Aucune donnée n’est inventée ; une donnée est simplement absente.
 *
 * ════════════════════════════════════════════════════════════════════════
 * PHASE B
 * ════════════════════════════════════════════════════════════════════════
 * Ce fichier disparaîtra. `lib/reviews/source.ts` cessera de l’importer et
 * l’interface ne s’apercevra de rien.
 */

/**
 * LE MARQUEUR DE PROVENANCE, lisible sans lire une seule ligne de données.
 *
 * ⚠️ NE PAS LE PASSER À `"google-api"` À LA MAIN. Le jour où Google alimente
 * réellement la section, c’est `source.ts` qui cesse d’importer ce fichier —
 * pas cette constante qui change de valeur.
 */
export const SOURCE_DES_AVIS = "mock-local" as const;

/** Le préfixe des identifiants réels : visible dans le DOM inspecté. */
const PREFIXE_MOCK = "mock-google-";

/** Le préfixe des avis pièges. Distinct, pour qu’aucun tri ne les confonde. */
const PREFIXE_PIEGE = "mock-piege-";

/**
 * LES NEUF AVIS RÉELS.
 *
 * ⚠️ NEUF, PAS DIX. Un dixième avis existe sur la fiche mais sa capture n’a
 * pas été fournie. Il n’est donc PAS ici, et il ne doit pas y être ajouté de
 * mémoire ni « reconstitué ». Un avis qu’on n’a pas lu est un avis qu’on
 * n’affiche pas.
 *
 * ⚠️ L’ORDRE DE CE TABLEAU EST L’ORDRE D’AFFICHAGE. Comme aucune date n’est
 * disponible, le tri par date est sans effet (voir `avisPubliables`) et c’est
 * cette liste qui décide. Déplacer une entrée déplace la carte.
 */
export const AVIS_RECOPIES: readonly GoogleReview[] = [
  {
    // Relevé sur la capture : 10 hours ago · Visited in August · avatar : initiale « N » (aucune photo de profil)
    id: `${PREFIXE_MOCK}01`,
    authorName: "Naïla Nach",
    authorPhoto: null,
    rating: 5,
    text:
      "J’ai eu l’occasion de faire une séance avec Jules, et je recommande vraiment son accompagnement ! 💪\nIl m’a donné de nombreux conseils très utiles.\nSes explications m’ont permis de mieux comprendre mes mouvements et surtout de progresser dans mes exercices.\nUn coach à l’écoute, professionnel et motivant. Je recommande Jules sans hésitation !",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : Edited a day ago · Visited in August · avatar : initiale « G » (aucune photo de profil)
    id: `${PREFIXE_MOCK}02`,
    authorName: "Gaelle Balouzat",
    authorPhoto: null,
    rating: 5,
    text:
      "J’ai commencé avec Jules à 45 kg avec l’objectif de prendre du poids et du muscle. En seulement 3 mois, je suis passée à 50 kg grâce à un suivi très poussé et totalement adapté à mes objectifs.\n\nL’application est également un vrai plus : très complète et fonctionnelle, avec des outils similaires à MyFitnessPal, mais aussi des listes de courses personnalisées qui me font gagner énormément de temps au quotidien. Je n’avais jamais vu autant de fonctionnalités réunies dans un outil de suivi.\n\nJe recommande Jules à 100 % pour son sérieux, son implication et la qualité de son accompagnement !",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : il y a 4 jours · Visité en février · avatar : photo de profil présente — non récupérable hors ligne
    id: `${PREFIXE_MOCK}03`,
    authorName: "Alice Raveau",
    authorPhoto: null,
    rating: 5,
    text:
      "Très bon coach, toujours disponible et à l’écoute. Un coaching personnalisé qui m’a permis de découvrir sereinement la muscu. Merci Jules !",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : 5 days ago · — · avatar : photo de profil présente — non récupérable hors ligne
    id: `${PREFIXE_MOCK}04`,
    authorName: "Vincent Métamorph'Ose l'art d'être Soi m'aime",
    authorPhoto: null,
    rating: 5,
    text:
      "J’ai commencé avec Jules à 118 kg, avec un objectif clair : perdre du poids avant de développer davantage ma musculature, gagner en force, en esthétique et en fierté personnelle.\n\nAujourd’hui, je suis à 108 kg. Malgré mes connaissances en nutrition, j’avais beaucoup de mal à perdre ces kilos seul. J’ai particulièrement apprécié chez Jules son cadre, sa persévérance, ses conseils et sa capacité à adapter les séances à mon potentiel et à mes objectifs.\n\nSon accompagnement m’aide à avancer avec régularité, motivation et confiance. Après ma Métamorph’OSE mentale et personnelle, je vis maintenant aussi une véritable Métamorph’OSE physique.\n\nProchain objectif : 103 kg. 💪\nJe recommande Jules à celles et ceux qui recherchent un coach sérieux, respectueux et réellement impliqué dans leur progression.",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : il y a 5 jours · Visité en août · avatar : photo de profil présente — non récupérable hors ligne
    id: `${PREFIXE_MOCK}05`,
    authorName: "Arthur C.I",
    authorPhoto: null,
    rating: 5,
    text:
      "Excellent coach qui m’a fait progresser physiquement, techniquement et mentalement autant dans ma pratique de la force athlétique compétitive que la musculation et le cardio. Je recommande vivement Jules qui est aussi une personne exceptionnelle",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : 6 days ago · Visited in August · avatar : initiale « A » (aucune photo de profil)
    id: `${PREFIXE_MOCK}06`,
    authorName: "Alessandra Piel",
    authorPhoto: null,
    rating: 5,
    text:
      "Jules est un coach excessivement professionnel qui sait ajuster chacun de ses coaching à la personne qu’il a en face de lui. Il fait preuve d’une maturité et d’une intelligence relationnelle qui donnent plaisir à être constant, discipliné et facilite la difficulté de chacun à se surpasser. Il mène le même combat que ses élèves l’espace d’un temps, les échanges vont au delà du sport et cela fait de lui un excellent professionnel. Ses connaissances en matière de corps humains mais aussi sportives, physiques, et physiologiques sont infinies. Il me réconciliera avec le goût de l’effort, moi qui suis fâchée avec le sport. Je le recommande les yeux fermés.",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : il y a 6 jours · Visité en août · avatar : initiale « M » (aucune photo de profil)
    id: `${PREFIXE_MOCK}07`,
    authorName: "Matthieu BALESTRIERI",
    authorPhoto: null,
    rating: 5,
    text:
      "Très bon coach 10/10 je le recommande a fond",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : 6 days ago · Visited in August · avatar : initiale « F » (aucune photo de profil)
    id: `${PREFIXE_MOCK}08`,
    authorName: "Foutse Yuehgoh",
    authorPhoto: null,
    rating: 5,
    text:
      "Avant, le sport était une corvée. Aujourd’hui, c’est un plaisir, et c’est entièrement grâce à lui. Son coaching m’a transformée : j’ai osé me lancer dans le trail, j’ai terminé un semi-marathon, et j’exécute les exercices avec une technique qui impressionne mon entourage.\nIl ne se contente pas d’entraîner : il motive, il encourage, et il m’a tellement sensibilisée à l’importance d’une bonne alimentation qu’il a transformé durablement mes habitudes alimentaires. Un coach passionné, bienveillant et toujours présent. Si vous cherchez quelqu’un qui croit en vous plus que vous-même, c’est lui qu’il vous faut. Merci pour tout !💖🙌🏽",
    date: null,
    googleUrl: null,
  },
  {
    // Relevé sur la capture : 6 days ago · Visited in August · avatar : initiale « A » (aucune photo de profil)
    id: `${PREFIXE_MOCK}09`,
    authorName: "Audrey ZIGGIOTTI",
    authorPhoto: null,
    rating: 5,
    text:
      "⭐⭐⭐⭐⭐\n\nJe recommande Jules à 100 % ! Un coach très professionnel, à l’écoute et qui s’adapte vraiment à nos objectifs. Il personnalise le programme alimentaire et reste toujours disponible quand on a besoin de lui.\n\nSon application est également super complète pour suivre notre progression et notre alimentation. En seulement quelques séances, j’ai déjà énormément appris et les premiers résultats sont top ! 💪\n\nJ’ai hâte de voir le résultat final 😍 Merci Jules pour ton accompagnement et ta motivation !\n\nAudrey",
    date: null,
    googleUrl: null,
  },
];

/**
 * LES TROIS AVIS PIÈGES — INVENTÉS, ET QUI NE DOIVENT JAMAIS S’AFFICHER.
 *
 * ⚠️ ILS NE SONT PAS DÉCORATIFS. Sans eux, le test « seuls les 5 étoiles sont
 * affichés » passerait au vert MÊME FILTRE SUPPRIMÉ : un jeu composé
 * uniquement de 5 étoiles ne peut rien prouver. Ils sont la seule chose qui
 * fasse réellement travailler `estPubliable()` à chaque exécution.
 *
 * ⚠️ ILS SONT DÉLIBÉRÉMENT FAUX, et ils le disent — nom, texte, identifiant.
 * C’est ce qui les rend impossibles à confondre avec les neuf vrais avis
 * juste au-dessus, y compris pour quelqu’un qui lirait ce fichier en
 * diagonale dans six mois.
 */
export const AVIS_PIEGES: readonly GoogleReview[] = [
  {
    id: `${PREFIXE_PIEGE}4-etoiles`,
    authorName: "Exemple — Ne doit pas s’afficher (4★)",
    authorPhoto: null,
    rating: 4,
    text:
      "Exemple de démonstration à QUATRE étoiles. Si ce texte apparaît sur la page d’accueil, le filtre 5 étoiles est cassé.",
    date: "2026-08-01T09:00:00.000Z",
    googleUrl: null,
  },
  {
    id: `${PREFIXE_PIEGE}3-etoiles`,
    authorName: "Exemple — Ne doit pas s’afficher (3★)",
    authorPhoto: null,
    rating: 3,
    text:
      "Exemple de démonstration à TROIS étoiles. Si ce texte apparaît sur la page d’accueil, le filtre 5 étoiles est cassé.",
    date: "2026-08-02T09:00:00.000Z",
    googleUrl: null,
  },
  {
    // 5 étoiles MAIS sans texte : une carte n’aurait rien à montrer.
    id: `${PREFIXE_PIEGE}5-sans-texte`,
    authorName: "Exemple — Ne doit pas s’afficher (5★ sans texte)",
    authorPhoto: null,
    rating: 5,
    text: "   ",
    date: "2026-08-03T09:00:00.000Z",
    googleUrl: null,
  },
];

/**
 * CE QUE LA SOURCE LIT — les vrais avis PUIS les pièges.
 *
 * ⚠️ LES PIÈGES SONT EN FIN DE TABLEAU, JAMAIS MÉLANGÉS AUX VRAIS. Le filtre
 * les écarte de toute façon, mais un faux avis intercalé entre deux vrais
 * serait une invitation à l’erreur le jour où quelqu’un modifiera ce fichier
 * sans lire les commentaires.
 */
export const AVIS_DEMONSTRATION: readonly GoogleReview[] = [
  ...AVIS_RECOPIES,
  ...AVIS_PIEGES,
];

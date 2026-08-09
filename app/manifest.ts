import type { MetadataRoute } from "next";

/**
 * LE MANIFESTE — ce qui transforme le site en application installable.
 *
 * Next.js sert ce fichier sur `/manifest.webmanifest` et pose lui-même le
 * `<link rel="manifest">` dans le <head> : rien à ajouter au layout.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI `start_url` POINTE SUR /entrainement
 * ────────────────────────────────────────────────────────────────────────
 * La demande de départ était « ouvrir sur la connexion, pas sur la vitrine ».
 * Elle reste satisfaite — mais /connexion s'est révélé être le MAUVAIS point
 * de lancement dès qu'on a voulu que l'application s'ouvre hors ligne.
 *
 * Le scénario qui a tranché : élève connecté, application préparée, séance
 * ouverte, puis fermeture complète et mode avion. Au lancement depuis
 * l'icône, le navigateur navigue vers `start_url`. Or /connexion dépend du
 * cookie de session (elle redirige un élève connecté vers son espace) : sa
 * réponse n'a donc rien à faire dans un cache, et elle n'y est pas. Sans
 * réseau, ce lancement tombait sur la page « Pas de connexion » — l'élève
 * avait son application sous les yeux et ne pouvait pas y entrer.
 *
 * /entrainement corrige cela, et c'est le seul choix qui coche tout :
 *
 *   • sa coquille EST mise en cache (liste blanche du service worker), donc
 *     le lancement hors ligne ouvre l'application, menus compris ;
 *   • elle est accessible aux DEUX types de compte — « coaching » comme
 *     « programme_seul » (`requireEntrainementAccess`) —, donc sa coquille
 *     est capturée à la première visite quel que soit l'élève. /dashboard
 *     n'aurait pas convenu : un compte « programme_seul » en est redirigé,
 *     sa coquille ne serait jamais capturée, et son lancement hors ligne
 *     retomberait sur la page de secours ;
 *   • c'est la page qui MÈNE à la séance du jour — le geste que
 *     l'application existe pour servir ;
 *   • et un visiteur non connecté qui la lance AVEC réseau est renvoyé sur
 *     /connexion par le garde serveur, exactement comme avant.
 *
 * `app/connexion/page.tsx` garde sa redirection serveur : elle sert toujours
 * à quelqu'un qui atteint la page de connexion en étant déjà connecté.
 *
 * `scope` reste `/` : une fois lancée, l'application peut naviguer partout
 * sur le site (y compris les pages publiques : CGV, mentions légales, liens
 * du pied de page) sans être éjectée dans le navigateur. Restreindre le
 * scope à /dashboard ferait sortir l'élève de son application au premier
 * lien légal — un aller sans retour, puisqu'il ne saurait pas y revenir.
 *
 * ────────────────────────────────────────────────────────────────────────
 * `id` FIGÉ, SÉPARÉMENT DE `start_url`
 * ────────────────────────────────────────────────────────────────────────
 * Sans `id`, l'identité de l'application EST son `start_url`. Le jour où
 * l'écran de lancement changera, les navigateurs verront une application
 * différente : la précédente resterait installée à côté, orpheline. `id`
 * est donc figé à "/" et ne doit plus jamais bouger.
 *
 * ────────────────────────────────────────────────────────────────────────
 * AUCUNE COULEUR
 * ────────────────────────────────────────────────────────────────────────
 * `background_color` (écran de démarrage) et `theme_color` (barre système)
 * reprennent `--background` du thème sombre, qui est le thème par défaut du
 * site tant que l'élève n'a rien mémorisé. Une valeur unique plutôt qu'un
 * couple clair/sombre : le thème de l'application ne suit PAS celui du
 * système (il vit en localStorage), donc annoncer du blanc à un téléphone
 * en mode clair afficherait une barre blanche au-dessus d'une application
 * restée noire.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PAS D'`orientation`
 * ────────────────────────────────────────────────────────────────────────
 * Verrouiller en portrait serait tentant. Ce serait aussi empêcher l'élève
 * de filmer sa technique en paysage (F4) et le coach de regarder cette
 * vidéo dans le bon sens (F5). On laisse le téléphone décider.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SETH — Préparation Physique",
    short_name: "SETH",
    description:
      "Ton espace coaching : entraînement, nutrition, suivi et rendez-vous.",
    lang: "fr",
    dir: "ltr",
    start_url: "/entrainement",
    scope: "/",
    display: "standalone",
    background_color: "#050505",
    theme_color: "#050505",
    categories: ["health", "fitness", "lifestyle"],
    icons: [
      // `any` : l'icône est utilisée TELLE QUELLE, fond compris. D'où un
      // carré plein — une icône transparente disparaîtrait sur un fond de
      // lanceur clair.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // `maskable` : le système ROGNE (cercle, squircle, goutte selon le
      // lanceur). L'emblème y est plus petit — il tient entièrement dans le
      // cercle de sécurité de 80 %, vérifié par `scripts/tests/pwa-manifest.mts`.
      // Deux fichiers distincts, jamais le même déclaré deux fois : une
      // icône `any` rognée perdrait ses pointes, une icône `maskable`
      // affichée telle quelle paraîtrait minuscule.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

/* eslint-disable */
/**
 * SERVICE WORKER — le strict minimum, et rien de plus.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE FICHIER S'EXÉCUTE AVANT CHAQUE PAGE. UN BOGUE ICI CASSE TOUT LE SITE,
 * Y COMPRIS POUR LES VISITEURS QUI N'ONT RIEN INSTALLÉ.
 * ════════════════════════════════════════════════════════════════════════
 * D'où une règle de conduite tenue partout dans ce fichier : quand un cas
 * n'est pas explicitement prévu, le service worker NE RÉPOND PAS —
 * `respondWith` n'est pas appelé, le navigateur fait exactement ce qu'il
 * aurait fait sans lui. L'inaction est le comportement par défaut.
 *
 * Il n'est PAS enregistré en développement (voir
 * `components/pwa/ServiceWorkerRegistrar.tsx`) : les fichiers de
 * `/_next/static/` n'y portent pas d'empreinte de contenu, les mettre en
 * cache servirait du code périmé à chaque modification.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI N'EST JAMAIS MIS EN CACHE — LA PARTIE QUI COMPTE
 * ════════════════════════════════════════════════════════════════════════
 * Le mode hors ligne demandé est MINIMAL, et c'est délibéré. Un cache de
 * pages authentifiées est une base de données personnelle posée sur le
 * disque du téléphone : elle survit à la déconnexion, elle survit au
 * changement d'élève sur le même appareil, et elle affiche des chiffres
 * périmés sans le dire. Ne sont donc JAMAIS mis en cache :
 *
 *   • toute réponse de /api/ ;
 *   • tout ce qui part vers une autre origine (Supabase, Stripe) ;
 *   • toute requête qui n'est pas un GET ;
 *   • le HTML de toute page HORS de la liste blanche ci-dessous.
 *
 * Sont mis en cache, et rien d'autre :
 *
 *   • les fichiers de `/_next/static/`, dont le nom contient l'empreinte du
 *     contenu : un fichier de ce dossier ne change jamais sans changer de
 *     nom, donc un cache éternel y est exact par construction — et il ne
 *     contient que du code, jamais une donnée d'élève ;
 *   • la COQUILLE des pages élève listées plus bas. Voir l'encadré : dans
 *     cette application, ces documents ne contiennent aucune donnée, et un
 *     test l'inspecte pour le prouver plutôt que de le supposer.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE « HORS LIGNE » VEUT DIRE ICI
 * ════════════════════════════════════════════════════════════════════════
 * L'élève qui a ouvert son application en ligne, puis perd le réseau en
 * salle, retrouve SON APPLICATION : mêmes menus, même navigation, même
 * écran de séance. Les chiffres, eux, ne viennent pas d'ici — ils viennent
 * d'IndexedDB, où le snapshot de la séance du jour a été déposé pendant
 * qu'il y avait du réseau.
 *
 * La page `/hors-ligne` reste, mais comme SECOURS : première visite,
 * application jamais préparée, route hors liste blanche. Ce n'est plus
 * l'écran normal d'une coupure.
 *
 * Ce que le service worker ne fera jamais : servir une donnée d'hier comme
 * si elle était d'aujourd'hui. Les données ne passent pas par lui.
 */

/**
 * Changer ce numéro purge TOUS les caches à l'activation.
 * À incrémenter quand la logique de ce fichier change, ou quand la page
 * hors ligne change assez pour qu'une version en cache devienne fausse.
 */
const VERSION = "seth-pwa-v1";
const CACHE_HORS_LIGNE = VERSION + "-hors-ligne";
const CACHE_STATIQUE = VERSION + "-statique";
const CACHE_COQUILLE = VERSION + "-coquille";
const CACHES_CONNUS = [CACHE_HORS_LIGNE, CACHE_STATIQUE, CACHE_COQUILLE];

const PAGE_HORS_LIGNE = "/hors-ligne";
const PREFIXE_STATIQUE = "/_next/static/";

/**
 * ════════════════════════════════════════════════════════════════════════
 * LA COQUILLE DE L'ESPACE ÉLÈVE
 * ════════════════════════════════════════════════════════════════════════
 * Ce qui rend ceci possible, et qu'il faut avoir vérifié avant de le lire
 * sans frémir : DANS CETTE APPLICATION, LES PAGES ÉLÈVE NE CONTIENNENT
 * AUCUNE DONNÉE DANS LEUR HTML. `app/(student)/layout.tsx` exécute le garde
 * puis rend `StudentShell`, qui est un composant client ; la page de séance
 * elle-même est `"use client"` et charge tout via des appels Supabase
 * depuis le navigateur. Le document servi est donc une coquille : barre
 * latérale, menus, « Chargement… ».
 *
 * `scripts/tests/pwa-coquille.mts` ne prend pas cette affirmation pour
 * argent comptant : il INSPECTE le HTML réellement mis en cache et échoue
 * s'il y trouve la moindre donnée métier.
 *
 * ────────────────────────────────────────────────────────────────────────
 * UNE LISTE BLANCHE, PAS UNE RÈGLE GÉNÉRALE
 * ────────────────────────────────────────────────────────────────────────
 * On ne met PAS en cache « tout le HTML du site ». Les pages publiques, les
 * pages d'administration, les pages légales n'ont rien à faire ici : elles
 * n'entrent pas dans le parcours « ouvrir l'application en salle ». Seuls
 * les documents nécessaires à ce parcours sont retenus.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'URL EXACTE, JAMAIS UN GABARIT
 * ────────────────────────────────────────────────────────────────────────
 * `/entrainement/seance/<id>` est une route dynamique. On pourrait être
 * tenté de garder UNE coquille et de la servir pour n'importe quel id.
 * Ce serait faux : Next.js embarque dans le document la charge RSC de la
 * route, paramètres compris. Servir la coquille de la séance A pour la
 * séance B ferait s'hydrater l'écran avec l'id de A — l'élève ouvrirait la
 * mauvaise séance sans le moindre signe.
 *
 * Chaque URL visitée est donc mise en cache SOUS SON URL EXACTE. Ce n'est
 * pas une limite : la séance du jour a forcément été ouverte en ligne, au
 * moment où le snapshot a été préparé.
 */
const COQUILLES_ELEVE = [
  /^\/dashboard$/,
  /^\/entrainement$/,
  /^\/entrainement\/historique$/,
  // Route dynamique : l'identifiant de séance est un UUID.
  /^\/entrainement\/seance\/[0-9a-fA-F-]{36}$/,
  /^\/entrainement\/[0-9a-fA-F-]{36}$/,
  /^\/profil$/,
  /^\/progression$/,
  /^\/nutrition$/,
  /^\/documents$/,
  /^\/rendez-vous$/,
];

/**
 * Plafond du cache de coquilles. Elles sont minuscules (quelques kilo-octets
 * de balisage), mais une route dynamique peut en produire autant qu'il y a
 * de séances : sans borne, le cache suivrait l'historique de l'élève.
 */
const MAX_COQUILLES = 30;

/**
 * Le point de lancement de l'application (`start_url` du manifeste).
 *
 * Il est PRÉPARÉ automatiquement, et pas seulement s'il a été visité : sinon
 * le lancement hors ligne dépendrait du fait que l'élève ait pensé à ouvrir
 * cette page-là avant de perdre le réseau. Un élève qui consulte son profil
 * puis descend au sous-sol se retrouverait devant la page de secours, sans
 * comprendre pourquoi son application « marche parfois ».
 *
 * La préparation est déclenchée par la première coquille élève capturée —
 * donc par une page qui a répondu 200 sans redirection, ce qui n'arrive
 * qu'à un élève authentifié. Elle ne précharge RIEN d'autre : une coquille
 * HTML, la même que celle déjà validée comme vide de données.
 *
 * La route de SÉANCE reste à l'opposé de cette logique : elle n'est
 * disponible hors ligne que si CETTE séance a réellement été ouverte en
 * ligne. C'est voulu — sa coquille porte l'identifiant de la séance, et il
 * n'y a rien à préparer d'avance pour une séance qu'on ne connaît pas.
 */
const LANCEMENT = "/entrainement";

function estCoquilleEleve(chemin) {
  for (let i = 0; i < COQUILLES_ELEVE.length; i += 1) {
    if (COQUILLES_ELEVE[i].test(chemin)) {
      return true;
    }
  }
  return false;
}

/**
 * Plafond du cache de fichiers empreintés.
 *
 * ────────────────────────────────────────────────────────────────────────
 * SANS CE PLAFOND, LE CACHE NE DIMINUE JAMAIS
 * ────────────────────────────────────────────────────────────────────────
 * Chaque déploiement change les empreintes : les nouveaux fichiers sont
 * ajoutés, les anciens ne correspondent plus à rien mais RESTENT. Rien ne
 * les enlève — le nom du cache, lui, ne change qu'avec `VERSION`, c'est-à-
 * dire quand ce fichier-ci est modifié, ce qui n'arrive presque jamais.
 * Au bout d'un an de déploiements, le téléphone de l'élève garderait
 * plusieurs centaines de mégaoctets de code mort.
 *
 * Le plafond est tenu en NOMBRE d'entrées, pas en octets : l'API Cache
 * n'expose aucune taille. 120 fichiers couvrent largement une visite
 * complète du site (une page en charge une vingtaine).
 *
 * Ce qui est expulsé peut très bien être encore utile : le coût est alors
 * une requête réseau, pas une panne. C'est le bon compromis — l'inverse,
 * garder pour être sûr, est précisément ce qui fait grossir sans fin.
 */
const MAX_ENTREES_STATIQUES = 120;

/**
 * Relève les fichiers de `/_next/static/` référencés par un HTML.
 *
 * Précacher la page hors ligne sans sa feuille de style donnerait, le jour
 * où elle sert, du texte noir sur fond blanc sans mise en page — la seule
 * page que l'élève verra jamais en panne serait la seule à ne pas
 * ressembler au site. On relève donc ses `href`/`src` au moment de
 * l'installation, pendant qu'il y a encore du réseau.
 *
 * Volontairement borné à `/_next/static/` : ces URL portent une empreinte
 * de contenu et sont publiques. Aucune autre URL de la page n'est suivie.
 */
function relevesStatiques(html) {
  const trouves = new Set();
  const motif = /(?:href|src)="(\/_next\/static\/[^"]+)"/g;
  let occurrence;
  while ((occurrence = motif.exec(html)) !== null) {
    trouves.add(occurrence[1]);
  }
  return Array.from(trouves);
}

self.addEventListener("install", function (evenement) {
  evenement.waitUntil(
    (async function () {
      // `cache: "reload"` : on veut la page telle qu'elle est en ligne
      // MAINTENANT, pas une copie que le navigateur traînerait depuis une
      // visite précédente.
      const reponse = await fetch(PAGE_HORS_LIGNE, { cache: "reload" });
      if (!reponse || !reponse.ok) {
        // Échouer l'installation plutôt que d'activer un service worker
        // dont la seule fonction hors ligne serait cassée. Le navigateur
        // réessaiera à la prochaine visite ; entre-temps le site marche
        // exactement comme avant.
        throw new Error("[sw] page hors ligne indisponible : installation refusée");
      }

      const html = await reponse.clone().text();
      const cacheHorsLigne = await caches.open(CACHE_HORS_LIGNE);
      await cacheHorsLigne.put(PAGE_HORS_LIGNE, reponse);

      // Les fichiers de la page hors ligne vont dans SON cache, pas dans le
      // cache statique : celui-ci est plafonné, et il finirait par les
      // expulser. La seule page que l'élève verra en panne s'afficherait
      // alors sans mise en page, après quelques semaines d'usage et sans
      // que rien ne le signale. `cacheDAbord` les retrouve quand même en
      // navigation normale, puisqu'il interroge tous les caches.
      await Promise.all(
        relevesStatiques(html).map(function (url) {
          // Une ressource manquante ne doit pas faire échouer l'installation :
          // la page hors ligne reste lisible sans elle.
          return cacheHorsLigne.add(url).catch(function () {});
        }),
      );

      // Prendre la main immédiatement. Ce service worker fait si peu qu'il
      // n'y a rien à préserver d'une ancienne version ; et le jour où une
      // correction touchera à ce qui est mis en cache, on veut qu'elle
      // s'applique au prochain chargement, pas à la prochaine semaine.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", function (evenement) {
  evenement.waitUntil(
    (async function () {
      const noms = await caches.keys();
      await Promise.all(
        noms.map(function (nom) {
          // Tout ce qui n'est pas de CETTE version disparaît — y compris un
          // cache qu'une version précédente de ce fichier aurait rempli avec
          // ce qu'elle n'aurait pas dû garder.
          return CACHES_CONNUS.indexOf(nom) === -1 ? caches.delete(nom) : undefined;
        }),
      );
      await self.clients.claim();
    })(),
  );
});

/** Ramène un cache sous son plafond, en partant des entrées les plus anciennes. */
async function borner(cache, plafond) {
  const cles = await cache.keys();
  const trop = cles.length - plafond;
  if (trop <= 0) {
    return;
  }
  // `keys()` rend les entrées dans leur ORDRE D'INSERTION (spécification de
  // l'API Cache) : les premières sont les plus anciennes. C'est ce qui rend
  // cette expulsion prévisible sans avoir à stocker de dates à côté.
  for (let i = 0; i < trop; i += 1) {
    await cache.delete(cles[i]);
  }
}

/**
 * S'assure que la coquille du point de lancement est disponible.
 *
 * Silencieux en cas d'échec : ce n'est qu'une préparation. Si elle rate, le
 * site continue exactement comme avant, et la prochaine visite réessaiera.
 */
async function preparerLancement(cache, origine) {
  const adresse = origine + LANCEMENT;
  const deja = await cache.match(adresse);
  if (deja) {
    return;
  }
  try {
    const reponse = await fetch(adresse, { credentials: "same-origin" });
    // Mêmes conditions que pour une coquille visitée : 200, sans
    // redirection. Un élève non authentifié est redirigé vers /connexion —
    // on ne garde donc jamais un formulaire de connexion comme point de
    // lancement.
    if (reponse.status === 200 && !reponse.redirected) {
      await cache.put(adresse, reponse);
    }
  } catch (erreur) {
    // Pas de réseau au moment de la préparation : rien à faire ici.
  }
}

/**
 * Navigation. Le réseau d'abord, TOUJOURS — la coquille en cache n'est là
 * que pour le jour où il n'y en a pas.
 *
 * Trois issues, dans cet ordre :
 *   1. réseau disponible → réponse du serveur (et coquille rafraîchie si la
 *      route est dans la liste blanche) ;
 *   2. pas de réseau, coquille connue pour CETTE URL → l'application
 *      s'ouvre normalement, menus compris, et va chercher ses données dans
 *      IndexedDB ;
 *   3. pas de réseau, aucune coquille → page hors ligne. C'est le SECOURS :
 *      première visite, application jamais préparée, ou route hors liste.
 */
async function navigation(requete) {
  const adresse = new URL(requete.url);
  const chemin = adresse.pathname;
  const listee = estCoquilleEleve(chemin);

  try {
    // Une réponse 500 est une réponse : elle est renvoyée telle quelle.
    // Confondre « le serveur a répondu une erreur » et « il n'y a pas de
    // réseau » masquerait une panne serveur derrière un message rassurant.
    const reponse = await fetch(requete);
    if (listee && reponse.status === 200 && !reponse.redirected) {
      // `!reponse.redirected` : sans réseau on ne doit jamais rejouer une
      // page obtenue APRÈS redirection. Une session expirée renvoie la page
      // de connexion sous l'URL du tableau de bord — la garder ferait
      // s'ouvrir l'application sur un formulaire de connexion figé.
      const cache = await caches.open(CACHE_COQUILLE);
      await cache.put(requete.url, reponse.clone());
      await preparerLancement(cache, adresse.origin);
      await borner(cache, MAX_COQUILLES);
    }
    return reponse;
  } catch (erreur) {
    if (listee) {
      const cache = await caches.open(CACHE_COQUILLE);
      const coquille = await cache.match(requete.url);
      if (coquille) {
        return coquille;
      }
    }
    const secours = await caches.open(CACHE_HORS_LIGNE);
    const repli = await secours.match(PAGE_HORS_LIGNE);
    return repli || Response.error();
  }
}

/** Cache d'abord — réservé aux URL porteuses d'une empreinte de contenu. */
async function cacheDAbord(requete) {
  // `caches.match` interroge TOUS les caches, y compris celui de la page
  // hors ligne : les fichiers précachés avec elle sont donc trouvés ici
  // sans être recopiés — et sans risquer d'être expulsés par le plafond
  // ci-dessous, qui ne touche qu'au cache statique.
  const connu = await caches.match(requete);
  if (connu) {
    return connu;
  }
  const reponse = await fetch(requete);
  // `status === 200` strictement : une réponse partielle (206) ou une
  // redirection mise en cache reviendrait tronquée au chargement suivant.
  if (reponse && reponse.status === 200) {
    const cache = await caches.open(CACHE_STATIQUE);
    await cache.put(requete, reponse.clone());
    await borner(cache, MAX_ENTREES_STATIQUES);
  }
  return reponse;
}

self.addEventListener("fetch", function (evenement) {
  const requete = evenement.request;

  // Un POST/PUT/DELETE n'est jamais rejouable : on n'y touche pas.
  if (requete.method !== "GET") {
    return;
  }

  const url = new URL(requete.url);

  // Autre origine : Supabase, Stripe, polices distantes. Le service worker
  // n'a rien à y faire, et surtout rien à en garder.
  if (url.origin !== self.location.origin) {
    return;
  }

  // /api/ renvoie des données personnelles. Le filtre `/_next/static/`
  // ci-dessous les exclut déjà ; ce refus explicite est là pour que
  // l'élargir un jour ne les rattrape pas par accident.
  if (url.pathname.indexOf("/api/") === 0) {
    return;
  }

  if (requete.mode === "navigate") {
    evenement.respondWith(navigation(requete));
    return;
  }

  if (url.pathname.indexOf(PREFIXE_STATIQUE) === 0) {
    evenement.respondWith(cacheDAbord(requete));
    return;
  }

  // Tout le reste — images, manifeste, polices locales, appels de données :
  // aucune réponse fournie, le navigateur fait son travail habituel.
});

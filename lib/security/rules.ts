import "server-only";

import type { RateLimitRule } from "@/lib/security/rate-limit";

/**
 * Règles de limitation, rassemblées ici pour être relues d'un coup d'œil
 * plutôt que dispersées dans les routes (audit de sécurité, juillet 2026).
 *
 * `failClosed` est posé dès qu'un appel coûte de l'argent ou crée un compte :
 * en production sans magasin partagé, ces routes refusent plutôt que de
 * s'ouvrir en grand.
 */

const HEURE = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Réclamation d'un programme gratuit : crée un compte auth + envoie un email. */
export const CLAIM_PROGRAM_IP: RateLimitRule = {
  name: "claim_program_ip",
  limit: 5,
  windowMs: HEURE,
  failClosed: true,
};

/** Même programme, même adresse : une seule réclamation utile. */
export const CLAIM_PROGRAM_EMAIL: RateLimitRule = {
  name: "claim_program_email",
  limit: 2,
  windowMs: 24 * HEURE,
  failClosed: true,
};

/** Réinitialisation de mot de passe : envoi d'email, cible potentiellement une victime. */
export const PASSWORD_RESET_IP: RateLimitRule = {
  name: "password_reset_ip",
  limit: 5,
  windowMs: HEURE,
  failClosed: true,
};

/** Par adresse visée : empêche le harcèlement d'une boîte précise. */
export const PASSWORD_RESET_EMAIL: RateLimitRule = {
  name: "password_reset_email",
  limit: 3,
  windowMs: HEURE,
  failClosed: true,
};

/** Création de session Stripe : appel facturé au projet. */
export const PROGRAM_CHECKOUT_IP: RateLimitRule = {
  name: "program_checkout_ip",
  limit: 10,
  windowMs: HEURE,
  failClosed: true,
};

/**
 * Consultation du statut d'un paiement : appelée en boucle courte par la page
 * de retour, donc quota large — mais elle interroge Stripe à chaque appel,
 * elle ne peut pas rester libre. (Depuis le correctif H-1, elle ne génère
 * plus aucun magiclink.)
 */
export const CHECKOUT_STATUS_IP: RateLimitRule = {
  name: "checkout_status_ip",
  limit: 60,
  windowMs: 5 * MINUTE,
  failClosed: false,
};

/** Garde anti-rejeu commune : deux appels identiques rapprochés. */
export const DOUBLE_SUBMIT: RateLimitRule = {
  name: "double_submit",
  limit: 1,
  windowMs: 20 * 1000,
};

/* ─────────────── Formulaires publics (correctif H-2) ─────────────── */

/**
 * Ces quatre routes utilisaient `lib/newsletter/rate-limit`, dont
 * l'extraction d'IP faisait confiance à `X-Forwarded-For` — un en-tête
 * fourni par le client. Il suffisait de le faire varier à chaque requête
 * pour ouvrir un compteur neuf, et le compteur mémoire ne survivait de
 * toute façon pas au partage entre instances serverless.
 *
 * `failClosed: true` (arbitrage Jules, 27/07/2026) : toutes produisent un
 * EFFET EXTERNE — un email part via Resend, un contact est créé chez Brevo.
 * Sans magasin partagé en production, la limite annoncée n'existe pas ; les
 * laisser passer reviendrait à offrir un relais d'envoi non borné, avec à la
 * clé la réputation du domaine expéditeur. Une indisponibilité visible vaut
 * mieux qu'une protection imaginaire.
 *
 * La route répond alors 503 (et non 429) avec un message générique : le
 * client n'apprend rien de l'infrastructure, et aucun effet externe n'est
 * déclenché — voir `refusDeLimite` dans lib/security/rate-limit.ts.
 */

/** Demande « Services aux entreprises » : envoie un email au coach. */
export const BUSINESS_INQUIRY_IP: RateLimitRule = {
  name: "business_inquiry_ip",
  limit: 3,
  windowMs: HEURE,
  failClosed: true,
};

/** Formulaire « Mon bilan offert » : envoie un email au coach. */
export const FREE_ASSESSMENT_IP: RateLimitRule = {
  name: "free_assessment_ip",
  limit: 3,
  windowMs: HEURE,
  failClosed: true,
};

/** Inscription à la newsletter : crée un contact Brevo. */
export const NEWSLETTER_SUBSCRIBE_IP: RateLimitRule = {
  name: "newsletter_subscribe_ip",
  limit: 5,
  windowMs: 10 * MINUTE,
  failClosed: true,
};

/** Désinscription : protégée par jeton signé, quota simplement anti-abus. */
export const NEWSLETTER_UNSUBSCRIBE_IP: RateLimitRule = {
  name: "newsletter_unsubscribe_ip",
  limit: 10,
  windowMs: 10 * MINUTE,
  failClosed: true,
};

/**
 * Recherche EXTERNE de produits (ALIMENTS A3 phase 4). Le quota protégé n'est
 * pas le nôtre : Open Food Facts limite les recherches à 10 par minute et par
 * IP — celle du SERVEUR, donc partagée par tous les élèves — et bannit les
 * récidivistes. Un seul élève impatient peut donc mettre la recherche hors
 * service pour tout le monde.
 *
 * La limite est posée PAR ÉLÈVE (la route la compose avec son identifiant),
 * et volontairement plus basse que celle d'OFF : 6 recherches par minute
 * laissent largement de quoi chercher, corriger sa frappe et rechercher, sans
 * qu'un seul compte puisse consommer le quota collectif.
 *
 * `failClosed` reste FAUX, à la différence des routes qui envoient des emails
 * ou créent des comptes : une recherche ne coûte rien et n'a aucun effet
 * durable. En production sans magasin partagé, une protection partielle en
 * mémoire vaut mieux qu'un refus qui casserait une fonctionnalité inoffensive.
 */
export const FOOD_PRODUCT_SEARCH_EXTERNAL: RateLimitRule = {
  name: "food_product_search_external",
  limit: 6,
  windowMs: MINUTE,
};

/** Recherche LOCALE : aucun appel sortant, quota large et purement anti-abus. */
export const FOOD_PRODUCT_SEARCH_LOCAL: RateLimitRule = {
  name: "food_product_search_local",
  limit: 60,
  windowMs: MINUTE,
};

/**
 * COURSES C4.1 — recherche de candidats par code Ciqual (administration du
 * pont produit). Quota RESSERRÉ par C4.1b, de 12 à 6 par minute.
 *
 * Un appel de curation déclenche DEUX sorties : une vers Open Food Facts
 * (`/api/v2/search`) et une ou plusieurs vers Open Prices. Le quota est donc
 * plus serré que celui de la recherche texte, alors même que l'appelant est
 * administrateur : les recherches de plusieurs utilisateurs de l'application
 * contribuent à NOTRE trafic vers Open Food Facts, et une session de curation
 * un peu vive ne doit pas ajouter inutilement de pression sur une source
 * bénévole pendant qu'un élève scanne son petit-déjeuner.
 *
 * ⚠️ FORMULÉ AINSI À DESSEIN. Décrire un compteur amont unique, ou une adresse
 * unique côté sortie, supposerait des faits que nous n'avons pas mesurés et
 * que l'egress dynamique de Vercel rend douteux. Ce que nous savons est plus
 * simple : notre trafic s'additionne, et le modérer est de notre ressort.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CE QUE CE GARDE-FOU PROTÈGE — ET CE QU'IL NE PROTÈGE PAS
 * ════════════════════════════════════════════════════════════════════════════
 * Il serait confortable de présenter ce quota comme une protection de l'amont.
 * Ce serait FAUX, et le croire ferait chercher ailleurs le jour où l'amont
 * refusera quand même. Trois limites, mesurées dans `consumeRateLimit` :
 *
 *   1. LA PORTÉE EST PAR ADMINISTRATEUR, PAS GLOBALE. La clé est
 *      `rl:food_bridge_search:<user.id>` : deux comptes d'administration
 *      consomment deux compteurs distincts, et l'amont voit la somme.
 *
 *   2. SANS UPSTASH, LE COMPTEUR EST EN MÉMOIRE — DONC PAR INSTANCE.
 *      `consumeRateLimit` n'utilise le magasin partagé que si
 *      `UPSTASH_REDIS_REST_URL` / `_TOKEN` sont configurées ; sinon il retombe
 *      sur `consumeFromMemory`. En serverless, chaque instance froide repart
 *      de zéro : le quota réel peut être un multiple de 6 par minute.
 *
 *   3. LE QUOTA LOCAL NE BORNE PAS TOUTES LES PROTECTIONS AMONT. Open Food
 *      Facts applique des limites par IP et peut également appliquer des
 *      protections globales, indépendantes de l'appelant. Par ailleurs
 *      l'egress de Vercel est dynamique. Un quota par administrateur, chez
 *      nous, ne garantit donc pas qu'une requête sera acceptée en face.
 *
 *      Fait mesuré le 18/08/2026 : un 503 HTML a été observé sur le chemin
 *      Vercel → Open Food Facts pour le code Ciqual 32140, à la minute où un
 *      poste de travail obtenait 200 sur la même requête. ⚠️ LA RAISON DE CE
 *      503 RESTE INCONNUE — lui attribuer une cause précise serait une
 *      hypothèse, pas une mesure, et une hypothèse écrite en commentaire finit
 *      toujours par être relue comme un fait.
 *
 * Ce quota est donc un frein à NOTRE emballement, pas un contrat avec l'amont.
 * C'est utile — c'est ce qui empêche une session de curation de marteler une
 * source bénévole — et c'est tout ce que c'est.
 *
 * `failClosed` reste faux, comme pour les autres recherches : refuser une
 * curation quand le compteur est injoignable ne protège rien, ça empêche
 * seulement de travailler, et l'administrateur réessaiera.
 */
export const FOOD_BRIDGE_SEARCH: RateLimitRule = {
  name: "food_bridge_search",
  limit: 6,
  windowMs: MINUTE,
};

/**
 * COURSES C4.3a — recherche de magasins proches.
 *
 * ⚠️ CHAQUE APPEL DÉCLENCHE JUSQU'À TROIS REQUÊTES chez un service bénévole,
 * et le geste produit est rare : on choisit son magasin une fois, puis on en
 * change de temps en temps. Un quota serré est donc sans effet sur l'usage
 * normal, et il empêche qu'un composant en boucle — ou un compte détourné —
 * fasse de SETH un robot d'aspiration d'Open Prices.
 */
export const STORES_NEARBY: RateLimitRule = {
  name: "stores_nearby",
  limit: 10,
  windowMs: MINUTE,
};

/**
 * COURSES C4.3a — enregistrement du magasin choisi.
 *
 * Plus serré encore : le choix relit la fiche chez l'amont PUIS écrit dans le
 * référentiel partagé. C'est la seule route par laquelle un élève fait entrer
 * une ligne dans `stores`.
 */
export const STORES_SELECT: RateLimitRule = {
  name: "stores_select",
  limit: 6,
  windowMs: MINUTE,
};

/**
 * COURSES C4.3b — recherche manuelle par ville.
 *
 * Même coût amont que la recherche géographique — jusqu'à trois requêtes chez
 * un service bénévole — mais un geste plus répétable : on corrige une faute de
 * frappe, on essaie la commune voisine. Quota un peu plus large, même ordre de
 * grandeur.
 */
export const STORES_SEARCH: RateLimitRule = {
  name: "stores_search",
  limit: 15,
  windowMs: MINUTE,
};

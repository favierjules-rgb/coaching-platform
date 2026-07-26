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
 * de retour, donc quota large — mais elle interroge Stripe et génère un
 * magiclink, elle ne peut pas rester libre.
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

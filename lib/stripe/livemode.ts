/**
 * Garde test/live des webhooks Stripe (Lot W1 — juillet 2026).
 *
 * Problème traité : rien n'empêchait un évènement du compte Stripe de TEST
 * d'être traité par un environnement configuré pour le LIVE, ni l'inverse.
 * L'audit a montré que la base de production ne contient aujourd'hui que
 * des évènements `livemode: false` — exactement le mélange que cette garde
 * doit rendre impossible.
 *
 * La règle est portée par une variable dédiée, `STRIPE_EXPECTED_LIVEMODE`,
 * et NON dérivée de NODE_ENV : un déploiement de préproduction tourne en
 * `NODE_ENV=production` tout en devant rester en mode test, et un
 * `NODE_ENV=development` pointant par erreur sur des clés live doit être
 * bloqué. Seule une variable explicite exprime l'intention réelle.
 *
 * Cette variable ne contient aucun secret (uniquement "true"/"false") mais
 * n'est volontairement PAS préfixée NEXT_PUBLIC_ : elle n'a aucune raison
 * d'être exposée au navigateur, et aucun secret Stripe ne doit jamais
 * l'être.
 */

export type StripeLivemodeGuardResult =
  | { ok: true; expectedLivemode: boolean }
  | { ok: false; reason: "not_configured" | "mismatch"; expectedLivemode: boolean | null; eventLivemode: boolean };

/**
 * Lit `STRIPE_EXPECTED_LIVEMODE`. Retourne `null` si la variable est
 * absente ou d'une valeur non reconnue — traité comme une erreur de
 * configuration, jamais comme une autorisation implicite.
 */
export function readExpectedLivemode(): boolean | null {
  const raw = process.env.STRIPE_EXPECTED_LIVEMODE?.trim().toLowerCase();
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Compare `event.livemode` à la valeur attendue. À appeler APRÈS la
 * vérification de signature (on ne fait confiance au champ `livemode`
 * qu'une fois l'authenticité de l'évènement établie) et AVANT toute
 * écriture en base : un évènement rejeté ici ne doit laisser aucune trace
 * dans `billing_events`, sans quoi il polluerait l'idempotence de
 * l'environnement légitime.
 */
export function checkStripeLivemode(eventLivemode: boolean): StripeLivemodeGuardResult {
  const expected = readExpectedLivemode();
  if (expected === null) {
    return { ok: false, reason: "not_configured", expectedLivemode: null, eventLivemode };
  }
  if (expected !== eventLivemode) {
    return { ok: false, reason: "mismatch", expectedLivemode: expected, eventLivemode };
  }
  return { ok: true, expectedLivemode: expected };
}

/**
 * Message d'alerte journalisable. Ne contient que deux booléens et un type
 * d'évènement — aucune clé, aucun secret, aucune donnée personnelle.
 */
export function describeLivemodeRejection(result: Extract<StripeLivemodeGuardResult, { ok: false }>, eventType: string): string {
  if (result.reason === "not_configured") {
    return `[Stripe webhook] STRIPE_EXPECTED_LIVEMODE absente ou invalide — évènement ${eventType} (livemode=${result.eventLivemode}) rejeté sans traitement.`;
  }
  return `[Stripe webhook] Mode incompatible — évènement ${eventType} livemode=${result.eventLivemode}, attendu ${result.expectedLivemode}. Rejeté sans traitement ni écriture.`;
}

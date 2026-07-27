import "server-only";

import { NextResponse } from "next/server";

/**
 * Limitation de fréquence — abstraction unique du projet (audit de sécurité,
 * juillet 2026, points H-2 / M-1 / M-2).
 *
 * Deux implémentations derrière une même interface :
 *
 *  - **Upstash Redis** en production : compteur RÉELLEMENT partagé entre les
 *    instances serverless. C'est le seul mode acceptable en ligne — sur
 *    Vercel, chaque instance a sa propre mémoire et redémarre à froid, si
 *    bien qu'un compteur local n'applique jamais la limite annoncée.
 *  - **Mémoire de processus** en développement et dans les tests, pour ne
 *    dépendre d'aucun service externe en local.
 *
 * Le choix n'est jamais silencieux : hors production, l'absence d'Upstash est
 * normale ; en production, elle fait échouer les routes coûteuses
 * (`failClosed`), plutôt que de laisser croire à une protection inexistante.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requêtes encore autorisées dans la fenêtre. */
  remaining: number;
  /** Millisecondes avant réouverture (0 si autorisé). */
  retryAfterMs: number;
  /** Implémentation ayant rendu la décision — utile aux tests et au diagnostic. */
  backend: "upstash" | "memory" | "unavailable";
}

export interface RateLimitRule {
  /** Préfixe fonctionnel, p. ex. `free_assessment`. */
  name: string;
  /** Nombre d'appels autorisés dans la fenêtre. */
  limit: number;
  /** Taille de la fenêtre, en millisecondes. */
  windowMs: number;
  /**
   * `true` pour une route coûteuse (création de compte, envoi d'email, appel
   * Stripe) : en production, si aucun magasin partagé n'est disponible, la
   * requête est REFUSÉE. Mieux vaut une indisponibilité visible qu'une porte
   * ouverte silencieuse.
   */
  failClosed?: boolean;
}

/* ─────────────── Magasin mémoire (développement et tests) ─────────────── */

interface Bucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, Bucket>();
/** Bornée : un attaquant ne peut pas faire grossir la table indéfiniment. */
const MAX_MEMORY_BUCKETS = 5000;

function consumeFromMemory(key: string, rule: RateLimitRule): RateLimitDecision {
  const now = Date.now();

  if (memoryBuckets.size > MAX_MEMORY_BUCKETS) {
    for (const [bucketKey, bucket] of memoryBuckets) {
      if (bucket.resetAt <= now) memoryBuckets.delete(bucketKey);
    }
  }

  const existing = memoryBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    memoryBuckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { allowed: true, remaining: rule.limit - 1, retryAfterMs: 0, backend: "memory" };
  }
  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, existing.resetAt - now),
      backend: "memory",
    };
  }
  existing.count += 1;
  return { allowed: true, remaining: rule.limit - existing.count, retryAfterMs: 0, backend: "memory" };
}

/** Réinitialise le magasin mémoire — réservé aux tests. */
export function resetMemoryRateLimits(): void {
  memoryBuckets.clear();
}

/* ─────────────── Magasin Upstash (production) ─────────────── */

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function isDistributedRateLimitConfigured(): boolean {
  return upstashConfig() !== null;
}

/**
 * Fenêtre fixe implémentée avec deux commandes atomiques (`INCR` puis
 * `PEXPIRE` au premier appel), via l'API REST d'Upstash — aucun client
 * persistant à gérer dans un environnement serverless, et donc aucune
 * dépendance npm supplémentaire.
 */
async function consumeFromUpstash(key: string, rule: RateLimitRule): Promise<RateLimitDecision | null> {
  const config = upstashConfig();
  if (!config) return null;

  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["PTTL", key],
      ]),
      // Une temporisation courte : la limitation ne doit jamais devenir le
      // facteur limitant du temps de réponse.
      signal: AbortSignal.timeout(2000),
      cache: "no-store",
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { result: number }[];
    const count = Number(payload[0]?.result ?? 0);
    let ttl = Number(payload[1]?.result ?? -1);

    // Premier appel de la fenêtre (ou clé sans expiration) : on pose le TTL.
    if (count === 1 || ttl < 0) {
      await fetch(`${config.url}/pexpire/${encodeURIComponent(key)}/${rule.windowMs}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}` },
        signal: AbortSignal.timeout(2000),
        cache: "no-store",
      });
      ttl = rule.windowMs;
    }

    if (count > rule.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, ttl), backend: "upstash" };
    }
    return { allowed: true, remaining: Math.max(0, rule.limit - count), retryAfterMs: 0, backend: "upstash" };
  } catch {
    // Réseau indisponible, temporisation dépassée, réponse illisible : on ne
    // laisse pas l'erreur remonter, `consume` décidera quoi faire selon
    // `failClosed`.
    return null;
  }
}

/* ─────────────── Point d'entrée ─────────────── */

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Consomme une unité de quota pour `identifier` (voir `rateLimitKey`).
 *
 * En production sans magasin partagé disponible :
 *  - route `failClosed` ⇒ refus (`backend: "unavailable"`) ;
 *  - route ordinaire ⇒ repli sur la mémoire locale, protection partielle
 *    assumée et sans conséquence financière.
 */
export async function consumeRateLimit(
  identifier: string,
  rule: RateLimitRule,
): Promise<RateLimitDecision> {
  const key = `rl:${rule.name}:${identifier}`;

  if (isDistributedRateLimitConfigured()) {
    const decision = await consumeFromUpstash(key, rule);
    if (decision) return decision;

    if (isProduction() && rule.failClosed) {
      console.error(`[RateLimit] Magasin partagé injoignable — refus (règle ${rule.name}).`);
      return { allowed: false, remaining: 0, retryAfterMs: rule.windowMs, backend: "unavailable" };
    }
  } else if (isProduction() && rule.failClosed) {
    console.error(
      `[RateLimit] UPSTASH_REDIS_REST_URL/TOKEN absentes en production — refus (règle ${rule.name}).`,
    );
    return { allowed: false, remaining: 0, retryAfterMs: rule.windowMs, backend: "unavailable" };
  }

  return consumeFromMemory(key, rule);
}

/* ─────────────── Identification de l'appelant ─────────────── */

/**
 * IP de l'appelant, telle que fournie par la PLATEFORME.
 *
 * `x-forwarded-for` n'est lu qu'en dernier recours et jamais en production :
 * un client peut le forger et obtenir un quota neuf à chaque requête (M-2).
 * Sur Vercel, `x-vercel-forwarded-for` et `x-real-ip` sont posés par le
 * routeur en amont et ne peuvent pas être usurpés par le client.
 */
export function getTrustedClientIp(request: Request): string {
  const vercelIp = request.headers.get("x-vercel-forwarded-for");
  if (vercelIp) return vercelIp.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  if (!isProduction()) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0].trim();
  }

  return "unknown";
}

/**
 * Clé composée : l'IP seule est trop facile à faire tourner (réseaux mobiles,
 * proxys), et le seul email permettrait à un attaquant unique de viser
 * successivement toutes ses victimes. On limite donc les deux dimensions.
 */
export function rateLimitKey(parts: (string | null | undefined)[]): string {
  return parts
    .map((part) => (part ?? "").trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join("|") || "unknown";
}

/** En-têtes normalisés d'une réponse 429. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))),
    "X-RateLimit-Remaining": String(decision.remaining),
  };
}

/* ─────────────── Refus normalisé ─────────────── */

/**
 * Message unique des refus pour indisponibilité. Volontairement muet sur la
 * cause : le client n'a pas à apprendre qu'un magasin Redis est injoignable,
 * ni même qu'il en existe un.
 */
export const MESSAGE_INDISPONIBLE =
  "Service temporairement indisponible. Merci de réessayer dans quelques minutes.";

/**
 * Traduit une décision de refus en réponse HTTP, en distinguant les deux
 * causes que les routes confondaient jusqu'ici :
 *
 *   - quota réellement dépassé          → 429, message métier de la route ;
 *   - magasin partagé indisponible      → 503, message générique.
 *
 * La distinction n'est pas cosmétique. Un 429 dit « tu as trop demandé » et
 * invite à ralentir ; un 503 dit « le service ne peut pas garantir la limite
 * en ce moment » et n'accuse personne. Surtout, sur une route `failClosed`,
 * le 503 signale que RIEN n'a été déclenché : aucun email, aucun appel à un
 * service tiers.
 *
 * Centralisé ici pour qu'aucune route ne puisse l'oublier — c'est
 * précisément le genre de branche qu'on oublie en la recopiant.
 */
export function refusDeLimite(decision: RateLimitDecision, messageQuota: string): NextResponse {
  const headers = rateLimitHeaders(decision);
  if (decision.backend === "unavailable") {
    return NextResponse.json({ error: MESSAGE_INDISPONIBLE }, { status: 503, headers });
  }
  return NextResponse.json({ error: messageQuota }, { status: 429, headers });
}

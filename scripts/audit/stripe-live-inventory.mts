/**
 * Inventaire Stripe LIVE — LECTURE SEULE (Lot W1, juillet 2026).
 *
 * ⚠️ CE SCRIPT N'A JAMAIS ÉTÉ EXÉCUTÉ. Il est fourni prêt à l'emploi, à
 * lancer manuellement lorsque tu le décideras.
 *
 * ══ GARANTIES ═══════════════════════════════════════════════════════════
 * - Uniquement des appels `.list()` / `.retrieve()` (GET). Aucune méthode
 *   `create`, `update`, `del` ou `cancel` n'est importée ni appelée.
 * - Aucune écriture Supabase : le script ne se connecte pas à la base.
 * - La clé est lue depuis `STRIPE_RESTRICTED_READ_KEY`, jamais passée en
 *   argument de ligne de commande (visible dans l'historique shell et dans
 *   `ps`), jamais écrite dans un fichier, jamais journalisée — même
 *   tronquée.
 * - Aucun en-tête d'authentification n'est journalisé.
 * - Les identifiants clients sont masqués par défaut dans la sortie
 *   lisible (`--reveal-ids` pour les afficher lors d'une revue manuelle).
 *
 * ══ CLÉ RESTREINTE ══════════════════════════════════════════════════════
 * Créer dans le Dashboard Stripe (Développeurs → Clés API → Clé
 * restreinte) une clé avec les permissions **Read** uniquement sur :
 * Products, Prices, Subscriptions, Subscription Schedules, Customers,
 * Invoices. Aucune permission Write. Ne jamais utiliser la clé secrète
 * complète pour ce script.
 *
 * ══ UTILISATION ═════════════════════════════════════════════════════════
 *   STRIPE_RESTRICTED_READ_KEY=… npx tsx scripts/audit/stripe-live-inventory.mts
 *   STRIPE_RESTRICTED_READ_KEY=… npx tsx scripts/audit/stripe-live-inventory.mts --json > inventaire.json
 *
 * (Préfixer la commande d'un espace pour éviter l'historique shell, ou
 * exporter la variable depuis un fichier d'environnement non versionné.)
 */

import Stripe from "stripe";

const REVEAL_IDS = process.argv.includes("--reveal-ids");
const JSON_OUTPUT = process.argv.includes("--json");

const apiKey = process.env.STRIPE_RESTRICTED_READ_KEY;
if (!apiKey) {
  console.error(
    "STRIPE_RESTRICTED_READ_KEY absente.\n" +
      "Définir une clé restreinte en LECTURE SEULE (voir l'en-tête de ce fichier).\n" +
      "Ne jamais utiliser la clé secrète complète pour cet inventaire.",
  );
  process.exit(1);
}

const stripe = new Stripe(apiKey);

/** Masque un identifiant : `cus_UsE1G3tdasjeDc` → `cus_…sjeDc`. */
function mask(id: string | null | undefined): string {
  if (!id) return "—";
  if (REVEAL_IDS) return id;
  const prefix = id.split("_")[0] ?? "";
  return `${prefix}_…${id.slice(-5)}`;
}

function euro(cents: number | null | undefined, currency = "eur"): string {
  if (cents === null || cents === undefined) return "—";
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

interface Finding {
  severity: "info" | "warning" | "critical";
  kind: string;
  detail: string;
}

const findings: Finding[] = [];
function flag(severity: Finding["severity"], kind: string, detail: string): void {
  findings.push({ severity, kind, detail });
}

async function main(): Promise<void> {
  // ── Produits et prix ─────────────────────────────────────────────────
  const products: Stripe.Product[] = [];
  for await (const p of stripe.products.list({ limit: 100 })) products.push(p);

  const prices: Stripe.Price[] = [];
  for await (const pr of stripe.prices.list({ limit: 100 })) prices.push(pr);

  // ── Abonnements (tous statuts) ───────────────────────────────────────
  const subscriptions: Stripe.Subscription[] = [];
  for await (const s of stripe.subscriptions.list({ status: "all", limit: 100 })) subscriptions.push(s);

  // ── Subscription Schedules ───────────────────────────────────────────
  const schedules: Stripe.SubscriptionSchedule[] = [];
  for await (const sc of stripe.subscriptionSchedules.list({ limit: 100 })) schedules.push(sc);

  // ── Clients ──────────────────────────────────────────────────────────
  const customers: Stripe.Customer[] = [];
  for await (const c of stripe.customers.list({ limit: 100 })) customers.push(c);

  // ══ ANALYSE ═════════════════════════════════════════════════════════
  const livemodeSubs = subscriptions.filter((s) => s.livemode);
  if (livemodeSubs.length !== subscriptions.length) {
    flag("warning", "mixed_livemode", `${subscriptions.length - livemodeSubs.length} abonnement(s) en mode test dans cet inventaire.`);
  }

  // Metadata manquante → irrattachable à un élève
  for (const s of subscriptions) {
    if (!s.metadata?.student_id) {
      flag("warning", "missing_student_metadata", `Abonnement ${mask(s.id)} sans metadata.student_id — revue manuelle requise.`);
    }
    if (!s.metadata?.template_id) {
      flag("info", "missing_template_metadata", `Abonnement ${mask(s.id)} sans metadata.template_id.`);
    }
  }

  // Plusieurs abonnements vivants pour un même client
  const liveStatuses = new Set(["active", "past_due", "trialing", "unpaid"]);
  const byCustomer = new Map<string, Stripe.Subscription[]>();
  for (const s of subscriptions) {
    if (!liveStatuses.has(s.status)) continue;
    const cust = typeof s.customer === "string" ? s.customer : s.customer?.id;
    if (!cust) continue;
    byCustomer.set(cust, [...(byCustomer.get(cust) ?? []), s]);
  }
  for (const [cust, subs] of byCustomer) {
    if (subs.length > 1) {
      flag("critical", "multiple_live_subscriptions", `Client ${mask(cust)} : ${subs.length} abonnements vivants (${subs.map((s) => mask(s.id)).join(", ")}).`);
    }
    // Doublons exacts : même prix
    const priceIds = subs.map((s) => s.items.data[0]?.price?.id).filter(Boolean);
    if (new Set(priceIds).size !== priceIds.length) {
      flag("critical", "duplicate_same_price", `Client ${mask(cust)} : plusieurs abonnements vivants sur le MÊME price — doublon probable.`);
    }
  }

  // Schedules non conformes au modèle cible (3 ou 6 itérations, end_behavior=cancel)
  for (const sc of schedules) {
    if (sc.end_behavior !== "cancel") {
      flag("critical", "schedule_end_behavior", `Schedule ${mask(sc.id)} : end_behavior="${sc.end_behavior}" (attendu "cancel") — risque de prélèvement surnuméraire.`);
    }
    // `iterations` n'est pas exposé sur le type `Phase` de cette version du
    // SDK (il l'est sur les paramètres de création, pas sur l'objet lu) :
    // lecture défensive sans `any`, la valeur reste purement informative.
    const firstPhase = sc.phases?.[0] as unknown as { iterations?: number | null } | undefined;
    const iterations = firstPhase?.iterations ?? null;
    if (iterations !== null && iterations !== 3 && iterations !== 6) {
      flag("warning", "schedule_iterations", `Schedule ${mask(sc.id)} : ${iterations} itérations (attendu 3 ou 6).`);
    }
    if (sc.status === "released") {
      flag("critical", "schedule_released", `Schedule ${mask(sc.id)} en statut "released" — l'abonnement associé peut se facturer indéfiniment.`);
    }
  }

  // Écart entre start_date et la première facture
  for (const s of subscriptions) {
    const invoices: Stripe.Invoice[] = [];
    for await (const inv of stripe.invoices.list({ subscription: s.id, limit: 100 })) invoices.push(inv);
    const paid = invoices.filter((i) => i.status === "paid").sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
    const first = paid[0];
    if (first && Math.abs((first.created ?? 0) - s.start_date) > 3 * 24 * 3600) {
      flag("warning", "start_date_mismatch", `Abonnement ${mask(s.id)} : écart > 3 jours entre start_date et la 1re facture payée — revue manuelle.`);
    }
    if (paid.length === 0 && liveStatuses.has(s.status)) {
      flag("warning", "no_paid_invoice", `Abonnement ${mask(s.id)} actif sans facture payée.`);
    }
  }

  // Prix utilisés par un abonnement mais absents du catalogue listé
  const knownPriceIds = new Set(prices.map((p) => p.id));
  for (const s of subscriptions) {
    const pid = s.items.data[0]?.price?.id;
    if (pid && !knownPriceIds.has(pid)) {
      flag("warning", "unknown_price", `Abonnement ${mask(s.id)} référence un price absent du catalogue actif (${mask(pid)}).`);
    }
  }

  // ══ SORTIE ══════════════════════════════════════════════════════════
  if (JSON_OUTPUT) {
    // Sortie brute pour archivage. Aucune clé, aucun en-tête d'auth.
    console.log(
      JSON.stringify(
        {
          livemode: subscriptions[0]?.livemode ?? null,
          counts: {
            products: products.length,
            prices: prices.length,
            subscriptions: subscriptions.length,
            schedules: schedules.length,
            customers: customers.length,
          },
          findings,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("═══ INVENTAIRE STRIPE — LECTURE SEULE ═══\n");
  console.log(`Produits    : ${products.length}`);
  console.log(`Prix        : ${prices.length}`);
  console.log(`Abonnements : ${subscriptions.length} (dont ${livemodeSubs.length} en livemode)`);
  console.log(`Schedules   : ${schedules.length}`);
  console.log(`Clients     : ${customers.length}\n`);

  console.log("─── Prix ───");
  for (const p of prices) {
    const rec = p.recurring ? `${p.recurring.interval_count}×${p.recurring.interval}` : "one_time";
    console.log(`  ${mask(p.id)}  ${euro(p.unit_amount, p.currency)}  ${rec}  ${p.active ? "actif" : "inactif"}`);
  }

  console.log("\n─── Abonnements ───");
  for (const s of subscriptions) {
    const cust = typeof s.customer === "string" ? s.customer : s.customer?.id;
    console.log(
      `  ${mask(s.id)}  ${s.status.padEnd(18)} client=${mask(cust)}  ` +
        `student_id=${s.metadata?.student_id ? "oui" : "MANQUANT"}  schedule=${s.schedule ? "oui" : "non"}`,
    );
  }

  console.log("\n─── Points d'attention ───");
  if (findings.length === 0) {
    console.log("  Aucun.");
  } else {
    for (const sev of ["critical", "warning", "info"] as const) {
      for (const f of findings.filter((x) => x.severity === sev)) {
        console.log(`  [${sev.toUpperCase()}] ${f.kind} — ${f.detail}`);
      }
    }
  }

  const criticals = findings.filter((f) => f.severity === "critical").length;
  console.log(`\n${criticals} point(s) critique(s), ${findings.length} au total.`);
  console.log("Aucun objet Stripe n'a été modifié. Aucune écriture Supabase.");
}

main().catch((error: unknown) => {
  // Ne jamais journaliser l'objet d'erreur brut : les erreurs Stripe
  // peuvent contenir la requête et ses en-têtes d'authentification.
  const message = error instanceof Error ? error.message : "Erreur inconnue.";
  console.error(`Échec de l'inventaire : ${message}`);
  process.exit(1);
});

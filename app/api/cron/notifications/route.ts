import { NextResponse } from "next/server";

import {
  balayerInterrompus,
  campagnesAEcheance,
  majCampagne,
  type Campagne,
} from "@/lib/notifications/depot";
import { statutCampagneDepuisOccurrence, traiterEcheance } from "@/lib/notifications/execution";
import { lireRegle, prochaineEcheance } from "@/lib/notifications/recurrence";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * LE PLANIFICATEUR — APPELÉ CHAQUE MINUTE, SANS CONSÉQUENCE S'IL L'EST DEUX FOIS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * QUI L'APPELLE
 * ════════════════════════════════════════════════════════════════════════
 * `pg_cron` chaque minute → `pg_net.http_post` → cette route, avec
 * `Authorization: Bearer $NOTIFICATION_CRON_SECRET`. Le secret est DISTINCT
 * de `CRON_SECRET` : les tâches Vercel existantes (purges de vidéos) n'ont
 * aucune raison de pouvoir déclencher des notifications, ni l'inverse. Sans
 * secret configuré, la route refuse tout — jamais ouverte par défaut.
 *
 * L'ordre `cron.schedule` n'est pas versionné : il porterait le secret. Voir
 * `docs/notifications-scheduler.md`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'IDEMPOTENCE N'EST PAS DANS CE FICHIER — ELLE EST DANS LA BASE
 * ════════════════════════════════════════════════════════════════════════
 *   • `unique (campaign_id, scheduled_for)` — une seule occurrence par
 *     échéance, quel que soit le nombre d'appelants ;
 *   • `update … where status = 'en_attente'` — un seul réserve ;
 *   • `unique (occurrence_id, subscription_id)` — un appareil servi une fois,
 *     et les deux appareils d'un même élève servis chacun une fois.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AT-MOST-ONCE
 * ════════════════════════════════════════════════════════════════════════
 * Si le processus tombe entre le push et son écriture, l'envoi reste
 * `en_cours` : le balayage le nomme `interrompue` et son occurrence devient
 * `echouee` — état TERMINAL, que `reserverOccurrence` n'accepte plus. Aucun
 * réessai : mieux vaut un rappel manquant qu'un rappel en double à 08:00.
 */

/** Au-delà, un envoi « en cours » ne l'est plus : personne ne le finira. */
const DELAI_INTERRUPTION_MS = 10 * 60 * 1000;

/**
 * L'échéance suivante d'une campagne récurrente, calculée depuis l'échéance
 * TRAITÉE et non depuis « maintenant » : un planificateur en retard de trois
 * minutes ne doit pas décaler le rendez-vous hebdomadaire de trois minutes,
 * semaine après semaine.
 */
export function echeanceSuivante(campagne: Campagne, echeanceTraitee: string): string | null {
  if (campagne.genreProgrammation !== "recurring") return null;
  const regle = lireRegle(campagne.recurrence);
  if (!regle) return null;
  const suivante = prochaineEcheance(regle, campagne.fuseau, new Date(echeanceTraitee));
  return suivante ? suivante.toISOString() : null;
}

export async function POST(request: Request) {
  const secret = process.env.NOTIFICATION_CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "NOTIFICATION_CRON_SECRET non configuré." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const maintenant = new Date();
  let occurrencesTraitees = 0;
  let envoyes = 0;
  let echoues = 0;

  const interrompus = await balayerInterrompus(
    admin,
    new Date(maintenant.getTime() - DELAI_INTERRUPTION_MS).toISOString(),
  );

  const campagnes = await campagnesAEcheance(admin, maintenant.toISOString());

  for (const campagne of campagnes) {
    const echeance = campagne.prochaineEcheance;
    if (!echeance) continue;

    // L'échéance suivante est posée AVANT l'envoi : une campagne hebdomadaire
    // dont l'envoi échoue ne doit pas rester bloquée sur lundi dernier et
    // repartir à chaque minute.
    const suivante = echeanceSuivante(campagne, echeance);
    await majCampagne(admin, campagne.id, {
      prochaineEcheance: suivante,
      // Une campagne ponctuelle a fini sa vie : plus d'échéance, plus active.
      active: suivante !== null,
    });

    const bilan = await traiterEcheance(admin, campagne, echeance);
    if (!bilan.occurrenceId) continue;

    occurrencesTraitees += 1;
    envoyes += bilan.envoyes;
    echoues += bilan.echoues;

    await majCampagne(admin, campagne.id, {
      statut: suivante ? "programmee" : statutCampagneDepuisOccurrence(bilan.statut),
    });
  }

  return NextResponse.json({
    ok: true,
    campagnes: campagnes.length,
    occurrences: occurrencesTraitees,
    envoyes,
    echoues,
    interrompus,
  });
}

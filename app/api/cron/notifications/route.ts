import { NextResponse } from "next/server";

import {
  balayerInterrompus,
  campagnesAEcheance,
  majCampagne,
  retraitDuPlanificateur,
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
  /** Campagnes dont l'avance n'a pas pu être écrite : rien n'a été tenté. */
  let bloquees = 0;
  /** Échéances dont l'occurrence appartenait déjà à quelqu'un : normal. */
  let dejaTraitees = 0;
  /** Échéances abandonnées sur une base qui ne répond pas : anormal. */
  let erreurs = 0;
  /** Envois partis dont le statut de campagne n'a pas pu être écrit. */
  let statutsNonEcrits = 0;

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

    // UNE CAMPAGNE TERMINÉE GARDE SON ÉCHÉANCE — ELLE NE LA PERD PAS.
    //
    // Clore une campagne en écrivant `next_run_at = null` était refusé par
    // `notification_campaigns_echeance_coherente` dès que `schedule_kind` vaut
    // autre chose que `now`. L'`update` échouait, la campagne restait `active`
    // avec une échéance passée, et ce même bloc la reprenait à la minute
    // suivante — indéfiniment. `retraitDuPlanificateur` porte désormais
    // l'invariant, et il le porte pour les trois appelants.
    const avance = await majCampagne(
      admin,
      campagne.id,
      suivante === null
        ? retraitDuPlanificateur(campagne.genreProgrammation, echeance)
        : { prochaineEcheance: suivante },
    );

    // L'AVANCE N'EST PAS ÉCRITE : ON NE TRAITE PAS L'ÉCHÉANCE.
    //
    // Traiter une échéance sans avoir pu déplacer sa campagne, c'est la
    // remettre au menu du passage suivant. On s'arrête donc AVANT toute
    // occurrence et tout push — le résultat de `majCampagne` n'est plus
    // ignoré — et `bloquees` le dit dans la réponse : un planificateur qui
    // répond `bloquees: 6` chaque minute est un incident VISIBLE, là où la
    // version précédente répondait `ok: true` en bouclant.
    if (!avance) {
      bloquees += 1;
      continue;
    }

    const bilan = await traiterEcheance(admin, campagne, echeance);
    if (!bilan.occurrenceId) {
      // `deja-reservee` est l'idempotence qui fonctionne ; l'autre est une
      // base qui ne répond pas. Les confondre, c'est rendre une panne muette.
      if (bilan.raison === "deja-reservee") dejaTraitees += 1;
      else erreurs += 1;
      continue;
    }

    occurrencesTraitees += 1;
    envoyes += bilan.envoyes;
    echoues += bilan.echoues;

    // CETTE ÉCRITURE NON PLUS N'EST PAS IGNORÉE.
    //
    // Elle ne porte que `status`, donc aucune contrainte ne peut la refuser
    // aujourd'hui — mais c'était déjà le raisonnement qui a laissé l'autre
    // échouer en silence pendant quarante jours. Le push est PARTI : on ne
    // peut plus rien annuler, alors on compte et on le dit.
    const statutEcrit = await majCampagne(admin, campagne.id, {
      statut: suivante ? "programmee" : statutCampagneDepuisOccurrence(bilan.statut),
    });
    if (!statutEcrit) statutsNonEcrits += 1;
  }

  // LE CONTRAT HTTP DISTINGUE LES CINQ SORTIES D'UNE ÉCHÉANCE.
  //
  // `campagnes` : vues à échéance. `occurrences` : réellement traitées.
  // `dejaTraitees` : échéances qu'un autre passage tenait déjà. `bloquees` :
  // campagnes qui n'ont pas pu avancer, donc rien n'a été tenté. `erreurs` :
  // occurrences abandonnées sur une base muette. `statutsNonEcrits` : envois
  // partis dont le statut de campagne n'a pas pu être écrit. Les champs
  // précédents ne changent ni de nom ni de sens — QUATRE s'ajoutent, aucun
  // ne disparaît.
  //
  // `ok` reste `true` : le passage s'est bien déroulé en tant que passage.
  // Ce sont `bloquees` et `erreurs` qui portent l'anomalie, parce qu'un 500
  // ferait recommencer pg_cron à la minute suivante sans rien changer.
  return NextResponse.json({
    ok: true,
    campagnes: campagnes.length,
    occurrences: occurrencesTraitees,
    dejaTraitees,
    bloquees,
    erreurs,
    statutsNonEcrits,
    envoyes,
    echoues,
    interrompus,
  });
}

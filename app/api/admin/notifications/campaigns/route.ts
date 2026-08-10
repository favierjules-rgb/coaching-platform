import { NextResponse } from "next/server";

import { requireAdmin, requireStaff, requireStaffForStudent } from "@/lib/api/authz";
import {
  cibles,
  creerCampagne,
  envois,
  listerCampagnes,
  majCampagne,
  occurrences,
  remplacerCibles,
} from "@/lib/notifications/depot";
import { statutCampagneDepuisOccurrence, traiterEcheance } from "@/lib/notifications/execution";
import { lireRegle, prochaineEcheance } from "@/lib/notifications/recurrence";
import { lireSaisie } from "@/lib/notifications/saisie";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * LES CAMPAGNES — CRÉATION ET LECTURE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * QUI PEUT VISER QUI
 * ════════════════════════════════════════════════════════════════════════
 * « Tout le monde » est réservé à l'ADMINISTRATEUR : c'est le seul geste du
 * produit qui touche tous les élèves d'un coup, et il n'a pas à être à la
 * portée d'un coach dont le périmètre est sa propre liste.
 *
 * « Plusieurs élèves » est autorisé élève par élève, avec la garde qui
 * existait déjà pour toute action nominative — `requireStaffForStudent`.
 * Un coach qui glisse dans sa liste l'élève d'un confrère est refusé sur
 * CET élève, pas seulement sur l'ensemble.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI SORT D'ICI
 * ════════════════════════════════════════════════════════════════════════
 * Des campagnes, des occurrences et des COMPTES d'envois. Jamais un
 * endpoint, une clé, ni même l'identifiant d'un abonnement.
 */

async function autoriserCible(genre: "all" | "students", studentIds: string[]) {
  if (genre === "all") return requireAdmin();
  // Le premier refus arrête tout : une campagne partiellement autorisée
  // serait une campagne dont personne ne sait qui elle vise vraiment.
  let dernier = await requireStaffForStudent(studentIds[0]);
  for (const id of studentIds.slice(1)) {
    if (!dernier.ok) return dernier;
    dernier = await requireStaffForStudent(id);
  }
  return dernier;
}

export async function GET() {
  const acces = await requireStaff();
  if (!acces.ok) return acces.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  const toutes = await listerCampagnes(admin);
  // Un coach ne voit que ce qu'il a créé ; l'administrateur voit tout.
  const visibles = acces.estAdmin ? toutes : toutes.filter((c) => c.createdBy === acces.user.id);

  const listeOccurrences = await occurrences(admin, visibles.map((c) => c.id));
  const listeEnvois = await envois(admin, listeOccurrences.map((o) => o.id));

  const campagnes = await Promise.all(
    visibles.map(async (c) => ({
      id: c.id,
      titre: c.titre,
      corps: c.corps,
      destination: c.destination,
      genreCible: c.genreCible,
      genreProgrammation: c.genreProgrammation,
      fuseau: c.fuseau,
      recurrence: c.recurrence,
      prochaineEcheance: c.prochaineEcheance,
      active: c.active,
      statut: c.statut,
      studentIds: c.genreCible === "students" ? await cibles(admin, c.id) : [],
    })),
  );

  const historique = listeOccurrences.map((o) => {
    const siens = listeEnvois.filter((e) => e.occurrenceId === o.id);
    const interrompus = siens.filter((e) => e.statut === "interrompue").length;
    const campagne = visibles.find((c) => c.id === o.campaignId);
    return {
      id: o.id,
      campaignId: o.campaignId,
      echeance: o.echeance,
      termineeLe: o.termineeLe,
      // « interrompue » et « annulée » ne sont pas des états stockés de
      // l'occurrence : ils se LISENT sur des faits stockés — un envoi resté
      // interrompu, ou une campagne annulée. Voir docs.
      statut:
        interrompus > 0
          ? "interrompue"
          : o.statut === "en_attente" && campagne?.statut === "annulee"
            ? "annulee"
            : o.statut,
      envoyes: siens.filter((e) => e.statut === "envoyee").length,
      echoues: siens.filter((e) => e.statut === "echouee").length,
      interrompus,
    };
  });

  return NextResponse.json({ ok: true, campagnes, historique });
}

export async function POST(request: Request) {
  // Une garde AVANT toute lecture du corps : un élève ne doit même pas
  // apprendre quelles saisies sont valides.
  const staff = await requireStaff();
  if (!staff.ok) return staff.response;

  let brut: unknown = {};
  try {
    brut = await request.json();
  } catch {
    brut = {};
  }

  const maintenant = new Date();
  const lecture = lireSaisie(brut, maintenant);
  if (!lecture.ok) return NextResponse.json({ error: lecture.erreur }, { status: 400 });
  const s = lecture.saisie;

  const acces = await autoriserCible(s.genreCible, s.studentIds);
  if (!acces.ok) return acces.response;

  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service indisponible." }, { status: 503 });

  // Pour une récurrence, la première échéance se calcule ici : elle dépend du
  // calendrier du fuseau, pas de ce que le navigateur a bien voulu envoyer.
  let echeance = s.prochaineEcheance;
  if (s.genreProgrammation === "recurring") {
    const regle = lireRegle(s.recurrence);
    const premiere = regle ? prochaineEcheance(regle, s.fuseau, maintenant) : null;
    if (!premiere) return NextResponse.json({ error: "Règle de répétition invalide." }, { status: 400 });
    echeance = premiere.toISOString();
  }

  const campagne = await creerCampagne(admin, {
    createdBy: acces.user.id,
    titre: s.titre,
    corps: s.corps,
    destination: s.destination,
    genreCible: s.genreCible,
    genreProgrammation: s.genreProgrammation,
    fuseau: s.fuseau,
    recurrence: s.recurrence,
    prochaineEcheance: echeance,
  });
  if (!campagne) return NextResponse.json({ error: "La campagne n'a pas pu être créée." }, { status: 500 });

  if (s.genreCible === "students") {
    await remplacerCibles(admin, campagne.id, s.studentIds);
  }

  if (s.genreProgrammation !== "now") {
    return NextResponse.json({
      ok: true,
      campagneId: campagne.id,
      prochaineEcheance: echeance,
      envoyes: 0,
      echoues: 0,
      appareilsCibles: 0,
    });
  }

  // « Maintenant » emprunte EXACTEMENT le chemin du planificateur : même
  // occurrence, mêmes contraintes d'unicité, même traitement des 410.
  const bilan = await traiterEcheance(admin, campagne, maintenant.toISOString());
  await majCampagne(admin, campagne.id, {
    active: false,
    prochaineEcheance: null,
    statut: statutCampagneDepuisOccurrence(bilan.statut),
  });

  return NextResponse.json({
    ok: true,
    campagneId: campagne.id,
    prochaineEcheance: null,
    appareilsCibles: bilan.appareilsCibles,
    envoyes: bilan.envoyes,
    echoues: bilan.echoues,
  });
}

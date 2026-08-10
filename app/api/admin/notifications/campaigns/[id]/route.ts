import { NextResponse } from "next/server";

import { requireAdmin, requireStaff, requireStaffForStudent } from "@/lib/api/authz";
import { lireCampagne, majCampagne, remplacerCibles } from "@/lib/notifications/depot";
import { lireRegle, prochaineEcheance } from "@/lib/notifications/recurrence";
import { estDestinationInterne } from "@/lib/push/destinations";
import { LIMITE_CORPS, LIMITE_TITRE } from "@/lib/notifications/saisie";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * PAUSE, MODIFICATION, ANNULATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI NE SE RÉÉCRIT JAMAIS
 * ════════════════════════════════════════════════════════════════════════
 * Les occurrences déjà parties. Modifier une campagne change ce qui SUIVRA :
 * les envois passés gardent le message qu'ils portaient, sinon l'historique
 * deviendrait un faux — « voici ce qu'on a envoyé » alors qu'on lit le texte
 * d'aujourd'hui. Aucune écriture de cette route ne touche
 * `notification_occurrences` ni `notification_deliveries`.
 *
 * SUPPRESSION = ANNULATION. `status = 'annulee'`, `active = false`,
 * `next_run_at = null`. La ligne reste, donc l'historique reste rattachable.
 * Un `delete` ferait disparaître par cascade tout ce qui a été envoyé.
 *
 * RÉACTIVATION = RECALCUL. On ne remet pas l'ancienne échéance en place :
 * elle est probablement passée, et la campagne partirait immédiatement, puis
 * à chaque minute. `next_run_at` est recalculé depuis maintenant.
 */

async function autorisee(id: string) {
  const staff = await requireStaff();
  if (!staff.ok) return { refus: staff.response };

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return { refus: NextResponse.json({ error: "Service indisponible." }, { status: 503 }) };
  }

  const campagne = await lireCampagne(admin, id);
  if (!campagne) {
    return { refus: NextResponse.json({ error: "Campagne introuvable." }, { status: 404 }) };
  }
  // Un coach n'agit que sur ce qu'il a créé. Même code qu'une campagne
  // inexistante n'aurait rien apporté : ici la campagne est nommée par
  // quelqu'un qui a déjà le droit d'en lister.
  if (!staff.estAdmin && campagne.createdBy !== staff.user.id) {
    return { refus: NextResponse.json({ error: "Accès refusé." }, { status: 403 }) };
  }
  return { admin, campagne, staff };
}

export async function PATCH(request: Request, contexte: { params: Promise<{ id: string }> }) {
  const { id } = await contexte.params;
  const resultat = await autorisee(id);
  if (resultat.refus) return resultat.refus;
  const { admin, campagne } = resultat;

  let brut: Record<string, unknown> = {};
  try {
    brut = (await request.json()) as Record<string, unknown>;
  } catch {
    brut = {};
  }

  const patch: Parameters<typeof majCampagne>[2] = {};

  if (typeof brut.titre === "string") {
    const titre = brut.titre.trim();
    if (titre.length === 0 || titre.length > LIMITE_TITRE) {
      return NextResponse.json({ error: "Titre invalide." }, { status: 400 });
    }
    patch.titre = titre;
  }
  if (typeof brut.corps === "string") {
    const corps = brut.corps.trim();
    if (corps.length === 0 || corps.length > LIMITE_CORPS) {
      return NextResponse.json({ error: "Message invalide." }, { status: 400 });
    }
    patch.corps = corps;
  }
  if (typeof brut.destination === "string") {
    if (!estDestinationInterne(brut.destination)) {
      return NextResponse.json({ error: "Destination refusée." }, { status: 400 });
    }
    patch.destination = brut.destination;
  }

  // Changer la cible pour « tout le monde » est un geste d'administrateur,
  // exactement comme à la création.
  if (brut.cible && typeof brut.cible === "object") {
    const cible = brut.cible as Record<string, unknown>;
    if (cible.genre === "all") {
      const admin1 = await requireAdmin();
      if (!admin1.ok) return admin1.response;
      patch.genreCible = "all";
      await remplacerCibles(admin, id, []);
    } else if (cible.genre === "students" && Array.isArray(cible.studentIds)) {
      const ids = cible.studentIds.filter((v): v is string => typeof v === "string");
      if (ids.length === 0) return NextResponse.json({ error: "Aucun élève sélectionné." }, { status: 400 });
      for (const studentId of ids) {
        const acces = await requireStaffForStudent(studentId);
        if (!acces.ok) return acces.response;
      }
      patch.genreCible = "students";
      await remplacerCibles(admin, id, ids);
    }
  }

  // Récurrence : la règle change, donc l'échéance aussi. La recalculer est
  // le seul moyen d'obtenir « le prochain mardi 20:00 » plutôt que « dans
  // sept jours à partir de l'ancienne heure ».
  let regleCourante = lireRegle(campagne.recurrence);
  if (brut.recurrence !== undefined) {
    const regle = lireRegle(brut.recurrence);
    if (!regle) return NextResponse.json({ error: "Règle de répétition invalide." }, { status: 400 });
    patch.recurrence = regle;
    regleCourante = regle;
  }

  if (typeof brut.active === "boolean") {
    patch.active = brut.active;
    if (brut.active) {
      // RÉACTIVATION : on recalcule, jamais on ne restaure.
      if (campagne.genreProgrammation === "recurring" && regleCourante) {
        const suivante = prochaineEcheance(regleCourante, campagne.fuseau, new Date());
        patch.prochaineEcheance = suivante ? suivante.toISOString() : null;
      }
      if (campagne.statut === "annulee") patch.statut = "programmee";
    } else {
      // PAUSE : plus aucune échéance à venir, la ligne reste intacte.
      patch.prochaineEcheance = null;
    }
  } else if (patch.recurrence && campagne.active && campagne.genreProgrammation === "recurring") {
    const suivante = regleCourante ? prochaineEcheance(regleCourante, campagne.fuseau, new Date()) : null;
    patch.prochaineEcheance = suivante ? suivante.toISOString() : null;
  }

  const ok = await majCampagne(admin, id, patch);
  if (!ok) return NextResponse.json({ error: "Modification refusée." }, { status: 500 });

  const relue = await lireCampagne(admin, id);
  return NextResponse.json({
    ok: true,
    active: relue?.active ?? false,
    statut: relue?.statut ?? campagne.statut,
    prochaineEcheance: relue?.prochaineEcheance ?? null,
  });
}

export async function DELETE(_request: Request, contexte: { params: Promise<{ id: string }> }) {
  const { id } = await contexte.params;
  const resultat = await autorisee(id);
  if (resultat.refus) return resultat.refus;
  const { admin } = resultat;

  await majCampagne(admin, id, { active: false, prochaineEcheance: null, statut: "annulee" });
  return NextResponse.json({ ok: true, statut: "annulee" });
}

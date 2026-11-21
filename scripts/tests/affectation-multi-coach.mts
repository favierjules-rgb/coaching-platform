/**
 * Harnais — LOT 1 : affectation multi-coach.
 *
 * Ce que ce fichier prouve, et comment :
 *
 *  1. `computeAvailableSlots` est importé POUR DE VRAI : les créneaux portent
 *     l'identifiant de leur disponibilité et son propriétaire, et une
 *     disponibilité sans propriétaire ne produit aucun créneau.
 *  2. Un mini-moteur reproduit l'ORDRE DE VALIDATION de la RPC
 *     `create_appointment_atomic` telle que la migration
 *     20261115090000 l'écrit, et chaque refus est vérifié par son nom.
 *  3. Des assertions de TEXTE figent ce que ni l'un ni l'autre ne peut
 *     attraper : la suppression de l'ancienne signature, la lecture de la
 *     disponibilité après le verrou, l'absence de tout paramètre de coach
 *     offert au navigateur.
 *
 * ⚠️ CE QUE CE FICHIER NE PROUVE PAS. Aucune base n'est touchée : la
 * sémantique SQL réelle est vérifiée par
 * `supabase/tests/lot1_affectation_multi_coach_checklist.sql`, qui s'exécute
 * sur une base de test et finit par un ROLLBACK. Le moteur ci-dessous est une
 * reproduction, pas la source de vérité.
 *
 * Lancement : NODE_OPTIONS="--conditions=react-server" npx tsx scripts/tests/affectation-multi-coach.mts
 */
process.env.TZ = "Europe/Paris";

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { computeAvailableSlots, type AvailabilityForSlots } from "../../lib/booking";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      failed += 1;
      console.error(`ÉCHEC - ${name}`);
      console.error(error);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}

/**
 * ⚠️ LES ASSERTIONS D'ABSENCE SE FONT SUR LE CODE, PAS SUR LA PROSE. Ce
 * fichier et la migration EXPLIQUENT en commentaire les motifs qu'ils
 * suppriment (« v_coach_id := v_coach_eleve », « coach le plus ancien »…).
 * Chercher ces chaînes dans le texte brut les trouverait dans les
 * commentaires et rendrait l'assertion toujours verte.
 */
function sansCommentairesSql(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

const MIGRATION = lire("../../supabase/migrations/20261115090000_lot1_multi_coach_ajout.sql");
const MIGRATION_CODE = sansCommentairesSql(MIGRATION);
/**
 * M2 n'est PAS une migration : son SQL vit dans un document de conception, et
 * le fichier de `supabase/migrations/` ne sera créé qu'après le déploiement de
 * M1 et une décision explicite. Tant qu'il n'existe pas, aucun
 * `supabase db push` ne peut appliquer les deux ensemble.
 */
const M2_DOC = lire("../../docs/lot1-m2-retrait-ancienne-rpc.md");
const BOOKING = lire("../../lib/booking.ts");
const APPOINTMENTS = lire("../../lib/supabase/appointments.ts");
const PAGE_ELEVE = lire("../../app/(student)/rendez-vous/page.tsx");
const TYPES = lire("../../types/index.ts");

const COACH_A = "coach-A";
const COACH_B = "coach-B";

/**
 * Les corps des DEUX RPC de création.
 *
 * ⚠️ IL N'Y A PLUS DE BRANCHES À DÉMÊLER, ET C'EST TOUT L'INTÉRÊT. Jusqu'au
 * 15/11/2026, `create_appointment_atomic` servait deux intentions derrière un
 * discriminant, et ces assertions devaient découper son corps en deux pour
 * dire quoi que ce soit de précis. Les deux parcours sont désormais deux
 * fonctions : chacune se lit seule, et une propriété vraie « dans la branche
 * élève » est simplement vraie dans `reserver_creneau_eleve`.
 */
function corpsDe(nom: "reserver_creneau_eleve" | "creer_rendez_vous_staff"): string {
  const debut = MIGRATION_CODE.indexOf(`create or replace function public.${nom}(`);
  const fin = MIGRATION_CODE.indexOf(`revoke all on function public.${nom}(`, debut);
  if (debut < 0 || fin <= debut) throw new Error(`corps de ${nom} introuvable`);
  return MIGRATION_CODE.slice(debut, fin);
}

/* ══════════════════════════════════════════════════════════════════════════
   1. LE CRÉNEAU PORTE SON PROPRIÉTAIRE — fonction réelle, pas une copie
   ══════════════════════════════════════════════════════════════════════════ */

/** Lundi 23/11/2026, heure locale Europe/Paris. */
const LUNDI = new Date(2026, 10, 23, 8, 0, 0);
/** Vendredi 20/11/2026 — point de départ, trois jours avant. */
const MAINTENANT = new Date(2026, 10, 20, 8, 0, 0);

function dispo(partiel: Partial<AvailabilityForSlots> = {}): AvailabilityForSlots {
  return {
    id: "dispo-1",
    coachId: COACH_A,
    weekday: 1,
    startTime: "09:00",
    endTime: "12:00",
    slotDurationMinutes: 45,
    appointmentType: "Coaching visio",
    location: "Visio",
    isActive: true,
    ...partiel,
  };
}

await test("SLOT-01 : chaque créneau porte l'identifiant de sa disponibilité et son coach", () => {
  const creneaux = computeAvailableSlots({
    availabilities: [dispo()],
    unavailabilities: [],
    bookedRanges: [],
    minLeadMinutes: 0,
    maxDaysAhead: 7,
    now: MAINTENANT,
  });
  assert.ok(creneaux.length > 0, "la disponibilité doit produire des créneaux");
  for (const c of creneaux) {
    assert.equal(c.availabilityId, "dispo-1");
    assert.equal(c.coachId, COACH_A);
  }
  // 09:00→12:00 par 45 min = 4 créneaux, un seul lundi dans la fenêtre.
  assert.equal(creneaux.length, 4, "quatre créneaux de 45 minutes");
  assert.equal(new Date(creneaux[0]!.startAt).getTime(), LUNDI.getTime() + 3600_000);
});

await test("SLOT-02 : une disponibilité SANS propriétaire ne produit aucun créneau", () => {
  const creneaux = computeAvailableSlots({
    availabilities: [dispo({ coachId: null })],
    unavailabilities: [],
    bookedRanges: [],
    minLeadMinutes: 0,
    maxDaysAhead: 7,
    now: MAINTENANT,
  });
  assert.deepEqual(creneaux, [], "aucun créneau sans propriétaire n'est proposé");
});

await test("SLOT-03 : le filtre sur le propriétaire s'ajoute à `isActive`, il ne le remplace pas", () => {
  const inactiveAvecCoach = computeAvailableSlots({
    availabilities: [dispo({ isActive: false })],
    unavailabilities: [],
    bookedRanges: [],
    minLeadMinutes: 0,
    maxDaysAhead: 7,
    now: MAINTENANT,
  });
  assert.deepEqual(inactiveAvecCoach, [], "une disponibilité désactivée reste écartée");
});

await test("SLOT-04 : deux coachs, deux lots de créneaux distincts et identifiables", () => {
  const creneaux = computeAvailableSlots({
    availabilities: [
      dispo({ id: "dispo-A", coachId: COACH_A }),
      dispo({ id: "dispo-B", coachId: COACH_B, startTime: "14:00", endTime: "15:30" }),
    ],
    unavailabilities: [],
    bookedRanges: [],
    minLeadMinutes: 0,
    maxDaysAhead: 7,
    now: MAINTENANT,
  });
  assert.equal(creneaux.filter((c) => c.coachId === COACH_A).length, 4);
  assert.equal(creneaux.filter((c) => c.coachId === COACH_B).length, 2);
  assert.equal(new Set(creneaux.map((c) => c.availabilityId)).size, 2);
});

/* ══════════════════════════════════════════════════════════════════════════
   2. LE MOTEUR — ordre de validation de `create_appointment_atomic`
   ══════════════════════════════════════════════════════════════════════════ */

interface DispoEnBase {
  id: string;
  coachId: string | null;
  weekday: number;
  startMinutes: number;
  endMinutes: number;
  dureeMinutes: number;
  appointmentType: string;
  location: string;
  isActive: boolean;
}
interface RdvEnBase {
  coachId: string | null;
  startMs: number;
  endMs: number;
  statut: "pending" | "confirmed" | "cancelled";
  appointmentType: string;
  location: string;
  title: string;
}

interface Base {
  dispos: DispoEnBase[];
  rdv: RdvEnBase[];
  indispos: { coachId: string | null; startMs: number; endMs: number }[];
  eleves: { id: string; coachId: string | null }[];
}

/** `calendar_has_conflict_pour_coach` — fail-closed sur les deux bornes. */
function conflitPourCoach(base: Base, coachId: string | null, startMs: number, endMs: number): boolean {
  if (coachId === null) return true;
  const concerne = (c: string | null) => c === coachId || c === null;
  return (
    base.rdv.some(
      (r) => r.statut !== "cancelled" && concerne(r.coachId) && startMs < r.endMs && r.startMs < endMs,
    ) || base.indispos.some((u) => concerne(u.coachId) && startMs < u.endMs && u.startMs < endMs)
  );
}

type Refus =
  | "calendar_slot_required"
  | "calendar_slot_not_found"
  | "calendar_slot_inactive"
  | "calendar_slot_unowned"
  | "calendar_slot_forbidden"
  | "calendar_slot_mismatch"
  | "calendar_conflict";

type Resultat = { ok: true; rdv: RdvEnBase } | { ok: false; refus: Refus };

/**
 * Réservation PAR UN ÉLÈVE. Le chemin staff est volontairement absent : il ne
 * passe pas par une disponibilité, et son coach est la fiche de l'appelant —
 * c'est le cas T12 de la checklist SQL, qui a besoin d'une vraie session.
 */
function reserver(
  base: Base,
  eleveId: string,
  availabilityId: string | null,
  startMs: number,
  endMs: number,
  typeDemande = "Autre",
  lieuDemande = "Falsifié",
  /**
   * Modification concurrente survenant PENDANT l'attente du verrou. C'est la
   * fenêtre réelle : un élève appelle la RPC, reste bloqué sur
   * `pg_advisory_xact_lock`, et le coach déplace sa plage entre-temps.
   */
  pendantLeVerrou?: (base: Base) => void,
): Resultat {
  // ⚠️ LE VERROU D'ABORD, LA LECTURE ENSUITE. Tout ce qui suit porte sur la
  // version verrouillée de la disponibilité : c'est l'ordre de la RPC depuis
  // la revue du 15/11/2026.
  pendantLeVerrou?.(base);
  if (availabilityId === null) return { ok: false, refus: "calendar_slot_required" };
  const d = base.dispos.find((x) => x.id === availabilityId);
  if (!d) return { ok: false, refus: "calendar_slot_not_found" };
  if (!d.isActive) return { ok: false, refus: "calendar_slot_inactive" };
  if (d.coachId === null) return { ok: false, refus: "calendar_slot_unowned" };

  const eleve = base.eleves.find((e) => e.id === eleveId);
  if (!eleve || eleve.coachId === null || eleve.coachId !== d.coachId) {
    return { ok: false, refus: "calendar_slot_forbidden" };
  }

  const debut = new Date(startMs);
  const fin = new Date(endMs);
  const minutesDebut = debut.getHours() * 60 + debut.getMinutes();
  const minutesFin = fin.getHours() * 60 + fin.getMinutes();
  if (debut.getDay() !== d.weekday) return { ok: false, refus: "calendar_slot_mismatch" };
  if (debut.toDateString() !== fin.toDateString()) return { ok: false, refus: "calendar_slot_mismatch" };
  if (minutesDebut < d.startMinutes || minutesFin > d.endMinutes) {
    return { ok: false, refus: "calendar_slot_mismatch" };
  }
  if ((endMs - startMs) / 60_000 !== d.dureeMinutes) return { ok: false, refus: "calendar_slot_mismatch" };
  if ((minutesDebut - d.startMinutes) % d.dureeMinutes !== 0) {
    return { ok: false, refus: "calendar_slot_mismatch" };
  }

  if (conflitPourCoach(base, d.coachId, startMs, endMs)) return { ok: false, refus: "calendar_conflict" };

  // ⚠️ TYPE, LIEU ET TITRE VIENNENT DE LA DISPONIBILITÉ. Les deux paramètres
  // `typeDemande`/`lieuDemande` existent pour prouver qu'ils sont ignorés.
  void typeDemande;
  void lieuDemande;
  const rdv: RdvEnBase = {
    coachId: d.coachId,
    startMs,
    endMs,
    statut: "confirmed",
    appointmentType: d.appointmentType,
    location: d.location,
    title: d.appointmentType,
  };
  base.rdv.push(rdv);
  return { ok: true, rdv };
}

/**
 * L'ORDRE FAUTIF, conservé uniquement comme contre-épreuve.
 *
 * ⚠️ C'EST LA PREMIÈRE VERSION DE CE LOT. Elle validait tout AVANT le verrou,
 * puis relisait la ligne verrouillée en ne revérifiant que trois propriétés :
 * existence, `is_active`, `coach_id`. Le jour, les horaires, la durée, le type
 * et le lieu restaient ceux de la lecture d'avant le verrou — et c'est cette
 * version périmée qui était insérée.
 */
function reserverOrdreFautif(
  base: Base,
  eleveId: string,
  availabilityId: string | null,
  startMs: number,
  endMs: number,
  pendantLeVerrou?: (base: Base) => void,
): Resultat {
  if (availabilityId === null) return { ok: false, refus: "calendar_slot_required" };
  const premiereLecture = base.dispos.find((x) => x.id === availabilityId);
  if (!premiereLecture) return { ok: false, refus: "calendar_slot_not_found" };
  if (!premiereLecture.isActive) return { ok: false, refus: "calendar_slot_inactive" };
  if (premiereLecture.coachId === null) return { ok: false, refus: "calendar_slot_unowned" };
  const eleve = base.eleves.find((e) => e.id === eleveId);
  if (!eleve || eleve.coachId !== premiereLecture.coachId) return { ok: false, refus: "calendar_slot_forbidden" };
  const debut = new Date(startMs);
  const minutesDebut = debut.getHours() * 60 + debut.getMinutes();
  if (debut.getDay() !== premiereLecture.weekday) return { ok: false, refus: "calendar_slot_mismatch" };
  if (minutesDebut < premiereLecture.startMinutes) return { ok: false, refus: "calendar_slot_mismatch" };
  if ((endMs - startMs) / 60_000 !== premiereLecture.dureeMinutes) return { ok: false, refus: "calendar_slot_mismatch" };

  /*
   * ⚠️ PHOTO DES VALEURS, PAS LA RÉFÉRENCE. `premiereLecture` pointe sur la
   * ligne du tableau : si le crochet la modifie, l'« ancienne » version
   * suivrait la nouvelle et la contre-épreuve ne prouverait rien. En base,
   * `v_dispo` est bien une copie — c'est ce qu'on reproduit ici.
   */
  const coachAvant = premiereLecture.coachId;
  const typeAvant = premiereLecture.appointmentType;
  const lieuAvant = premiereLecture.location;

  pendantLeVerrou?.(base);

  const relecture = base.dispos.find((x) => x.id === availabilityId);
  if (!relecture) return { ok: false, refus: "calendar_slot_not_found" };
  if (!relecture.isActive) return { ok: false, refus: "calendar_slot_inactive" };
  if (relecture.coachId !== coachAvant) return { ok: false, refus: "calendar_slot_mismatch" };

  if (conflitPourCoach(base, coachAvant, startMs, endMs)) {
    return { ok: false, refus: "calendar_conflict" };
  }
  const rdv: RdvEnBase = {
    coachId: coachAvant,
    startMs,
    endMs,
    statut: "confirmed",
    // La version PÉRIMÉE, celle d'avant le verrou.
    appointmentType: typeAvant,
    location: lieuAvant,
    title: typeAvant,
  };
  base.rdv.push(rdv);
  return { ok: true, rdv };
}

/**
 * Variante fautive n° 2, conservée comme contre-épreuve : le rattachement de
 * l'élève est lu AVANT le verrou et n'est pas revérifié après.
 *
 * ⚠️ C'EST LE DÉFAUT RELEVÉ À LA REVUE DU 15/11/2026, APRÈS CORRECTION DU
 * VERROU DE LA DISPONIBILITÉ. La disponibilité était bien verrouillée, mais
 * `students.coach_id` était lu sans verrou de ligne : une réaffectation
 * pouvait s'intercaler, et le rendez-vous était attribué au propriétaire de la
 * disponibilité alors que l'élève venait de passer à un autre coach.
 */
function reserverCoachEleveAvantVerrou(
  base: Base,
  eleveId: string,
  availabilityId: string,
  startMs: number,
  endMs: number,
  pendantLeVerrou?: (base: Base) => void,
): Resultat {
  const eleve = base.eleves.find((e) => e.id === eleveId);
  const coachEleveAvant = eleve?.coachId ?? null;

  pendantLeVerrou?.(base);

  const d = base.dispos.find((x) => x.id === availabilityId);
  if (!d) return { ok: false, refus: "calendar_slot_not_found" };
  if (!d.isActive) return { ok: false, refus: "calendar_slot_inactive" };
  if (d.coachId === null) return { ok: false, refus: "calendar_slot_unowned" };
  // La comparaison porte sur la version PÉRIMÉE du rattachement.
  if (coachEleveAvant === null || coachEleveAvant !== d.coachId) {
    return { ok: false, refus: "calendar_slot_forbidden" };
  }
  if (conflitPourCoach(base, d.coachId, startMs, endMs)) return { ok: false, refus: "calendar_conflict" };
  const rdv: RdvEnBase = {
    coachId: d.coachId,
    startMs,
    endMs,
    statut: "confirmed",
    appointmentType: d.appointmentType,
    location: d.location,
    title: d.appointmentType,
  };
  base.rdv.push(rdv);
  return { ok: true, rdv };
}

function baseDeTest(): Base {
  const lundi9h = new Date(2026, 10, 23, 9, 0, 0).getTime();
  void lundi9h;
  return {
    dispos: [
      { id: "dA", coachId: COACH_A, weekday: 1, startMinutes: 540, endMinutes: 720, dureeMinutes: 45, appointmentType: "Coaching visio", location: "Visio A", isActive: true },
      { id: "dB", coachId: COACH_B, weekday: 1, startMinutes: 540, endMinutes: 720, dureeMinutes: 45, appointmentType: "Bilan mensuel", location: "Salle B", isActive: true },
      { id: "dInactive", coachId: COACH_A, weekday: 1, startMinutes: 840, endMinutes: 1020, dureeMinutes: 45, appointmentType: "Coaching visio", location: "Visio A", isActive: false },
      { id: "dOrpheline", coachId: null, weekday: 1, startMinutes: 1080, endMinutes: 1200, dureeMinutes: 45, appointmentType: "Coaching visio", location: "", isActive: true },
    ],
    rdv: [],
    indispos: [],
    eleves: [
      { id: "eA", coachId: COACH_A },
      { id: "eB", coachId: COACH_B },
      { id: "eSansCoach", coachId: null },
    ],
  };
}

const h = (heure: number, minute = 0) => new Date(2026, 10, 23, heure, minute, 0).getTime();

await test("RPC-01 : l'élève de A sur un créneau de A → coach A, type et lieu de la disponibilité", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "Falsifié");
  assert.ok(r.ok, "la réservation doit réussir");
  assert.equal(r.rdv.coachId, COACH_A);
  assert.equal(r.rdv.appointmentType, "Coaching visio", "le type vient de la disponibilité");
  assert.equal(r.rdv.location, "Visio A", "le lieu vient de la disponibilité");
  assert.equal(r.rdv.title, "Coaching visio");
});

await test("RPC-02 : l'élève de B sur un créneau de B → coach B", () => {
  const base = baseDeTest();
  const r = reserver(base, "eB", "dB", h(9), h(9, 45));
  assert.ok(r.ok);
  assert.equal(r.rdv.coachId, COACH_B, "un second coach obtient bien SES rendez-vous");
});

await test("RPC-03 : l'élève de A sur le créneau de B → refus, et rien n'est écrit", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dB", h(9), h(9, 45));
  assert.equal(r.ok, false);
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_forbidden");
  assert.equal(base.rdv.length, 0, "aucun rendez-vous ne doit avoir été créé");
});

await test("RPC-04 : un élève sans coach ne peut réserver chez personne", () => {
  const base = baseDeTest();
  for (const d of ["dA", "dB"]) {
    const r = reserver(base, "eSansCoach", d, h(9), h(9, 45));
    assert.equal((r as { refus: Refus }).refus, "calendar_slot_forbidden");
  }
  assert.equal(base.rdv.length, 0);
});

await test("RPC-05 : créneau sans propriétaire → refus nommé, aucun repli sur un coach par défaut", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dOrpheline", h(18), h(18, 45));
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_unowned");
});

await test("RPC-06 : créneau désactivé, inexistant, ou non désigné", () => {
  const base = baseDeTest();
  assert.equal((reserver(base, "eA", "dInactive", h(14), h(14, 45)) as { refus: Refus }).refus, "calendar_slot_inactive");
  assert.equal((reserver(base, "eA", "inconnu", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_slot_not_found");
  assert.equal((reserver(base, "eA", null, h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_slot_required");
});

await test("RPC-07 : horaire hors plage, mauvais jour, durée et grille", () => {
  const base = baseDeTest();
  const cas: [string, number, number][] = [
    ["au-delà de end_time", h(12), h(12, 45)],
    ["avant start_time", h(8, 15), h(9)],
    ["durée différente", h(9), h(11)],
    ["début hors grille", h(9, 5), h(9, 50)],
  ];
  for (const [nom, debut, fin] of cas) {
    const r = reserver(base, "eA", "dA", debut, fin);
    assert.equal((r as { refus: Refus }).refus, "calendar_slot_mismatch", nom);
  }
  // Mauvais jour : mardi 24/11.
  const mardi = new Date(2026, 10, 24, 9, 0, 0).getTime();
  const r = reserver(base, "eA", "dA", mardi, mardi + 45 * 60_000);
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_mismatch", "mauvais jour de semaine");
  assert.equal(base.rdv.length, 0);
});

await test("RPC-08 : l'indisponibilité de A bloque A et laisse B libre", () => {
  const base = baseDeTest();
  base.indispos.push({ coachId: COACH_A, startMs: h(9), endMs: h(9, 45) });
  assert.equal((reserver(base, "eA", "dA", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_conflict");
  assert.ok(reserver(base, "eB", "dB", h(9), h(9, 45)).ok, "l'agenda de A ne ferme pas celui de B");
});

await test("RPC-09 : un rendez-vous existant bloque le bon coach, et lui seul", () => {
  const base = baseDeTest();
  assert.ok(reserver(base, "eA", "dA", h(9), h(9, 45)).ok);
  assert.equal((reserver(base, "eA", "dA", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_conflict");
  assert.ok(reserver(base, "eB", "dB", h(9), h(9, 45)).ok, "le même horaire reste libre chez B");
});

await test("RPC-10 : un rendez-vous annulé libère le créneau (règle métier conservée)", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45));
  assert.ok(r.ok);
  r.rdv.statut = "cancelled";
  assert.ok(reserver(base, "eA", "dA", h(9), h(9, 45)).ok);
});

await test("RPC-11 : un rendez-vous SANS propriétaire bloque, au lieu de ne bloquer personne", () => {
  const base = baseDeTest();
  // L'état historique mesuré : 7 rendez-vous sur 9 sans coach_id. Avant le
  // lot 1 ils n'apparaissaient dans AUCUN contrôle de conflit sauf pour
  // l'administrateur — deux élèves pouvaient réserver par-dessus.
  base.rdv.push({ coachId: null, startMs: h(9), endMs: h(9, 45), statut: "confirmed", appointmentType: "X", location: "", title: "X" });
  assert.equal((reserver(base, "eA", "dA", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_conflict");
  assert.equal((reserver(base, "eB", "dB", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_conflict");
});

/* ══════════════════════════════════════════════════════════════════════════
   2 bis. LA LIGNE VERROUILLÉE — une modification concurrente pendant l'attente
   du verrou ne doit jamais laisser passer une réservation sur l'ancienne
   version de la disponibilité.
   ══════════════════════════════════════════════════════════════════════════ */

await test("VERROU-01 : disponibilité désactivée pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.dispos.find((d) => d.id === "dA")!.isActive = false;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_inactive");
  assert.equal(base.rdv.length, 0);
});

await test("VERROU-02 : changement de propriétaire pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.dispos.find((d) => d.id === "dA")!.coachId = COACH_B;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_forbidden");
  assert.equal(base.rdv.length, 0);
});

await test("VERROU-03 : propriétaire retiré pendant l'attente du verrou → refus nommé", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.dispos.find((d) => d.id === "dA")!.coachId = null;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_unowned");
});

await test("VERROU-04 : horaires déplacés pendant l'attente du verrou → aucune réservation sur les anciennes valeurs", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    const d = b.dispos.find((x) => x.id === "dA")!;
    d.startMinutes = 840; // 14:00
    d.endMinutes = 1020; // 17:00
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_mismatch");
  assert.equal(base.rdv.length, 0, "rien ne doit avoir été écrit");
});

await test("VERROU-05 : durée changée pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.dispos.find((d) => d.id === "dA")!.dureeMinutes = 60;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_mismatch");
});

await test("VERROU-06 : jour changé pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.dispos.find((d) => d.id === "dA")!.weekday = 4;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_mismatch");
});

await test("VERROU-07 : type et lieu modifiés pendant l'attente du verrou → la NOUVELLE version est écrite", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    const d = b.dispos.find((x) => x.id === "dA")!;
    d.appointmentType = "Bilan mensuel";
    d.location = "Salle neuve";
  });
  assert.ok(r.ok, "la réservation reste valide : seuls le type et le lieu ont bougé");
  assert.equal(r.rdv.appointmentType, "Bilan mensuel", "ce qui valide et ce qui écrit viennent de la même ligne");
  assert.equal(r.rdv.location, "Salle neuve");
  assert.equal(r.rdv.title, "Bilan mensuel");
});

await test("VERROU-08 : élève réaffecté à un autre coach pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.eleves.find((e) => e.id === "eA")!.coachId = COACH_B;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_forbidden");
  assert.equal(base.rdv.length, 0, "aucun rendez-vous ne doit être attribué au propriétaire de la dispo");
});

await test("VERROU-09 : élève détaché de tout coach pendant l'attente du verrou → refus", () => {
  const base = baseDeTest();
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.eleves.find((e) => e.id === "eA")!.coachId = null;
  });
  assert.equal((r as { refus: Refus }).refus, "calendar_slot_forbidden");
});

await test("VERROU-10 : élève réaffecté AU propriétaire de la disponibilité → la réservation passe", () => {
  const base = baseDeTest();
  base.eleves.find((e) => e.id === "eA")!.coachId = COACH_B; // pas encore chez A
  const r = reserver(base, "eA", "dA", h(9), h(9, 45), "Autre", "F", (b) => {
    b.eleves.find((e) => e.id === "eA")!.coachId = COACH_A; // réaffecté juste avant
  });
  assert.ok(r.ok, "le rattachement validé est celui de la ligne verrouillée, pas celui d'avant");
  assert.equal(r.rdv.coachId, COACH_A);
});

/* ══════════════════════════════════════════════════════════════════════════
   2 ter. IDENTITÉ DOUBLE — un point d'entrée par intention
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Reproduction de la RPC UNIQUE d'avant la séparation, conservée uniquement
 * comme contre-épreuve : un seul point d'entrée, et un discriminant serveur
 * qui décidait du comportement.
 *
 * ⚠️ C'EST LE DÉFAUT QUE LA SÉPARATION FERME. `estStaff` valait
 * `current_staff_id() is not null or is_admin()` : une personne portant à la
 * fois une fiche `coaches` et une fiche `students` — rien ne l'interdit, les
 * deux tables référencent `auth.users` — passait donc par la branche staff en
 * réservant depuis son espace élève, et échappait à TOUTE validation de
 * disponibilité.
 */
function reserverRpcUnique(
  base: Base,
  eleveId: string,
  availabilityId: string | null,
  startMs: number,
  endMs: number,
  estStaff: boolean,
): Resultat {
  if (estStaff) {
    // Aucune disponibilité exigée, aucune validation d'horaire : le chemin
    // staff n'en avait pas besoin, et le discriminant y menait.
    const eleve = base.eleves.find((e) => e.id === eleveId);
    if (!eleve || eleve.coachId === null) return { ok: false, refus: "calendar_slot_forbidden" };
    const rdv: RdvEnBase = {
      coachId: eleve.coachId,
      startMs,
      endMs,
      statut: "confirmed",
      appointmentType: "Autre",
      location: "",
      title: "Séance",
    };
    base.rdv.push(rdv);
    return { ok: true, rdv };
  }
  return reserver(base, eleveId, availabilityId, startMs, endMs);
}

await test("IDENTITE-01 : la porte élève exige une disponibilité, sans exception possible", () => {
  const base = baseDeTest();
  /*
   * Le moteur de réservation n'a AUCUN paramètre de staff — c'est la
   * propriété, pas un oubli. Il n'existe donc aucune valeur à fournir pour
   * contourner la validation : seul l'identifiant de disponibilité compte.
   */
  assert.equal(
    (reserver(base, "eA", null, h(9), h(9, 45)) as { refus: Refus }).refus,
    "calendar_slot_required",
  );
  assert.equal(base.rdv.length, 0);
});

await test("IDENTITE-02 : un compte à double identité reste soumis à toute la validation", () => {
  const base = baseDeTest();
  // Le compte « double » est l'élève eA (rattaché à COACH_A) et porterait
  // aussi une fiche coach. Côté porte élève, cela ne change rien.
  assert.equal((reserver(base, "eA", "dB", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_slot_forbidden");
  assert.equal((reserver(base, "eA", "dA", h(9, 5), h(9, 50)) as { refus: Refus }).refus, "calendar_slot_mismatch");
  assert.equal((reserver(base, "eA", "dInactive", h(14), h(14, 45)) as { refus: Refus }).refus, "calendar_slot_inactive");
  assert.ok(reserver(base, "eA", "dA", h(9), h(9, 45)).ok, "et le cas légitime passe");
});

/* ══════════════════════════════════════════════════════════════════════════
   3. CONTRE-ÉPREUVES — chaque test ci-dessus détecte-t-il son défaut ?
   ══════════════════════════════════════════════════════════════════════════ */

await test("CONTRE-07 : avec une RPC unique, une identité double créait un rendez-vous hors disponibilité", () => {
  // Le même geste, sans aucune disponibilité, par un compte qui porte les deux
  // fiches : la RPC unique l'ACCEPTE…
  const fautif = baseDeTest();
  const rFautif = reserverRpcUnique(fautif, "eA", null, h(3), h(3, 30), true);
  assert.ok(rFautif.ok, "l'ancien point d'entrée unique accepte une réservation sans disponibilité");
  assert.equal(rFautif.rdv.coachId, COACH_A);
  assert.equal(fautif.rdv.length, 1, "un rendez-vous à 03:00, hors de toute plage, a été créé");

  // …là où la porte élève le refuse, quelle que soit l'identité de l'appelant.
  const correct = baseDeTest();
  assert.equal(
    (reserver(correct, "eA", null, h(3), h(3, 30)) as { refus: Refus }).refus,
    "calendar_slot_required",
  );
  assert.equal(correct.rdv.length, 0);
});

await test("CONTRE-08 : et elle ignorait aussi la grille horaire pour ce même compte", () => {
  const fautif = baseDeTest();
  // Un créneau au milieu de la plage, mais hors grille : accepté par la RPC unique.
  assert.ok(reserverRpcUnique(fautif, "eA", "dA", h(9, 5), h(9, 50), true).ok);
  const correct = baseDeTest();
  assert.equal(
    (reserver(correct, "eA", "dA", h(9, 5), h(9, 50)) as { refus: Refus }).refus,
    "calendar_slot_mismatch",
  );
});

await test("CONTRE-05 : lire le rattachement de l'élève AVANT le verrou attribue le rendez-vous à un coach qu'il a quitté", () => {
  const reaffecter = (b: Base) => {
    b.eleves.find((e) => e.id === "eA")!.coachId = COACH_B;
  };

  // La variante fautive ACCEPTE la réservation…
  const fautif = baseDeTest();
  const rFautif = reserverCoachEleveAvantVerrou(fautif, "eA", "dA", h(9), h(9, 45), reaffecter);
  assert.ok(rFautif.ok, "l'ordre fautif accepte la réservation");
  assert.equal(rFautif.rdv.coachId, COACH_A, "…et l'attribue à un coach qui n'est plus le sien");
  assert.equal(fautif.eleves.find((e) => e.id === "eA")!.coachId, COACH_B, "alors que l'élève est passé chez B");

  // …là où la version corrigée la refuse : c'est VERROU-08.
  const correct = baseDeTest();
  const rCorrect = reserver(correct, "eA", "dA", h(9), h(9, 45), "Autre", "F", reaffecter);
  assert.equal((rCorrect as { refus: Refus }).refus, "calendar_slot_forbidden");
  assert.equal(correct.rdv.length, 0);
});

await test("CONTRE-06 : la variante fautive manque aussi le détachement complet de l'élève", () => {
  const detacher = (b: Base) => {
    b.eleves.find((e) => e.id === "eA")!.coachId = null;
  };
  const fautif = baseDeTest();
  assert.ok(reserverCoachEleveAvantVerrou(fautif, "eA", "dA", h(9), h(9, 45), detacher).ok);
  const correct = baseDeTest();
  assert.equal(
    (reserver(correct, "eA", "dA", h(9), h(9, 45), "Autre", "F", detacher) as { refus: Refus }).refus,
    "calendar_slot_forbidden",
  );
});

await test("CONTRE-03 : valider les horaires AVANT le verrou sans les répéter laisse passer une réservation périmée", () => {
  const deplacer = (b: Base) => {
    const d = b.dispos.find((x) => x.id === "dA")!;
    d.startMinutes = 840;
    d.endMinutes = 1020;
  };

  // L'ordre fautif : la réservation RÉUSSIT sur des horaires qui n'existent plus.
  const fautif = baseDeTest();
  const rFautif = reserverOrdreFautif(fautif, "eA", "dA", h(9), h(9, 45), deplacer);
  assert.ok(rFautif.ok, "l'ordre fautif accepte une réservation hors de la plage réelle");
  assert.equal(fautif.rdv.length, 1);

  // L'ordre corrigé la refuse : c'est exactement VERROU-04.
  const correct = baseDeTest();
  const rCorrect = reserver(correct, "eA", "dA", h(9), h(9, 45), "Autre", "F", deplacer);
  assert.equal((rCorrect as { refus: Refus }).refus, "calendar_slot_mismatch");
  assert.equal(correct.rdv.length, 0);
});

await test("CONTRE-04 : l'ordre fautif écrit le type et le lieu d'AVANT le verrou", () => {
  const renommer = (b: Base) => {
    const d = b.dispos.find((x) => x.id === "dA")!;
    d.appointmentType = "Bilan mensuel";
    d.location = "Salle neuve";
  };
  const fautif = baseDeTest();
  const rFautif = reserverOrdreFautif(fautif, "eA", "dA", h(9), h(9, 45), renommer);
  assert.ok(rFautif.ok);
  assert.equal(rFautif.rdv.appointmentType, "Coaching visio", "la version périmée est insérée");
  assert.equal(rFautif.rdv.location, "Visio A");

  const correct = baseDeTest();
  const rCorrect = reserver(correct, "eA", "dA", h(9), h(9, 45), "Autre", "F", renommer);
  assert.ok(rCorrect.ok);
  assert.equal(rCorrect.rdv.appointmentType, "Bilan mensuel");
});

await test("CONTRE-01 : l'ancienne déduction (coach de l'élève) ferait passer un créneau d'un autre coach", () => {
  const base = baseDeTest();
  // Reproduction de la version d'avant le lot 1 : aucune vérification de
  // propriété, et `coach_id` pris sur `students.coach_id`.
  const d = base.dispos.find((x) => x.id === "dB")!;
  const eleve = base.eleves.find((e) => e.id === "eA")!;
  const rdvAncien: RdvEnBase = {
    coachId: eleve.coachId,
    startMs: h(9),
    endMs: h(9, 45),
    statut: "confirmed",
    appointmentType: d.appointmentType,
    location: d.location,
    title: d.appointmentType,
  };
  assert.equal(rdvAncien.coachId, COACH_A, "l'ancienne logique attribuait le RDV au coach de l'élève…");
  assert.notEqual(rdvAncien.coachId, d.coachId, "…alors que le créneau appartenait à un autre coach");
  // Et la version corrigée refuse ce même geste : c'est RPC-03.
  assert.equal((reserver(base, "eA", "dB", h(9), h(9, 45)) as { refus: Refus }).refus, "calendar_slot_forbidden");
});

await test("CONTRE-02 : sans portée par coach, l'agenda d'un coach fermerait celui de l'autre", () => {
  const base = baseDeTest();
  base.indispos.push({ coachId: COACH_A, startMs: h(9), endMs: h(9, 45) });
  // L'ancien prédicat ignorait `coach_id` : tout chevauchement bloquait.
  const ancienPredicat =
    base.rdv.some((r) => r.statut !== "cancelled" && h(9) < r.endMs && r.startMs < h(9, 45)) ||
    base.indispos.some((u) => h(9) < u.endMs && u.startMs < h(9, 45));
  assert.equal(ancienPredicat, true, "l'ancien prédicat voit un conflit pour B…");
  assert.equal(conflitPourCoach(base, COACH_B, h(9), h(9, 45)), false, "…la portée par coach, non");
});

/* ══════════════════════════════════════════════════════════════════════════
   4. LE TEXTE — ce que ni la fonction pure ni le moteur ne peuvent attraper
   ══════════════════════════════════════════════════════════════════════════ */

await test("TEXTE-01 : M1 ne supprime RIEN, et M2 n'est pas un fichier de migration", () => {
  /*
   * ⚠️ LE DÉCOUPAGE EST UNE PROPRIÉTÉ À PROTÉGER, PAS UN DÉTAIL
   * D'ORGANISATION. L'application en service appelle encore
   * `create_appointment_atomic` : si une rédaction future ajoutait son `drop`
   * dans M1, la bascule redeviendrait un saut sans filet, et la seule fenêtre
   * de retour arrière disparaîtrait.
   */
  assert.equal(
    /drop\s+function[\s\S]{0,80}create_appointment_atomic/i.test(MIGRATION_CODE),
    false,
    "M1 ne doit contenir aucun `drop` de create_appointment_atomic",
  );
  assert.match(
    MIGRATION_CODE,
    /create or replace function public\.create_appointment_atomic/,
    "M1 redéfinit l'ancienne RPC en garde-fou",
  );

  /*
   * ⚠️ AUCUN FICHIER DE MIGRATION M2. `supabase db push` applique TOUTES les
   * migrations en attente : un fichier M2 présent dans le dossier serait
   * appliqué avec M1 par le prochain `push`, fait pour n'importe quelle autre
   * raison. Son absence est la seule garantie mécanique du découpage.
   */
  // ⚠️ LE FILTRE EST BORNÉ AU LOT. Une première rédaction cherchait
  // « retrait|drop|suppression » dans tout le dossier et attrapait
  // `20260924090000_suppression_nolio.sql`, étrangère à ce chantier.
  const migrations = readdirSync(new URL("../../supabase/migrations", import.meta.url));
  const retrait = migrations.filter((f) => f.includes("lot1") && /retrait|drop|suppression/i.test(f));
  assert.deepEqual(retrait, [], `aucun fichier de retrait du lot 1 ne doit exister : ${retrait.join(", ")}`);
  assert.equal(
    migrations.filter((f) => f.includes("lot1")).length,
    1,
    "exactement un fichier de migration pour le lot 1 : M1",
  );

  // Et le SQL de M2 est bien préparé, avec ses deux `drop` et son assertion.
  assert.match(M2_DOC, /drop function if exists public\.create_appointment_atomic\(\s*\n?\s*uuid, text,/);
  assert.match(M2_DOC, /drop function if exists public\.create_appointment_atomic\(\s*\n?\s*uuid, uuid, text,/);
  assert.match(M2_DOC, /v_n <> 0 then[\s\S]{0,200}subsiste/);
});

await test("TEXTE-02 : les dix refus métier sont nommés dans la migration ET dans la couche TS", () => {
  const refus = [
    "calendar_slot_required",
    "calendar_slot_not_found",
    "calendar_slot_inactive",
    "calendar_slot_unowned",
    "calendar_slot_forbidden",
    "calendar_slot_mismatch",
    "calendar_owner_unresolved",
    "calendar_conflict",
    "calendar_parcours_obsolete",
    "calendar_identite_ambigue",
  ] as const;
  for (const r of refus) {
    assert.ok(MIGRATION_CODE.includes(r), `la migration doit lever ${r}`);
    assert.ok(APPOINTMENTS.includes(r), `lib/supabase/appointments.ts doit savoir traduire ${r}`);
  }
});

await test("TEXTE-03 : réservation élève — UN SEUL jeu de validations, après le verrou", () => {
  const corps = corpsDe("reserver_creneau_eleve");
  const posVerrou = corps.indexOf("pg_advisory_xact_lock");
  assert.ok(posVerrou > 0, "le verrou consultatif doit être posé");

  /*
   * ⚠️ AUCUNE LECTURE NI VALIDATION AVANT LE VERROU. C'était le défaut relevé
   * le 15/11/2026 : la ligne était lue et validée avant, puis relue
   * `for share` en ne revérifiant que trois propriétés sur six.
   */
  const avant = corps.slice(0, posVerrou);
  assert.equal(/from\s+public\.coach_availabilities/i.test(avant), false,
    "la disponibilité ne doit pas être LUE avant le verrou");
  assert.equal(/from\s+public\.students/i.test(avant), false,
    "la ligne élève ne doit pas être lue avant le verrou");
  // Les déclarations de type, elles, précèdent le verrou : c'est normal.
  assert.match(avant, /v_dispo public\.coach_availabilities%rowtype/);
  // Seules les gardes d'identité et de période précèdent le verrou.
  for (const garde of ["calendar_student_required", "calendar_slot_required", "calendar_invalid_period"]) {
    assert.ok(avant.includes(garde), `${garde} doit précéder le verrou : rien à verrouiller sans cela`);
  }

  const apres = corps.slice(posVerrou);
  assert.match(apres, /select \* into v_dispo[\s\S]{0,200}from public\.coach_availabilities[\s\S]{0,120}for share/i,
    "la lecture `for share` de la disponibilité doit suivre le verrou");

  /*
   * ⚠️ CHAQUE VALIDATION N'EXISTE QU'UNE FOIS. Deux jeux partiellement
   * différents sur deux versions de la même ligne, c'est une validation de
   * moins ; ce comptage interdit d'en réintroduire un second.
   */
  const uniques = [
    "from public.coach_availabilities",
    "from public.students s",
    "extract(dow from v_debut_local)",
    "make_interval(mins => v_dispo.slot_duration_minutes)",
    "v_dispo.start_time or v_fin_local::time > v_dispo.end_time",
    "mod(v_minutes_depuis_debut, v_dispo.slot_duration_minutes)",
    "raise exception 'calendar_slot_unowned'",
    "raise exception 'calendar_slot_forbidden'",
  ] as const;
  for (const motif of uniques) {
    assert.equal(corps.split(motif).length - 1, 1, `« ${motif} » doit apparaître exactement une fois`);
    assert.ok(apres.includes(motif), `« ${motif} » doit être APRÈS le verrou`);
  }
  assert.equal(corps.split("for share").length - 1, 2, "deux lignes verrouillées : la dispo et l'élève");

  // Ordre final : conflit, puis insertion, après toutes les validations.
  const posConflit = corps.indexOf("calendar_has_conflict_pour_coach(v_dispo.coach_id");
  const posInsert = corps.indexOf("insert into public.appointments");
  const posDerniere = corps.lastIndexOf("raise exception 'calendar_slot_mismatch'");
  assert.ok(posDerniere > posVerrou, "les validations sont après le verrou");
  assert.ok(posConflit > posDerniere, "le conflit est évalué après les validations");
  assert.ok(posInsert > posConflit, "l'insertion est la dernière étape");
});

await test("TEXTE-04 : réservation élève → élève de la SESSION, coach du CRÉNEAU", () => {
  const corps = corpsDe("reserver_creneau_eleve");

  /*
   * ⚠️ LA PROPRIÉTÉ CENTRALE DE CE TOUR. La RPC ne prend aucune identité en
   * paramètre : l'élève vient de `current_student_id()`, le coach de la
   * disponibilité verrouillée. C'est ce qui rend inoffensive une personne
   * portant à la fois une fiche `coaches` et une fiche `students` : il n'y a
   * rien à falsifier, et la disponibilité est obligatoire.
   */
  assert.match(corps, /v_student_id := public\.current_student_id\(\);/,
    "l'élève doit venir de la session");
  assert.match(corps, /if v_student_id is null then[\s\S]{0,120}calendar_student_required/,
    "un appelant sans fiche élève doit être refusé");
  const signature = corps.slice(0, corps.indexOf(") returns uuid"));
  assert.equal(/p_student|p_coach/i.test(signature), false,
    "aucune identité ne doit figurer dans la signature");
  assert.match(signature, /p_availability_id uuid/, "la disponibilité est le premier argument");

  assert.match(corps, /if p_availability_id is null then[\s\S]{0,120}calendar_slot_required/,
    "la disponibilité est obligatoire : pas de chemin sans elle");

  // Le contenu inséré vient de la ligne verrouillée, pas du navigateur.
  const insertion = corps.slice(corps.indexOf("insert into public.appointments"));
  assert.match(insertion, /v_student_id, v_dispo\.coach_id, v_dispo\.appointment_type/,
    "élève de la session, coach et type de la disponibilité");
  assert.match(insertion, /v_dispo\.location/, "lieu de la disponibilité");
  assert.match(insertion, /'confirmed'/, "statut forcé : l'élève ne le choisit pas");
  assert.equal(/order by\s+c?\.?created_at[\s\S]{0,40}limit 1/i.test(corps), false,
    "aucun coach choisi par ancienneté");
});

await test("TEXTE-14 : création staff → staff obligatoire, propriétaire = coach TITULAIRE", () => {
  const corps = corpsDe("creer_rendez_vous_staff");

  // Être staff est la PREMIÈRE garde, et `is_admin()` compte autant qu'une fiche.
  assert.match(
    corps,
    /if public\.current_staff_id\(\) is null and not coalesce\(public\.is_admin\(\), false\) then[\s\S]{0,160}calendar_staff_required/,
    "un non-staff doit être refusé d'emblée ; un administrateur sans fiche doit passer",
  );

  /*
   * ⚠️ LA BRANCHE « L'APPELANT AGIT POUR SA PROPRE FICHE ÉLÈVE » A DISPARU DE
   * LA GARDE. C'était la porte par laquelle une identité double créait un
   * rendez-vous hors disponibilité. Ce cas relève désormais de
   * `reserver_creneau_eleve`, et de lui seul.
   */
  assert.equal(
    /p_student_id = public\.current_student_id\(\)/.test(corps),
    false,
    "la création manuelle ne doit plus servir à réserver pour soi-même",
  );

  const posTest = corps.indexOf("if p_student_id is not null then");
  const posElse = corps.indexOf("\n  else\n", posTest);
  assert.ok(posTest > 0 && posElse > posTest, "la RPC doit distinguer avec et sans élève");
  const avecEleve = corps.slice(posTest, posElse);
  const sansEleve = corps.slice(posElse, corps.indexOf("calendar_has_conflict_pour_coach"));

  assert.match(avecEleve, /from public\.students s[\s\S]{0,160}for share/, "la ligne élève est verrouillée");
  assert.equal(avecEleve.split("v_coach_id := v_coach_eleve").length - 1, 1,
    "le propriétaire est le coach titulaire de l'élève");
  assert.equal(avecEleve.includes("current_staff_id()"), false,
    "l'auteur de l'action ne doit jouer aucun rôle dans l'attribution");
  assert.match(avecEleve, /raise exception 'calendar_owner_unresolved'/, "zéro titulaire → refus");

  assert.equal(sansEleve.split("v_coach_id := public.current_staff_id()").length - 1, 1,
    "sans élève, le propriétaire est la fiche de l'auteur");
  assert.match(sansEleve, /staff_role\(\) in \('admin', 'assistant'\)[\s\S]{0,200}calendar_owner_unresolved/,
    "un collaborateur n'a pas d'agenda propre : refus explicite");

  assert.equal(corps.split("v_coach_id := public.current_staff_id()").length - 1, 1,
    "`current_staff_id()` ne doit attribuer un rendez-vous que dans ce seul cas");
});

await test("TEXTE-05 : aucune des deux RPC n'expose de coach, et la couche TS n'en envoie pas", () => {
  for (const nom of ["reserver_creneau_eleve", "creer_rendez_vous_staff"] as const) {
    const corps = corpsDe(nom);
    const signature = corps.slice(0, corps.indexOf(") returns uuid"));
    assert.equal(/p_coach/i.test(signature), false, `aucun paramètre de coach dans ${nom}`);
  }
  const appelTs = sansCommentairesTs(APPOINTMENTS);
  assert.equal(/p_coach_id\s*:/.test(appelTs), false,
    "la couche TS ne doit jamais envoyer de coach");
  // Les deux appels existent, et chacun n'envoie que ce qui lui revient.
  assert.match(appelTs, /rpc\("reserver_creneau_eleve", \{[\s\S]{0,200}p_availability_id: input\.availabilityId/);
  assert.equal(
    /rpc\("reserver_creneau_eleve", \{[\s\S]{0,400}p_student_id/.test(appelTs),
    false,
    "la réservation élève ne doit pas envoyer d'identifiant d'élève",
  );
  assert.match(appelTs, /rpc\("creer_rendez_vous_staff", \{[\s\S]{0,200}p_student_id: input\.studentId/);
  assert.equal(
    /rpc\("create_appointment_atomic"/.test(appelTs),
    false,
    "plus aucun appel à l'ancienne RPC",
  );
});

await test("TEXTE-06 : la reprise de données ne supprime rien et conserve le compte de test", () => {
  const code = MIGRATION_CODE;
  for (const interdit of [
    /delete\s+from\s+public\.coaches/i,
    /delete\s+from\s+public\.appointments/i,
    /delete\s+from\s+public\.coach_availabilities/i,
    /delete\s+from\s+public\.students/i,
    /truncate/i,
  ]) {
    assert.equal(interdit.test(code), false, `la migration ne doit pas contenir ${interdit}`);
  }
  assert.match(code, /not exists \(select 1 from public\.coaches where id = c_coach_b\)[\s\S]{0,200}raise exception/,
    "la migration doit échouer si le compte de test a disparu");
  assert.ok(code.includes("raise exception 'LOT1/avant"), "assertions AVANT la reprise");
  assert.ok(code.includes("raise exception 'LOT1/apres"), "assertions APRÈS la reprise");
  assert.match(code, /is distinct from[\s\S]{0,600}une donnee de reservation autre que coach_id/,
    "la migration doit prouver qu'aucune autre donnée de réservation n'a bougé");
});

await test("TEXTE-07 : `coach_id` n'est PAS passé not null par ce lot", () => {
  assert.equal(
    /alter\s+table\s+public\.appointments[\s\S]{0,120}set\s+not\s+null/i.test(MIGRATION_CODE),
    false,
    "la stratégie pour les rendez-vous non attribuables n'est pas tranchée : pas de not null ici",
  );
});

await test("TEXTE-08 : `computeAvailableSlots` écarte les disponibilités sans propriétaire", () => {
  const code = sansCommentairesTs(BOOKING);
  assert.match(code, /filter\([\s\S]{0,200}a\.isActive && a\.coachId !== null/,
    "le filtre doit porter sur les deux conditions");
  assert.match(code, /availabilityId: availability\.id/);
  assert.match(code, /coachId: availability\.coachId/);
});

await test("TEXTE-09 : `AvailableSlot` porte les deux champs, et l'espace élève les transmet", () => {
  const typesCode = sansCommentairesTs(TYPES);
  const bloc = typesCode.slice(typesCode.indexOf("export interface AvailableSlot"), typesCode.indexOf("export interface AvailableSlot") + 400);
  assert.match(bloc, /availabilityId: string;/);
  assert.match(bloc, /coachId: string;/);
  const page = sansCommentairesTs(PAGE_ELEVE);
  assert.match(page, /availabilityId: slot\.availabilityId/, "la page élève doit transmettre le créneau réservé");
  /*
   * ⚠️ ASSERTION RESSERRÉE, PAS AFFAIBLIE (lot 2, 16/11/2026). Elle portait
   * sur TOUT le fichier : `assert.equal(/coachId: null/.test(page), false)`.
   * Le lot 2 a introduit dans cette page un `coachId: null` LÉGITIME —
   * l'état initial de `coachInfo`, nul tant que la RPC
   * `get_my_coach_public_profile` n'a pas répondu, et dont la nullité est
   * précisément ce qui interdit à la carte de rendez-vous de nommer un coach
   * non prouvé dans l'intitulé d'une invitation. Le défaut visé ici est
   * l'objet `created` : il forçait `coachId: null` dans le rendez-vous
   * affiché après réservation. L'assertion le cible maintenant nommément,
   * donc plus strictement qu'avant — n'importe quel `coachId: null` ailleurs
   * la satisfaisait ou la cassait sans rapport avec le défaut.
   */
  const debutObjetCree = page.indexOf("const created: AdminAppointment = {");
  assert.ok(debutObjetCree > 0, "l'objet `created` doit toujours être construit dans handleBook");
  const finObjetCree = page.indexOf("};", debutObjetCree);
  assert.ok(finObjetCree > debutObjetCree, "l'objet `created` doit être un littéral refermé");
  const objetCree = page.slice(debutObjetCree, finObjetCree + 2);
  assert.match(objetCree, /coachId: slot\.coachId/, "et afficher le coach du créneau, non `null`");
  assert.equal(/coachId: null/.test(objetCree), false, "plus de coachId forcé à null dans le rendez-vous créé");
  // Contre-épreuve : le défaut d'origine, réintroduit dans la tranche ciblée,
  // doit bien faire rougir l'assertion resserrée.
  const objetFautif = objetCree.replace("coachId: slot.coachId", "coachId: null");
  assert.notEqual(objetFautif, objetCree, "la mutation doit s'appliquer");
  assert.throws(
    () => assert.equal(/coachId: null/.test(objetFautif), false),
    "l'assertion resserrée doit détecter un coachId forcé à null dans `created`",
  );
});

await test("TEXTE-10 : le report suit le coach du rendez-vous, pas celui de l'appelant", () => {
  const code = MIGRATION_CODE;
  const bloc = code.slice(code.indexOf("create or replace function public.reschedule_appointment_atomic"));
  assert.match(bloc, /calendar_has_conflict_pour_coach\(\s*\n?\s*v_original\.coach_id/,
    "le conflit du report doit être évalué sur le coach du rendez-vous");
  /*
   * ⚠️ ET UN RENDEZ-VOUS ORPHELIN EST REFUSÉ, PAS REPLIÉ. Le repli
   * `coalesce(v_original.coach_id, current_staff_id())` aurait pu attribuer le
   * report à un collaborateur — le défaut corrigé dans la RPC de création.
   */
  assert.match(bloc, /if v_original\.coach_id is null then[\s\S]{0,160}calendar_owner_unresolved/,
    "un report de rendez-vous sans propriétaire doit être refusé");
  assert.equal(
    /coalesce\(v_original\.coach_id, public\.current_staff_id\(\)\)/.test(bloc), false,
    "plus aucun repli sur la fiche de l'appelant",
  );
  assert.equal(
    /calendar_has_conflict\(p_new_start_at/.test(bloc),
    false,
    "l'ancien appel, qui prenait la portée de l'appelant, ne doit plus exister",
  );
});

await test("TEXTE-13 : ordre de verrouillage — disponibilité PUIS élève, les deux en `for share`", () => {
  /*
   * ⚠️ L'ORDRE N'EST PAS UNE PRÉFÉRENCE DE STYLE, IL A ÉTÉ MESURÉ. Le
   * 15/11/2026, sur PostgreSQL 16.15 : une transaction qui verrouille
   * `students` PUIS `coach_availabilities` en concurrence d'une réservation
   * produit un interblocage (`deadlock detected`, 1 compté dans
   * `pg_stat_database`). Dans l'ordre de la RPC — `coach_availabilities` puis
   * `students` — aucun : elle attend.
   */
  const eleve = corpsDe("reserver_creneau_eleve");
  const posDispo = eleve.indexOf("from public.coach_availabilities");
  const posEleve = eleve.indexOf("from public.students s");
  assert.ok(posDispo > 0 && posEleve > 0, "les deux lignes doivent être lues");
  assert.ok(posDispo < posEleve, "la disponibilité se verrouille AVANT la ligne élève");
  assert.equal(eleve.split("for share").length - 1, 2, "exactement deux lectures `for share`");
  assert.match(eleve.slice(posDispo, posEleve), /where id = p_availability_id\s*\n\s*for share;/,
    "la lecture de la disponibilité doit être `for share`");
  assert.match(eleve.slice(posEleve), /where s\.id = v_student_id\s*\n\s*for share;/,
    "la lecture de l'élève doit être `for share`, et porter sur l'élève de la SESSION");
  assert.match(
    eleve.slice(posEleve),
    /if not found or v_coach_eleve is null or v_coach_eleve <> v_dispo\.coach_id then[\s\S]{0,140}calendar_slot_forbidden/,
    "le rattachement verrouillé doit être comparé au propriétaire de la disponibilité verrouillée",
  );

  /*
   * La création manuelle ne verrouille QUE `students` : elle ne touche à
   * aucune disponibilité, donc elle ne peut composer aucun cycle.
   */
  const staff = corpsDe("creer_rendez_vous_staff");
  assert.equal(staff.includes("from public.coach_availabilities"), false,
    "la création manuelle ne lit aucune disponibilité");
  assert.equal(staff.split("for share").length - 1, 1, "elle ne verrouille que la ligne élève");

  assert.match(MIGRATION, /ORDRE DE VERROUILLAGE DU PROJET/,
    "l'ordre doit être documenté sur place, pas seulement respecté");
});

await test("TEXTE-15 : le garde-fou de M1 lit les TROIS fonctions d'identité et délègue", () => {
  const debut = MIGRATION_CODE.indexOf("create or replace function public.create_appointment_atomic");
  const fin = MIGRATION_CODE.indexOf("revoke all on function public.create_appointment_atomic", debut);
  assert.ok(debut > 0 && fin > debut, "le garde-fou doit être délimitable");
  const corps = MIGRATION_CODE.slice(debut, fin);

  /*
   * ⚠️ `is_admin()` EN PLUS DE `current_staff_id()`. Une première rédaction ne
   * testait que la présence d'une fiche `coaches` : un administrateur
   * applicatif SANS fiche — reconnu par `is_admin()` seul — n'aurait pas été
   * vu comme staff, et son identité double n'aurait pas été nommée. Le cas T30
   * de la checklist SQL le démontre sur base.
   */
  assert.match(corps, /v_identite_eleve := public\.current_student_id\(\) is not null;/);
  assert.match(
    corps,
    /v_identite_staff := public\.current_staff_id\(\) is not null\s*\n?\s*or coalesce\(public\.is_admin\(\), false\);/,
    "la détection du staff doit lire current_staff_id() ET is_admin()",
  );

  // Les deux refus, dans cet ordre : l'ambiguïté d'abord, car elle est plus
  // précise et ne devrait jamais arriver.
  const posAmbigue = corps.indexOf("calendar_identite_ambigue");
  const posObsolete = corps.indexOf("calendar_parcours_obsolete");
  assert.ok(posAmbigue > 0 && posObsolete > posAmbigue, "l'ambiguïté se signale avant l'obsolescence");

  // ⚠️ TOUT PORTEUR DE FICHE ÉLÈVE EST REFUSÉ — option B stricte. Les deux
  // `raise` précèdent la délégation : aucun chemin d'écriture ne leur échappe.
  const posDelegation = corps.indexOf("return public.creer_rendez_vous_staff(");
  assert.ok(posDelegation > posObsolete, "la délégation vient après les deux refus");

  // Et le garde-fou ne réimplémente rien.
  assert.equal(
    /insert\s+into\s+public\.appointments/i.test(corps),
    false,
    "le garde-fou ne doit contenir aucune écriture directe",
  );
  assert.equal(
    /pg_advisory_xact_lock/.test(corps),
    false,
    "ni verrou : il délègue, et la fonction appelée s'en charge",
  );

  // La migration vérifie elle-même tout cela.
  assert.match(MIGRATION_CODE, /LOT1\/M1 : la garde ne lit pas les trois fonctions d''identite/);
  assert.match(MIGRATION_CODE, /LOT1\/M1 : le chemin staff doit DELEGUER, pas reimplementer/);
  assert.match(MIGRATION_CODE, /LOT1\/M1 : le garde-fou ne doit contenir aucune ecriture directe/);
});

await test("TEXTE-16 : les deux scripts de retour arrière existent, HORS du dossier migrations", () => {
  const d3 = lire("../../docs/lot1-retour-arriere-reprise.sql");
  const d4 = lire("../../docs/lot1-reouverture-ancien-parcours.sql");

  /*
   * ⚠️ HORS DE `supabase/migrations/`, ET C'EST LE POINT. Ces scripts y
   * seraient appliqués par le prochain `supabase db push` — c'est-à-dire
   * exactement au moment où personne ne le veut.
   */
  const migrations = readdirSync(new URL("../../supabase/migrations", import.meta.url));
  for (const interdit of ["retour-arriere", "reouverture", "lot1-rollback"]) {
    assert.deepEqual(
      migrations.filter((f) => f.includes(interdit)),
      [],
      `aucun script de retour arrière dans migrations/ (${interdit})`,
    );
  }

  // D3 désigne ses lignes NOMMÉMENT et refuse d'écraser un geste postérieur.
  assert.match(d3, /c_dispos_sans_proprietaire constant uuid\[\]/);
  assert.match(d3, /c_rdv_sans_proprietaire constant uuid\[\]/);
  assert.match(d3, /c_eleves_sans_coach constant uuid\[\]/);
  assert.match(d3, /coach_id is distinct from c_coach_a/, "les lignes modifiées depuis M1 sont détectées");
  assert.match(d3, /and coach_id = c_coach_a/, "et seules celles encore chez Coach A sont restaurées");
  // ⚠️ SUR LE CODE, PAS SUR LA PROSE. D3 ÉCRIT en commentaire « aucun
  // `delete`, aucun `truncate` » : chercher ces mots dans le texte brut les
  // trouverait dans la phrase qui promet le contraire.
  assert.equal(
    /delete\s+from|truncate/i.test(sansCommentairesSql(d3)),
    false,
    "D3 ne supprime rien",
  );

  // D4 est identifié comme une urgence, et refuse de s'exécuter après M2.
  assert.match(d4, /PROCÉDURE D'URGENCE/);
  assert.match(d4, /sans validation de disponibilit/i, "D4 doit dire ce qu'il rouvre");
  assert.match(d4, /NE VALIDE AUCUNE/);
  assert.match(d4, /M2 a deja ete appliquee/, "D4 doit refuser de recréer la fonction après M2");
});

await test("TEXTE-11 : la migration est déclarée au contrat ET au manifeste", () => {
  const contrat = lire("./contrat-migrations.mts");
  assert.ok(contrat.includes("20261115090000_lot1_multi_coach_ajout.sql"), "M1 nommée dans le contrat");
  assert.ok(contrat.includes("MIGRATION_LOT1_M1_AJOUT,"), "M1 inscrite dans MIGRATIONS_APRES_C0_1");
  // ⚠️ SUR LE CODE, PAS SUR LA PROSE : le contrat CITE l'ancien nom dans son
  // commentaire, précisément pour documenter le renommage.
  assert.equal(
    sansCommentairesTs(contrat).includes("lot1_affectation_multi_coach.sql"),
    false,
    "l'ancien nom ne doit plus être déclaré : le fichier a été renommé",
  );
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json")) as {
    migrations_post_baseline_attendues: string[];
  };
  assert.ok(
    manifeste.migrations_post_baseline_attendues.includes("20261115090000_lot1_multi_coach_ajout.sql"),
    "déclarée au manifeste, sans quoi le bootstrap d'une base neuve l'ignore",
  );
});

await test("TEXTE-17 : l'identité journalisée vient du rendez-vous créé, pas du navigateur", () => {
  const code = sansCommentairesTs(APPOINTMENTS);

  // Le champ a disparu de l'interface publique, et de l'écran.
  assert.equal(code.includes("studentIdPourJournal"), false, "le champ ne doit plus exister");
  assert.equal(
    sansCommentairesTs(PAGE_ELEVE).includes("studentIdPourJournal"),
    false,
    "la page élève ne doit plus le passer",
  );

  // L'entrée de réservation ne porte plus aucune identité.
  const bloc = code.slice(code.indexOf("export interface ReservationEleveInput"));
  const corpsBloc = bloc.slice(0, bloc.indexOf("}"));
  assert.equal(/student|coach/i.test(corpsBloc), false, "ReservationEleveInput ne porte aucune identité");

  /*
   * ⚠️ UNE SEULE SOURCE DE VÉRITÉ, POUR LES DEUX PARCOURS. L'identité
   * journalisée est relue sur `appointments` à partir de l'identifiant rendu
   * par la RPC. Deux règles à tenir à jour, c'est une de trop.
   */
  assert.match(code, /async function journaliserRendezVousCree\(/);
  assert.match(code, /from\("appointments"\)\s*\n?\s*\.select\("student_id"\)/);
  assert.equal(
    code.split("journaliserRendezVousCree(").length - 1,
    3,
    "une définition et deux appels : les deux parcours passent par elle",
  );
  // Et plus aucun `logActivityEvent` direct dans les deux créations.
  // ⚠️ LA TRANCHE S'ARRÊTE À LA FIN DES DEUX CRÉATIONS. Au-delà,
  // `cancelAppointment` journalise une ANNULATION — c'est légitime, et
  // l'inclure faisait échouer l'assertion pour une raison étrangère.
  const debutCreations = code.indexOf("export async function reserverCreneauEleve");
  const finCreations = code.indexOf("export async function cancelAppointment");
  assert.ok(debutCreations > 0 && finCreations > debutCreations, "les deux créations doivent être délimitables");
  assert.equal(
    code.slice(debutCreations, finCreations).includes("logActivityEvent("),
    false,
    "les créations ne doivent plus journaliser directement",
  );

  // Best-effort préservé : la relecture ratée ne lève pas, elle avertit.
  assert.match(code, /devWarn\("journaliserRendezVousCree \(relecture de l'élève\)", error\);\s*\n\s*return;/);
});

await test("TEXTE-18 : les deux motifs de la fenêtre M1 sont câblés côté TypeScript", () => {
  const code = sansCommentairesTs(APPOINTMENTS);
  /*
   * ⚠️ SANS EUX, UN ONGLET RESTÉ OUVERT AFFICHERAIT « Création impossible.
   * Réessaie. » et l'élève recliquerait indéfiniment. Ces deux motifs sont
   * levés par le garde-fou de M1, jamais par la nouvelle application.
   */
  for (const [fragment, motif] of [
    ["calendar_parcours_obsolete", "parcours_obsolete"],
    ["calendar_identite_ambigue", "identite_ambigue"],
  ] as const) {
    assert.ok(MIGRATION_CODE.includes(fragment), `M1 doit lever ${fragment}`);
    assert.ok(code.includes(fragment), `la couche TS doit traduire ${fragment}`);
    assert.ok(code.includes(`${motif}:`), `${motif} doit avoir sa phrase dans MOTIFS_DE_REFUS`);
  }
  assert.match(code, /parcours_obsolete: "[^"]*[Rr]echarge/, "le message doit dire de recharger la page");
});

await test("TEXTE-12 : la checklist SQL existe et finit par un ROLLBACK", () => {
  const checklist = lire("../../supabase/tests/lot1_affectation_multi_coach_checklist.sql");
  /*
   * ⚠️ LA DERNIÈRE INSTRUCTION, PAS LA DERNIÈRE LIGNE. Le fichier se termine
   * par un bloc de commentaires (la procédure T10, qui demande deux sessions
   * et ne peut pas tenir dans un fichier) : comparer la fin brute du texte
   * rendrait cette assertion fausse pour une raison qui n'a rien à voir.
   */
  const instructions = checklist
    .replace(/--[^\n]*/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  assert.equal(
    instructions[instructions.length - 1],
    "rollback;",
    "la checklist ne doit rien laisser derrière elle",
  );
  // Le `commit;` du bloc T10 est dans un COMMENTAIRE : on interroge les
  // instructions, jamais le texte brut.
  assert.equal(instructions.includes("commit;"), false, "aucun commit dans une checklist");
  for (const cas of ["T01", "T03", "T05", "T09", "T12", "T13b", "T16a", "T28", "T29", "T30", "T31", "T32"]) {
    assert.ok(checklist.includes(cas), `le cas ${cas} doit être présent dans la checklist`);
  }
  /*
   * ⚠️ LA CHECKLIST SERT AUX DEUX ÉTATS, et elle le détecte. Asserter « zéro
   * signature de create_appointment_atomic » vaut après M2 et pas après M1 :
   * un fichier qui l'affirmerait sans condition serait faux à l'une des deux
   * étapes du déploiement.
   */
  assert.match(checklist, /v_etape_m1 boolean := exists \(/, "la checklist doit détecter l'état");
  assert.match(checklist, /if v_etape_m1 then/, "et choisir son bloc d'assertions");
  assert.match(checklist, /T28\.\.T32 sautés/, "les cas de la fenêtre M1 sont sautés après M2");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);

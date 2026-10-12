import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  AffectationCollaborateur,
  CategorieDroit,
  NiveauDroit,
  PermissionsCollaborateur,
} from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès aux deux tables du modèle de droits P13-B —
 * `collaborateur_eleves` (affectation explicite d'un élève) et
 * `collaborateur_permissions` (niveau par catégorie) — utilisée par la
 * section "Coachs" de /admin/parametres.
 *
 * ---------------------------------------------------------------------
 * Pourquoi un client de SESSION et aucune route API
 * ---------------------------------------------------------------------
 * Même principe que `lib/supabase/coaches.ts::updateCoach` : ces écritures
 * n'ont besoin d'aucun privilège service role, et les policies posées par la
 * migration 20261011090000 les réservent DÉJÀ à l'administrateur :
 *
 *   collaborateur_eleves_manage_admin       — ALL, using/with check is_admin()
 *   collaborateur_permissions_manage_admin  — ALL, using/with check is_admin()
 *   collaborateur_*_select_self             — SELECT de ses propres lignes
 *
 * Le refus est donc rendu par PostgreSQL, pas par l'interface : un coach, un
 * collaborateur ou un élève qui appellerait ces fonctions obtiendrait zéro
 * ligne en lecture et une erreur en écriture. Ajouter une route
 * `/api/admin/...` n'aurait rien resserré et aurait au contraire créé une
 * nouvelle surface capable de lire ces tables avec le service role, donc
 * hors RLS.
 *
 * Aucune donnée globale nouvelle n'est exposée : les deux tables ne
 * contiennent que des identifiants d'affectation, et leur lecture est déjà
 * bornée par les policies ci-dessus.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

/* ─── Lecture ─── */

/**
 * Élèves explicitement affectés à ce collaborateur, avec de quoi les
 * afficher. La jointure passe par `students` : l'affectation seule ne
 * contient qu'un identifiant, et l'interface doit afficher un nom.
 *
 * Les lignes sans élève joint (élève supprimé entre-temps) sont écartées
 * plutôt que rendues avec un nom vide.
 */
export async function getAffectations(
  supabase: TypedSupabaseClient,
  collaborateurId: string,
): Promise<AffectationCollaborateur[]> {
  const { data, error } = await supabase
    .from("collaborateur_eleves")
    .select("student_id, students(first_name, last_name, email)")
    .eq("collaborateur_id", collaborateurId);
  devWarn("getAffectations", error);

  type Ligne = {
    student_id: string;
    students: { first_name: string; last_name: string; email: string } | null;
  };

  return ((data ?? []) as unknown as Ligne[])
    .filter((ligne) => ligne.students !== null)
    .map((ligne) => ({
      studentId: ligne.student_id,
      firstName: ligne.students?.first_name ?? "",
      lastName: ligne.students?.last_name ?? "",
      email: ligne.students?.email ?? "",
    }))
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, "fr"));
}

/**
 * Permissions ENREGISTRÉES de ce collaborateur. Une catégorie absente du
 * résultat n'a aucun accès : la fonction ne complète jamais le dictionnaire
 * avec une valeur par défaut, pour que l'affichage reste fidèle à ce qui est
 * réellement en base.
 */
export async function getPermissions(
  supabase: TypedSupabaseClient,
  collaborateurId: string,
): Promise<PermissionsCollaborateur> {
  const { data, error } = await supabase
    .from("collaborateur_permissions")
    .select("categorie, niveau")
    .eq("collaborateur_id", collaborateurId);
  devWarn("getPermissions", error);

  const permissions: PermissionsCollaborateur = {};
  for (const ligne of data ?? []) {
    permissions[ligne.categorie] = ligne.niveau;
  }
  return permissions;
}

/** Identité minimale des élèves, pour le sélecteur d'affectation. */
export interface EleveAffectable {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Liste courte des élèves. Volontairement distincte de
 * `lib/supabase/students.ts::getStudents`, qui charge en plus les profils,
 * les paiements, les programmes et les plans : le sélecteur n'a besoin que
 * d'un nom. La portée reste celle de la policy `students_select_self_or_staff`
 * (`student_ids_portee()`), donc rien de plus que ce que l'appelant voit
 * déjà ailleurs.
 */
export async function getElevesAffectables(supabase: TypedSupabaseClient): Promise<EleveAffectable[]> {
  const { data, error } = await supabase
    .from("students")
    .select("id, first_name, last_name, email")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });
  devWarn("getElevesAffectables", error);
  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
  }));
}

/* ─── Écriture (réservée à l'administrateur par la RLS) ─── */

export type ResultatEcriture = { ok: true } | { ok: false; error: string };

function echec(contexte: string, error: { message: string; code?: string } | null): ResultatEcriture {
  devWarn(contexte, error);
  // `42501` = insufficient_privilege, le code renvoyé quand la policy
  // `..._manage_admin` refuse l'écriture. Le message doit rester
  // compréhensible pour l'administrateur sans exposer le détail SQL.
  if (error?.code === "42501") {
    return { ok: false, error: "Accès refusé : seul un administrateur peut modifier les droits d'un collaborateur." };
  }
  return { ok: false, error: "Échec de l'enregistrement." };
}

/**
 * Affecte un élève à un collaborateur. `affecte_par` conserve la fiche
 * `coaches` de l'administrateur à l'origine de la décision.
 *
 * Idempotent par construction : la contrainte
 * `collaborateur_eleves_unique (collaborateur_id, student_id)` empêche le
 * doublon, et une seconde affectation du même élève est traitée comme un
 * succès plutôt que comme une erreur à afficher.
 */
export async function affecterEleve(
  supabase: TypedSupabaseClient,
  collaborateurId: string,
  studentId: string,
  affectePar: string | null,
): Promise<ResultatEcriture> {
  const { error } = await supabase
    .from("collaborateur_eleves")
    .insert({ collaborateur_id: collaborateurId, student_id: studentId, affecte_par: affectePar });
  if (error && error.code !== "23505") return echec("affecterEleve", error);
  return { ok: true };
}

/** Révoque l'affectation d'un élève — l'accès du collaborateur tombe aussitôt. */
export async function revoquerEleve(
  supabase: TypedSupabaseClient,
  collaborateurId: string,
  studentId: string,
): Promise<ResultatEcriture> {
  const { error } = await supabase
    .from("collaborateur_eleves")
    .delete()
    .eq("collaborateur_id", collaborateurId)
    .eq("student_id", studentId);
  if (error) return echec("revoquerEleve", error);
  return { ok: true };
}

/**
 * Fixe le niveau d'UNE catégorie, indépendamment des trois autres.
 *
 * `niveau === null` SUPPRIME la ligne : « aucun accès » n'est pas une valeur
 * stockable (la contrainte CHECK n'accepte que `lecture` et `ecriture`),
 * c'est l'absence de ligne. Écrire une troisième valeur aurait créé deux
 * façons de dire la même chose.
 *
 * L'upsert cible la contrainte unique (collaborateur_id, categorie) : passer
 * de `lecture` à `ecriture` met la ligne existante à jour, il n'y a jamais
 * deux lignes pour une même catégorie.
 */
export async function definirPermission(
  supabase: TypedSupabaseClient,
  collaborateurId: string,
  categorie: CategorieDroit,
  niveau: NiveauDroit | null,
  accordePar: string | null,
): Promise<ResultatEcriture> {
  if (niveau === null) {
    const { error } = await supabase
      .from("collaborateur_permissions")
      .delete()
      .eq("collaborateur_id", collaborateurId)
      .eq("categorie", categorie);
    if (error) return echec("definirPermission (suppression)", error);
    return { ok: true };
  }

  const { error } = await supabase
    .from("collaborateur_permissions")
    .upsert(
      { collaborateur_id: collaborateurId, categorie, niveau, accorde_par: accordePar },
      { onConflict: "collaborateur_id,categorie" },
    );
  if (error) return echec("definirPermission", error);
  return { ok: true };
}

/* ─── Résumé pour la liste ─── */

export interface ResumeDroits {
  permissions: PermissionsCollaborateur;
  nbEleves: number;
}

/**
 * Résumé des droits de TOUS les collaborateurs, indexé par id de fiche
 * `coaches` — pour que la liste de /admin/parametres affiche ce qui est
 * réellement enregistré, sans ouvrir chaque modale.
 *
 * Deux requêtes sans filtre, bornées par les policies `..._manage_admin` /
 * `..._select_self` : un administrateur obtient tout, un collaborateur
 * uniquement ses propres lignes, un élève rien. Aucune donnée globale
 * supplémentaire n'est donc exposée par cette lecture.
 *
 * Un collaborateur absent du résultat n'a aucun droit : l'appelant lit
 * `resumes[id]` et traite `undefined` comme « aucun accès, aucun élève ».
 */
export async function getResumesDroits(supabase: TypedSupabaseClient): Promise<Record<string, ResumeDroits>> {
  const [{ data: lignesPermissions, error: erreurPermissions }, { data: lignesAffectations, error: erreurAffectations }] =
    await Promise.all([
      supabase.from("collaborateur_permissions").select("collaborateur_id, categorie, niveau"),
      supabase.from("collaborateur_eleves").select("collaborateur_id"),
    ]);
  devWarn("getResumesDroits (permissions)", erreurPermissions);
  devWarn("getResumesDroits (affectations)", erreurAffectations);

  const resumes: Record<string, ResumeDroits> = {};
  const obtenir = (id: string): ResumeDroits => {
    if (!resumes[id]) resumes[id] = { permissions: {}, nbEleves: 0 };
    return resumes[id];
  };

  for (const ligne of lignesPermissions ?? []) {
    obtenir(ligne.collaborateur_id).permissions[ligne.categorie] = ligne.niveau;
  }
  for (const ligne of lignesAffectations ?? []) {
    obtenir(ligne.collaborateur_id).nbEleves += 1;
  }
  return resumes;
}

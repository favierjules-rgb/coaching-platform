/**
 * LE CONTRAT DES MIGRATIONS — une seule vérité, partagée par trois suites.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 * ────────────────────────────────────────────────────────────────────────────
 * Avant C2, trois suites (`liste-de-courses-c1`, `courses-c0-validation`,
 * `liste-de-courses-ux`) portaient chacune la même garantie, écrite trois fois :
 *
 *     « ce lot n'introduit AUCUNE migration inattendue ».
 *
 * Elle s'exprimait par un compte — `assert.equal(migrations.length, 80)` — et
 * par le nom de la dernière. C2 introduit une migration : le compte devient
 * faux, et la tentation serait de le remonter à 81.
 *
 * ⚠️ REMONTER LE COMPTE AFFAIBLIRAIT LA GARANTIE, ET C'EST EXACTEMENT CE QU'IL
 * NE FAUT PAS FAIRE. « 81 migrations » est satisfait par n'importe quelle
 * 81ᵉ migration — y compris une migration étrangère glissée en même temps, y
 * compris deux migrations C2 dont l'une écraserait l'autre. Le compte ne dit
 * rien de ce qui a été ajouté.
 *
 * La garantie est donc RENFORCÉE, pas déplacée : au lieu d'un nombre, on fige
 * l'IDENTITÉ EXACTE de ce qui est autorisé, l'ORDRE dans lequel les deux
 * dernières migrations doivent apparaître, et une EMPREINTE de tout l'historique
 * antérieur — qui rougit si une migration est antidatée pour se glisser avant.
 *
 * ⚠️ CE MODULE N'EST PAS UNE SUITE. Il n'exécute aucun test ; il expose une
 * fonction que les suites appellent avec leur propre `assert`.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

/** La dernière migration d'avant C2 : le verrou serveur du repas consommé. */
export const MIGRATION_C0_1 = "20260914090000_c0_1_verrou_repas_consomme.sql";

/** La SEULE migration que C2 a le droit d'ajouter. */
export const MIGRATION_C2 = "20260915090000_c2_liste_de_courses_persistante.sql";

/** La SEULE migration que C3 a le droit d'ajouter. */
export const MIGRATION_C3 = "20260916090000_c3_budget_et_prix_estimatifs.sql";

/**
 * La SEULE migration que C4.1 a le droit d'ajouter — le pont aliment → produit.
 *
 * ⚠️ Elle est ADDITIVE et n'ajoute qu'UNE table (`food_catalog_retail_review`).
 * Elle ne touche ni `food_products`, ni `food_catalog`, ni aucune structure de
 * C2/C3. C'est le point 4 ci-dessous qui interdit qu'une seconde migration C4
 * se glisse pour « corriger » celle-ci : une migration déjà appliquée en
 * distant ne se réécrit pas, mais une migration du même lot ne se dédouble pas
 * non plus.
 */
export const MIGRATION_C4_1 = "20260917090000_c4_1_pont_retail.sql";

/**
 * La SEULE migration que C4.2 a le droit d'ajouter — le modèle du magasin.
 *
 * ⚠️ ADDITIVE, et elle ne crée que DEUX tables : `stores` (référentiel canonique
 * minimal, fermé à l'écriture cliente) et `student_selected_store` (un magasin
 * actif par élève, garanti par la clé primaire). Elle ne touche à AUCUNE
 * structure de C2, C3 ou C4.1, n'introduit aucun prix, aucune disponibilité et
 * aucun appel réseau — c'est C4.3a qui fera entrer un magasin dans la table.
 *
 * ⚠️ SON HORODATAGE EST UN COMPTEUR D'ORDRE, PAS UNE DATE. `20260918…` suit
 * `20260917…` parce que `supabase db push` applique les fichiers dans l'ordre
 * lexicographique de leur nom, et pour aucune autre raison.
 */
export const MIGRATION_C4_2 = "20260918090000_c4_2_magasins.sql";

/**
 * La SEULE migration que C4.3c a le droit d'ajouter — OpenStreetMap devient
 * l'annuaire des magasins.
 *
 * ⚠️ ADDITIVE, ET ELLE NE CRÉE AUCUNE TABLE. Elle fait trois choses et pas une
 * de plus : elle rend `stores.op_location_id` NULLABLE — un magasin réel peut
 * exister sans que Open Prices le connaisse, et c'est le fait mesuré à Toulon
 * qui l'impose ; elle ajoute `brand_wikidata` et `operator_wikidata`, tous deux
 * nullables, pour identifier une enseigne autrement que par son nom ; et elle
 * pose la FORME de ces deux identifiants (`^Q[1-9][0-9]*$`).
 *
 * ⚠️ ELLE NE TOUCHE NI À `stores_op_location_id_key` NI À
 * `stores_op_location_id_positif`. Vérifié sur un PostgreSQL 16 réel : un
 * UNIQUE simple traite les NULL comme DISTINCTS, et un CHECK ne rougit que sur
 * FALSE — `NULL > 0` vaut UNKNOWN et passe. Les deux contraintes existantes
 * couvraient donc déjà le cas nullable, et une migration qui les aurait
 * réécrites « pour être sûre » aurait été du bruit dangereux.
 *
 * ⚠️ SON RETOUR EN ARRIÈRE N'EST PLUS ANODIN une fois qu'un magasin sans pont
 * a été sélectionné : réimposer NOT NULL échouerait sur les lignes existantes.
 */
export const MIGRATION_C4_3C = "20260919090000_c4_3c_magasins_osm.sql";

/**
 * Les migrations du chantier COURSES, dans l'ordre d'application.
 *
 * ⚠️ CETTE LISTE EST LE CONTRAT, ET ELLE S'ALLONGE EXPLICITEMENT. Chaque lot
 * qui ajoute une migration doit venir l'inscrire ici — c'est précisément ce que
 * le compte seul ne demandait pas, et c'est pour ça qu'il a été remplacé.
 */
/**
 * N1.7 — LA PREMIÈRE MIGRATION POSTÉRIEURE AU CHANTIER COURSES.
 *
 * ⚠️ ELLE N'APPARTIENT PAS À COURSES, ET C'EST TOUT L'INTÉRÊT DE LA NOMMER À
 * PART. Le contrat disait jusqu'ici « après C0.1, il n'y a QUE des migrations
 * COURSES » — une formulation qui n'était vraie que tant qu'aucun autre
 * chantier n'ajoutait de migration. La règle réelle, celle qui vaut la peine
 * d'être gardée, est plus simple : TOUTE migration ajoutée doit être inscrite
 * ici, nommément. Elle l'est.
 */
export const MIGRATION_N1_7 = "20260920090000_n1_7_listes_ignorables.sql";

/**
 * N1.7.1 — LE CORRECTIF DE CONSOMMATION.
 *
 * ⚠️ UNE SECONDE MIGRATION POUR LE MÊME CHANTIER, ET ELLE EST INSCRITE À PART
 * PLUTÔT QUE FONDUE DANS N1.7. Celle-ci ne pouvait pas modifier la première :
 * N1.7 est DÉJÀ APPLIQUÉE sur la base distante, et réécrire une migration
 * jouée est le seul geste que ce dépôt s'interdit sans exception.
 */
export const MIGRATION_N1_7_1 = "20260921090000_n1_7_1_consommer_avec_rien.sql";

/**
 * C5.1 — LA CONNEXION NOLIO DE L'ÉLÈVE.
 *
 * ⚠️ PREMIÈRE MIGRATION D'UN CHANTIER QUI N'EST NI COURSES NI NUTRITION, et
 * elle est inscrite ici pour la même raison que les précédentes : la règle du
 * contrat n'est pas « les migrations appartiennent à tel chantier », c'est
 * « aucune migration n'existe sans avoir été nommée ». Elle crée
 * `nolio_connections` — une table neuve, aucune table existante n'est touchée.
 */
export const MIGRATION_C5_1 = "20260922090000_c5_1_connexions_nolio.sql";

/**
 * LA DATE DE DÉBUT DES PROGRAMMES.
 *
 * ⚠️ UNE COLONNE, ET AUCUNE DONNÉE. Elle ajoute
 * `assignments.program_start_date` sans remplir une seule des 15 affectations
 * existantes : les régulariser demande une décision de coaching, pas une
 * requête. C'est la migration la plus étroite du dépôt, et c'est voulu.
 */
export const MIGRATION_DEBUT_PROGRAMME = "20260923090000_date_debut_programme.sql";

/**
 * LA SUPPRESSION DE L'INTÉGRATION NOLIO.
 *
 * ⚠️ ELLE DÉFAIT C5.1, ELLE NE LA REMPLACE PAS. `MIGRATION_C5_1` reste
 * déclarée juste au-dessus, et son fichier reste sur le disque : il a été
 * appliqué en Production, et une migration appliquée ne se réécrit pas. Deux
 * entrées coexistent donc ici pour un seul chantier — celle qui a créé les
 * objets, et celle qui les retire.
 *
 * Elle supprime la vue `nolio_connexion_etat` puis la table
 * `nolio_connections`, sans `cascade`, après une garde qui refuse de
 * s'exécuter si la table n'est pas vide.
 */
export const MIGRATION_SUPPRESSION_NOLIO = "20260924090000_suppression_nolio.sql";

/**
 * PROGRESSION AUTOMATIQUE PAR EXERCICE — le réglage ON/OFF, GLOBAL au couple
 * (programme, exercice).
 *
 * Elle crée `program_exercise_progression` avec DEUX identités d'exercice
 * mutuellement exclusives (fiche de banque, ou nom normalisé pour un exercice
 * en texte libre), un CHECK qui impose « exactement une », deux index uniques
 * partiels, et la RLS calquée sur `program_weeks`. Aucune ligne écrite :
 * absence de ligne = OFF, donc aucun programme existant ne change de
 * comportement.
 */
export const MIGRATION_PROGRESSION_AUTOMATIQUE =
  "20260925090000_progression_automatique_par_exercice.sql";

/* ────────────────────────────────────────────────────────────────────────────
 * LES QUATORZE MIGRATIONS INSCRITES LE 11/10/2026 — ET POURQUOI SI TARD
 * ────────────────────────────────────────────────────────────────────────────
 * Le contrat dit « aucune migration n'existe sans avoir été nommée ». Il n'a
 * pourtant plus été alimenté après `20260925090000` : onze migrations ont été
 * ajoutées et COMMITTÉES par le propriétaire du dépôt entre le 24/09 et le
 * 10/10 sans passer ici, puis trois de plus par P13-B. Le contrôle rougissait
 * donc en permanence, ce qui est exactement ce qu'il devait faire — personne
 * ne l'avait relancé.
 *
 * Les quatorze sont inscrites APRÈS vérification, une par une : commit
 * d'origine (`git log` sur le fichier), appartenance à un chantier réel du
 * dépôt, absence de donnée personnelle, de secret et d'identifiant Stripe.
 * Les onze premières sont déjà APPLIQUÉES en production (la branche part de
 * `85a76f8`, état exact de la production) ; les trois dernières (P13-B) ne le
 * sont pas et ne doivent pas l'être sans décision explicite.
 *
 * ⚠️ Aucune assertion n'a été modifiée pour masquer l'écart : le compte, les
 * deux ordres, l'empreinte de l'historique antérieur et le balayage COURSES
 * sont intacts. Seul l'INVENTAIRE NOMMÉ s'allonge, ce que le contrat exige.
 */

/** Les drapeaux de relecture d'un programme (commit fb30d98). */
export const MIGRATION_PROGRAM_REVIEW_FLAGS = "20260926090000_program_review_flags.sql";

/**
 * Les deux rails de rappel automatique (commit fb30d98).
 *
 * ⚠️ SEULE DES QUATORZE À ÉCRIRE DES LIGNES, et ce sont des lignes de
 * CONFIGURATION, pas des données d'élève : deux campagnes système
 * (`rappel_auto = 'entrainement' | 'nutrition'`), `created_by` à NULL, insérées
 * sous `where not exists` donc idempotentes. Aucune donnée personnelle.
 */
export const MIGRATION_RAPPELS_AUTOMATIQUES = "20260927090000_rappels_automatiques.sql";

/** Les privilèges manquants des drapeaux de relecture (commit 287e58f). */
export const MIGRATION_REVIEW_FLAGS_GRANTS = "20260928090000_program_review_flags_grants.sql";

/** Les privilèges manquants des notifications (commit 287e58f). */
export const MIGRATION_NOTIFICATIONS_GRANTS = "20260929090000_notifications_grants.sql";

/** Le profil physiologique de l'élève (commit 9ea1576). */
export const MIGRATION_PROFIL_PHYSIOLOGIQUE = "20260930090000_profil_physiologique.sql";

/**
 * Le builder cardio et le calendrier (commit 9ea1576).
 *
 * Ses `insert` sont tous DANS des corps de fonction (RPC atomiques de
 * rendez-vous et de séance) : la migration elle-même n'écrit aucune ligne.
 */
export const MIGRATION_CARDIO_ET_CALENDRIER = "20260930100000_cardio_builder_et_calendrier.sql";

/** La consultation sécurisée des documents (commit 2096095). */
export const MIGRATION_DOCUMENTS_SECURISES = "20261001090000_documents_consultation_securisee.sql";

/**
 * P13-A, migration 1/4 — l'isolation RLS du cœur nutrition entre coachs
 * (commit ec98601). Couverte par
 * `scripts/tests/rls-nutrition-isolation-multi-coachs.mts` et par
 * `supabase/tests/nutrition_isolation_multi_coachs_checklist.sql`.
 */
export const MIGRATION_P13A_ISOLATION = "20261002090000_rls_nutrition_isolation_multi_coachs.sql";

/** P13-A, migration 2/4 — le coût d'évaluation des policies (commit 85a76f8). */
export const MIGRATION_P13A_PERF = "20261003090000_p13a_perf_rls_nutrition.sql";

/** P13-A, migration 3/4 — la garde admin du chemin d'écriture (commit 85a76f8). */
export const MIGRATION_P13A_GARDE_ADMIN = "20261003190000_p13a_perf_garde_admin_ecriture.sql";

/** P13-A, migration 4/4 — la lecture élève ensembliste (commit 85a76f8). */
export const MIGRATION_P13A_LECTURE_ELEVE = "20261003200000_p13a_perf_lecture_eleve_ensembliste.sql";

/**
 * P13-B, migration 1/3 — le modèle de droits des collaborateurs.
 *
 * ⚠️ PAS ENCORE APPLIQUÉE. Elle ajoute `coaches.role = 'collaborateur'`, les
 * deux tables `collaborateur_eleves` / `collaborateur_permissions` et 27
 * fonctions d'accès sans argument. Elle ne touche ni `profiles.role`, ni une
 * policy existante, ni une donnée.
 */
export const MIGRATION_P13B_MODELE = "20261011090000_p13b_modele_droits_collaborateurs.sql";

/**
 * P13-B, migration 2/3 — la réécriture des 72 policies `is_coach_or_admin()`
 * en policies cloisonnées par portée et par catégorie. PAS ENCORE APPLIQUÉE.
 */
export const MIGRATION_P13B_POLICIES = "20261011100000_p13b_policies_cloisonnees.sql";

/**
 * P13-B, migration 3/3 — le durcissement des fonctions `SECURITY DEFINER` qui
 * contournaient la RLS. PAS ENCORE APPLIQUÉE.
 */
export const MIGRATION_P13B_FONCTIONS = "20261011110000_p13b_durcissement_fonctions_definer.sql";

/**
 * P13-B, migration 4/4 — le cœur nutrition entre dans le modèle de
 * catégories. PAS ENCORE APPLIQUÉE.
 *
 * ⚠️ ELLE EXISTE PARCE QUE LES TROIS PREMIÈRES NE SUFFISAIENT PAS, ET C'EST
 * MESURÉ : un collaborateur `nutrition / ecriture` explicitement affecté
 * obtenait zéro plan, les huit tables du cœur opposant encore les ensembles de
 * PROPRIÉTÉ de P13-A (`nutrition_plan_ids_geres()` → `is_coach_of_student()` →
 * `students.coach_id`), qu'un collaborateur ne vaut jamais.
 *
 * Elle n'étend PAS les anciennes fonctions — un ensemble unique opposé en
 * lecture comme en écriture aurait fait du niveau `lecture` un droit
 * d'écriture. Elle ajoute dix fonctions de portée PAR NIVEAU et scinde les
 * policies `FOR ALL` en quatre. Elle corrige au passage le DÉFAUT de
 * `coaches.role` (`'admin'` → `'assistant'`) et fait suivre les droits
 * globaux à `public.is_admin()` : sans cela, toute fiche créée sans rôle
 * explicite devenait administrateur de cabinet sous P13-B.
 */
export const MIGRATION_P13B_NUTRITION = "20261011120000_p13b_integration_nutrition.sql";

/**
 * P13-B, migration 5/5 — la garde de `provision_program_copy`.
 * PAS ENCORE APPLIQUÉE.
 *
 * ⚠️ ELLE FERME LA DERNIÈRE PORTE, ET CELLE-LÀ ÉTAIT MESURÉE. La revue
 * finale a montré qu'un collaborateur SANS permission ni affectation créait
 * un programme et une affectation pour n'importe quel élève : la fonction est
 * `SECURITY DEFINER` (elle écrit hors RLS) et sa garde acceptait
 * `profiles.role in ('service','admin','coach')` — la bonne règle avant
 * P13-B, quand `coach` désignait un staff forcément global.
 *
 * Elle ne change QUE la garde, par substitution sur la définition en place
 * (même technique que 20261011110000) : le corps de la copie — semaines,
 * séances, blocs, exercices, prescriptions, RPE, verrou advisory, idempotence
 * — est repris octet pour octet, et la substitution échoue si le motif
 * attendu n'apparaît pas exactement une fois.
 */
export const MIGRATION_P13B_PROVISION = "20261011130000_p13b_garde_provision_program_copy.sql";

/**
 * P13-B, migration 6/6 — la surface de réservation.
 * PAS ENCORE APPLIQUÉE. Les cinq précédentes le sont (commit 8fc530f).
 *
 * ⚠️ ELLE CORRIGE UNE ANOMALIE MESURÉE SUR PREVIEW, ET LA CAUSE N'EST PAS
 * CELLE QU'ON CROIT. Un collaborateur dont `agenda_communication` vaut
 * « aucun accès » lisait les créneaux de disponibilité, les réglages de
 * réservation et les bornes occupées. Ce n'était ni une permission mal
 * enregistrée, ni un rôle mal résolu : les policies PERMISSIVES de PostgreSQL
 * se combinent en **OU**, et la migration 20261011100000 avait ajouté ses
 * policies catégorisées À CÔTÉ des policies héritées du parcours de
 * réservation élève (`auth.role() = 'authenticated'`), qui restaient vraies
 * pour tout compte connecté. `get_busy_ranges()`, SECURITY DEFINER, n'avait
 * aucune garde du tout.
 *
 * ⚠️ ELLE NE REFERME PAS LE PARCOURS ÉLÈVE, et c'est la moitié du correctif :
 * sans les créneaux, les réglages et les bornes occupées, un élève ne peut
 * plus réserver — ou réserve un créneau déjà pris. Les contrôles I13 à I15 de
 * la checklist échouent si on referme trop.
 */
export const MIGRATION_P13B_RESERVATION =
  "20261013090000_p13b_cloisonner_surface_reservation.sql";

/**
 * P13-B, migration 7/7 — l'administrateur réel et `est_staff_global()`.
 * PAS ENCORE APPLIQUÉE.
 *
 * ⚠️ ELLE DÉBLOQUE UN ENREGISTREMENT, PAS SEULEMENT UNE LECTURE. Signalé le
 * 13/10/2026 : plus aucune modification de programme ne s'enregistrait, avec
 * le bandeau « Une partie du programme n'a pas pu être enregistrée » — soit
 * `STRUCTURE_INCOMPLETE` (lib/admin-builder-save.ts). Reproduit : un compte
 * `profiles.role = 'admin'` SANS fiche `coaches` active obtenait
 * `staff_role()` NULL, donc `est_staff_global()` NULL, donc des ensembles
 * `program_ids_lecture()` / `program_ids_ecriture()` vides sur les programmes
 * MODÈLES — zéro semaine lue, insertion refusée en 42501.
 *
 * `est_staff_global()` ne consultait que `coaches.role` ; elle consulte
 * désormais AUSSI `is_admin()` (`profiles.role = 'admin'`), la distinction
 * déjà posée par 20261011130000 pour `provision_program_copy`. Un
 * collaborateur porte `profiles.role = 'coach'` : il ne gagne rien
 * (contrôles J5/J6 de la checklist).
 */
export const MIGRATION_P13B_ADMIN_REEL =
  "20261013100000_p13b_admin_reel_est_staff_global.sql";

/**
 * P13-B, migration 8/8 — les policies `INSERT` qui testaient leur propre id.
 * PAS ENCORE APPLIQUÉE. **CORRECTIF BLOQUANT.**
 *
 * ⚠️ CE DÉFAUT NE VISAIT PAS QUE LES COLLABORATEURS : il empêchait TOUTE
 * CRÉATION, administrateur compris. Cinq policies de 20261011100000 étaient
 * écrites `with check (id in (select <table>_ids_ecriture()))`, or ces
 * ensembles sont calculés depuis les lignes DÉJÀ EXISTANTES de la même
 * table : l'identifiant d'une ligne qu'on crée ne peut jamais y figurer. Une
 * policy INSERT doit porter sur le PARENT (« ai-je le droit d'écrire DANS ce
 * programme ? »), jamais sur son propre identifiant — ce que faisaient
 * correctement les neuf autres policies INSERT du cœur.
 *
 * Mesuré pour un ADMIN à fiche active : INSERT sur workout_sessions,
 * workout_exercises, programs, students et documents → 42501. UPDATE d'une
 * ligne existante → accepté. D'où « Une partie du programme n'a pas pu être
 * enregistrée » dès qu'une séance neuve partait.
 *
 * ⚠️ UN SIXIÈME CAS, DE MÊME NATURE : `training_prescriptions` ne testait que
 * `block_id`, NULL pour une prescription rattachée à un EXERCICE — les séries
 * d'exercice étaient bloquées elles aussi.
 */
export const MIGRATION_P13B_INSERT =
  "20261013110000_p13b_corriger_policies_insert.sql";

export const MIGRATIONS_COURSES: readonly string[] = [
  MIGRATION_C2,
  MIGRATION_C3,
  MIGRATION_C4_1,
  MIGRATION_C4_2,
  MIGRATION_C4_3C,
];

/**
 * TOUT CE QUI SUIT C0.1, DANS L'ORDRE D'APPLICATION — chantier COURSES compris.
 *
 * ⚠️ C'EST CETTE LISTE QUE LES POINTS 2 ET 5 COMPARENT, et plus
 * `MIGRATIONS_COURSES` seule. Une migration ajoutée sans être inscrite ici
 * rougit toujours : la garantie est intacte, elle a seulement cessé de
 * supposer que le dernier chantier du dépôt serait éternellement COURSES.
 */
export const MIGRATIONS_APRES_C0_1: readonly string[] = [
  ...MIGRATIONS_COURSES,
  MIGRATION_N1_7,
  MIGRATION_N1_7_1,
  MIGRATION_C5_1,
  MIGRATION_DEBUT_PROGRAMME,
  MIGRATION_SUPPRESSION_NOLIO,
  MIGRATION_PROGRESSION_AUTOMATIQUE,
  // Inscrites le 11/10/2026 — voir le bloc de justification ci-dessus.
  MIGRATION_PROGRAM_REVIEW_FLAGS,
  MIGRATION_RAPPELS_AUTOMATIQUES,
  MIGRATION_REVIEW_FLAGS_GRANTS,
  MIGRATION_NOTIFICATIONS_GRANTS,
  MIGRATION_PROFIL_PHYSIOLOGIQUE,
  MIGRATION_CARDIO_ET_CALENDRIER,
  MIGRATION_DOCUMENTS_SECURISES,
  MIGRATION_P13A_ISOLATION,
  MIGRATION_P13A_PERF,
  MIGRATION_P13A_GARDE_ADMIN,
  MIGRATION_P13A_LECTURE_ELEVE,
  MIGRATION_P13B_MODELE,
  MIGRATION_P13B_POLICIES,
  MIGRATION_P13B_FONCTIONS,
  MIGRATION_P13B_NUTRITION,
  MIGRATION_P13B_PROVISION,
  MIGRATION_P13B_RESERVATION,
  MIGRATION_P13B_ADMIN_REEL,
  MIGRATION_P13B_INSERT,
];

/**
 * Le compte attendu — nécessaire, jamais suffisant.
 *
 * 110 = 84 avant C0.1 (figées par `EMPREINTE_HISTORIQUE`) + C0.1 + les 25
 * migrations nommées dans `MIGRATIONS_APRES_C0_1`. Le point 6 recalcule
 * l'historique à partir de ce nombre : il ne peut pas être remonté seul sans
 * qu'une migration soit nommée en face.
 */
export const NOMBRE_DE_MIGRATIONS = 110;

/**
 * L'empreinte des 79 migrations ANTÉRIEURES à C0.1, dans l'ordre.
 *
 * ⚠️ C'EST ELLE QUI ATTRAPE L'ANTIDATAGE. Une migration étrangère horodatée
 * `20260101…` se rangerait avant C0.1 sans changer ni le nom de la dernière ni
 * l'ordre du couple final ; seule une empreinte de l'historique complet la voit.
 * Elle attrape aussi le renommage silencieux d'une migration passée.
 */
export const EMPREINTE_HISTORIQUE = "9e3a7691dceff667";

export function listerMigrations(): readonly string[] {
  return readdirSync(new URL("../../supabase/migrations/", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** `20260915090000` → 20260915090000. `null` si le nom n'est pas horodaté. */
export function estampille(nom: string): number | null {
  const m = /^(\d{14})_/.exec(nom);
  return m ? Number(m[1]) : null;
}

export function empreinte(noms: readonly string[]): string {
  return createHash("sha256").update(noms.join("\n")).digest("hex").slice(0, 16);
}

/**
 * Le contrat, en sept points. Chacun peut rougir seul, et chacun nomme ce qui
 * l'a fait rougir.
 *
 * `assert` est passé par la suite appelante : ce module ne dépend d'aucune.
 */
export function verifierContratDesMigrations(assert: typeof import("node:assert/strict")): void {
  const migrations = listerMigrations();

  // 1. LE COMPTE — nécessaire, et volontairement insuffisant à lui seul.
  assert.equal(
    migrations.length,
    NOMBRE_DE_MIGRATIONS,
    `${migrations.length} migrations au lieu de ${NOMBRE_DE_MIGRATIONS} : une migration a été ajoutée ou retirée`,
  );

  // 2. L'ORDRE ET L'IDENTITÉ DES DERNIÈRES. C0.1, puis C2, puis C3 — et rien
  //    après. Antidater l'une d'elles casse l'ordre, et rougit ici.
  assert.deepEqual(
    migrations.slice(-(1 + MIGRATIONS_APRES_C0_1.length)),
    [MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1],
    "les dernières migrations doivent être C0.1 puis celles déclarées, dans l'ordre",
  );

  // 3. L'HORODATAGE, pas seulement l'ordre alphabétique. Un nom qui trie bien
  //    mais dont l'estampille est antérieure serait accepté par le point 2 sur
  //    un dépôt renommé ; il ne l'est pas ici.
  const tC01 = estampille(MIGRATION_C0_1);
  assert.ok(tC01 !== null, "la migration C0.1 doit être horodatée");
  let precedente = tC01;
  for (const nom of MIGRATIONS_APRES_C0_1) {
    const t = estampille(nom);
    assert.ok(t !== null, `${nom} doit être horodatée`);
    assert.ok(t > precedente, `${nom} (${t}) doit être POSTÉRIEURE à ${precedente}`);
    precedente = t;
  }

  // 4. EXACTEMENT UNE MIGRATION DE LISTE DE COURSES, et c'est celle de C2.
  //    Une seconde migration C2 — un correctif « vite fait » qui redéfinirait
  //    la RPC — rougit ici, là où un simple compte l'aurait absorbée.
  const deCourses = migrations.filter((f) =>
    /shopping|grocer|liste_de_courses|courses|panier|checklist|budget|prix|pont_retail|_c0_|_c1_|_c2_|_c3_|_c4_/i.test(f),
  );
  // ⚠️ C0.1 EST DANS LA COMPARAISON — élargi en C4.1 avec le motif `_c0_|_c1_`.
  // Le verrou du repas consommé appartient au chantier COURSES ; il est
  // simplement nommé à part parce qu'il précède la première liste. L'inclure
  // ici ferme le dernier trou du balayage : une migration nommée `_c1_` ou
  // `_c0_` — un lot qui aurait « juste ajouté une petite table » — n'a plus
  // aucun moyen de passer inaperçue.
  assert.deepEqual(
    deCourses,
    [MIGRATION_C0_1, ...MIGRATIONS_COURSES],
    `migrations COURSES inattendues : ${deCourses.join(", ") || "aucune"}`,
  );

  // 5. RIEN APRÈS LA DERNIÈRE MIGRATION COURSES. Une migration étrangère postérieure serait invisible au
  //    point 2 seulement si elle triait avant — le point 2 la voit ; ici on
  //    nomme précisément les intruses, pour que l'échec soit lisible.
  const apresC01 = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t >= tC01;
  });
  const autorisees = new Set([MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1]);
  assert.deepEqual(
    apresC01,
    [MIGRATION_C0_1, ...MIGRATIONS_APRES_C0_1],
    `migrations inattendues depuis C0.1 : ${apresC01.filter((f) => !autorisees.has(f)).join(", ")}`,
  );

  // 6. L'HISTORIQUE ANTÉRIEUR EST FIGÉ. C1 et C0 n'ont pas gagné de migration
  //    rétroactive, et aucune migration passée n'a été renommée.
  const historique = migrations.filter((f) => {
    const t = estampille(f);
    return t !== null && t < tC01;
  });
  assert.equal(
    historique.length,
    NOMBRE_DE_MIGRATIONS - 1 - MIGRATIONS_APRES_C0_1.length,
    "l'historique antérieur a changé de taille",
  );
  assert.equal(
    empreinte(historique),
    EMPREINTE_HISTORIQUE,
    "une migration a été ajoutée, retirée ou renommée AVANT C0.1 (antidatage)",
  );

  // 7. AUCUN NOM NON HORODATÉ. Une migration sans estampille échapperait aux
  //    points 3, 5 et 6 d'un seul coup.
  const sansEstampille = migrations.filter((f) => estampille(f) === null);
  assert.deepEqual(sansEstampille, [], `migrations sans horodatage : ${sansEstampille.join(", ")}`);
}

/**
 * LE MANIFESTE — la propriété RÉELLE que dix compteurs figés essayaient
 * d'exprimer.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI CE SECOND CONTRÔLE
 * ────────────────────────────────────────────────────────────────────────────
 * Six suites du dépôt portaient un `assert.equal(migrations.length, N)`. Leur
 * intention, écrite noir sur blanc dans `aliments-a1`, était bonne :
 *
 *     « ajouter un fichier au dossier est un acte délibéré, et ce rouge en est
 *       l'accusé de réception »
 *
 * Mais le MOYEN était faux, et il s'est cassé exactement comme prévu : un
 * compte ne dit pas CE QUI a été ajouté, il doit être recopié dans dix
 * fichiers, et le jour où l'un n'est pas mis à jour on remonte le nombre sans
 * regarder. Mesuré le 17/08/2026 : les compteurs disaient 76 et 80 pendant que
 * le dossier en portait 82 — et surtout, **C2 et C3 n'avaient jamais été
 * déclarées au manifeste**, ce que personne n'avait vu.
 *
 * L'accusé de réception existe pourtant déjà, et il est meilleur : le
 * MANIFESTE (`supabase/baseline/manifest.json`) énumère NOMMÉMENT les
 * migrations à rejouer par-dessus le baseline. Ajouter une migration sans l'y
 * déclarer casse le bootstrap d'une base neuve — c'est une conséquence réelle,
 * pas une convention de test.
 *
 * Ce contrôle vérifie donc l'égalité EXACTE des deux ensembles, dans les deux
 * sens. Aucun nombre n'y est écrit en dur.
 */
export const BORNE_POST_BASELINE = "20260724214500";

export function migrationsPostBaseline(): readonly string[] {
  return listerMigrations()
    .filter((f) => f >= BORNE_POST_BASELINE)
    .sort();
}

export function verifierManifesteDesMigrations(assert: typeof import("node:assert/strict")): void {
  const manifeste = JSON.parse(
    readFileSync(new URL("../../supabase/baseline/manifest.json", import.meta.url), "utf8"),
  ) as { migrations_post_baseline_attendues?: unknown };

  const declarees = manifeste.migrations_post_baseline_attendues;
  assert.ok(Array.isArray(declarees), "le manifeste doit énumérer les migrations post-baseline");

  const surDisque = migrationsPostBaseline();
  const declareesTriees = [...(declarees as string[])].sort();

  // Les deux sens, nommés séparément : « oubliée au manifeste » et « déclarée
  // mais absente » sont deux fautes différentes, et le message doit le dire.
  const oubliees = surDisque.filter((f) => !declareesTriees.includes(f));
  assert.deepEqual(
    oubliees,
    [],
    `migration(s) présentes sur le disque mais NON déclarées au manifeste : ${oubliees.join(", ")}`,
  );

  const fantomes = declareesTriees.filter((f) => !surDisque.includes(f));
  assert.deepEqual(
    fantomes,
    [],
    `migration(s) déclarées au manifeste mais absentes du disque : ${fantomes.join(", ")}`,
  );

  assert.deepEqual(declareesTriees, surDisque, "le manifeste et le dossier doivent coïncider");
}

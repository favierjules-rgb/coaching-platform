"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { droitEcritureProgrammes, type DroitEcritureProgrammes } from "@/lib/droit-affectation";
import type { CategorieDroit, CoachRole } from "@/types";

/**
 * Identité STAFF de l'utilisateur connecté — son rôle P13-B
 * (`coaches.role`) et l'identifiant de sa fiche `coaches` — obtenus par les
 * deux fonctions SECURITY DEFINER du modèle, `public.staff_role()` et
 * `public.current_staff_id()`.
 *
 * ---------------------------------------------------------------------
 * Pourquoi par RPC, et pas par un `select` sur `coaches`
 * ---------------------------------------------------------------------
 * Depuis P13-B, la lecture de `coaches` est réservée à l'administrateur
 * (policy `coaches_manage_admin_select` / `coaches_select_staff`,
 * `is_admin()`). Un collaborateur ne peut donc pas lire SA PROPRE ligne —
 * et c'est volontaire : le contrôle B6 de
 * supabase/tests/p13b_roles_collaborateurs_checklist.sql vérifie qu'il
 * compte zéro ligne dans `coaches`. Ajouter une policy « je lis ma ligne »
 * ferait tomber ce contrôle validé.
 *
 * Les deux fonctions ci-dessous existent précisément pour cela : elles sont
 * SECURITY DEFINER, ne renvoient QUE l'identité de l'appelant (jamais une
 * ligne d'un autre), et `execute` leur est accordé à `authenticated` seul
 * (`revoke … from anon` dans la migration 20261011090000). Aucune donnée
 * globale n'est exposée.
 *
 * ---------------------------------------------------------------------
 * Dégradation volontaire
 * ---------------------------------------------------------------------
 * Tant que les migrations P13-B ne sont pas appliquées, ces fonctions
 * n'existent pas : l'appel échoue et le hook renvoie `{ role: null,
 * staffId: null }`. Les appelants doivent donc traiter `null` comme
 * « inconnu », et retomber sur leur comportement d'avant P13-B — jamais
 * comme un refus ni comme une autorisation. La sécurité réelle reste portée
 * par la RLS et par lib/api/authz.ts, que ce hook ne remplace pas.
 */
export interface StaffContext {
  chargement: boolean;
  /**
   * `profiles.role === "admin"`. Lu dans `profiles`, que chacun peut lire pour
   * SA PROPRE ligne (policy `profiles_select_self_or_staff`) : ce signal reste
   * donc disponible même si les fonctions P13-B n'existent pas encore, et même
   * si la fiche `coaches` de l'administrateur manque. C'est ce qui garantit que
   * l'administrateur ne peut jamais perdre sa propre navigation.
   */
  estAdmin: boolean;
  /** `coaches.role` de l'appelant, `null` si inconnu (fonction absente, pas de fiche active). */
  role: CoachRole | null;
  /** `coaches.id` de l'appelant, `null` si inconnu. */
  staffId: string | null;
  /**
   * Catégories en LECTURE de l'appelant, par `public.categories_lecture()`.
   * Cette fonction ne filtre pas sur le niveau : une catégorie accordée en
   * `ecriture` y figure aussi, donc « écriture implique visibilité » est tenu
   * par la fonction elle-même, sans règle supplémentaire côté interface.
   * Pour un admin ou un assistant, elle renvoie les quatre.
   */
  categoriesLecture: readonly CategorieDroit[];
  /**
   * Catégories en ÉCRITURE de l'appelant, par `public.categories_ecriture()`.
   *
   * ⚠️ DISTINCTE DE `categoriesLecture`, ET C'EST TOUT L'INTÉRÊT. La fonction
   * de lecture ne filtre pas le niveau : `entrainement` y figure qu'il soit
   * accordé en `lecture` ou en `ecriture`, donc elle ne peut pas dire si une
   * ÉCRITURE est permise. Pour un admin ou un assistant, celle-ci rend les
   * quatre catégories ; pour un collaborateur, uniquement celles dont
   * `niveau = 'ecriture'` (migration 20261011090000).
   */
  categoriesEcriture: readonly CategorieDroit[];
  /**
   * `true` quand les fonctions du modèle P13-B sont INTROUVABLES (migrations
   * pas encore appliquées) — à distinguer d'un rôle absent. Voir
   * `sectionAdminVisible` dans lib/admin-shell-nav.ts : dans ce cas la
   * navigation d'avant P13-B est conservée, la RLS continuant de refuser.
   */
  mecanismeIndisponible: boolean;
}

const ETAT_INCONNU: StaffContext = {
  chargement: false,
  estAdmin: false,
  role: null,
  staffId: null,
  categoriesLecture: [],
  categoriesEcriture: [],
  mecanismeIndisponible: false,
};

/**
 * RIEN N'A PU ÊTRE ÉTABLI — à ne pas confondre avec « cet appelant n'est
 * personne ».
 *
 * ⚠️ C'EST LA CAUSE DE LA RÉGRESSION QUI A COÛTÉ SON ESPACE À
 * L'ADMINISTRATEUR. Jusqu'ici, toute lecture qui n'aboutissait pas rendait
 * `ETAT_INCONNU`, c'est-à-dire une réponse PROPRE : « pas admin, aucun rôle,
 * aucune catégorie, et le mécanisme fonctionne ». `sectionAdminVisible` en
 * concluait, très logiquement, qu'il fallait tout masquer sauf l'accueil. Un
 * administrateur parfaitement provisionné perdait Paramètres, Paiements,
 * Abonnements, Emails, Notifications et Newsletter — et, le résultat étant
 * mis en cache pour toute la session, les retrouvait seulement après un
 * rechargement complet.
 *
 * Les chemins concernés n'ont rien d'exotique : client navigateur absent,
 * session pas encore réhydratée au premier rendu (les RPC partent alors en
 * `anon`, à qui P13-B a RETIRÉ l'EXECUTE — donc `42501`, que l'ancien
 * classement ne reconnaissait pas comme une absence de mécanisme), coupure
 * réseau, 5xx.
 *
 * `mecanismeIndisponible: true` est exactement le signal prévu pour cela :
 * « l'interface ne peut pas savoir, conserve le comportement d'avant
 * P13-B ». La sécurité ne s'en trouve pas changée d'un pouce — la RLS et
 * lib/api/authz.ts refusent indépendamment de ce qui est affiché.
 */
const INDETERMINE: StaffContext = { ...ETAT_INCONNU, mecanismeIndisponible: true };

function normaliserRole(valeur: unknown): CoachRole | null {
  return valeur === "admin" || valeur === "assistant" || valeur === "collaborateur" ? valeur : null;
}

const CATEGORIES_CONNUES: readonly string[] = ["entrainement", "suivi_eleve", "agenda_communication", "nutrition"];

/** Normalise le `setof text` de `categories_lecture()` ; toute valeur inconnue est écartée. */
function normaliserCategories(data: unknown): CategorieDroit[] {
  const lignes = Array.isArray(data) ? data : data == null ? [] : [data];
  const valeurs = lignes.map((ligne) =>
    typeof ligne === "string" ? ligne : (ligne as { categories_lecture?: unknown } | null)?.categories_lecture,
  );
  return valeurs.filter((v): v is CategorieDroit => typeof v === "string" && CATEGORIES_CONNUES.includes(v));
}

/**
 * Fonction absente en base ? PostgreSQL répond `42883` (undefined_function)
 * et PostgREST `PGRST202` (fonction introuvable dans le schéma exposé). Toute
 * AUTRE erreur n'est pas une absence de mécanisme : elle laisse l'état en
 * « inconnu », donc en refus.
 */
function estFonctionAbsente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42883" || error.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

/**
 * UNE SEULE LECTURE PAR CHARGEMENT DE PAGE, PARTAGÉE.
 *
 * ⚠️ POURQUOI CE CACHE EST NÉCESSAIRE, ET PAS UN LUXE. `AssignStudentsModal`
 * est rendu PAR LIGNE dans /admin/programmes et /admin/nutrition : sans
 * mutualisation, brancher ce hook sur la modale déclencherait quatre RPC et
 * un select PAR PROGRAMME affiché — une vingtaine de lignes suffisait à
 * produire une centaine de requêtes au chargement. La promesse est donc
 * partagée : le premier appelant déclenche la lecture, les suivants
 * s'abonnent au même résultat.
 *
 * ⚠️ VOLONTAIREMENT SANS INVALIDATION AUTOMATIQUE. Les droits d'un
 * utilisateur ne changent pas pendant qu'il navigue — /admin/parametres
 * modifie ceux des AUTRES, et un rechargement de page suffit à relire les
 * siens. Un cache qui se rafraîchirait tout seul ferait apparaître ou
 * disparaître des boutons sous les doigts, sans que la sécurité y gagne quoi
 * que ce soit : la RLS reste l'autorité.
 */
let lectureEnCours: Promise<StaffContext> | null = null;

/** Réinitialise le cache — réservé aux tests. */
export function reinitialiserContexteStaff(): void {
  lectureEnCours = null;
}

export function useStaffContext(): StaffContext {
  const [etat, setEtat] = useState<StaffContext>({ ...ETAT_INCONNU, chargement: true });

  useEffect(() => {
    let annule = false;

    async function lire(): Promise<StaffContext> {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        return INDETERMINE;
      }
      const { data: session } = await supabase.auth.getUser();
      const userId = session?.user?.id ?? null;
      // ⚠️ PAS DE SESSION = PAS DE RÉPONSE, PAS « PAS ADMIN ». Sans
      // `userId`, la lecture de `profiles` est sautée et les quatre RPC
      // partent en `anon`, à qui P13-B a retiré l'EXECUTE : elles rendent
      // `42501`. Conclure « cet appelant n'est personne » de cette situation
      // revenait à démonter l'espace d'administration sur une course au
      // premier rendu.
      if (!userId) {
        return INDETERMINE;
      }


      const [profil, roleRpc, idRpc, categoriesRpc, ecritureRpc] = await Promise.all([
        supabase.from("profiles").select("role").eq("user_id", userId).maybeSingle(),
        supabase.rpc("staff_role"),
        supabase.rpc("current_staff_id"),
        supabase.rpc("categories_lecture"),
        // Ajoutée pour l'amélioration d'interface P13-B : distinguer
        // `entrainement / lecture` de `entrainement / ecriture` avant de
        // proposer une assignation vouée au refus. Son absence compte comme
        // « mécanisme indisponible » ci-dessous, donc l'interface retombe sur
        // son comportement d'avant plutôt que de griser à tort.
        supabase.rpc("categories_ecriture"),
      ]);

      // `Functions: Record<string, never>` dans types/supabase.ts (types tenus
      // à la main) : `data` arrive en `never`, d'où la normalisation explicite
      // — même traitement que lib/supabase/appointments.ts pour
      // `get_my_coach_public_profile`.
      const brutRole: unknown = Array.isArray(roleRpc.data) ? roleRpc.data[0] : roleRpc.data;
      const brutId: unknown = Array.isArray(idRpc.data) ? idRpc.data[0] : idRpc.data;
      const profilRole = (profil.data as { role?: unknown } | null)?.role;

      /*
       * ⚠️ TOUTE ERREUR COMPTE, PAS SEULEMENT LA FONCTION ABSENTE.
       *
       * `estFonctionAbsente` ne reconnaissait que `42883`/`PGRST202`. Or pour
       * un membre du staff RÉGULIÈREMENT authentifié, AUCUNE de ces cinq
       * lectures n'est censée échouer : `profiles` se lit soi-même (policy
       * `profiles_select_self_or_staff`) et les quatre fonctions sont
       * accordées à `authenticated`. Une erreur, quelle qu'elle soit —
       * `42501` parce que la requête est partie en `anon`, réseau coupé,
       * 5xx, fonction absente — signifie donc UNE SEULE chose : l'interface
       * ne sait pas. Elle doit alors conserver le comportement d'avant
       * P13-B, jamais inventer un appelant sans droits.
       *
       * Ce que cela NE change PAS : pour un collaborateur dont les lectures
       * aboutissent, le verdict reste identique au contrôle près — c'est le
       * chemin normal, et la suite `rubriques-globales-collaborateur` le
       * mesure. Et de toute façon, afficher une rubrique n'en ouvre pas les
       * données : la RLS rend zéro ligne et les routes refusent en 403.
       */
      const lectureIncertaine =
        profil.error != null ||
        roleRpc.error != null ||
        idRpc.error != null ||
        categoriesRpc.error != null ||
        ecritureRpc.error != null;

      if (lectureIncertaine) {
        // La fonction absente reste nommée à part : c'est le cas « migrations
        // pas encore appliquées », attendu et sans gravité, qu'on ne veut pas
        // journaliser comme une anomalie.
        const migrationsAbsentes =
          estFonctionAbsente(roleRpc.error) ||
          estFonctionAbsente(categoriesRpc.error) ||
          estFonctionAbsente(ecritureRpc.error);
        if (!migrationsAbsentes) {
          console.warn("[StaffContext] droits indéterminables : navigation d'avant P13-B conservée.");
        }
        return INDETERMINE;
      }

      return {
        chargement: false,
        estAdmin: profilRole === "admin",
        role: normaliserRole(brutRole),
        staffId: typeof brutId === "string" && brutId.length > 0 ? brutId : null,
        categoriesLecture: normaliserCategories(categoriesRpc.data),
        categoriesEcriture: normaliserCategories(ecritureRpc.data),
        mecanismeIndisponible: false,
      };
    }

    // ⚠️ UNE LECTURE RATÉE N'EST PAS MISE EN CACHE. Sinon une coupure réseau
    // au chargement figerait l'état « inconnu » pour toute la session, et un
    // simple changement d'onglet ne suffirait plus à retrouver ses droits.
    if (lectureEnCours === null) {
      lectureEnCours = lire()
        .then((resultat) => {
          /*
           * ⚠️ UNE NON-RÉPONSE N'EST PAS MISE EN CACHE. Le cache est au
           * niveau du MODULE et n'a volontairement aucune invalidation : un
           * état « indéterminé » qui s'y installait figeait la navigation
           * mutilée pour TOUTE la session, et seul un rechargement complet
           * en sortait. Désormais la prochaine montée du hook réessaie.
           */
          if (resultat.mecanismeIndisponible) {
            lectureEnCours = null;
          }
          return resultat;
        })
        .catch((erreur) => {
          lectureEnCours = null;
          throw erreur;
        });
    }
    lectureEnCours.then(
      (resultat) => {
        if (!annule) setEtat(resultat);
      },
      () => {
        // Rejet (exception, pas simple erreur Supabase) : même règle.
        if (!annule) setEtat(INDETERMINE);
      },
    );

    return () => {
      annule = true;
    };
  }, []);

  return etat;
}

/**
 * Le droit d'écrire sur l'entraînement, prêt à l'emploi dans une modale.
 *
 * La RÈGLE vit dans `lib/droit-affectation.ts` — fonction pure, testable sans
 * React ni base. Ce hook ne fait que lui passer le contexte lu.
 */
export function useDroitEcritureProgrammes(): DroitEcritureProgrammes {
  return droitEcritureProgrammes(useStaffContext());
}

import "server-only";

import {
  NolioCryptoErreur,
  VERSION_DE_CLE_COURANTE,
  chiffrerJeton,
  dechiffrerJeton,
} from "@/lib/nolio/crypto";
import { NolioErreur, deautoriser, rafraichirJetons, type JetonsNolio } from "@/lib/nolio/oauth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * C5.1 — LA CONNEXION NOLIO, CÔTÉ BASE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA FRONTIÈRE QUE CE MODULE TIENT
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE FONCTION EXPORTÉE ICI NE REND UN JETON, sauf `jetonDAcces()` —
 * qui existe pour les lots suivants (import des séances) et n'est appelée par
 * AUCUNE route de C5.1. Les routes n'en ont pas besoin : `etatConnexion()`
 * leur suffit, et elle ne lit que la vue `nolio_connexion_etat`, laquelle ne
 * SÉLECTIONNE aucun jeton.
 *
 * Deux barrières, donc : le privilège absent en base, et la forme des
 * fonctions ici. La seconde protège du jour où quelqu'un ajouterait un
 * `select("*")` par commodité.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE BAIL DE RAFRAÎCHISSEMENT
 * ════════════════════════════════════════════════════════════════════════
 * Nolio ROTE le refresh_token à chaque usage et INVALIDE l'ancien. Deux
 * rafraîchissements concurrents pour le même élève présenteraient le même
 * jeton : le second serait rejeté, et la connexion perdue sans que personne
 * n'ait rien fait de mal.
 *
 * ⚠️ LE VERROU EST UN `UPDATE … WHERE` CONDITIONNEL, ET C'EST CE QUI LE REND
 * ATOMIQUE. PostgreSQL sérialise les écritures sur une même ligne : parmi N
 * processus qui tentent la prise, exactement UN voit sa clause `where`
 * satisfaite et reçoit la ligne en retour. Les autres reçoivent zéro ligne et
 * savent qu'ils ont perdu. Aucune transaction explicite n'est nécessaire — ce
 * qui tombe bien, PostgREST n'en offrant pas.
 *
 * ⚠️ ET LE BAIL PÉRIME. Un processus tué entre la prise et l'écriture ne doit
 * pas condamner la connexion pour toujours : passé `DUREE_BAIL_MS`, un autre
 * peut reprendre la main.
 */

/** Au-delà, un bail est réputé abandonné : large devant un aller-retour Nolio (10 s max). */
const DUREE_BAIL_MS = 60_000;

/** On rafraîchit avant l'échéance réelle, pour ne pas courir après un 401. */
const MARGE_EXPIRATION_MS = 5 * 60_000;

export type StatutConnexion = "active" | "expired" | "revoked" | "error";

/** Ce que l'interface a le droit de savoir. AUCUN jeton. */
export interface EtatConnexionNolio {
  readonly connecte: boolean;
  readonly nolioUserId: number | null;
  readonly status: StatutConnexion | null;
  readonly connectedAt: string | null;
  readonly lastSyncAt: string | null;
}

export const ETAT_NON_CONNECTE: EtatConnexionNolio = Object.freeze({
  connecte: false,
  nolioUserId: null,
  status: null,
  connectedAt: null,
  lastSyncAt: null,
});

export type MotifEnregistrement = "service-indisponible" | "deja-liee-autre-eleve" | "echec-ecriture";

export class NolioConnexionErreur extends Error {
  readonly motif: MotifEnregistrement;
  constructor(motif: MotifEnregistrement) {
    super(`nolio-connexion: ${motif}`);
    this.name = "NolioConnexionErreur";
    this.motif = motif;
  }
}

/* ─────────────────────────── Lecture d'état ─────────────────────────── */

/**
 * L'état de connexion d'un élève.
 *
 * ⚠️ LIT LA VUE, PAS LA TABLE. `nolio_connexion_etat` ne sélectionne aucun
 * jeton : même une erreur de code ici ne peut pas en faire remonter un.
 */
export async function etatConnexion(studentId: string): Promise<EtatConnexionNolio> {
  const admin = createSupabaseAdminClient();
  if (!admin) return ETAT_NON_CONNECTE;

  const { data } = await admin
    .from("nolio_connexion_etat")
    .select("nolio_user_id, status, connected_at, last_sync_at")
    .eq("student_id", studentId)
    .maybeSingle();

  if (!data) return ETAT_NON_CONNECTE;
  const ligne = data as unknown as {
    nolio_user_id: number | string;
    status: string;
    connected_at: string;
    last_sync_at: string | null;
  };
  return {
    connecte: true,
    nolioUserId: Number(ligne.nolio_user_id),
    status: ligne.status as StatutConnexion,
    connectedAt: ligne.connected_at,
    lastSyncAt: ligne.last_sync_at,
  };
}

/* ─────────────────────────── Écriture ─────────────────────────── */

/**
 * Crée ou remplace la connexion d'un élève.
 *
 * ⚠️ LE CONTRÔLE DE COLLISION EST FAIT AVANT L'ÉCRITURE, ET LA CONTRAINTE
 * UNIQUE RESTE LE DERNIER MOT. Le contrôle donne un message lisible ; la
 * contrainte `nolio_user_id UNIQUE` attrape la course entre deux callbacks
 * simultanés, que nulle vérification préalable ne peut fermer.
 */
export async function enregistrerConnexion(
  studentId: string,
  nolioUserId: number,
  jetons: JetonsNolio,
): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new NolioConnexionErreur("service-indisponible");

  const { data: existante } = await admin
    .from("nolio_connections")
    .select("student_id")
    .eq("nolio_user_id", nolioUserId)
    .maybeSingle();

  if (existante && (existante as unknown as { student_id: string }).student_id !== studentId) {
    // ⚠️ ON N'ÉCRASE RIEN. Réattribuer un compte Nolio à un autre élève lui
    // donnerait accès aux séances du premier au prochain import.
    throw new NolioConnexionErreur("deja-liee-autre-eleve");
  }

  const { error } = await admin.from("nolio_connections").upsert(
    {
      student_id: studentId,
      nolio_user_id: nolioUserId,
      access_token: chiffrerJeton(jetons.accessToken),
      refresh_token: chiffrerJeton(jetons.refreshToken),
      key_version: VERSION_DE_CLE_COURANTE,
      expires_at: jetons.expiresAt.toISOString(),
      scope: jetons.scope,
      status: "active",
      // ⚠️ REMIS À NULL À CHAQUE RECONNEXION. Une erreur d'hier ne doit pas
      // rester affichée sur une connexion qui vient de réussir.
      last_error: null,
      refresh_lock_at: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "student_id" },
  );
  if (error) throw new NolioConnexionErreur("echec-ecriture");
}

/** Supprime la connexion locale et tente la révocation chez Nolio. */
export async function supprimerConnexion(studentId: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new NolioConnexionErreur("service-indisponible");

  const { data } = await admin
    .from("nolio_connections")
    .select("access_token")
    .eq("student_id", studentId)
    .maybeSingle();

  // ⚠️ ABSENTE = SUCCÈS. Une déconnexion doit être idempotente : un second
  // clic, ou un rechargement, ne doit pas rendre d'erreur à l'élève.
  if (!data) return false;

  // ⚠️ LA RÉVOCATION D'ABORD, LA SUPPRESSION ENSUITE — mais l'échec de la
  // première n'empêche PAS la seconde. Garder la ligne parce que Nolio est
  // injoignable laisserait l'élève incapable de se déconnecter.
  try {
    await deautoriser(dechiffrerJeton((data as unknown as { access_token: string }).access_token));
  } catch {
    // Chiffré illisible ou amont muet : on supprime quand même. Rien à
    // journaliser qui ne risquerait de porter un fragment de jeton.
  }

  await admin.from("nolio_connections").delete().eq("student_id", studentId);
  return true;
}

/* ─────────────────────────── Rafraîchissement ─────────────────────────── */

/**
 * Rend un access_token valide, en rafraîchissant si nécessaire.
 *
 * ⚠️ AUCUNE ROUTE DE C5.1 N'APPELLE CETTE FONCTION. Elle est écrite et testée
 * maintenant parce que la rotation est la partie la plus fragile du protocole,
 * et qu'on ne veut pas la découvrir en même temps que l'import des séances.
 */
export async function jetonDAcces(studentId: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data } = await admin
    .from("nolio_connections")
    .select("access_token, refresh_token, expires_at, status")
    .eq("student_id", studentId)
    .maybeSingle();
  if (!data) return null;

  const ligne = data as unknown as {
    access_token: string;
    refresh_token: string;
    expires_at: string;
    status: StatutConnexion;
  };
  if (ligne.status !== "active") return null;

  const echeance = new Date(ligne.expires_at).getTime();
  if (Number.isFinite(echeance) && echeance - Date.now() > MARGE_EXPIRATION_MS) {
    try {
      return dechiffrerJeton(ligne.access_token);
    } catch {
      return null;
    }
  }

  return rafraichirSousBail(studentId, ligne.refresh_token);
}

async function rafraichirSousBail(studentId: string, refreshChiffre: string): Promise<string | null> {
  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const maintenant = new Date();
  const seuil = new Date(maintenant.getTime() - DUREE_BAIL_MS).toISOString();
  const bail = maintenant.toISOString();

  // ⚠️ LA PRISE DE BAIL. `or(...)` : libre, ou périmé. Un seul processus voit
  // sa clause satisfaite — PostgreSQL sérialise les écritures d'une ligne.
  const { data: pris } = await admin
    .from("nolio_connections")
    .update({ refresh_lock_at: bail } as never)
    .eq("student_id", studentId)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${seuil}`)
    .select("student_id");

  // ⚠️ PERDU LA COURSE : on ne rafraîchit PAS. Utiliser le refresh_token
  // pendant qu'un autre le rote, c'est le présenter après son invalidation —
  // et perdre la connexion. Mieux vaut ne rien rendre : l'appelant réessaiera.
  if (!pris || pris.length === 0) return null;

  let clair: string;
  try {
    clair = dechiffrerJeton(refreshChiffre);
  } catch {
    await marquerEchec(studentId, "chiffre-illisible", "error");
    return null;
  }

  let jetons: JetonsNolio;
  try {
    jetons = await rafraichirJetons(clair);
  } catch (erreur) {
    const motif = erreur instanceof NolioErreur ? erreur.motif : "inconnu";
    // ⚠️ « jeton-invalide » EST DÉFINITIF, LE RESTE NE L'EST PAS. Un amont
    // injoignable se réessaie ; un refresh_token rejeté ne se réessaiera
    // jamais avec succès — et une boucle de tentatives brûlerait le quota.
    await marquerEchec(studentId, motif, motif === "jeton-invalide" ? "revoked" : "error");
    return null;
  }

  // ⚠️ L'ÉCRITURE EST CONDITIONNÉE AU BAIL QU'ON DÉTIENT ENCORE
  // (`.eq("refresh_lock_at", bail)`). Si un autre processus l'a repris entre
  // temps — bail périmé parce que Nolio a été lent —, on n'écrase pas SON
  // couple de jetons, qui est le seul valide.
  const { data: ecrit } = await admin
    .from("nolio_connections")
    .update({
      access_token: chiffrerJeton(jetons.accessToken),
      refresh_token: chiffrerJeton(jetons.refreshToken),
      key_version: VERSION_DE_CLE_COURANTE,
      expires_at: jetons.expiresAt.toISOString(),
      scope: jetons.scope,
      status: "active",
      last_error: null,
      refresh_lock_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("student_id", studentId)
    .eq("refresh_lock_at", bail)
    .select("student_id");

  if (!ecrit || ecrit.length === 0) return null;
  return jetons.accessToken;
}

/**
 * Consigne un échec.
 *
 * ⚠️ `last_error` NE REÇOIT QU'UN MOTIF COURT ET FIXE — jamais un corps de
 * réponse, jamais un jeton, jamais un message d'exception. Cette colonne est
 * lisible par un administrateur : elle doit rester sans valeur pour un
 * attaquant qui y accéderait.
 */
async function marquerEchec(studentId: string, motif: string, statut: StatutConnexion): Promise<void> {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin
    .from("nolio_connections")
    .update({
      status: statut,
      last_error: motif.slice(0, 64),
      refresh_lock_at: null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("student_id", studentId);
}

export { NolioCryptoErreur };

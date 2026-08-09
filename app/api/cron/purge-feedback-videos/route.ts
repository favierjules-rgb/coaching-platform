import { NextResponse } from "next/server";

import { statutHttpPurge } from "@/lib/feedback-video-retention";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purgeFeedbackVideos } from "@/lib/supabase/purge-feedback-videos";

/**
 * GET /api/cron/purge-feedback-videos — rétention des vidéos de technique
 * (F4.1). Efface les vidéos d'élève dont l'objet Storage a plus de 30 jours,
 * puis les objets orphelins de plus de 24 h.
 *
 * Sécurité — REPRISE EXACTE de la convention de
 * `app/api/cron/appointment-reminders` :
 *   • Vercel Cron envoie automatiquement `Authorization: Bearer $CRON_SECRET`
 *     quand `CRON_SECRET` est configuré (voir .env.example et vercel.json) ;
 *   • toute autre requête est rejetée ;
 *   • `CRON_SECRET` absent ⇒ la route REFUSE tout appel. Une route de purge
 *     qui resterait ouverte « parce que le secret n'est pas encore posé »
 *     serait un bouton « effacer les vidéos » sur Internet.
 *
 * La clé service role ne quitte jamais le serveur : `createSupabaseAdminClient`
 * importe `server-only`, ce qui fait échouer le build si ce chemin devenait
 * accessible depuis un composant client.
 *
 * Idempotence : un second appel immédiat ne trouve plus rien à supprimer.
 * Un échec sur un objet n'arrête pas les autres et sera retenté au passage
 * suivant — voir lib/supabase/purge-feedback-videos.ts.
 *
 * La réponse porte le bilan complet (compteurs, chemins supprimés avec leur
 * raison, échecs). Vercel journalise le corps de la réponse d'un cron : c'est
 * là qu'on relit ce qu'une exécution a fait.
 *
 * STATUT HTTP — un cron vert doit vouloir dire quelque chose
 *   • 200 : aucun échec opérationnel.
 *   • 500 : au moins un échec Storage ou base. Le bilan complet est rendu
 *     QUAND MÊME — un cron rouge sans détail n'aide personne — mais Vercel
 *     le marque en échec, et c'est le seul moyen de le voir sans aller lire
 *     les journaux ligne à ligne.
 *   Les chemins non traités (forme invalide, fichier à la racine,
 *   sous-dossier) NE font PAS échouer le cron : ce sont des avertissements
 *   d'hygiène, pas des pannes. Ils apparaissent dans `cheminsMalformes` et
 *   en `console.warn`, et rien n'a été supprimé les concernant.
 *
 * RÉTENTION DE 30 JOURS — ce que ça veut dire exactement
 *   Une vidéo devient éligible à J+30. En fonctionnement nominal, le cron
 *   quotidien (03:00 UTC) la traite au passage suivant, généralement entre
 *   J+30 et J+31.
 *
 *   « Généralement », et non « au plus tard » : un échec Storage, un nouvel
 *   essai, le plafond de suppressions par exécution ou un arriéré peuvent
 *   repousser le traitement de plusieurs passages. Il n'existe pas de borne
 *   haute garantie, et on n'en promet donc aucune.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const bilan = await purgeFeedbackVideos(supabase);
  const statut = statutHttpPurge(bilan);
  return NextResponse.json({ ok: statut === 200, ...bilan }, { status: statut });
}

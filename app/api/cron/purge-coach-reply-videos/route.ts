import { NextResponse } from "next/server";

import { statutHttpPurge } from "@/lib/feedback-video-retention";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purgeCoachReplyVideos } from "@/lib/supabase/purge-coach-reply-videos";

/**
 * GET /api/cron/purge-coach-reply-videos — rétention des réponses vidéo du
 * coach (F5). Efface les réponses dont l'objet Storage a plus de 3 jours,
 * puis les objets orphelins de plus de 24 h.
 *
 * ── POURQUOI UNE SECONDE ROUTE, ET PAS UN SECOND BUCKET DANS LA PREMIÈRE ────
 * Le balayeur est le même (`purgerBucketVideo`) ; la ROUTE, non. Trois
 * raisons, dans l'ordre d'importance :
 *
 *   1. LE SIGNAL RESTE LISIBLE. Un cron rouge doit dire QUOI a échoué. Deux
 *      buckets dans une seule exécution, c'est un statut unique pour deux
 *      rétentions indépendantes : la purge des élèves passerait pour cassée
 *      parce qu'un fichier de coach a résisté.
 *   2. ON NE TOUCHE PAS À CE QUI TOURNE. `purge-feedback-videos` est en
 *      Production et validé. Lui ajouter un second bucket changerait sa
 *      réponse, son statut et son journal — pour un gain nul.
 *   3. LES DEUX SONT INDÉPENDANTES. Un échec de l'une ne doit pas empêcher
 *      l'autre de s'exécuter.
 *
 * Sécurité — REPRISE EXACTE de la convention des deux crons existants :
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
 *
 * STATUT HTTP — un cron vert doit vouloir dire quelque chose
 *   • 200 : aucun échec opérationnel.
 *   • 500 : au moins un échec Storage ou base. Le bilan complet est rendu
 *     QUAND MÊME — un cron rouge sans détail n'aide personne.
 *   Les chemins non traités (forme invalide, fichier à la racine,
 *   sous-dossier) NE font PAS échouer le cron : ce sont des avertissements
 *   d'hygiène, pas des pannes.
 *
 * RÉTENTION DE 3 JOURS — ce que ça veut dire exactement
 *   Une vidéo devient éligible à J+3. En fonctionnement nominal, le cron
 *   quotidien la traite au passage suivant, généralement entre J+3 et J+4.
 *
 *   « Généralement », et non « au plus tard » : un échec Storage, un nouvel
 *   essai, le plafond de suppressions par exécution ou un arriéré peuvent
 *   repousser le traitement de plusieurs passages. Il n'existe pas de borne
 *   haute garantie, et on n'en promet donc aucune — ce qui va dans le bon
 *   sens ici : une réponse peut rester quelques heures de plus, jamais
 *   disparaître avant le délai annoncé à l'élève.
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

  const bilan = await purgeCoachReplyVideos(supabase);
  const statut = statutHttpPurge(bilan);
  return NextResponse.json({ ok: statut === 200, ...bilan }, { status: statut });
}

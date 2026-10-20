import { NextResponse } from "next/server";

import { etatAbonnement } from "@/lib/push/depot-abonnements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/status — cet appareil est-il ENCORE enregistré, et actif ?
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CETTE ROUTE EXISTE, ET POURQUOI ELLE EST EN POST
 * ════════════════════════════════════════════════════════════════════════
 * Le profil déduisait « notifications actives » de la seule présence d'un
 * `PushSubscription` dans le navigateur. C'est un fait LOCAL, et il diverge
 * du serveur dès qu'un envoi a reçu 404/410, qu'un abonnement a été renouvelé
 * par le service push, ou que la clé VAPID a changé au déploiement. Le profil
 * affichait alors « activé » pendant que plus rien n'arrivait, sans aucun
 * moyen pour l'élève de le voir ni de le corriger.
 *
 * POST et non GET : le corps porte l'`endpoint`, qui est une URL de capacité
 * — la connaître suffit à envoyer une notification à cet appareil. Elle n'a
 * donc rien à faire dans une URL, qui finit dans les journaux d'accès,
 * l'historique et le `Referer`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI SORT D'ICI : DEUX BOOLÉENS
 * ════════════════════════════════════════════════════════════════════════
 * Jamais de clé (`p256dh`, `auth`), jamais la liste des appareils, jamais un
 * endpoint que l'appelant ne possédait pas déjà. La réponse ne dit rien de
 * plus que ce que l'élève est en droit de savoir de SON appareil.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'IDENTITÉ VIENT DE LA SESSION, PAS DU CORPS
 * ════════════════════════════════════════════════════════════════════════
 * Même règle que `subscribe` et `unsubscribe` : le `user_id` est dérivé de la
 * session authentifiée. Sans ce filtre, connaître un endpoint suffirait à
 * savoir si quelqu'un d'autre a ses notifications actives.
 *
 * ⚠️ AUCUNE ÉCRITURE. Cette route ne crée, ne modifie et ne supprime rien :
 * elle ne peut donc pas altérer la préférence d'un élève, ni la sienne ni
 * celle d'un autre. Le client admin est utilisé en LECTURE seule, parce que
 * RLS interdit — à dessein — à l'élève de lire cette table.
 *
 * ⚠️ UNE PANNE REND 503, JAMAIS « ABSENT ». Confondre les deux ferait
 * afficher « pense à réactiver » à chaque coupure réseau.
 */

/** Un endpoint fait quelques centaines d'octets ; 8 Ko est déjà très large. */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const taille = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(taille) && taille > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corps de requête trop volumineux." }, { status: 413 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  let corps: { endpoint?: unknown };
  try {
    corps = (await request.json()) as { endpoint?: unknown };
  } catch {
    return NextResponse.json({ error: "Corps illisible." }, { status: 400 });
  }
  const endpoint = corps?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2000) {
    return NextResponse.json({ error: "Endpoint invalide." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const etat = await etatAbonnement(admin, user.id, endpoint);
  return NextResponse.json({ connu: etat.connu, actif: etat.actif });
}

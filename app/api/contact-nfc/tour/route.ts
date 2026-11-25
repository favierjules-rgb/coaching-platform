import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/validate";
import { IDENTIFIANTS_COACHS_HTS } from "@/lib/contact-nfc/rotation";
import { lireTour, magasinDuTour, signalerOuverture } from "@/lib/contact-nfc/tour";
import { consumeRateLimit, getTrustedClientIp, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { CONTACT_NFC_TOUR_LECTURE_IP, CONTACT_NFC_TOUR_OUVERTURE_IP } from "@/lib/security/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TOUR DE RÔLE DU CONTACT NFC HTS — `/api/contact-nfc/tour`.
 *
 *   GET  → `{ coach }` : à qui est le tour. Ne fait RIEN avancer : ouvrir ou
 *          scanner la page ne compte pas.
 *   POST `{ coach }` → `{ coach, avance }` : le visiteur vient d'ouvrir
 *          l'application SMS vers `coach`. Le tour avance si c'était bien
 *          son tour (voir `lib/contact-nfc/tour.ts`), et la réponse donne le
 *          coach suivant.
 *
 * ⚠️ AUCUNE DONNÉE PERSONNELLE N'ENTRE NI NE SORT. Le corps n'accepte qu'un
 * identifiant de coach issu d'une liste fermée (`.strict()`), la réponse ne
 * contient qu'un identifiant de coach et un booléen. Aucun SMS n'est envoyé
 * par le serveur : c'est le téléphone du visiteur qui envoie.
 *
 * ⚠️ UNE PANNE NE BLOQUE JAMAIS LE VISITEUR. En cas d'erreur, la route
 * répond 503 sans détail ; la page sert alors le coach par défaut.
 */

const SANS_CACHE = { "Cache-Control": "no-store" } as const;

/** Un corps légitime fait une vingtaine d'octets. */
const TAILLE_MAX_CORPS = 256;

const MESSAGE_QUOTA = "Trop de demandes. Réessaie dans quelques minutes.";
const MESSAGE_INDISPONIBLE = "Tour de rôle momentanément indisponible.";

const corpsOuverture = z.object({ coach: z.enum(IDENTIFIANTS_COACHS_HTS) }).strict();

function indisponible() {
  return NextResponse.json({ error: MESSAGE_INDISPONIBLE }, { status: 503, headers: SANS_CACHE });
}

export async function GET(request: Request) {
  const ip = getTrustedClientIp(request);
  const quota = await consumeRateLimit(rateLimitKey(["contact_nfc_tour_lecture", ip]), CONTACT_NFC_TOUR_LECTURE_IP);
  if (!quota.allowed) return refusDeLimite(quota, MESSAGE_QUOTA);

  try {
    const coach = await lireTour(magasinDuTour());
    return NextResponse.json({ coach: coach.identifiant }, { headers: SANS_CACHE });
  } catch {
    console.error("[ContactNfc] Lecture du tour impossible.");
    return indisponible();
  }
}

export async function POST(request: Request) {
  const taille = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(taille) && taille > TAILLE_MAX_CORPS) {
    return NextResponse.json({ error: "Corps de requete trop volumineux." }, { status: 413, headers: SANS_CACHE });
  }

  const ip = getTrustedClientIp(request);
  const quota = await consumeRateLimit(
    rateLimitKey(["contact_nfc_tour_ouverture", ip]),
    CONTACT_NFC_TOUR_OUVERTURE_IP,
  );
  if (!quota.allowed) return refusDeLimite(quota, MESSAGE_QUOTA);

  const parsed = await parseJsonBody(request, corpsOuverture);
  if (!parsed.success) return parsed.response;

  try {
    const { prochain, avance } = await signalerOuverture(magasinDuTour(), parsed.data.coach);
    return NextResponse.json({ coach: prochain.identifiant, avance }, { headers: SANS_CACHE });
  } catch {
    console.error("[ContactNfc] Avance du tour impossible.");
    return indisponible();
  }
}

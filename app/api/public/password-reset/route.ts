import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/validate";
import { composePasswordResetEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import {
  consumeRateLimit,
  getTrustedClientIp,
  rateLimitHeaders,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { PASSWORD_RESET_EMAIL, PASSWORD_RESET_IP } from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/public/password-reset — déclenché par /mot-de-passe-oublie
 * (chantier "flux mot de passe oublié"). Remplace `resetPasswordForEmail`
 * côté client (qui envoie l'email par défaut de Supabase Auth, non
 * brandé) : génère ici le lien via l'API admin puis l'envoie avec le
 * template Resend habituel (composePasswordResetEmail), cohérent avec le
 * reste des emails transactionnels de l'app.
 *
 * Toujours `{ ok: true }`, que l'email corresponde à un compte ou non —
 * jamais de fuite d'information sur l'existence d'un compte à un tiers.
 */
const bodySchema = z
  .object({ email: z.string().trim().toLowerCase().max(254).pipe(z.string().email()) })
  .strict();

/** ~2 Ko : une adresse email et rien d'autre. */
const MAX_BODY_BYTES = 2 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: true });
  }

  // Limite par IP AVANT lecture du corps : un flot de requêtes ne doit pas
  // même atteindre la validation.
  const ip = getTrustedClientIp(request);
  const parIp = await consumeRateLimit(rateLimitKey([ip]), PASSWORD_RESET_IP);
  if (!parIp.allowed) {
    return NextResponse.json(
      { error: "Trop de demandes. Réessaie plus tard." },
      { status: 429, headers: rateLimitHeaders(parIp) },
    );
  }

  const parsedBody = await parseJsonBody(request, bodySchema);
  if (!parsedBody.success) return parsedBody.response;

  // Limite par adresse VISÉE : sans elle, un attaquant changeant d'IP peut
  // noyer la boîte d'une victime précise. La réponse reste `{ ok: true }`
  // pour ne rien révéler sur l'existence du compte.
  const parEmail = await consumeRateLimit(rateLimitKey([parsedBody.data.email]), PASSWORD_RESET_EMAIL);
  if (!parEmail.allowed) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    // Pas de fuite d'info non plus en cas de mauvaise config : la page
    // affiche le même message de succès générique dans tous les cas.
    return NextResponse.json({ ok: true });
  }

  const email = parsedBody.data.email;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/reinitialiser-mot-de-passe` },
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    // Cas normal si l'email ne correspond à aucun compte — pas une erreur à
    // signaler côté client.
    if (linkError) {
      console.error(`[public/password-reset] generateLink : ${linkError.message}`);
    }
    return NextResponse.json({ ok: true });
  }

  // On construit nous-mêmes l'URL vers /reinitialiser-mot-de-passe plutôt
  // que d'utiliser linkData.properties.action_link (URL hébergée par
  // Supabase, /auth/v1/verify?...&redirect_to=...) : ce redirect_to est
  // tronqué par GoTrue dès qu'il ne correspond pas exactement à une entrée
  // de la liste "Redirect URLs" du dashboard, ce qui a cassé ce flux en prod
  // — voir le commentaire détaillé dans ResetPasswordForm.tsx. verifyOtp()
  // y échange ce jeton contre une session sans dépendre de cette redirection.
  const resetUrl = `${appUrl}/reinitialiser-mot-de-passe?token_hash=${encodeURIComponent(linkData.properties.hashed_token)}&type=recovery`;
  const email_ = composePasswordResetEmail({ resetUrl });
  await sendTransactionalEmail(supabase, {
    emailType: "password_reset",
    recipientEmail: email,
    subject: email_.subject,
    html: email_.html,
    text: email_.text,
    metadata: { source: "mot_de_passe_oublie" },
  });

  return NextResponse.json({ ok: true });
}

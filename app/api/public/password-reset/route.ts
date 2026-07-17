import { NextResponse } from "next/server";
import { z } from "zod";

import { parseJsonBody } from "@/lib/api/validate";
import { composePasswordResetEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
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
const bodySchema = z.object({ email: z.string().email() }).strict();

export async function POST(request: Request) {
  const parsedBody = await parseJsonBody(request, bodySchema);
  if (!parsedBody.success) return parsedBody.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    // Pas de fuite d'info non plus en cas de mauvaise config : la page
    // affiche le même message de succès générique dans tous les cas.
    return NextResponse.json({ ok: true });
  }

  const email = parsedBody.data.email.trim().toLowerCase();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/reinitialiser-mot-de-passe` },
  });

  if (linkError || !linkData?.properties?.action_link) {
    // Cas normal si l'email ne correspond à aucun compte — pas une erreur à
    // signaler côté client.
    if (linkError) {
      console.error(`[public/password-reset] generateLink : ${linkError.message}`);
    }
    return NextResponse.json({ ok: true });
  }

  const email_ = composePasswordResetEmail({ resetUrl: linkData.properties.action_link });
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

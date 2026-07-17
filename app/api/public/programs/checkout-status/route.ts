import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";

/**
 * GET /api/public/programs/checkout-status?session_id=cs_... — statut du
 * provisionnement après un achat de programme public (chantier module
 * Programmation, correctif "accès direct post-paiement"). Interrogée par la
 * page /programmes/merci en polling juste après le retour de Stripe
 * Checkout, PAS par le webhook lui-même : cette route ne crée jamais de
 * compte, elle se contente de vérifier si le webhook
 * (checkout.session.completed, voir lib/stripe/webhook-handlers.ts) a déjà
 * fini son travail — le webhook reste l'unique source de vérité pour le
 * provisionnement, ce qui reste fiable même si ce polling échoue ou
 * n'aboutit jamais (l'email de bienvenue envoyé par le webhook sert alors de
 * filet de sécurité).
 *
 * Une fois le compte trouvé, génère un lien de connexion Supabase à usage
 * unique (magiclink, distinct de celui déjà envoyé par email — chaque appel
 * à generateLink produit un jeton différent, donc consommer celui-ci ici ne
 * invalide jamais le lien "définir ton mot de passe" de l'email) pour
 * ramener l'acheteur directement dans l'app, déjà connecté. Compte flambant
 * neuf (créé par ce paiement) -> /reinitialiser-mot-de-passe, pour qu'il
 * reparte avec un vrai mot de passe utilisable plus tard (accès durable dans
 * le temps) ; compte déjà existant (achat d'un programme supplémentaire) ->
 * /dashboard directement, il a déjà un mot de passe, inutile de le lui
 * redemander.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "session_id manquant." }, { status: 400 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 503 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error("[public/programs/checkout-status] session Stripe introuvable", error);
    return NextResponse.json({ error: "Session de paiement introuvable." }, { status: 404 });
  }

  // Cette route ne sert que le parcours "programme public" (metadata posée
  // par /api/public/programs/[programId]/checkout) — jamais les sessions
  // d'abonnement élève classiques.
  if (!session.metadata?.public_program_id) {
    return NextResponse.json({ error: "Session hors périmètre." }, { status: 400 });
  }

  if (session.payment_status !== "paid") {
    return NextResponse.json({ ready: false });
  }

  const email = (session.metadata?.email || session.customer_details?.email || session.customer_email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return NextResponse.json({ ready: false });
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id, created_at")
    .ilike("email", email)
    .maybeSingle();
  if (studentError) {
    console.error(`[public/programs/checkout-status] lecture élève : ${studentError.message}`);
  }
  if (!student) {
    // Webhook pas encore passé — la page continue de poller.
    return NextResponse.json({ ready: false });
  }

  // Un email déjà connu (achat d'un programme supplémentaire) a déjà un
  // compte de longue date — le trouver ici ne prouve pas que LE WEBHOOK DE
  // CET ACHAT a fini de tourner. Seule l'assignation de ce programme précis
  // en est la preuve : sans ça, on redirigerait un client existant vers son
  // espace avant même que son nouveau programme n'y soit visible.
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id")
    .eq("student_id", student.id)
    .eq("content_type", "programme")
    .eq("content_id", session.metadata.public_program_id)
    .maybeSingle();
  if (assignmentError) {
    console.error(`[public/programs/checkout-status] lecture assignation : ${assignmentError.message}`);
  }
  if (!assignment) {
    return NextResponse.json({ ready: false });
  }

  // Compte créé il y a moins de 5 minutes -> quasi certainement provisionné
  // par ce paiement même (le webhook tourne en quelques secondes) -> jamais
  // encore de mot de passe défini.
  const isNewAccount = Date.now() - new Date(student.created_at).getTime() < 5 * 60 * 1000;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${appUrl}${isNewAccount ? "/reinitialiser-mot-de-passe" : "/dashboard"}` },
  });
  if (linkError || !linkData?.properties?.action_link) {
    console.error(`[public/programs/checkout-status] génération du lien de connexion : ${linkError?.message ?? "action_link manquant"}`);
    // Le compte existe déjà (webhook terminé) : mieux vaut laisser la page
    // basculer sur le message "vérifie ton email" que bloquer indéfiniment.
    return NextResponse.json({ ready: false });
  }

  return NextResponse.json({ ready: true, loginUrl: linkData.properties.action_link });
}

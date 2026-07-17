import "server-only";

import { escapeHtml, renderBaseEmailHtml, renderBaseEmailText, type EmailButton } from "@/lib/email/templates/base";
import { billingIntervalFrequencyLabels } from "@/lib/stripe/plans";
import { formatAmountCents } from "@/lib/stripe/status";
import type { BillingInterval } from "@/types";

/**
 * Un composeur par type d'email transactionnel (chantier
 * "supabase-resend-transactional-emails") — chacun renvoie {subject, html,
 * text}, prêt à passer à lib/email/send-transactional-email.ts. Toute
 * donnée utilisateur (prénom, titre...) est échappée via `escapeHtml` avant
 * d'être insérée dans le HTML.
 */

export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

function p(text: string): string {
  return `<p style="margin: 0 0 14px 0;">${text}</p>`;
}

function formatDateTimeFr(dateIso: string): { date: string; time: string } {
  const d = new Date(dateIso);
  return {
    date: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function formatDateFr(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/* ─── A. Bienvenue / compte activé ─── */

export function composeWelcomeEmail(input: { firstName: string; dashboardUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Bienvenue sur ton espace SETH Préparation Physique ! Ton compte est activé et ton questionnaire est bien enregistré.`),
    p(`Prochaines étapes : ton coach va analyser tes réponses pour te préparer un programme et un plan nutritionnel adaptés. Tu peux dès maintenant explorer ton tableau de bord.`),
  ].join("");
  const button: EmailButton = { label: "Accéder à mon dashboard", url: input.dashboardUrl };
  return {
    subject: "Bienvenue chez SETH Préparation Physique",
    html: renderBaseEmailHtml({ preheader: "Ton compte est activé.", heading: "Bienvenue !", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Bienvenue !",
      bodyText: `Bonjour ${input.firstName},\nBienvenue sur ton espace SETH Préparation Physique ! Ton compte est activé et ton questionnaire est bien enregistré.\nTon coach va analyser tes réponses pour te préparer un programme et un plan nutritionnel adaptés.`,
      button,
    }),
  };
}

/* ─── B. Abonnement attribué ─── */

export function composeSubscriptionAssignedEmail(input: {
  firstName: string;
  templateName: string;
  amountCents: number;
  currency: string;
  billingInterval: BillingInterval;
  durationMonths: number | null;
  payUrl: string;
  profileUrl: string;
}): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const amount = formatAmountCents(input.amountCents, input.currency);
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton coach t'a attribué une formule d'abonnement. Il ne te reste plus qu'à l'activer pour débloquer l'accès complet à tes programmes, plans nutritionnels et documents.`),
  ].join("");
  const detailsHtml = [
    `<p style="margin: 0 0 6px 0; font-weight: 700;">${escapeHtml(input.templateName)}</p>`,
    `<p style="margin: 0 0 4px 0; font-size: 13px;">${amount}${billingIntervalFrequencyLabels[input.billingInterval] ? ` · ${billingIntervalFrequencyLabels[input.billingInterval]}` : ""}</p>`,
    input.durationMonths ? `<p style="margin: 0; font-size: 13px;">Durée : ${input.durationMonths} mois</p>` : "",
  ].join("");
  const button: EmailButton = { label: "Activer mon abonnement", url: input.payUrl };
  const secondaryButton: EmailButton = { label: "Voir mon profil", url: input.profileUrl };
  return {
    subject: `Formule attribuée : ${input.templateName}`,
    html: renderBaseEmailHtml({ preheader: "Une formule t'a été attribuée.", heading: "Formule attribuée", bodyHtml, detailsHtml, button, secondaryButton }),
    text: renderBaseEmailText({
      heading: "Formule attribuée",
      bodyText: `Bonjour ${input.firstName},\nTon coach t'a attribué la formule "${input.templateName}" (${amount}${billingIntervalFrequencyLabels[input.billingInterval] ? `, ${billingIntervalFrequencyLabels[input.billingInterval]}` : ""}${input.durationMonths ? `, ${input.durationMonths} mois` : ""}).\nActive-la pour débloquer l'accès complet.`,
      button,
      secondaryButton,
    }),
  };
}

/* ─── C. Paiement Stripe réussi ─── */

export function composePaymentSucceededEmail(input: {
  firstName: string;
  planName: string;
  amountCents: number;
  currency: string;
  dashboardUrl: string;
}): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const amount = formatAmountCents(input.amountCents, input.currency);
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton paiement de <strong>${amount}</strong>${input.planName ? ` pour la formule <strong>${escapeHtml(input.planName)}</strong>` : ""} a bien été reçu. Ton accès est activé.`),
  ].join("");
  const button: EmailButton = { label: "Accéder à mon dashboard", url: input.dashboardUrl };
  return {
    subject: "Paiement confirmé — accès activé",
    html: renderBaseEmailHtml({ preheader: "Ton paiement est confirmé.", heading: "Paiement confirmé", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Paiement confirmé",
      bodyText: `Bonjour ${input.firstName},\nTon paiement de ${amount}${input.planName ? ` pour la formule ${input.planName}` : ""} a bien été reçu. Ton accès est activé.`,
      button,
    }),
  };
}

/* ─── D. Paiement Stripe échoué ─── */

export function composePaymentFailedEmail(input: { firstName: string; portalUrl: string; profileUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Le prélèvement de ton abonnement n'a pas abouti. Ton accès aux programmes, documents et plans nutritionnels risque d'être limité si la situation n'est pas régularisée.`),
  ].join("");
  const button: EmailButton = { label: "Mettre à jour mon moyen de paiement", url: input.portalUrl };
  const secondaryButton: EmailButton = { label: "Voir mon profil", url: input.profileUrl };
  return {
    subject: "Échec de paiement — action requise",
    html: renderBaseEmailHtml({ preheader: "Ton dernier paiement a échoué.", heading: "Paiement non abouti", bodyHtml, button, secondaryButton }),
    text: renderBaseEmailText({
      heading: "Paiement non abouti",
      bodyText: `Bonjour ${input.firstName},\nLe prélèvement de ton abonnement n'a pas abouti. Ton accès risque d'être limité si la situation n'est pas régularisée.`,
      button,
      secondaryButton,
    }),
  };
}

/* ─── E. Abonnement annulé ─── */

export function composeSubscriptionCancelledEmail(input: { firstName: string; accessEndDate: string | null; profileUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const endDate = input.accessEndDate ? formatDateFr(input.accessEndDate) : null;
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton abonnement a bien été annulé.${endDate ? ` Ton accès reste actif jusqu'au <strong>${escapeHtml(endDate)}</strong>.` : ""}`),
  ].join("");
  const button: EmailButton = { label: "Voir mon profil", url: input.profileUrl };
  return {
    subject: "Abonnement annulé",
    html: renderBaseEmailHtml({ preheader: "Confirmation d'annulation.", heading: "Abonnement annulé", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Abonnement annulé",
      bodyText: `Bonjour ${input.firstName},\nTon abonnement a bien été annulé.${endDate ? ` Ton accès reste actif jusqu'au ${endDate}.` : ""}`,
      button,
    }),
  };
}

/* ─── F. Programme attribué ─── */

export function composeProgramAssignedEmail(input: { firstName: string; programName: string; startDate: string | null; trainingUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton coach t'a attribué un nouveau programme d'entraînement : <strong>${escapeHtml(input.programName)}</strong>.${input.startDate ? ` Début prévu le <strong>${escapeHtml(formatDateFr(input.startDate))}</strong>.` : ""}`),
  ].join("");
  const button: EmailButton = { label: "Voir mon programme", url: input.trainingUrl };
  return {
    subject: `Nouveau programme : ${input.programName}`,
    html: renderBaseEmailHtml({ preheader: "Un nouveau programme t'a été attribué.", heading: "Programme attribué", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Programme attribué",
      bodyText: `Bonjour ${input.firstName},\nTon coach t'a attribué le programme "${input.programName}".${input.startDate ? ` Début prévu le ${formatDateFr(input.startDate)}.` : ""}`,
      button,
    }),
  };
}

/* ─── G. Plan nutritionnel attribué ─── */

export function composeNutritionAssignedEmail(input: { firstName: string; planName: string; nutritionUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton coach t'a attribué un nouveau plan nutritionnel : <strong>${escapeHtml(input.planName)}</strong>.`),
  ].join("");
  const button: EmailButton = { label: "Voir mon plan nutritionnel", url: input.nutritionUrl };
  return {
    subject: `Nouveau plan nutritionnel : ${input.planName}`,
    html: renderBaseEmailHtml({ preheader: "Un nouveau plan nutritionnel t'a été attribué.", heading: "Plan nutritionnel attribué", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Plan nutritionnel attribué",
      bodyText: `Bonjour ${input.firstName},\nTon coach t'a attribué le plan nutritionnel "${input.planName}".`,
      button,
    }),
  };
}

/* ─── G-bis. Bienvenue — programme public (chantier module Programmation, étape 6) ───
 * Compte auto-créé après achat/réclamation d'un programme public sur la home
 * page (accès restreint à /entrainement, voir lib/supabase/guards.ts). Le
 * bouton pointe vers un lien Supabase (magic link/invite) qui connecte
 * directement le destinataire et lui permet de définir son mot de passe —
 * jamais d'email Supabase par défaut, toujours ce template Resend.
 */

export function composePublicProgramWelcomeEmail(input: { firstName: string; programName: string; setPasswordUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton accès au programme <strong>${escapeHtml(input.programName)}</strong> est prêt ! Clique sur le bouton ci-dessous pour définir ton mot de passe et accéder directement à ton programme.`),
  ].join("");
  const button: EmailButton = { label: "Définir mon mot de passe et accéder à mon programme", url: input.setPasswordUrl };
  return {
    subject: `Ton accès à ${input.programName} est prêt`,
    html: renderBaseEmailHtml({ preheader: "Ton accès est prêt.", heading: "Bienvenue !", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Bienvenue !",
      bodyText: `Bonjour ${input.firstName},\nTon accès au programme "${input.programName}" est prêt ! Définis ton mot de passe pour y accéder.`,
      button,
    }),
  };
}

/* ─── G-ter. Mot de passe oublié ───
 * Déclenché par /mot-de-passe-oublie (voir
 * app/api/public/password-reset/route.ts) — remplace l'email par défaut de
 * Supabase Auth (anglais, expéditeur "Supabase Auth") par ce template
 * Resend, cohérent avec composePublicProgramWelcomeEmail. Le bouton pointe
 * vers un lien Supabase (type "recovery") qui connecte directement le
 * destinataire sur /reinitialiser-mot-de-passe.
 */

export function composePasswordResetEmail(input: { resetUrl: string }): ComposedEmail {
  const bodyHtml = [
    p(`Bonjour,`),
    p(`Tu as demandé à réinitialiser ton mot de passe sur ton espace SETH Préparation Physique. Clique sur le bouton ci-dessous pour en choisir un nouveau.`),
    p(`Si tu n'es pas à l'origine de cette demande, tu peux ignorer cet email — ton mot de passe actuel reste inchangé.`),
  ].join("");
  const button: EmailButton = { label: "Choisir un nouveau mot de passe", url: input.resetUrl };
  return {
    subject: "Réinitialise ton mot de passe",
    html: renderBaseEmailHtml({ preheader: "Choisis un nouveau mot de passe.", heading: "Mot de passe oublié", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Mot de passe oublié",
      bodyText: `Bonjour,\nTu as demandé à réinitialiser ton mot de passe. Utilise ce lien pour en choisir un nouveau : ${input.resetUrl}\nSi tu n'es pas à l'origine de cette demande, ignore cet email.`,
      button,
    }),
  };
}

/* ─── G-quater. Avertissement fin d'accès (achat unique, 6 mois) ───
 * Chantier "suppression auto. comptes programme_seul" — envoyé une seule
 * fois (`students.deletion_warning_sent_at`), ~14 jours avant la
 * suppression définitive du compte (voir
 * app/api/internal/cleanup-expired-accounts/route.ts). Le compte est
 * réellement supprimé (fiche + connexion) à l'échéance, sans nouvel email.
 */

export function composeAccountExpiryWarningEmail(input: { firstName: string; loginUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton accès à ton programme sur SETH Préparation Physique se termine dans environ 14 jours. Passé ce délai, ton compte et tes données seront définitivement supprimés.`),
    p(`Si tu souhaites encore profiter de ton programme, connecte-toi dès maintenant.`),
  ].join("");
  const button: EmailButton = { label: "Accéder à mon programme", url: input.loginUrl };
  return {
    subject: "Ton accès se termine bientôt",
    html: renderBaseEmailHtml({ preheader: "Ton accès se termine dans environ 14 jours.", heading: "Ton accès se termine bientôt", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Ton accès se termine bientôt",
      bodyText: `Bonjour ${input.firstName},\nTon accès à ton programme se termine dans environ 14 jours. Passé ce délai, ton compte et tes données seront définitivement supprimés.\nConnecte-toi dès maintenant pour en profiter : ${input.loginUrl}`,
      button,
    }),
  };
}

/* ─── G-quinquies. Invitation élève créé par le coach (coaching classique) ───
 * Déclenché à la création d'un élève depuis /admin/eleves
 * (CreateStudentModal -> lib/supabase/coach-student-provisioning.ts).
 * Distinct de composePublicProgramWelcomeEmail (achat unique programme
 * public) : ici l'élève est un compte "coaching" classique, le lien de
 * définition de mot de passe le ramène sur /reinitialiser-mot-de-passe puis
 * /dashboard, qui le redirige automatiquement vers /onboarding tant que son
 * questionnaire n'est pas complété (voir lib/supabase/guards.ts::
 * requireStudent) — jamais besoin de forcer ce lien explicitement ici.
 */

export function composeCoachInviteEmail(input: { firstName: string; coachName: string; setPasswordUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const coach = escapeHtml(input.coachName || "ton coach");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`${coach} vient de créer ton espace sur SETH Préparation Physique. Clique sur le bouton ci-dessous pour définir ton mot de passe et accéder à ton compte.`),
    p(`Une fois connecté, un court questionnaire te sera demandé pour que ton coach puisse te préparer un programme et un plan nutritionnel adaptés.`),
  ].join("");
  const button: EmailButton = { label: "Définir mon mot de passe", url: input.setPasswordUrl };
  return {
    subject: "Ton espace SETH Préparation Physique est prêt",
    html: renderBaseEmailHtml({ preheader: "Définis ton mot de passe pour accéder à ton espace.", heading: "Bienvenue !", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Bienvenue !",
      bodyText: `Bonjour ${input.firstName},\n${input.coachName || "Ton coach"} vient de créer ton espace sur SETH Préparation Physique. Définis ton mot de passe pour y accéder : ${input.setPasswordUrl}\nUn court questionnaire te sera ensuite demandé.`,
      button,
    }),
  };
}

/* ─── H. Document attribué ─── */

export function composeDocumentAssignedEmail(input: { firstName: string; documentTitle: string; documentsUrl: string }): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Un nouveau document est disponible pour toi : <strong>${escapeHtml(input.documentTitle)}</strong>.`),
  ].join("");
  const button: EmailButton = { label: "Voir mes documents", url: input.documentsUrl };
  return {
    subject: `Nouveau document : ${input.documentTitle}`,
    html: renderBaseEmailHtml({ preheader: "Un nouveau document t'a été attribué.", heading: "Document attribué", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Document attribué",
      bodyText: `Bonjour ${input.firstName},\nUn nouveau document est disponible : "${input.documentTitle}".`,
      button,
    }),
  };
}

/* ─── I. Rendez-vous créé (élève + coach) ─── */

export function composeAppointmentCreatedStudentEmail(input: {
  firstName: string;
  appointmentType: string;
  startAt: string;
  location: string;
  meetingUrl: string;
  coachName: string;
  appointmentUrl: string;
  /** `true` si ce rendez-vous remplace un rendez-vous reporté (lib/supabase/appointments.ts::rescheduleAppointment) — ajuste uniquement le libellé, toujours journalisé comme `appointment_created` (voir types/index.ts::EmailType). */
  isReschedule?: boolean;
}): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const { date, time } = formatDateTimeFr(input.startAt);
  const where = input.meetingUrl || input.location || "à confirmer avec ton coach";
  const verb = input.isReschedule ? "reporté" : "confirmé";
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Ton rendez-vous "${escapeHtml(input.appointmentType)}" avec ${escapeHtml(input.coachName)} est ${verb}.`),
  ].join("");
  const detailsHtml = [
    `<p style="margin: 0 0 4px 0;">Date : <strong>${escapeHtml(date)}</strong></p>`,
    `<p style="margin: 0 0 4px 0;">Heure : <strong>${escapeHtml(time)}</strong></p>`,
    `<p style="margin: 0;">Lieu / lien : ${escapeHtml(where)}</p>`,
  ].join("");
  const button: EmailButton = { label: "Voir mon rendez-vous", url: input.appointmentUrl };
  return {
    subject: `Rendez-vous ${verb} — ${date}`,
    html: renderBaseEmailHtml({ preheader: `Ton rendez-vous est ${verb}.`, heading: `Rendez-vous ${verb}`, bodyHtml, detailsHtml, button }),
    text: renderBaseEmailText({
      heading: `Rendez-vous ${verb}`,
      bodyText: `Bonjour ${input.firstName},\nTon rendez-vous "${input.appointmentType}" avec ${input.coachName} est ${verb}.\nDate : ${date}\nHeure : ${time}\nLieu / lien : ${where}`,
      button,
    }),
  };
}

export function composeAppointmentCreatedCoachEmail(input: {
  coachFirstName: string;
  studentName: string;
  appointmentType: string;
  startAt: string;
  appointmentUrl: string;
  isReschedule?: boolean;
}): ComposedEmail {
  const { date, time } = formatDateTimeFr(input.startAt);
  const verbNoun = input.isReschedule ? "Rendez-vous reporté" : "Nouveau rendez-vous";
  const bodyHtml = [
    p(`Bonjour ${escapeHtml(input.coachFirstName || "")},`),
    p(
      `${input.isReschedule ? "Rendez-vous reporté" : "Nouveau rendez-vous réservé"} par <strong>${escapeHtml(input.studentName)}</strong> — ${escapeHtml(input.appointmentType)}.`,
    ),
  ].join("");
  const detailsHtml = [
    `<p style="margin: 0 0 4px 0;">Élève : <strong>${escapeHtml(input.studentName)}</strong></p>`,
    `<p style="margin: 0 0 4px 0;">Date : <strong>${escapeHtml(date)}</strong></p>`,
    `<p style="margin: 0;">Heure : <strong>${escapeHtml(time)}</strong></p>`,
  ].join("");
  const button: EmailButton = { label: "Voir le calendrier", url: input.appointmentUrl };
  return {
    subject: `${verbNoun} — ${input.studentName} — ${date}`,
    html: renderBaseEmailHtml({ preheader: `${verbNoun}.`, heading: verbNoun, bodyHtml, detailsHtml, button }),
    text: renderBaseEmailText({
      heading: verbNoun,
      bodyText: `Bonjour ${input.coachFirstName},\n${verbNoun} par ${input.studentName} — ${input.appointmentType}.\nDate : ${date}\nHeure : ${time}`,
      button,
    }),
  };
}

/* ─── J. Rendez-vous annulé ─── */

export function composeAppointmentCancelledEmail(input: {
  recipientFirstName: string;
  appointmentType: string;
  startAt: string;
  profileOrCalendarUrl: string;
}): ComposedEmail {
  const { date, time } = formatDateTimeFr(input.startAt);
  const bodyHtml = [
    p(`Bonjour ${escapeHtml(input.recipientFirstName || "")},`),
    p(`Le rendez-vous "${escapeHtml(input.appointmentType)}" du <strong>${escapeHtml(date)}</strong> à <strong>${escapeHtml(time)}</strong> a été annulé.`),
  ].join("");
  const button: EmailButton = { label: "Voir le calendrier", url: input.profileOrCalendarUrl };
  return {
    subject: `Rendez-vous annulé — ${date}`,
    html: renderBaseEmailHtml({ preheader: "Un rendez-vous a été annulé.", heading: "Rendez-vous annulé", bodyHtml, button }),
    text: renderBaseEmailText({
      heading: "Rendez-vous annulé",
      bodyText: `Bonjour ${input.recipientFirstName},\nLe rendez-vous "${input.appointmentType}" du ${date} à ${time} a été annulé.`,
      button,
    }),
  };
}

/* ─── K. Rappel de rendez-vous ─── */

export function composeAppointmentReminderEmail(input: {
  firstName: string;
  appointmentType: string;
  startAt: string;
  location: string;
  meetingUrl: string;
  hoursBefore: 24 | 2;
  appointmentUrl: string;
}): ComposedEmail {
  const name = escapeHtml(input.firstName || "");
  const { date, time } = formatDateTimeFr(input.startAt);
  const where = input.meetingUrl || input.location || "à confirmer avec ton coach";
  const delay = input.hoursBefore === 24 ? "demain" : "dans 2 heures";
  const bodyHtml = [
    p(`Bonjour ${name},`),
    p(`Rappel : ton rendez-vous "${escapeHtml(input.appointmentType)}" a lieu <strong>${delay}</strong>.`),
  ].join("");
  const detailsHtml = [
    `<p style="margin: 0 0 4px 0;">Date : <strong>${escapeHtml(date)}</strong></p>`,
    `<p style="margin: 0 0 4px 0;">Heure : <strong>${escapeHtml(time)}</strong></p>`,
    `<p style="margin: 0;">Lieu / lien : ${escapeHtml(where)}</p>`,
  ].join("");
  const button: EmailButton = { label: "Voir mon rendez-vous", url: input.appointmentUrl };
  return {
    subject: `Rappel — rendez-vous ${delay} — ${time}`,
    html: renderBaseEmailHtml({ preheader: `Rappel : rendez-vous ${delay}.`, heading: "Rappel de rendez-vous", bodyHtml, detailsHtml, button }),
    text: renderBaseEmailText({
      heading: "Rappel de rendez-vous",
      bodyText: `Bonjour ${input.firstName},\nRappel : ton rendez-vous "${input.appointmentType}" a lieu ${delay}.\nDate : ${date}\nHeure : ${time}\nLieu / lien : ${where}`,
      button,
    }),
  };
}

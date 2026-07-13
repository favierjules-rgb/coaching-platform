import { requireAdminOrCoach } from "@/lib/supabase/guards";
import { listSubscribersForStaff } from "@/lib/newsletter/db";
import { NewsletterAdminTable } from "@/components/admin/NewsletterAdminTable";

export default async function AdminNewsletterPage() {
  await requireAdminOrCoach();
  const subscribers = await listSubscribersForStaff();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-bold uppercase text-foreground">
          Newsletter
        </h1>
        <a
          href="https://app.brevo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="border border-border px-4 py-2 text-sm font-bold uppercase text-foreground transition hover:bg-foreground hover:text-background"
        >
          Ouvrir Brevo
        </a>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">
        Les campagnes se créent et s&apos;envoient directement depuis Brevo.
        Cette page sert uniquement à consulter et gérer les abonnés
        synchronisés avec Brevo.
      </p>
      <NewsletterAdminTable subscribers={subscribers} />
    </div>
  );
}

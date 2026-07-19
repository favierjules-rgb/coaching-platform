import { requireAdminOrCoach } from "@/lib/supabase/guards";
import { listSubscribersForStaff } from "@/lib/newsletter/db";
import { NewsletterAdminTable } from "@/components/admin/NewsletterAdminTable";

export default async function AdminNewsletterPage() {
  await requireAdminOrCoach();
  const subscribers = await listSubscribersForStaff();

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Newsletter
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Les campagnes se créent et s&apos;envoient directement depuis Brevo. Cette page sert uniquement à
            consulter et gérer les abonnés synchronisés avec Brevo.
          </p>
        </div>
        <a
          href="https://app.brevo.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Ouvrir Brevo
        </a>
      </div>
      <NewsletterAdminTable subscribers={subscribers} />
    </div>
  );
}

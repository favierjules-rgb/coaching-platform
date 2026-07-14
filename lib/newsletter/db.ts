import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin data-access layer for `public.newsletter_subscribers`.
 *
 * The shared `types/supabase.ts` Database type is a hand-maintained
 * placeholder (see its own header comment) and hasn't been regenerated for
 * this table yet, so this module intentionally works against a locally
 * declared row type instead of extending that shared generic. This keeps the
 * migration purely additive without risking an unrelated, large edit to a
 * shared type file. `types/supabase.ts` can be regenerated later with
 * `supabase gen types typescript` without any change required here.
 */

export type NewsletterStatus =
  | "pending"
  | "subscribed"
  | "unsubscribed"
  | "bounced"
  | "complained"
  | "sync_failed";

export interface NewsletterSubscriberRow {
  id: string;
  email: string;
  normalized_email: string;
  profile_id: string | null;
  status: NewsletterStatus;
  source: string;
  consent_text_version: string;
  consent_at: string;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
  brevo_contact_id: string | null;
  brevo_list_id: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NewNewsletterSubscriber {
  email: string;
  normalized_email: string;
  profile_id?: string | null;
  status?: NewsletterStatus;
  source: string;
  consent_text_version: string;
  brevo_contact_id?: string | null;
  brevo_list_id?: string | null;
  last_sync_status?: string | null;
  last_sync_error?: string | null;
  metadata?: Record<string, unknown>;
}

const TABLE = "newsletter_subscribers";

/** Service-role client: bypasses RLS. Returns null if not configured. */
function getAdminClient(): SupabaseClient | null {
  return createSupabaseAdminClient() as unknown as SupabaseClient | null;
}

/** Cookie/session-bound client: respects RLS for the current user. */
async function getServerClient(): Promise<SupabaseClient | null> {
  const client = await createSupabaseServerClient();
  return client as unknown as SupabaseClient | null;
}

export async function findSubscriberByNormalizedEmail(
  normalizedEmail: string
): Promise<NewsletterSubscriberRow | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("normalized_email", normalizedEmail)
    .maybeSingle();

  if (error) {
    console.error("[Newsletter] findSubscriberByNormalizedEmail:", error.message);
    return null;
  }
  return (data as NewsletterSubscriberRow) ?? null;
}

export async function findSubscriberByProfileId(
  profileId: string
): Promise<NewsletterSubscriberRow | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("[Newsletter] findSubscriberByProfileId:", error.message);
    return null;
  }
  return (data as NewsletterSubscriberRow) ?? null;
}

export async function createSubscriber(
  input: NewNewsletterSubscriber
): Promise<NewsletterSubscriberRow | null> {
  const client = getAdminClient();
  if (!client) {
    console.error(
      "[Newsletter] createSubscriber: client admin indisponible (SUPABASE_SERVICE_ROLE_KEY manquante)."
    );
    return null;
  }

  const { data, error } = await client
    .from(TABLE)
    .insert({
      email: input.email,
      normalized_email: input.normalized_email,
      profile_id: input.profile_id ?? null,
      status: input.status ?? "pending",
      source: input.source,
      consent_text_version: input.consent_text_version,
      brevo_contact_id: input.brevo_contact_id ?? null,
      brevo_list_id: input.brevo_list_id ?? null,
      last_sync_status: input.last_sync_status ?? null,
      last_sync_error: input.last_sync_error ?? null,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    console.error("[Newsletter] createSubscriber:", error.message);
    return null;
  }
  return data as NewsletterSubscriberRow;
}

export async function updateSubscriberById(
  id: string,
  patch: Partial<NewsletterSubscriberRow>
): Promise<NewsletterSubscriberRow | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    console.error("[Newsletter] updateSubscriberById:", error.message);
    return null;
  }
  return data as NewsletterSubscriberRow;
}

export async function updateSubscriberByNormalizedEmail(
  normalizedEmail: string,
  patch: Partial<NewsletterSubscriberRow>
): Promise<NewsletterSubscriberRow | null> {
  const client = getAdminClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("normalized_email", normalizedEmail)
    .select("*")
    .single();

  if (error) {
    console.error("[Newsletter] updateSubscriberByNormalizedEmail:", error.message);
    return null;
  }
  return data as NewsletterSubscriberRow;
}

export interface ListSubscribersFilters {
  status?: NewsletterStatus;
  source?: string;
  search?: string;
}

/**
 * Lists subscribers using the session-bound (RLS-respecting) client, so this
 * only ever works when called on behalf of an authenticated admin/coach.
 */
export async function listSubscribersForStaff(
  filters: ListSubscribersFilters = {}
): Promise<NewsletterSubscriberRow[]> {
  const client = await getServerClient();
  if (!client) return [];

  let query = client
    .from(TABLE)
    .select("*")
    .order("created_at", { ascending: false });

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.source) query = query.eq("source", filters.source);
  if (filters.search) {
    query = query.ilike("email", `%${filters.search}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Newsletter] listSubscribersForStaff:", error.message);
    return [];
  }
  return (data as NewsletterSubscriberRow[]) ?? [];
}

export async function getSubscriberByIdForStaff(
  id: string
): Promise<NewsletterSubscriberRow | null> {
  const client = await getServerClient();
  if (!client) return null;

  const { data, error } = await client
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[Newsletter] getSubscriberByIdForStaff:", error.message);
    return null;
  }
  return (data as NewsletterSubscriberRow) ?? null;
}

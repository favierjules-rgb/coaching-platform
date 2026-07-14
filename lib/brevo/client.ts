/**
 * Minimal, dependency-free client for the Brevo (ex-Sendinblue) Contacts API.
 *
 * This module is intentionally isolated from `lib/email/*` (Resend
 * transactional emails). It is only ever used by the newsletter feature.
 *
 * Every exported function is tolerant of a missing `BREVO_API_KEY`: instead
 * of throwing, it returns a `{ skipped: true }` result so the newsletter
 * signup flow never crashes when Brevo isn't configured yet.
 */

const BREVO_API_BASE = "https://api.brevo.com/v3";

type BrevoResult<T> =
  | { ok: true; skipped: false; data: T }
  | { ok: false; skipped: true; reason: "missing_api_key" }
  | { ok: false; skipped: false; status: number; error: string };

function getApiKey(): string | null {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.warn(
      "[Brevo] BREVO_API_KEY absente. Appel Brevo ignoré (skipped)."
    );
    return null;
  }
  return key;
}

function getListId(): number | null {
  const raw = process.env.BREVO_NEWSLETTER_LIST_ID;
  if (!raw) {
    console.warn("[Brevo] BREVO_NEWSLETTER_LIST_ID absente.");
    return null;
  }
  const id = Number(raw);
  if (!Number.isFinite(id)) {
    console.warn("[Brevo] BREVO_NEWSLETTER_LIST_ID invalide:", raw);
    return null;
  }
  return id;
}

async function brevoFetch<T>(
  path: string,
  init: RequestInit
): Promise<BrevoResult<T>> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, skipped: true, reason: "missing_api_key" };
  }

  try {
    const response = await fetch(`${BREVO_API_BASE}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "api-key": apiKey,
        ...(init.headers ?? {}),
      },
    });

    if (response.status === 204) {
      return { ok: true, skipped: false, data: undefined as T };
    }

    const text = await response.text();
    const json = text ? safeJsonParse(text) : null;

    if (!response.ok) {
      // Never log or surface the API key itself, only the response body.
      const errorMessage =
        (json && typeof json === "object" && "message" in json
          ? String((json as { message: unknown }).message)
          : text) || `HTTP ${response.status}`;
      return {
        ok: false,
        skipped: false,
        status: response.status,
        error: errorMessage,
      };
    }

    return { ok: true, skipped: false, data: json as T };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      status: 0,
      error: error instanceof Error ? error.message : "Erreur réseau Brevo",
    };
  }
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface BrevoContactAttributes {
  PRENOM?: string;
  NOM?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface UpsertContactResult {
  ok: boolean;
  skipped: boolean;
  brevoContactId: string | null;
  listId: number | null;
  error: string | null;
}

/**
 * Creates the contact if it doesn't exist yet (or updates it if it does),
 * and adds it to the newsletter list configured via
 * `BREVO_NEWSLETTER_LIST_ID`.
 */
export async function upsertNewsletterContact(
  email: string,
  attributes: BrevoContactAttributes = {}
): Promise<UpsertContactResult> {
  const listId = getListId();

  const result = await brevoFetch<{ id?: number }>("/contacts", {
    method: "POST",
    body: JSON.stringify({
      email,
      attributes,
      listIds: listId ? [listId] : undefined,
      updateEnabled: true,
    }),
  });

  if (result.skipped) {
    return { ok: false, skipped: true, brevoContactId: null, listId, error: null };
  }

  if (!result.ok) {
    return {
      ok: false,
      skipped: false,
      brevoContactId: null,
      listId,
      error: result.error,
    };
  }

  return {
    ok: true,
    skipped: false,
    brevoContactId:
      result.data && typeof result.data === "object" && "id" in result.data
        ? String((result.data as { id: unknown }).id)
        : email,
    listId,
    error: null,
  };
}

export interface SimpleBrevoResult {
  ok: boolean;
  skipped: boolean;
  error: string | null;
}

/**
 * Permanently deletes the contact from Brevo. Used on unsubscribe: our own
 * `newsletter_subscribers` row and its consent history are always kept, only
 * the Brevo-side contact is removed.
 */
export async function deleteBrevoContact(
  email: string
): Promise<SimpleBrevoResult> {
  const result = await brevoFetch<void>(
    `/contacts/${encodeURIComponent(email)}`,
    { method: "DELETE" }
  );

  if (result.skipped) {
    return { ok: false, skipped: true, error: null };
  }

  // Brevo returns 404 if the contact is already gone: treat that as success.
  if (!result.ok && result.status === 404) {
    return { ok: true, skipped: false, error: null };
  }

  if (!result.ok) {
    return { ok: false, skipped: false, error: result.error };
  }

  return { ok: true, skipped: false, error: null };
}

/**
 * Removes the contact from a specific list without deleting it entirely.
 * Not used by the main unsubscribe flow (which deletes the contact) but kept
 * available for the admin "resync" tooling.
 */
export async function removeContactFromList(
  email: string,
  listId: number
): Promise<SimpleBrevoResult> {
  const result = await brevoFetch<void>(
    `/contacts/${encodeURIComponent(email)}`,
    {
      method: "PUT",
      body: JSON.stringify({ unlinkListIds: [listId] }),
    }
  );

  if (result.skipped) {
    return { ok: false, skipped: true, error: null };
  }
  if (!result.ok) {
    return { ok: false, skipped: false, error: result.error };
  }
  return { ok: true, skipped: false, error: null };
}

export interface GetContactResult {
  ok: boolean;
  skipped: boolean;
  found: boolean;
  brevoContactId: string | null;
  error: string | null;
}

/** Looks up a contact by email. Used by the admin "resync" action. */
export async function getBrevoContact(
  email: string
): Promise<GetContactResult> {
  const result = await brevoFetch<{ id?: number }>(
    `/contacts/${encodeURIComponent(email)}`,
    { method: "GET" }
  );

  if (result.skipped) {
    return {
      ok: false,
      skipped: true,
      found: false,
      brevoContactId: null,
      error: null,
    };
  }

  if (!result.ok) {
    if (result.status === 404) {
      return {
        ok: true,
        skipped: false,
        found: false,
        brevoContactId: null,
        error: null,
      };
    }
    return {
      ok: false,
      skipped: false,
      found: false,
      brevoContactId: null,
      error: result.error,
    };
  }

  return {
    ok: true,
    skipped: false,
    found: true,
    brevoContactId:
      result.data && typeof result.data === "object" && "id" in result.data
        ? String((result.data as { id: unknown }).id)
        : email,
    error: null,
  };
}

/** Whether the newsletter/Brevo integration is fully configured. */
export function isBrevoConfigured(): boolean {
  return Boolean(process.env.BREVO_API_KEY);
}

/** Whether the newsletter feature is enabled at all (env flag). */
export function isNewsletterEnabled(): boolean {
  return process.env.NEWSLETTER_ENABLED === "true";
}

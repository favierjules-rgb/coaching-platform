import { NextResponse } from "next/server";
import type { ZodTypeAny, z } from "zod";

/**
 * Validation Zod des entrees d'API (chantier api-zod-validation) : chaque
 * endpoint doit rejeter toute requete qui ne correspond pas exactement au
 * schema attendu (type, longueur, format) plutot que d'accepter des champs
 * partiels/inconnus en silence. Tous les schemas de body doivent utiliser
 * `.strict()` pour refuser les cles superflues.
 */

export interface ValidationSuccess<T> {
  success: true;
  data: T;
}

export interface ValidationFailure {
  success: false;
  response: NextResponse;
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

function formatIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({ path: issue.path.join(".") || "(racine)", message: issue.message }));
}

/**
 * Parse `request.json()` puis valide le resultat contre `schema`. Renvoie
 * soit `{ success: true, data }` (typee via `z.infer<S>`), soit
 * `{ success: false, response }` ou `response` est une 400 JSON prete a
 * etre retournee telle quelle par le handler (`if (!parsed.success) return
 * parsed.response;`).
 */
export async function parseJsonBody<S extends ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<ValidationResult<z.infer<S>>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: "Corps de requete invalide (JSON malforme)." }, { status: 400 }),
    };
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Corps de requete invalide.", issues: formatIssues(result.error) },
        { status: 400 },
      ),
    };
  }
  return { success: true, data: result.data };
}

/**
 * Valide un objet de parametres (ex. route params `{ id }`) contre
 * `schema`. Utilise pour les segments dynamiques `[id]` qui doivent aussi
 * respecter un format strict (ex. UUID) et pas seulement etre une chaine
 * non vide.
 */
export function parseParams<S extends ZodTypeAny>(
  params: Record<string, unknown>,
  schema: S,
): ValidationResult<z.infer<S>> {
  const result = schema.safeParse(params);
  if (!result.success) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Parametres invalides.", issues: formatIssues(result.error) },
        { status: 400 },
      ),
    };
  }
  return { success: true, data: result.data };
}

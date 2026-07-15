import { z } from "zod";

/** UUID (toutes les cles primaires du schema public sont de type uuid). */
export const uuidSchema = z.string().uuid({ message: "Doit etre un UUID valide." });

/** Schema reutilise pour valider `{ id }` extrait des params de route dynamique `[id]`. */
export const idParamSchema = z.object({ id: uuidSchema }).strict();

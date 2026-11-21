import { z } from 'zod';

/**
 * FACTS: values that a document literally states, extracted per document.
 * These are NOT interpretation. Interpretation lives in `analysis.ts` (Finding).
 */
export const FactCategorySchema = z.enum([
  'identity',
  'address',
  'date',
  'financial',
  'obligation',
  'licence',
  'other',
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

export const ExtractedFactSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  /** Snake_case key, e.g. "applicant_name", "revenue_2025", "licence_number". */
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9_]+$/, 'key must be snake_case'),
  value: z.string().min(1).max(1000),
  normalizedValue: z.string().nullable(),
  category: FactCategorySchema,
  /** Short exact quote from the document that supports this fact. */
  sourceSnippet: z.string().min(1).max(200),
  confidence: z.number().min(0).max(1),
});
export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

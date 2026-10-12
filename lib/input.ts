// Public input guard (PRD A7): the "Your product" text is length-limited and stripped of control
// characters. Changing it only triggers new Gemini angles, never a new Product Hunt run.
export const DEFAULT_PRODUCT_TEXT = "Software that helps remote teams run async standups.";
export const MAX_PRODUCT_TEXT = 300;

export function cleanProductText(input: unknown): string {
  const text = typeof input === "string" ? input : "";
  const cleaned = text
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PRODUCT_TEXT)
    .trim();
  return cleaned || DEFAULT_PRODUCT_TEXT;
}

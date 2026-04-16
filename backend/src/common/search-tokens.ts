/**
 * Arama metnini boşlukla ayrılmış kelimelere böler (tam kelime / çoklu kelime eşleşmesi için).
 */
export function splitSearchTokens(search: string | undefined | null): string[] {
  if (!search?.trim()) return [];
  return search
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

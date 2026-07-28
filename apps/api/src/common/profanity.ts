import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

export function containsProfanity(text: string): boolean {
  return matcher.hasMatch(text);
}

/** Replace matches with asterisks — used for chat (don't reject). */
export function replaceProfanity(text: string): string {
  if (!containsProfanity(text)) return text;
  // obscenity match spans vary by version — conservative whole-token mask
  return text
    .split(/(\s+)/)
    .map((part) => (/\s+/.test(part) ? part : containsProfanity(part) ? "*".repeat(part.length) : part))
    .join("");
}

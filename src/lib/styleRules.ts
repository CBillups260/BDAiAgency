import { isOpenAIModel } from './modelCatalog';

/**
 * OpenAI-only layout constraints for the composer, appended to the prompt as
 * explicit negatives.
 *
 * GPT Image reliably adds rule lines between sections, underlines headings, and
 * fills space with ornament unless told not to — and it responds to plain
 * "do not" phrasing far better than to adjectives like "clean" or "minimal" on
 * their own. Gemini and the other families don't share the habit, so the panel
 * stays hidden for them rather than spending prompt tokens on it.
 */
export interface StyleRule {
  key: StyleRuleKey;
  label: string;
  sub: string;
  rule: string;
}

export type StyleRuleKey = 'noDividers' | 'noUnderlines' | 'minimalDesign';

export const STYLE_RULES: StyleRule[] = [
  {
    key: 'noDividers',
    label: 'No dividers',
    sub: 'No rule lines or separator bars',
    rule:
      'Do not draw any divider lines, horizontal rules, separator bars, or ruled lines between ' +
      'sections. Separate content with spacing alone.',
  },
  {
    key: 'noUnderlines',
    label: 'No underlined text',
    sub: 'Never underline headings or words',
    rule:
      'Do not underline any text. No underlines beneath headings, words, or numbers, and no ' +
      'line accents sitting under text.',
  },
  {
    key: 'minimalDesign',
    label: 'Minimal design',
    sub: 'Space over ornament',
    rule:
      'Keep the design minimal: generous negative space, few elements, a restrained palette, and ' +
      'no decorative flourishes, frames, badges, ornaments, or background texture.',
  },
];

/**
 * The constraints block to append to a prompt. Empty string when the model
 * isn't an OpenAI one or nothing is ticked, so callers can concatenate blindly.
 */
export function buildStyleRulesSuffix(
  model: string,
  flags: Record<StyleRuleKey, boolean>,
): string {
  if (!isOpenAIModel(model)) return '';
  const active = STYLE_RULES.filter((r) => flags[r.key]);
  if (!active.length) return '';
  return `\n\nSTYLE RULES (hard constraints — follow every one):\n${active
    .map((r) => `- ${r.rule}`)
    .join('\n')}`;
}

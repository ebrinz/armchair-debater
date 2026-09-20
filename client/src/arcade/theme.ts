import type { TheoryCard } from './types';

/** Top-level Kuhn category → CSS custom property holding that type's colour (defined in arcade.css). */
const TYPE_COLORS: Record<string, string> = {
  Materialism: '--type-materialism',
  'Integrated Information Theory': '--type-information',
  'Quantum Theories': '--type-quantum',
  Panpsychisms: '--type-panpsychism',
  Dualisms: '--type-dualism',
  Idealisms: '--type-idealism',
};

export const typeOf = (card: Pick<TheoryCard, 'kuhn_category'>): { label: string; colorVar: string } => {
  const segments = card.kuhn_category.split('>').map((s) => s.trim());
  return { label: segments.at(-1) ?? '', colorVar: TYPE_COLORS[segments[0]] ?? '--type-neutral' };
};

/** Short codes for the card's rival chips, six characters at most, fighting-game style. */
const SHORT_NAMES: Record<string, string> = {
  gwt: 'GWT',
  iit: 'IIT',
  hot: 'HOT',
  rpt: 'RPT',
  predictive_processing: 'PREDIC',
  ast: 'AST',
  illusionism: 'ILLUSN',
  biological_naturalism: 'BIONAT',
  orch_or: 'ORCHOR',
  panpsychism: 'PANPSY',
  property_dualism: 'DUAL',
  analytic_idealism: 'IDEAL',
};

export const shortName = (id: string): string => SHORT_NAMES[id] ?? id.toUpperCase().slice(0, 6);

/**
 * The ink token that stays legible on a type colour. arcade.css defines the
 * pairs (`--type-quantum` → `--ink-on-quantum`), so the mapping is a rename.
 */
export const inkOn = (colorVar: string): string => colorVar.replace('--type-', '--ink-on-');

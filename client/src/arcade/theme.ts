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

/** Grid-slot names, six characters at most, fighting-game style. */
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

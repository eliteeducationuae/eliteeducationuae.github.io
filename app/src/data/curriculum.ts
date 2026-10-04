import { sameSubject } from '@/domain/enrolments';
import type { Syllabus, SyllabusUnit } from '@/domain/progress';

/**
 * Syllabus topic trees used for curriculum-aware progress tracking.
 * Topic ids are stable strings stored against ratings — never rename an id, only add new ones.
 */

type UnitSpec = [unitName: string, topics: string[]];

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function build(prefix: string, units: UnitSpec[]): SyllabusUnit[] {
  return units.map(([name, topics]) => ({
    id: `${prefix}:${slug(name)}`,
    name,
    topics: topics.map((t) => ({ id: `${prefix}:${slug(name)}:${slug(t)}`, name: t })),
  }));
}

/** Merge HL-only topics into the matching SL units (by unit name). */
function extend(base: UnitSpec[], extra: UnitSpec[]): UnitSpec[] {
  return base.map(([name, topics]) => {
    const more = extra.find(([n]) => n === name)?.[1] ?? [];
    return [name, [...topics, ...more]];
  });
}

const IB_AA_SL: UnitSpec[] = [
  ['Number & Algebra', ['Standard form', 'Arithmetic sequences & series', 'Geometric sequences & series', 'Financial applications', 'Exponents & logarithms', 'Binomial theorem', 'Simple proof']],
  ['Functions', ['Equation of a line', 'Function concepts, domain & range', 'Graphing & key features', 'Composite & inverse functions', 'Quadratic functions', 'Rational functions', 'Exponential & log functions', 'Transformations of graphs']],
  ['Geometry & Trigonometry', ['3D solids, distance & angles', 'Sine & cosine rules', 'Radian measure, arcs & sectors', 'Unit circle & exact values', 'Trig identities', 'Trig functions & graphs', 'Solving trig equations']],
  ['Statistics & Probability', ['Sampling & data', 'Summary statistics', 'Correlation & regression', 'Probability & Venn diagrams', 'Conditional probability', 'Discrete random variables', 'Binomial distribution', 'Normal distribution']],
  ['Calculus', ['Limits & derivative concept', 'Differentiation rules', 'Tangents & normals', 'Stationary points & optimisation', 'Integration & area', 'Kinematics']],
];

const IB_AA_HL_EXTRA: UnitSpec[] = [
  ['Number & Algebra', ['Counting principles', 'Partial fractions', 'Complex numbers', 'Polar & Euler form', 'De Moivre’s theorem', 'Proof by induction & contradiction', 'Systems of linear equations']],
  ['Functions', ['Polynomial factor & remainder theorems', 'Sums & products of roots', 'Odd & even functions', 'Modulus & reciprocal graphs']],
  ['Geometry & Trigonometry', ['Reciprocal & inverse trig functions', 'Compound angle identities', 'Vectors', 'Lines & planes in 3D', 'Scalar & vector product']],
  ['Statistics & Probability', ['Bayes’ theorem', 'Continuous random variables']],
  ['Calculus', ['Continuity & differentiability', 'L’Hôpital’s rule', 'Implicit differentiation', 'Integration by substitution & parts', 'Volumes of revolution', 'Differential equations', 'Maclaurin series']],
];

const IB_AI_SL: UnitSpec[] = [
  ['Number & Algebra', ['Standard form & approximation', 'Sequences & series', 'Financial mathematics', 'Exponents & logarithms', 'Systems of equations']],
  ['Functions', ['Linear models', 'Quadratic & cubic models', 'Exponential models', 'Sinusoidal models', 'Modelling process']],
  ['Geometry & Trigonometry', ['3D geometry', 'Trigonometry & bearings', 'Arcs & sectors', 'Voronoi diagrams']],
  ['Statistics & Probability', ['Data collection & sampling', 'Statistical diagrams', 'Correlation & regression', 'Probability', 'Binomial & normal distributions', 'Chi-squared tests', 'Spearman’s rank']],
  ['Calculus', ['Gradients & derivatives', 'Tangents & normals', 'Optimisation', 'Integration & trapezium rule']],
];

const IB_AI_HL_EXTRA: UnitSpec[] = [
  ['Number & Algebra', ['Complex numbers', 'Matrices', 'Eigenvalues & eigenvectors']],
  ['Functions', ['Logistic & power models', 'Composite & inverse models']],
  ['Geometry & Trigonometry', ['Vectors', 'Graph theory', 'Adjacency matrices & walks', 'Minimum spanning trees', 'Chinese postman & TSP']],
  ['Statistics & Probability', ['Bayes & conditional probability', 'Hypothesis testing', 'Poisson distribution', 'Markov chains', 'Confidence intervals']],
  ['Calculus', ['Further differentiation', 'Integration techniques', 'Volumes of revolution', 'Kinematics', 'Differential equations & slope fields', 'Euler’s method', 'Coupled systems']],
];

const IGCSE_4MA1: UnitSpec[] = [
  ['Number', ['Integers, fractions & decimals', 'Powers & roots', 'Surds', 'Set language & notation', 'Percentages', 'Ratio & proportion', 'Degree of accuracy & bounds', 'Standard form', 'Applying number']],
  ['Algebra', ['Algebraic manipulation', 'Expressions & formulae', 'Linear equations', 'Proportion', 'Simultaneous equations', 'Quadratic equations', 'Inequalities', 'Sequences', 'Function notation & inverses', 'Graphs', 'Calculus (differentiation)']],
  ['Geometry', ['Angles, lines & triangles', 'Polygons', 'Symmetry', 'Measures', 'Constructions', 'Circle properties', 'Geometric reasoning', 'Trigonometry & Pythagoras', 'Mensuration', 'Similarity', 'Vectors', 'Transformations']],
  ['Statistics & Probability', ['Graphical representation of data', 'Statistical measures', 'Probability', 'Tree diagrams & conditional probability']],
];

const CAMBRIDGE_0580: UnitSpec[] = [
  ['Number', ['Types of number', 'Sets', 'Powers & roots', 'Fractions, decimals & percentages', 'Ordering', 'Indices', 'Standard form', 'Estimation & bounds', 'Ratio & proportion', 'Rates', 'Percentages', 'Using a calculator', 'Time', 'Money', 'Exponential growth & decay', 'Surds']],
  ['Algebra & Graphs', ['Introduction to algebra', 'Algebraic manipulation', 'Algebraic fractions', 'Indices', 'Equations', 'Inequalities', 'Sequences', 'Proportion', 'Graphs in practical situations', 'Graphs of functions', 'Sketching curves', 'Differentiation', 'Functions']],
  ['Coordinate Geometry', ['Coordinates', 'Drawing linear graphs', 'Gradient', 'Length & midpoint', 'Equation of a line', 'Parallel & perpendicular lines']],
  ['Geometry', ['Geometrical terms', 'Constructions', 'Scale drawings', 'Similarity', 'Symmetry', 'Angles', 'Circle theorems']],
  ['Mensuration', ['Units of measure', 'Area & perimeter', 'Circles, arcs & sectors', 'Surface area & volume', 'Compound shapes']],
  ['Trigonometry', ['Pythagoras’ theorem', 'Right-angled triangles', 'Exact trig values', 'Trig functions', 'Non-right-angled triangles', '3D Pythagoras & trigonometry']],
  ['Transformations & Vectors', ['Transformations', 'Vectors in 2D', 'Magnitude', 'Vector geometry']],
  ['Probability', ['Introduction to probability', 'Relative & expected frequencies', 'Combined events', 'Conditional probability']],
  ['Statistics', ['Classifying data', 'Interpreting data', 'Averages & range', 'Statistical charts', 'Scatter diagrams', 'Cumulative frequency', 'Histograms']],
];

const CAMBRIDGE_0606: UnitSpec[] = [
  ['Algebra', ['Functions', 'Quadratic functions', 'Factors of polynomials', 'Equations, inequalities & graphs', 'Simultaneous equations', 'Logarithmic & exponential functions']],
  ['Geometry', ['Straight-line graphs', 'Coordinate geometry of the circle', 'Circular measure', 'Trigonometry', 'Vectors in 2D']],
  ['Discrete', ['Permutations & combinations', 'Series & binomial expansion']],
  ['Calculus', ['Differentiation', 'Integration', 'Kinematics']],
];

const AL_PURE: UnitSpec[] = [
  ['Proof', ['Proof by deduction & exhaustion', 'Disproof by counter-example', 'Proof by contradiction']],
  ['Algebra & Functions', ['Indices & surds', 'Quadratics', 'Simultaneous equations', 'Inequalities', 'Polynomials & factor theorem', 'Graphs & transformations', 'Modulus', 'Composite & inverse functions', 'Partial fractions']],
  ['Coordinate Geometry', ['Straight lines', 'Circles', 'Parametric equations']],
  ['Sequences & Series', ['Binomial expansion', 'Arithmetic & geometric series', 'Sigma notation & recurrence']],
  ['Trigonometry', ['Sine & cosine rules', 'Radians, arcs & sectors', 'Small angle approximations', 'Reciprocal & inverse trig', 'Identities & compound angles', 'R-addition form', 'Trig equations']],
  ['Exponentials & Logarithms', ['Exponential functions', 'Laws of logarithms', 'Modelling with exponentials']],
  ['Differentiation', ['First principles', 'Standard derivatives', 'Chain, product & quotient rules', 'Stationary points & concavity', 'Implicit & parametric differentiation', 'Connected rates of change']],
  ['Integration', ['Standard integrals', 'Definite integrals & area', 'Substitution', 'Integration by parts', 'Partial fractions integration', 'Differential equations', 'Trapezium rule']],
  ['Numerical Methods', ['Locating roots', 'Iteration', 'Newton–Raphson']],
  ['Vectors', ['Vectors in 2D & 3D', 'Vector geometry & proof']],
];

const AL_STATS: UnitSpec[] = [
  ['Data', ['Sampling', 'Data presentation & interpretation', 'Measures of location & spread', 'Correlation & regression']],
  ['Probability', ['Venn & tree diagrams', 'Conditional probability', 'Modelling with probability']],
  ['Distributions', ['Binomial distribution', 'Normal distribution', 'Normal approximation to binomial']],
  ['Hypothesis Testing', ['Binomial hypothesis tests', 'Correlation coefficient tests', 'Normal mean tests']],
];

const AL_MECH: UnitSpec[] = [
  ['Kinematics', ['Units & modelling', 'Constant acceleration (suvat)', 'Variable acceleration (calculus)', 'Projectiles']],
  ['Forces', ['Newton’s laws', 'Connected particles & pulleys', 'Resolving forces', 'Friction', 'Inclined planes']],
  ['Moments', ['Moments & equilibrium', 'Ladders & rigid bodies']],
];

export const SYLLABUSES: Syllabus[] = [
  { id: 'ib-aa-sl', name: 'IB Maths AA SL', subject: 'Maths', curriculum: 'IB DP', level: 'AA SL', examBoard: 'IB', units: build('ib-aa', IB_AA_SL) },
  { id: 'ib-aa-hl', name: 'IB Maths AA HL', subject: 'Maths', curriculum: 'IB DP', level: 'AA HL', examBoard: 'IB', units: build('ib-aa', extend(IB_AA_SL, IB_AA_HL_EXTRA)) },
  { id: 'ib-ai-sl', name: 'IB Maths AI SL', subject: 'Maths', curriculum: 'IB DP', level: 'AI SL', examBoard: 'IB', units: build('ib-ai', IB_AI_SL) },
  { id: 'ib-ai-hl', name: 'IB Maths AI HL', subject: 'Maths', curriculum: 'IB DP', level: 'AI HL', examBoard: 'IB', units: build('ib-ai', extend(IB_AI_SL, IB_AI_HL_EXTRA)) },
  { id: 'igcse-4ma1', name: 'IGCSE Maths (Edexcel 4MA1)', subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Pearson Edexcel', units: build('4ma1', IGCSE_4MA1) },
  { id: 'igcse-0580', name: 'IGCSE Maths (Cambridge 0580)', subject: 'Maths', curriculum: 'IGCSE', examBoard: 'Cambridge', units: build('0580', CAMBRIDGE_0580) },
  // Maths at the 'Additional' level, so legacy 0606 students' Maths lessons and reports match their enrolment.
  // It is also offered when a tutor chooses the subject 'Additional Maths'.
  {
    id: 'igcse-0606',
    name: 'IGCSE Additional Maths (0606)',
    subject: 'Maths',
    level: 'Additional',
    curriculum: 'IGCSE',
    examBoard: 'Cambridge',
    units: build('0606', CAMBRIDGE_0606),
  },
  {
    id: 'alevel-maths',
    name: 'A-Level Maths (Pure, Stats, Mechanics)',
    subject: 'Maths',
    curriculum: 'A-Level',
    units: [...build('al-pure', AL_PURE), ...build('al-stats', AL_STATS), ...build('al-mech', AL_MECH)],
  },
];

export function getSyllabus(id: string): Syllabus | undefined {
  return SYLLABUSES.find((s) => s.id === id);
}

const topicIndex = new Map<string, { name: string; unit: string }>();
for (const s of SYLLABUSES) {
  for (const u of s.units) for (const t of u.topics) topicIndex.set(t.id, { name: t.name, unit: u.name });
}

export function topicName(id: string): string {
  return topicIndex.get(id)?.name ?? id;
}

export function topicUnit(id: string): string | undefined {
  return topicIndex.get(id)?.unit;
}

/** Legacy curriculum names stored before subjects arrived, mapped to the catalogue names. */
function normaliseCurriculum(curriculum: string): string {
  const c = curriculum.trim();
  return c.toLowerCase() === 'ib' ? 'IB DP' : c;
}

/** The built-in topic trees for a subject, optionally limited to one curriculum ('IB' counts as 'IB DP'). */
export function builtInSyllabusesFor(subject?: string, curriculum?: string): Syllabus[] {
  const wanted = curriculum?.trim() ? normaliseCurriculum(curriculum).toLowerCase() : undefined;
  return SYLLABUSES.filter(
    (s) =>
      (sameSubject(s.subject, subject) || (s.id === 'igcse-0606' && sameSubject('Additional Maths', subject))) &&
      (!wanted || normaliseCurriculum(s.curriculum).toLowerCase() === wanted),
  );
}

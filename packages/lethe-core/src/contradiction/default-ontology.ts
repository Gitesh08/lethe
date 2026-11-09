/**
 * Default conflict ontology (12 axes) for contradiction detection.
 *
 * CAVEAT: detection is PATTERN-BASED, not semantic. A stance is recognised
 * only when one of its regex patterns matches a sentence. Contradictions that
 * the patterns do not capture are NOT detected. Extend via ontology.json.
 *
 * Patterns are regex source strings compiled later with flag "i" (never g/y)
 * and are written to be ReDoS-safe (no nested quantifiers, bounded alternation).
 *
 * Covers: REQ-CON-1, REQ-CON-5.
 */
import type { Axis } from "../types.js";
import { AXES_A } from "./ontology-axes-a.js";
import { AXES_B } from "./ontology-axes-b.js";

export const DEFAULT_AXES: readonly Axis[] = [...AXES_A, ...AXES_B];

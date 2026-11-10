// Loads .kiro/lethe/ontology.json (zod) and merges it through core's mergeOntology. Refs: Req 10.5
import { DEFAULT_AXES, mergeOntology, ok, type Axis, type Result } from "@lethe/core";
import { z } from "zod";
import type { ToolError } from "../envelope/errors.js";
import type { WorkspaceFs } from "../io/workspace-fs.js";
import { readJsonFile } from "./json-file.js";

export const ONTOLOGY_PATH = ".kiro/lethe/ontology.json";

export const stanceSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    patterns: z.array(z.string()),
    negationAware: z.boolean(),
  })
  .strict();

export const axisSchema = z
  .object({ id: z.string(), description: z.string(), stances: z.array(stanceSchema) })
  .strict();

/** Shape of ontology.json. Regex validity is checked later by core (ONTOLOGY_INVALID_PATTERN). */
export const ontologyFileSchema = z.object({ version: z.literal(1), axes: z.array(axisSchema) }).strict();

export type OntologyFile = z.output<typeof ontologyFileSchema>;

/** Absent file → default axes only. Otherwise default axes merged with the user's. */
export async function loadOntologyFile(fs: WorkspaceFs): Promise<Result<readonly Axis[], ToolError>> {
  const read = await readJsonFile(fs, ONTOLOGY_PATH, ontologyFileSchema);
  if (!read.ok) return read;
  return ok(mergeOntology(DEFAULT_AXES, read.value?.axes));
}

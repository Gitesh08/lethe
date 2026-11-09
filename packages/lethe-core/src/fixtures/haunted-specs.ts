// Three active specs for the haunted repo. Their stances are what makes the protected
// rules win contradictions. Stance ids come from the default ontology. Refs: REQ-SBX-1

import type { SpecInvariant } from "../types.js";

export const HAUNTED_SPEC_NAMES: readonly string[] = ["lethe-core", "lethe-mcp", "lethe-web-sandbox"];

export function hauntedSpecs(): readonly SpecInvariant[] {
  return [
    {
      specName: "lethe-core",
      active: true,
      requirementIds: ["REQ-DEC-1", "REQ-DEC-4", "REQ-CON-3", "REQ-CRY-1", "REQ-PBT-4"],
      stances: ["mod:esm", "err:result-types", "typing:strict-ts"],
    },
    {
      specName: "lethe-mcp",
      active: true,
      requirementIds: ["REQ-MCP-1", "REQ-MCP-3", "REQ-MCP-5"],
      stances: ["mod:esm"],
    },
    {
      specName: "lethe-web-sandbox",
      active: true,
      requirementIds: ["REQ-SBX-1", "REQ-SBX-2", "REQ-UI-1"],
      stances: ["state:signals", "css:pure-css"],
    },
  ];
}

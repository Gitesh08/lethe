export interface CompiledStance { readonly id: string; readonly label: string; readonly negationAware: boolean; readonly regexes: readonly RegExp[] }
export interface CompiledAxis { readonly id: string; readonly description: string; readonly stances: readonly CompiledStance[] }
export type CompiledOntology = readonly CompiledAxis[];

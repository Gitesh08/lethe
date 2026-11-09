import type { Axis } from "../types.js";
import { axis, stance } from "./ontology-helpers.js";

// Patterns are regex SOURCE strings compiled with the "i" flag (no g/y).
// They avoid nested quantifiers and use \b plus bounded alternations (ReDoS-safe).

export const AXES_B: readonly Axis[] = [
  axis("error-handling", "How failures are propagated", [
    stance("err:throw-exceptions", "Throw exceptions", [
      "\\bthrow(?:ing|s)? (?:an? )?(?:errors?|exceptions?)\\b",
      "\\btry/catch\\b",
      "\\bexceptions?\\b",
    ]),
    stance("err:result-types", "Result types", [
      "\\bresult types?\\b",
      "\\bresult<",
      "\\bneverthrow\\b",
      "\\beither (?:type|monad)\\b",
    ]),
  ]),
  axis("typing-strictness", "TypeScript strictness level", [
    stance("typing:strict-ts", "Strict TypeScript", [
      "\\bstrict (?:typescript|mode|typing)\\b",
      "\\bstrict:\\s*true\\b",
      "\\bnoImplicitAny\\b",
      "\\bzero any\\b",
    ]),
    stance("typing:loose-ts", "Loose TypeScript", [
      "\\bloose(?:ly)?[- ]typed\\b",
      "\\bloose typescript\\b",
      "\\ballow any\\b",
      "\\bts-ignore\\b",
      "\\bas any\\b",
      "\\bstrict:\\s*false\\b",
    ]),
  ]),
  axis("component-model", "Default React component boundary", [
    stance("comp:server-components", "Server Components", [
      "\\bserver components?\\b",
      "\\brsc\\b",
      "\\buse server\\b",
    ]),
    stance("comp:client-components", "Client Components", [
      "\\bclient components?\\b",
      "\\buse client\\b",
    ]),
  ]),
  axis("data-fetching", "How remote data is fetched", [
    stance("fetch:react-query", "React Query", ["\\breact[- ]query\\b", "\\btanstack query\\b"]),
    stance("fetch:swr", "SWR", ["\\bswr\\b"]),
    stance("fetch:server-fetch", "Server-side fetch", [
      "\\bserver[- ](?:side )?fetch(?:ing)?\\b",
      "\\bfetch (?:data )?on the server\\b",
      "\\bgetServerSideProps\\b",
    ]),
  ]),
  axis("naming-convention", "File and identifier naming", [
    stance("name:camel-case", "camelCase", ["\\bcamel[- ]?case\\b"]),
    stance("name:kebab-case", "kebab-case", ["\\bkebab[- ]?case\\b"]),
    stance("name:pascal-case", "PascalCase", ["\\bpascal[- ]?case\\b"]),
  ]),
  axis("file-size-policy", "Preferred source file size", [
    stance("size:small-files", "Small files", [
      "\\bsmall(?:er)? (?:files?|modules?)\\b",
      "\\b\\d{2,4} lines per file\\b",
      "\\b\\d{2,4}[- ]line limit\\b",
    ]),
    stance("size:large-files", "Large files", [
      "\\blarge (?:files?|modules?)\\b",
      "\\bmonolithic files?\\b",
      "\\bno (?:file )?size limits?\\b",
      "\\bone big file\\b",
    ]),
  ]),
];

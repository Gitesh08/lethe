import type { Axis } from "../types.js";
import { axis, stance } from "./ontology-helpers.js";

// Patterns are regex SOURCE strings compiled with the "i" flag (no g/y).
// They avoid nested quantifiers and use \b plus bounded alternations (ReDoS-safe).

export const AXES_A: readonly Axis[] = [
  axis("state-management", "How application state is held and shared", [
    stance("state:rxjs-subjects", "RxJS subjects", [
      "\\brxjs\\b",
      "\\b(?:behaviou?r|replay|async)subjects?\\b",
    ]),
    stance("state:signals", "Signals", ["\\bsignals?\\b", "\\bcreateSignal\\b"]),
    stance("state:redux", "Redux / NgRx", ["\\bredux\\b", "\\bngrx\\b"]),
    stance("state:zustand", "Zustand", ["\\bzustand\\b"]),
    stance("state:context", "React Context", [
      "\\breact context\\b",
      "\\bcontext api\\b",
      "\\buseContext\\b",
    ]),
  ]),
  axis("css-approach", "How styles are authored", [
    stance("css:tailwind", "Tailwind", ["\\btailwind(?:css)?\\b", "\\butility[- ]first\\b"]),
    stance("css:pure-css", "Pure CSS", [
      "\\b(?:pure|vanilla|plain) css\\b",
      "\\bhand-?written css\\b",
    ]),
    stance("css:css-in-js", "CSS-in-JS", [
      "\\bcss-in-js\\b",
      "\\bstyled[- ]components\\b",
      "\\bemotion\\b",
    ]),
    stance("css:css-modules", "CSS Modules", ["\\bcss modules?\\b", "\\.module\\.css\\b"]),
  ]),
  axis("framework", "Primary UI framework", [
    stance("fw:react", "React", ["\\breact(?:js|\\.js)?\\b(?! (?:query|context|server|client))"]),
    stance("fw:angular", "Angular", ["\\bangular\\b"]),
    stance("fw:vue", "Vue", ["\\bvue(?:\\.?js)?\\b"]),
    stance("fw:svelte", "Svelte", ["\\bsvelte(?:kit)?\\b"]),
  ]),
  axis("package-manager", "Which package manager the repo uses", [
    stance("pm:npm", "npm", ["\\bnpm\\b", "\\bnpx\\b"]),
    stance("pm:yarn", "Yarn", ["\\byarn\\b"]),
    stance("pm:pnpm", "pnpm", ["\\bpnpm\\b"]),
    stance("pm:bun", "Bun", ["\\bbun\\b"]),
  ]),
  axis("test-runner", "Unit test runner", [
    stance("test:jest", "Jest", ["\\bjest\\b"]),
    stance("test:vitest", "Vitest", ["\\bvitest\\b"]),
    stance("test:mocha", "Mocha", ["\\bmocha\\b"]),
  ]),
  axis("module-system", "JavaScript module format", [
    stance("mod:esm", "ES modules", ["\\besm\\b", "\\bes modules?\\b"]),
    stance("mod:commonjs", "CommonJS", [
      "\\bcommon-?js\\b",
      "\\brequire\\(",
      "\\bmodule\\.exports\\b",
    ]),
  ]),
];

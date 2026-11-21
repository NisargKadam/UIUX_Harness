/** JSON shape of the component catalogue the agent maps UI elements onto. */

export interface PropInfo {
  name: string;
  /** TypeScript type as written/resolved, e.g. `"primary" | "secondary"`, `(value: string) => void`. */
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
  /** For unions of literals: the allowed values, e.g. ["primary", "secondary"]. */
  values?: string[];
}

export interface ComponentInfo {
  name: string;
  /** Workspace-relative file the component is declared in. */
  file: string;
  description?: string;
  /** From a JSDoc @category tag, e.g. "Inputs", "Layout". */
  category?: string;
  props: PropInfo[];
  /** Inherited prop groups from outside the library, e.g. ["ButtonHTMLAttributes"]. */
  inherits: string[];
  acceptsChildren: boolean;
  /** JSDoc @example blocks, verbatim. */
  examples: string[];
}

export interface TokenInfo {
  name: string;
  value: string;
  /** Derived from the name, e.g. "color", "space". */
  group: string;
  file: string;
}

export interface Catalogue {
  source: "indexer" | "storybook";
  generatedAt: string;
  /** Import specifier prototypes use, e.g. "@ds". */
  importFrom: string;
  libraryPath: string;
  components: ComponentInfo[];
  tokens: TokenInfo[];
  warnings: string[];
}

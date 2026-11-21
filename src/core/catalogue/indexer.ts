/**
 * Built-in component catalogue indexer. It scans a component folder with the
 * TypeScript compiler API and produces a JSON catalogue: components, their own
 * props (name, type, required, default, allowed values, JSDoc), and design
 * tokens.
 *
 * Why the compiler API rather than regexes: the props worth knowing are often
 * declared through aliases (`variant: ButtonVariant`), so a literal union like
 * "primary" | "secondary" only shows up after resolving the type.
 *
 * Inherited DOM attributes (`extends ButtonHTMLAttributes<...>`) are summarised
 * by interface name and not expanded. Expanding them would drown the 5 props
 * that matter under 250 that don't.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import type { Catalogue, ComponentInfo, PropInfo, TokenInfo } from "./types";

export interface IndexerOptions {
  workspaceRoot: string;
  /** Workspace-relative component folder. */
  libraryPath: string;
  /** Workspace-relative tokens file or folder (optional). */
  tokensPath?: string;
  importFrom: string;
}

const SOURCE_EXT = /\.(tsx|ts)$/;
const EXCLUDED = /(\.test|\.spec|\.stories|\.story|\.d)\.(tsx|ts)$/;

function walk(dir: string, filter: (file: string) => boolean, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (entry.isFile() && filter(full)) out.push(full);
  }
  return out.sort();
}

function rel(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join("/");
}

function isPascalCase(name: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function jsDocTags(symbol: ts.Symbol, checker: ts.TypeChecker): ts.JSDocTagInfo[] {
  return symbol.getJsDocTags(checker);
}

function tagText(tag: ts.JSDocTagInfo): string {
  return ts.displayPartsToString(tag.text ?? []).trim();
}

/** Does this type look like a React component (callable returning JSX, or an exotic component)? */
function looksLikeComponent(type: ts.Type, checker: ts.TypeChecker, decl: ts.Node): boolean {
  // Without resolvable React types the return type degrades to `any`; in a .tsx
  // file a PascalCase callable is still almost certainly a component.
  const inTsx = decl.getSourceFile().fileName.endsWith(".tsx");
  const text = checker.typeToString(type);
  if (/(ForwardRefExoticComponent|MemoExoticComponent|NamedExoticComponent|FunctionComponent|\bFC<)/.test(text)) {
    return true;
  }
  const sigs = type.getCallSignatures();
  if (sigs.length === 0) return false;
  return sigs.some((sig) => {
    const ret = checker.typeToString(sig.getReturnType());
    const jsxLike = /(JSX\.Element|ReactElement|ReactNode|Element\b|null)/.test(ret) || (inTsx && ret === "any");
    return jsxLike && sig.getParameters().length <= 2;
  });
}

function propsTypeOf(type: ts.Type, decl: ts.Node, checker: ts.TypeChecker): ts.Type | undefined {
  const sig = type.getCallSignatures()[0];
  const param = sig?.getParameters()[0];
  if (!param) return undefined;
  return checker.getTypeOfSymbolAtLocation(param, decl);
}

/** Destructuring defaults: `function Button({ variant = "primary" })`. */
function destructuredDefaults(decl: ts.Node): Map<string, string> {
  const defaults = new Map<string, string>();
  let fn: ts.SignatureDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (fn) return;
    if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      fn = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(decl);
  const first = fn?.parameters[0];
  if (first && ts.isObjectBindingPattern(first.name)) {
    for (const el of first.name.elements) {
      if (el.initializer) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key)) defaults.set(key.text, el.initializer.getText());
      }
    }
  }
  return defaults;
}

/**
 * Literal members of a union type node, in source order, following type aliases
 * (`variant?: ButtonVariant` -> `type ButtonVariant = "a" | "b"`).
 */
function literalValuesFromNode(node: ts.TypeNode | undefined, checker: ts.TypeChecker, depth = 0): string[] | undefined {
  if (!node || depth > 4) return undefined;
  if (ts.isParenthesizedTypeNode(node)) return literalValuesFromNode(node.type, checker, depth + 1);
  if (ts.isTypeReferenceNode(node)) {
    const sym = checker.getSymbolAtLocation(node.typeName);
    const target = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
    const alias = target?.getDeclarations()?.find(ts.isTypeAliasDeclaration);
    return alias ? literalValuesFromNode(alias.type, checker, depth + 1) : undefined;
  }
  if (!ts.isUnionTypeNode(node)) return undefined;
  const values: string[] = [];
  for (const member of node.types) {
    if (ts.isLiteralTypeNode(member)) {
      const lit = member.literal;
      if (ts.isStringLiteral(lit)) values.push(JSON.stringify(lit.text));
      else if (ts.isNumericLiteral(lit)) values.push(lit.text);
      else if (lit.kind === ts.SyntaxKind.NullKeyword) continue;
      else return undefined;
    } else if (member.kind === ts.SyntaxKind.UndefinedKeyword) {
      continue;
    } else {
      const nested = literalValuesFromNode(member, checker, depth + 1);
      if (!nested) return undefined;
      values.push(...nested);
    }
  }
  return values.length > 0 ? [...new Set(values)] : undefined;
}

/** Fallback when there is no type node: the checker's union (its member order is not source order). */
function literalValues(type: ts.Type): string[] | undefined {
  if (!type.isUnion()) return undefined;
  const values: string[] = [];
  for (const t of type.types) {
    if (t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)) continue;
    if (t.isStringLiteral()) values.push(JSON.stringify(t.value));
    else if (t.isNumberLiteral()) values.push(String(t.value));
    else return undefined; // includes boolean (true | false): plain "boolean" reads better
  }
  return values.length > 0 ? [...new Set(values)] : undefined;
}

const GENERIC_DOM_GROUPS = new Set(["AriaAttributes", "DOMAttributes", "HTMLAttributes"]);

/** Keep the most specific inherited groups: drop HTMLAttributes & co. when e.g. ButtonHTMLAttributes is present. */
function summariseInherits(names: Set<string>): string[] {
  const list = [...names];
  const hasSpecific = list.some((n) => /HTMLAttributes$/.test(n) && n !== "HTMLAttributes");
  return list.filter((n) => !(hasSpecific && GENERIC_DOM_GROUPS.has(n)) && !(GENERIC_DOM_GROUPS.has(n) && n !== "HTMLAttributes" && list.includes("HTMLAttributes"))).sort();
}

function typeText(type: ts.Type, checker: ts.TypeChecker, enclosing: ts.Node): string {
  const flags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
    ts.TypeFormatFlags.WriteArrowStyleSignature;
  let text = checker.typeToString(type, enclosing, flags);
  if (/\|\s*undefined$/.test(text)) {
    text = text.replace(/\s*\|\s*undefined$/, "");
    // "(() => void) | undefined" -> "() => void"
    if (/^\(.*\)$/.test(text) && text.includes("=>")) text = text.slice(1, -1);
  }
  if (text === "true | false" || text === "false | true") text = "boolean";
  return text.length > 300 ? `${text.slice(0, 297)}...` : text;
}

function containingInterfaceName(decl: ts.Declaration): string | undefined {
  let node: ts.Node | undefined = decl.parent;
  while (node) {
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) return node.name.text;
    node = node.parent;
  }
  return undefined;
}

function extractProps(
  propsType: ts.Type,
  decl: ts.Node,
  checker: ts.TypeChecker,
  libraryAbs: string,
): { props: PropInfo[]; inherits: string[] } {
  const defaults = destructuredDefaults(decl);
  const props: PropInfo[] = [];
  const inherits = new Set<string>();
  for (const prop of checker.getPropertiesOfType(propsType)) {
    const declarations = prop.getDeclarations() ?? [];
    const ownDecl = declarations.find((d) => path.resolve(d.getSourceFile().fileName).startsWith(libraryAbs));
    if (!ownDecl) {
      const first = declarations[0];
      const owner = first ? containingInterfaceName(first) : undefined;
      if (owner && owner !== "RefAttributes" && owner !== "Attributes") inherits.add(owner);
      continue;
    }
    const type = checker.getTypeOfSymbolAtLocation(prop, ownDecl);
    const optional = (prop.flags & ts.SymbolFlags.Optional) !== 0;
    const description = ts.displayPartsToString(prop.getDocumentationComment(checker)).trim();
    const defaultTag = jsDocTags(prop, checker).find((t) => t.name === "default" || t.name === "defaultValue");
    const info: PropInfo = {
      name: prop.getName(),
      type: typeText(type, checker, ownDecl),
      required: !optional,
    };
    if (description) info.description = description;
    const def = defaults.get(prop.getName()) ?? (defaultTag ? tagText(defaultTag) : undefined);
    if (def !== undefined && def !== "") info.defaultValue = def;
    const typeNode = ts.isPropertySignature(ownDecl) || ts.isPropertyDeclaration(ownDecl) ? ownDecl.type : undefined;
    const values = literalValuesFromNode(typeNode, checker) ?? literalValues(type);
    if (values) info.values = values;
    props.push(info);
  }
  // Required first, then alphabetical: the shape the model reads fastest.
  props.sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name));
  return { props, inherits: summariseInherits(inherits) };
}

function exampleText(tag: ts.JSDocTagInfo): string {
  return tagText(tag)
    .replace(/^```[a-z]*\n?/i, "")
    .replace(/\n?```$/, "")
    .trim();
}

export function indexComponents(opts: IndexerOptions): Catalogue {
  const root = path.resolve(opts.workspaceRoot);
  const libraryAbs = path.resolve(root, opts.libraryPath);
  const warnings: string[] = [];
  const components: ComponentInfo[] = [];

  if (!fs.existsSync(libraryAbs)) {
    warnings.push(`Component folder "${opts.libraryPath}" does not exist.`);
  } else {
    const files = walk(libraryAbs, (f) => SOURCE_EXT.test(f) && !EXCLUDED.test(f));
    const program = ts.createProgram(files, {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowJs: false,
      esModuleInterop: true,
    });
    const checker = program.getTypeChecker();

    // Public surface: the library index's exports when there is one (that is what
    // `import { X } from "@ds"` can reach), otherwise every exported symbol.
    const indexFile = ["index.ts", "index.tsx"].map((f) => path.join(libraryAbs, f)).find((f) => fs.existsSync(f));
    const exported: ts.Symbol[] = [];
    const sourceFiles = indexFile
      ? [program.getSourceFile(indexFile)].filter((sf): sf is ts.SourceFile => !!sf)
      : files.map((f) => program.getSourceFile(f)).filter((sf): sf is ts.SourceFile => !!sf);
    for (const sf of sourceFiles) {
      const moduleSymbol = checker.getSymbolAtLocation(sf);
      if (!moduleSymbol) continue;
      exported.push(...checker.getExportsOfModule(moduleSymbol));
    }

    const seen = new Set<string>();
    for (const exp of exported) {
      const name = exp.getName();
      if (!isPascalCase(name) || seen.has(name)) continue;
      const symbol = exp.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exp) : exp;
      const decl = symbol.valueDeclaration ?? symbol.getDeclarations()?.[0];
      if (!decl) continue;
      if (ts.isInterfaceDeclaration(decl) || ts.isTypeAliasDeclaration(decl)) continue;
      const type = checker.getTypeOfSymbolAtLocation(symbol, decl);
      if (!looksLikeComponent(type, checker, decl)) continue;
      seen.add(name);

      const tags = jsDocTags(symbol, checker);
      const description = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      const propsType = propsTypeOf(type, decl, checker);
      const { props, inherits } = propsType
        ? extractProps(propsType, decl, checker, libraryAbs)
        : { props: [], inherits: [] };
      const category = tags.find((t) => t.name === "category");
      const info: ComponentInfo = {
        name,
        file: rel(root, decl.getSourceFile().fileName),
        props,
        inherits,
        acceptsChildren: props.some((p) => p.name === "children") || inherits.length > 0,
        examples: tags.filter((t) => t.name === "example").map(exampleText).filter(Boolean),
      };
      if (description) info.description = description;
      if (category) info.category = tagText(category);
      components.push(info);
    }
    if (components.length === 0) {
      warnings.push(`No React components found in "${opts.libraryPath}".`);
    }
    components.sort((a, b) => a.name.localeCompare(b.name));
  }

  const tokens = opts.tokensPath ? indexTokens(root, opts.tokensPath, warnings) : [];
  return {
    source: "indexer",
    generatedAt: new Date().toISOString(),
    importFrom: opts.importFrom,
    libraryPath: opts.libraryPath,
    components,
    tokens,
    warnings,
  };
}

// ---------------------------------------------------------------- tokens

function tokenGroup(name: string): string {
  const bare = name.replace(/^--/, "").replace(/^(ds|tk|token)-/, "");
  return bare.split(/[-.]/)[0] ?? "other";
}

function flattenJson(value: unknown, prefix: string, file: string, out: TokenInfo[]): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    // W3C design-token format: { "$value": ... }
    if ("$value" in obj || "value" in obj) {
      const v = obj.$value ?? obj.value;
      if (typeof v === "string" || typeof v === "number") {
        out.push({ name: prefix, value: String(v), group: tokenGroup(prefix), file });
        return;
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith("$")) continue;
      flattenJson(v, prefix ? `${prefix}.${k}` : k, file, out);
    }
  } else if (typeof value === "string" || typeof value === "number") {
    out.push({ name: prefix, value: String(value), group: tokenGroup(prefix), file });
  }
}

function flattenTsObject(node: ts.Expression, prefix: string, file: string, out: TokenInfo[]): void {
  let expr = node;
  while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr)) {
    expr = expr.expression;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) || ts.isNumericLiteral(prop.name) ? prop.name.text : undefined;
      if (key === undefined) continue;
      flattenTsObject(prop.initializer, prefix ? `${prefix}.${key}` : key, file, out);
    }
  } else if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    out.push({ name: prefix, value: expr.text, group: tokenGroup(prefix), file });
  } else if (ts.isNumericLiteral(expr)) {
    out.push({ name: prefix, value: expr.text, group: tokenGroup(prefix), file });
  }
}

export function indexTokens(root: string, tokensPath: string, warnings: string[] = []): TokenInfo[] {
  const abs = path.resolve(root, tokensPath);
  if (!fs.existsSync(abs)) {
    warnings.push(`Tokens path "${tokensPath}" does not exist.`);
    return [];
  }
  const files = fs.statSync(abs).isDirectory() ? walk(abs, (f) => /\.(css|json|ts)$/.test(f) && !f.endsWith(".d.ts")) : [abs];
  const tokens: TokenInfo[] = [];
  for (const file of files) {
    const relFile = rel(root, file);
    const text = fs.readFileSync(file, "utf8");
    if (file.endsWith(".css")) {
      // Custom properties declared anywhere (usually :root / [data-theme]).
      const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+);/g;
      for (const m of text.matchAll(re)) {
        const [, name, value] = m;
        if (name && value) tokens.push({ name, value: value.trim(), group: tokenGroup(name), file: relFile });
      }
    } else if (file.endsWith(".json")) {
      try {
        flattenJson(JSON.parse(text), "", relFile, tokens);
      } catch {
        warnings.push(`Could not parse tokens JSON ${relFile}.`);
      }
    } else {
      const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
      for (const stmt of sf.statements) {
        if (!ts.isVariableStatement(stmt)) continue;
        if (!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer) flattenTsObject(d.initializer, d.name.text, relFile, tokens);
        }
      }
    }
  }
  // De-duplicate by name (first declaration wins, e.g. :root before a dark theme override).
  const byName = new Map<string, TokenInfo>();
  for (const t of tokens) if (!byName.has(t.name)) byName.set(t.name, t);
  return [...byName.values()];
}

// ---------------------------------------------------------------- prompt rendering

/** Compact, model-friendly summary of the catalogue for the system prompt. */
export function formatCatalogueForPrompt(cat: Catalogue): string {
  const lines: string[] = [];
  lines.push(`Import every component from "${cat.importFrom}" (source: ${cat.libraryPath}, indexed by ${cat.source}).`);
  lines.push("");
  for (const c of cat.components) {
    const props = c.props
      .map((p) => {
        let s = p.name + (p.required ? "" : "?");
        if (p.values) s += `: ${p.values.join("|")}`;
        else if (p.type.length <= 40) s += `: ${p.type}`;
        if (p.defaultValue !== undefined) s += ` = ${p.defaultValue}`;
        return s;
      })
      .join("; ");
    const inherits = c.inherits.length ? ` (+ ${c.inherits.join(", ")})` : "";
    const description = (c.description ?? "(no description)").replace(/\s+/g, " ");
    lines.push(`- ${c.name}${c.category ? ` [${c.category}]` : ""}: ${description}`);
    lines.push(`  props: ${props || "(none)"}${inherits}`);
  }
  if (cat.tokens.length) {
    lines.push("");
    lines.push("Design tokens (use these, never raw hex/px values):");
    const groups = new Map<string, string[]>();
    for (const t of cat.tokens) {
      const list = groups.get(t.group) ?? [];
      list.push(`${t.name}`);
      groups.set(t.group, list);
    }
    for (const [group, names] of groups) {
      lines.push(`- ${group}: ${names.join(", ")}`);
    }
  }
  if (cat.warnings.length) {
    lines.push("");
    lines.push(`Indexer warnings: ${cat.warnings.join(" ")}`);
  }
  return lines.join("\n");
}

import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import { SPRING_BEAN_STEREOTYPES } from './spring-bean-stereotypes.js';

const IMPORT_DECLARATION_QUERY = new Parser.Query(Java, '(import_declaration) @import');

interface JavaImports {
  explicitBySimpleName: Map<string, Set<string>>;
  wildcardPackages: Set<string>;
  locallyDeclaredTypeNames: Set<string>;
}

const IMPORTS_BY_TREE = new WeakMap<Parser.Tree, JavaImports>();
const TOP_LEVEL_TYPE_DECLARATIONS = new Set([
  'annotation_type_declaration',
  'class_declaration',
  'enum_declaration',
  'interface_declaration',
  'record_declaration',
]);

function collectJavaImports(tree: Parser.Tree): JavaImports {
  const explicitBySimpleName = new Map<string, Set<string>>();
  const wildcardPackages = new Set<string>();
  const locallyDeclaredTypeNames = new Set<string>();

  for (const child of tree.rootNode.namedChildren) {
    if (!TOP_LEVEL_TYPE_DECLARATIONS.has(child.type)) continue;
    const name = child.childForFieldName('name')?.text.trim();
    if (name) locallyDeclaredTypeNames.add(name);
  }

  for (const match of IMPORT_DECLARATION_QUERY.matches(tree.rootNode)) {
    const importNode = match.captures.find((capture) => capture.name === 'import')?.node;
    if (!importNode) continue;

    // Static imports cannot bring annotation types into scope. Parsing the AST
    // node text keeps this extractor independent from Java's import resolver.
    const parsed = /^import\s+(?!static\s)([A-Za-z0-9_$.]+?)(\.\*)?\s*;$/.exec(
      importNode.text.trim(),
    );
    if (!parsed) continue;

    const importedName = parsed[1];
    if (parsed[2]) {
      wildcardPackages.add(importedName);
      continue;
    }

    const simpleName = importedName.split('.').pop();
    if (!simpleName) continue;
    const imports = explicitBySimpleName.get(simpleName) ?? new Set<string>();
    imports.add(importedName);
    explicitBySimpleName.set(simpleName, imports);
  }

  return { explicitBySimpleName, wildcardPackages, locallyDeclaredTypeNames };
}

function importsFor(tree: Parser.Tree): JavaImports {
  const cached = IMPORTS_BY_TREE.get(tree);
  if (cached) return cached;

  // Class extraction visits each declaration separately. Cache the file-level
  // file-level scan so nested and sibling classes do not rescan the same tree.
  const imports = collectJavaImports(tree);
  IMPORTS_BY_TREE.set(tree, imports);
  return imports;
}

function declarationAnnotations(node: Parser.SyntaxNode): Parser.SyntaxNode[] {
  const modifiers = node.namedChildren.find((child) => child.type === 'modifiers');
  if (!modifiers) return [];
  return modifiers.namedChildren.filter(
    (child) => child.type === 'annotation' || child.type === 'marker_annotation',
  );
}

function resolveSpringStereotype(
  annotation: Parser.SyntaxNode,
  imports: JavaImports,
): string | undefined {
  const annotationName = annotation.childForFieldName('name')?.text.trim();
  if (!annotationName) return undefined;

  // Fully-qualified annotations require an exact allow-list match.
  if (annotationName.includes('.')) {
    return SPRING_BEAN_STEREOTYPES.has(annotationName) ? annotationName : undefined;
  }

  // A type declared in the same compilation unit shadows an on-demand import.
  // Fail closed for explicit-import conflicts too, even though javac rejects them.
  if (imports.locallyDeclaredTypeNames.has(annotationName)) return undefined;

  const explicitImports = imports.explicitBySimpleName.get(annotationName);
  if (explicitImports) {
    // An explicit non-Spring same-name import shadows any Spring wildcard.
    // Ambiguous duplicate imports also fail closed instead of guessing.
    if (explicitImports.size !== 1) return undefined;
    const [explicitImport] = explicitImports;
    return SPRING_BEAN_STEREOTYPES.has(explicitImport) ? explicitImport : undefined;
  }

  const wildcardMatches: string[] = [];
  for (const [fqn, stereotype] of SPRING_BEAN_STEREOTYPES) {
    if (
      fqn.endsWith(`.${annotationName}`) &&
      imports.wildcardPackages.has(stereotype.packageName)
    ) {
      wildcardMatches.push(fqn);
    }
  }
  return wildcardMatches.length === 1 ? wildcardMatches[0] : undefined;
}

/** Return canonical Spring stereotype evidence for one Java class declaration. */
export function extractSpringFrameworkAnnotations(node: Parser.SyntaxNode): string[] | undefined {
  if (node.type !== 'class_declaration') return undefined;

  const imports = importsFor(node.tree);
  const recognized = new Set<string>();
  for (const annotation of declarationAnnotations(node)) {
    const fqn = resolveSpringStereotype(annotation, imports);
    if (fqn) recognized.add(fqn);
  }

  // Choosing one of multiple stereotypes would make downstream metadata
  // dependent on source order, so conflicting evidence is omitted.
  return recognized.size === 1 ? [...recognized] : undefined;
}

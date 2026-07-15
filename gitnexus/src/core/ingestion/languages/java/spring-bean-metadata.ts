import type { ParsedFile, ScopeId } from 'gitnexus-shared';
import type { KnowledgeGraph } from '../../../graph/types.js';
import type { ScopeResolutionIndexes } from '../../model/scope-resolution-indexes.js';
import type { GraphNodeLookup } from '../../scope-resolution/graph-bridge/node-lookup.js';
import { resolveDefGraphId } from '../../scope-resolution/graph-bridge/ids.js';
import { isClassLike, lookupBindingsAt } from '../../scope-resolution/scope/walkers.js';
import { getJavaClassAnnotationFacts } from './capture-side-channel.js';
import { SPRING_BEAN_STEREOTYPES } from './spring-bean-stereotypes.js';

function hasLexicalTypeDeclaration(
  startScope: ScopeId | null,
  simpleName: string,
  indexes: ScopeResolutionIndexes,
): boolean {
  let scopeId = startScope;
  const visited = new Set<ScopeId>();
  while (scopeId !== null && !visited.has(scopeId)) {
    visited.add(scopeId);
    const scope = indexes.scopeTree.getScope(scopeId);
    if (scope === undefined) return false;
    const locals = scope.bindings.get(simpleName);
    if (locals?.some(({ def }) => isClassLike(def.type) || def.type === 'Annotation')) return true;
    scopeId = scope.parent;
  }
  return false;
}

function explicitImportTargets(parsed: ParsedFile, simpleName: string): ReadonlySet<string> {
  const targets = new Set<string>();
  for (const entry of parsed.parsedImports) {
    if (entry.kind !== 'named' && entry.kind !== 'alias') continue;
    if (entry.localName !== simpleName || entry.targetIncludesImportedName !== true) continue;
    targets.add(entry.targetRaw);
  }
  return targets;
}

function hasVisibleTypeBinding(
  startScope: ScopeId | null,
  simpleName: string,
  indexes: ScopeResolutionIndexes,
): boolean {
  let scopeId = startScope;
  const visited = new Set<ScopeId>();
  while (scopeId !== null && !visited.has(scopeId)) {
    visited.add(scopeId);
    const scope = indexes.scopeTree.getScope(scopeId);
    if (scope === undefined) return false;
    const visible = lookupBindingsAt(scopeId, simpleName, indexes);
    if (visible.some(({ def }) => isClassLike(def.type) || def.type === 'Annotation')) return true;
    scopeId = scope.parent;
  }
  return false;
}

function wildcardImportTarget(parsed: ParsedFile, simpleName: string): string | undefined {
  const wildcardPackages = new Set(
    parsed.parsedImports
      .filter((entry) => entry.kind === 'wildcard')
      .map((entry) => entry.targetRaw.replace(/\.\*$/, '')),
  );
  // Without classpath data, another on-demand import may expose the same
  // simple name. Only a single wildcard package is unambiguous here.
  if (wildcardPackages.size !== 1) return undefined;
  const [packageName] = wildcardPackages;
  const target = `${packageName}.${simpleName}`;
  return SPRING_BEAN_STEREOTYPES.has(target) ? target : undefined;
}

function resolveSpringAnnotation(
  rawName: string,
  parsed: ParsedFile,
  enclosingScope: ScopeId | null,
  indexes: ScopeResolutionIndexes,
): string | undefined {
  if (rawName.includes('.')) {
    return SPRING_BEAN_STEREOTYPES.has(rawName) ? rawName : undefined;
  }

  if (hasLexicalTypeDeclaration(enclosingScope, rawName, indexes)) return undefined;

  // External Spring classes are normally outside the indexed repository, so
  // finalized bindings may remain unresolved. ParsedImport retains the exact
  // source while the resolved scope chain above supplies Java shadowing rules.
  const explicitImports = explicitImportTargets(parsed, rawName);
  if (explicitImports.size > 0) {
    if (explicitImports.size !== 1) return undefined;
    const [imported] = explicitImports;
    return SPRING_BEAN_STEREOTYPES.has(imported) ? imported : undefined;
  }

  const wildcardTarget = wildcardImportTarget(parsed, rawName);
  if (wildcardTarget === undefined) return undefined;

  // Same-package types and resolved wildcard imports are available only after
  // finalize/populateNamespaceSiblings. Any such binding wins over guessing
  // that an unresolved external Spring wildcard supplied the annotation.
  return hasVisibleTypeBinding(enclosingScope, rawName, indexes) ? undefined : wildcardTarget;
}

/** Attach Spring stereotype evidence after Java cross-file resolution is complete. */
export function attachSpringBeanCandidateMetadata(
  graph: KnowledgeGraph,
  parsedFiles: readonly ParsedFile[],
  nodeLookup: GraphNodeLookup,
  indexes: ScopeResolutionIndexes,
): void {
  for (const parsed of parsedFiles) {
    for (const fact of getJavaClassAnnotationFacts(parsed.filePath)) {
      const classScope = indexes.scopeTree.getScope(fact.classScopeId);
      if (classScope === undefined || classScope.kind !== 'Class') continue;
      const classDef = classScope.ownedDefs.find((def) => def.type === 'Class');
      if (classDef === undefined) continue;

      const graphId = resolveDefGraphId(parsed.filePath, classDef, nodeLookup);
      if (graphId === undefined) continue;
      const classNode = graph.getNode(graphId);
      if (classNode === undefined || classNode.label !== 'Class') continue;

      const recognized = new Set<string>();
      for (const rawName of fact.annotationNames) {
        const annotation = resolveSpringAnnotation(rawName, parsed, classScope.parent, indexes);
        if (annotation !== undefined) recognized.add(annotation);
      }

      // Conflicting stereotypes are omitted instead of making source order
      // decide which Bean role downstream MCP responses expose.
      if (recognized.size === 1) {
        classNode.properties.frameworkAnnotations = [...recognized];
      }
    }
  }
}

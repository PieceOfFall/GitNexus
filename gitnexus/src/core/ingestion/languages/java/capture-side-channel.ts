import type { ParsedFile, ScopeId } from 'gitnexus-shared';

export interface JavaClassAnnotationFact {
  readonly classScopeId: ScopeId;
  readonly annotationNames: readonly string[];
}

export interface JavaCaptureSideChannel {
  readonly kind: 'java';
  readonly classAnnotations: readonly JavaClassAnnotationFact[];
}

const classAnnotationsByFile = new Map<string, readonly JavaClassAnnotationFact[]>();

/** Store the annotation syntax collected by Java's existing scope-query traversal. */
export function setJavaClassAnnotationFacts(
  filePath: string,
  facts: readonly JavaClassAnnotationFact[],
): void {
  if (facts.length === 0) {
    classAnnotationsByFile.delete(filePath);
    return;
  }
  classAnnotationsByFile.set(filePath, facts);
}

/** Snapshot worker-local Java annotation facts for ParsedFile serialization. */
export function collectJavaCaptureSideChannel(
  filePath: string,
): JavaCaptureSideChannel | undefined {
  const classAnnotations = classAnnotationsByFile.get(filePath);
  if (classAnnotations === undefined) return undefined;
  return { kind: 'java', classAnnotations };
}

export function getJavaClassAnnotationFacts(filePath: string): readonly JavaClassAnnotationFact[] {
  return classAnnotationsByFile.get(filePath) ?? [];
}

/** Restore worker-collected facts before Java's post-resolution hook runs. */
export function applyJavaCaptureSideChannel(parsed: ParsedFile): void {
  const data = parsed.captureSideChannel as JavaCaptureSideChannel | undefined;
  if (
    data === undefined ||
    data === null ||
    typeof data !== 'object' ||
    data.kind !== 'java' ||
    !Array.isArray(data.classAnnotations)
  ) {
    setJavaClassAnnotationFacts(parsed.filePath, []);
    return;
  }
  setJavaClassAnnotationFacts(parsed.filePath, data.classAnnotations);
}

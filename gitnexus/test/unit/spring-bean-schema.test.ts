import { describe, expect, it } from 'vitest';
import { CLASS_SCHEMA } from '../../src/core/lbug/schema.js';
import { getCopyQuery } from '../../src/core/lbug/lbug-adapter.js';
import { PARSE_CACHE_VERSION } from '../../src/storage/parse-cache.js';
import { INCREMENTAL_SCHEMA_VERSION } from '../../src/storage/repo-manager.js';
import { isSpringBeanCandidateSourceFile } from '../../src/core/ingestion/frameworks/spring/bean-catalog.js';

describe('Spring Bean Class persistence schema', () => {
  it('keeps the Class DDL and bulk COPY column order aligned', () => {
    expect(CLASS_SCHEMA).toContain('frameworkAnnotations STRING[]');

    expect(getCopyQuery('Class', '/tmp/class.csv')).toContain(
      '(id, name, filePath, startLine, endLine, isExported, content, description, frameworkAnnotations)',
    );
  });

  it('invalidates parse and incremental caches that predate Bean metadata', () => {
    expect(PARSE_CACHE_VERSION).toMatch(/^14\+/);
    expect(INCREMENTAL_SCHEMA_VERSION).toBe(8);
  });

  it('limits incremental drift queries to Java and Kotlin Bean source files', () => {
    expect(isSpringBeanCandidateSourceFile('src/App.java')).toBe(true);
    expect(isSpringBeanCandidateSourceFile('src/App.kt')).toBe(true);
    expect(isSpringBeanCandidateSourceFile('build.gradle.kts')).toBe(true);
    expect(isSpringBeanCandidateSourceFile('src/app.ts')).toBe(false);
  });
});

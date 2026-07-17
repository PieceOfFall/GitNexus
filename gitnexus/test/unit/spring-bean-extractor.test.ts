import type { ParsedFile, ScopeResolutionIndexes } from 'gitnexus-shared';
import { describe, expect, it } from 'vitest';
import {
  collectJavaCaptureSideChannel,
  type JavaCaptureSideChannel,
} from '../../src/core/ingestion/languages/java/capture-side-channel.js';
import { emitJavaScopeCaptures } from '../../src/core/ingestion/languages/java/captures.js';
import {
  isJavaPackageSiblingVisibilityCapped,
  populateJavaPackageSiblings,
} from '../../src/core/ingestion/languages/java/package-siblings.js';
import { getJavaParser } from '../../src/core/ingestion/languages/java/query.js';
import { javaScopeResolver } from '../../src/core/ingestion/languages/java/scope-resolver.js';
import { deriveSpringBeanMetadata } from '../../src/core/ingestion/languages/java/spring-bean-stereotypes.js';

function captureClassAnnotations(code: string): JavaCaptureSideChannel['classAnnotations'] {
  const filePath = 'src/Test.java';
  emitJavaScopeCaptures(code, filePath);
  return collectJavaCaptureSideChannel(filePath)?.classAnnotations ?? [];
}

describe('Java class annotation capture', () => {
  it('collects annotation names during the existing scope-query traversal', () => {
    const facts = captureClassAnnotations(`
      @Component("widget") class Widget {
        @Deprecated @Service static class BillingService {}
      }
      @org.springframework.context.annotation.Configuration class AppConfiguration {}

      @Service interface ServiceContract {}
      @Service enum ServiceState { READY }
      @Service record ServiceRecord(String value) {}
      @Service @interface ServiceMarker {}
    `);

    expect(facts.map((fact) => fact.annotationNames)).toEqual([
      ['Component'],
      ['Deprecated', 'Service'],
      ['org.springframework.context.annotation.Configuration'],
    ]);
  });

  it('clears worker side-channel facts at the start of each workspace pass', async () => {
    const filePath = 'src/Stale.java';
    emitJavaScopeCaptures('@Service class Stale {}', filePath);
    expect(collectJavaCaptureSideChannel(filePath)?.classAnnotations).toHaveLength(1);

    await javaScopeResolver.loadResolutionConfig?.('/tmp/repo');

    expect(collectJavaCaptureSideChannel(filePath)).toBeUndefined();
  });

  it('records files whose same-package visibility was disabled by the package cap', () => {
    const source = 'package com.capped;\nclass Placeholder {}';
    const tree = getJavaParser().parse(source);
    const parsedFiles = Array.from({ length: 501 }, (_, index) => {
      const filePath = `src/com/capped/Type${index}.java`;
      return {
        filePath,
        scopes: [{ id: `module:${index}`, kind: 'Module' }],
      } as unknown as ParsedFile;
    });
    const fileContents = new Map(parsedFiles.map((parsed) => [parsed.filePath, source]));
    const indexes = {
      bindingAugmentations: new Map(),
    } as unknown as ScopeResolutionIndexes;

    populateJavaPackageSiblings(parsedFiles, indexes, {
      fileContents,
      treeCache: { get: () => tree },
    });

    expect(isJavaPackageSiblingVisibilityCapped(parsedFiles[0].filePath)).toBe(true);
    expect(isJavaPackageSiblingVisibilityCapped('src/other/Uncapped.java')).toBe(false);
  });
});

describe('deriveSpringBeanMetadata', () => {
  it('maps all supported canonical stereotypes to roles', () => {
    const cases = [
      ['org.springframework.stereotype.Component', 'component'],
      ['org.springframework.stereotype.Service', 'service'],
      ['org.springframework.stereotype.Repository', 'repository'],
      ['org.springframework.stereotype.Controller', 'controller'],
      ['org.springframework.web.bind.annotation.RestController', 'rest-controller'],
      ['org.springframework.context.annotation.Configuration', 'configuration'],
    ] as const;

    for (const [annotation, role] of cases) {
      expect(deriveSpringBeanMetadata([annotation])).toEqual({
        framework: 'spring',
        role,
        annotation,
      });
    }
  });

  it('omits conflicting or unsupported evidence', () => {
    expect(
      deriveSpringBeanMetadata([
        'org.springframework.stereotype.Service',
        'org.springframework.stereotype.Component',
      ]),
    ).toBeUndefined();
    expect(deriveSpringBeanMetadata(['com.example.Service'])).toBeUndefined();
  });
});

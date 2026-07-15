import { describe, expect, it } from 'vitest';
import {
  collectJavaCaptureSideChannel,
  type JavaCaptureSideChannel,
} from '../../src/core/ingestion/languages/java/capture-side-channel.js';
import { emitJavaScopeCaptures } from '../../src/core/ingestion/languages/java/captures.js';
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

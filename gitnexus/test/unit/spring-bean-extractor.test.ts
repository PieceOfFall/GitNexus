import { describe, expect, it } from 'vitest';
import Parser from 'tree-sitter';
import Java from 'tree-sitter-java';
import { SupportedLanguages } from 'gitnexus-shared';
import { createClassExtractor } from '../../src/core/ingestion/class-extractors/generic.js';
import { javaProvider } from '../../src/core/ingestion/languages/java.js';
import { extractSpringFrameworkAnnotations } from '../../src/core/ingestion/languages/java/spring-bean-metadata.js';
import { deriveSpringBeanMetadata } from '../../src/core/ingestion/languages/java/spring-bean-stereotypes.js';

const CLASS_QUERY = new Parser.Query(Java, '(class_declaration) @class');
const TYPE_QUERY = new Parser.Query(
  Java,
  `[
    (class_declaration)
    (interface_declaration)
    (enum_declaration)
    (record_declaration)
    (annotation_type_declaration)
  ] @type`,
);

function parse(code: string): Parser.Tree {
  const parser = new Parser();
  parser.setLanguage(Java);
  return parser.parse(code);
}

function queryNodes(tree: Parser.Tree, query: Parser.Query): Parser.SyntaxNode[] {
  return query.matches(tree.rootNode).flatMap((match) => match.captures.map(({ node }) => node));
}

function extractClasses(code: string): Array<string[] | undefined> {
  const tree = parse(code);
  return queryNodes(tree, CLASS_QUERY).map(extractSpringFrameworkAnnotations);
}

describe('extractSpringFrameworkAnnotations', () => {
  it('recognizes all supported stereotypes through explicit imports and FQNs', () => {
    const annotations = extractClasses(`
      import org.springframework.stereotype.Component;
      import org.springframework.stereotype.Service;
      import org.springframework.stereotype.Repository;
      import org.springframework.stereotype.Controller;
      import org.springframework.web.bind.annotation.RestController;

      @Component("widget") class Widget {}
      @Service class BillingService {}
      @Repository class WidgetRepository {}
      @Controller class PageController {}
      @RestController class ApiController {}
      @org.springframework.context.annotation.Configuration class AppConfiguration {}
    `);

    expect(annotations).toEqual([
      ['org.springframework.stereotype.Component'],
      ['org.springframework.stereotype.Service'],
      ['org.springframework.stereotype.Repository'],
      ['org.springframework.stereotype.Controller'],
      ['org.springframework.web.bind.annotation.RestController'],
      ['org.springframework.context.annotation.Configuration'],
    ]);
    expect(annotations.map((value) => deriveSpringBeanMetadata(value ?? [])?.role)).toEqual([
      'component',
      'service',
      'repository',
      'controller',
      'rest-controller',
      'configuration',
    ]);
  });

  it('extracts nested and sibling classes independently', () => {
    expect(
      extractClasses(`
        import org.springframework.stereotype.Component;
        import org.springframework.stereotype.Service;

        @Component class Outer {
          @Service static class Inner {}
        }
        @Component class Sibling {}
      `),
    ).toEqual([
      ['org.springframework.stereotype.Component'],
      ['org.springframework.stereotype.Service'],
      ['org.springframework.stereotype.Component'],
    ]);
  });

  it('ignores wildcard-only stereotypes but honors an explicit import alongside a wildcard', () => {
    expect(
      extractClasses(`
        import org.springframework.stereotype.*;
        @Service class WildcardOnlyService {}
      `),
    ).toEqual([undefined]);

    expect(
      extractClasses(`
        import org.springframework.stereotype.*;
        import org.springframework.stereotype.Service;
        @Service class ExplicitlyImportedService {}
      `),
    ).toEqual([['org.springframework.stereotype.Service']]);
  });

  it('fails closed for unresolved, shadowed, composed, and conflicting annotations', () => {
    expect(
      extractClasses(`
        import org.springframework.stereotype.*;
        import com.acme.Service;

        @Service class ShadowedService {}
        @UnimportedService class UnresolvedService {}

        @org.springframework.stereotype.Service
        @interface DomainService {}
        @DomainService class ComposedService {}

        @org.springframework.stereotype.Service
        @org.springframework.stereotype.Component
        class ConflictingBean {}
      `),
    ).toEqual([undefined, undefined, undefined, undefined]);
    expect(extractClasses('@Service class CustomService {}')).toEqual([undefined]);
    expect(
      extractClasses(`
        import org.springframework.stereotype.Service;

        @interface Service {}
        @Service class LocallyShadowedService {}
      `),
    ).toEqual([undefined]);
    expect(
      extractClasses(`
        import org.springframework.stereotype.Service;

        class Outer {
          @interface Service {}
          @Service class MemberShadowedService {}
        }
      `),
    ).toEqual([undefined, undefined]);
  });

  it('ignores non-class declarations and allows unrelated annotations', () => {
    const tree = parse(`
      import org.springframework.stereotype.Service;

      @Service interface ServiceContract {}
      @Service enum ServiceState { READY }
      @Service record ServiceRecord(String value) {}
      @Service @interface ServiceMarker {}

      @Deprecated
      @Service("named")
      class ValidService {}
    `);

    expect(queryNodes(tree, TYPE_QUERY).map(extractSpringFrameworkAnnotations)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      ['org.springframework.stereotype.Service'],
    ]);
  });

  it('keeps the generic Class extractor unchanged when no hook is registered', () => {
    const [classNode] = queryNodes(
      parse(`
        import org.springframework.stereotype.Service;
        @Service class BillingService {}
      `),
      CLASS_QUERY,
    );
    const genericExtractor = createClassExtractor({
      language: SupportedLanguages.TypeScript,
      typeDeclarationNodes: ['class_declaration'],
    });

    expect(javaProvider.classExtractor?.extract(classNode)?.frameworkAnnotations).toEqual([
      'org.springframework.stereotype.Service',
    ]);
    expect(genericExtractor.extract(classNode)).not.toHaveProperty('frameworkAnnotations');
  });
});

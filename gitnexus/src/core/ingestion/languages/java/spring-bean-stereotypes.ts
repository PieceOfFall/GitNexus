export interface SpringBeanMetadata {
  framework: 'spring';
  role: string;
  annotation: string;
}

export interface SpringBeanStereotype {
  role: string;
  packageName: string;
}

export const SPRING_BEAN_STEREOTYPES = new Map<string, SpringBeanStereotype>([
  [
    'org.springframework.stereotype.Component',
    { role: 'component', packageName: 'org.springframework.stereotype' },
  ],
  [
    'org.springframework.stereotype.Service',
    { role: 'service', packageName: 'org.springframework.stereotype' },
  ],
  [
    'org.springframework.stereotype.Repository',
    { role: 'repository', packageName: 'org.springframework.stereotype' },
  ],
  [
    'org.springframework.stereotype.Controller',
    { role: 'controller', packageName: 'org.springframework.stereotype' },
  ],
  [
    'org.springframework.web.bind.annotation.RestController',
    { role: 'rest-controller', packageName: 'org.springframework.web.bind.annotation' },
  ],
  [
    'org.springframework.context.annotation.Configuration',
    { role: 'configuration', packageName: 'org.springframework.context.annotation' },
  ],
]);

export function deriveSpringBeanMetadata(
  frameworkAnnotations: readonly string[],
): SpringBeanMetadata | undefined {
  const recognized = [
    ...new Set(
      frameworkAnnotations.filter((annotation) => SPRING_BEAN_STEREOTYPES.has(annotation)),
    ),
  ];
  if (recognized.length !== 1) return undefined;

  const annotation = recognized[0];
  const stereotype = SPRING_BEAN_STEREOTYPES.get(annotation);
  if (!stereotype) return undefined;

  return { framework: 'spring', role: stereotype.role, annotation };
}

import type { z } from 'zod';

import { EVENT_TYPE_MAP } from '@proofmesh/contracts';

export class UnsupportedEventTypeError extends Error {
  constructor(public readonly eventType: string) {
    super(`Unsupported event type: '${eventType}'`);
    this.name = 'UnsupportedEventTypeError';
  }
}

export class UnsupportedSchemaVersionError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly requestedVersion: string,
    public readonly supportedVersions: string[]
  ) {
    super(
      `Unsupported schema version '${requestedVersion}' for event type '${eventType}'. Supported versions: [${supportedVersions.join(', ')}]`
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

export class SchemaValidationError extends Error {
  constructor(
    public readonly eventType: string,
    public readonly version: string,
    public readonly validationErrors: string[]
  ) {
    super(
      `Schema validation failed for '${eventType}' (version ${version}): ${validationErrors.join('; ')}`
    );
    this.name = 'SchemaValidationError';
  }
}

export interface SchemaRegistration {
  schema: z.ZodTypeAny;
  deprecated: boolean;
  sunsetDate?: string;
  majorVersion: number;
}

export class EventSchemaRegistry {
  private static instance: EventSchemaRegistry | null = null;
  private readonly registry = new Map<string, Map<string, SchemaRegistration>>();

  constructor() {
    this.registerBuiltInSchemas();
  }

  public static getInstance(): EventSchemaRegistry {
    if (!EventSchemaRegistry.instance) {
      EventSchemaRegistry.instance = new EventSchemaRegistry();
    }
    return EventSchemaRegistry.instance;
  }

  private registerBuiltInSchemas(): void {
    // Register all default event families at v1 (version 1.0.0)
    for (const [eventType, schema] of Object.entries(EVENT_TYPE_MAP)) {
      this.register(eventType, 'v1', schema);
      this.register(eventType, '1.0.0', schema);
      this.register(eventType, '1.0', schema);
    }
  }

  public register(
    eventType: string,
    version: string,
    schema: z.ZodTypeAny,
    options?: { deprecated?: boolean; sunsetDate?: string }
  ): void {
    let versionMap = this.registry.get(eventType);
    if (!versionMap) {
      versionMap = new Map();
      this.registry.set(eventType, versionMap);
    }

    const major = this.parseMajorVersion(version);
    versionMap.set(version, {
      schema,
      deprecated: options?.deprecated ?? false,
      sunsetDate: options?.sunsetDate,
      majorVersion: major
    });
  }

  public markDeprecated(eventType: string, version: string, sunsetDate: string): void {
    const versionMap = this.registry.get(eventType);
    const entry = versionMap?.get(version);
    if (!entry) {
      throw new UnsupportedSchemaVersionError(
        eventType,
        version,
        this.getSupportedVersions(eventType)
      );
    }
    entry.deprecated = true;
    entry.sunsetDate = sunsetDate;
  }

  public getSupportedVersions(eventType: string): string[] {
    const versionMap = this.registry.get(eventType);
    if (!versionMap) return [];
    return Array.from(versionMap.keys());
  }

  public isSupported(eventType: string, version?: string): boolean {
    const versionMap = this.registry.get(eventType);
    if (!versionMap) return false;
    if (!version) return versionMap.size > 0;
    return versionMap.has(version);
  }

  public isDeprecated(
    eventType: string,
    version: string
  ): { deprecated: boolean; sunsetDate?: string } {
    const versionMap = this.registry.get(eventType);
    const entry = versionMap?.get(version);
    if (!entry) {
      return { deprecated: false };
    }
    return {
      deprecated: entry.deprecated,
      sunsetDate: entry.sunsetDate
    };
  }

  public validate(
    eventType: string,
    version: string,
    data: unknown
  ):
    | { success: true; data: unknown }
    | {
        success: false;
        errors: string[];
        errorType: 'unsupported_type' | 'unsupported_version' | 'validation_failed';
      } {
    const versionMap = this.registry.get(eventType);
    if (!versionMap) {
      return {
        success: false,
        errors: [`Unknown or unsupported event type: '${eventType}'`],
        errorType: 'unsupported_type'
      };
    }

    // Attempt exact version match, or match by major prefix (e.g. 'v1' vs '1.0.0')
    let registration = versionMap.get(version);
    if (!registration) {
      // Try resolving 'v' + major
      const major = this.parseMajorVersion(version);
      registration = versionMap.get(`v${major}`) ?? versionMap.get(`${major}.0.0`);
    }

    if (!registration) {
      return {
        success: false,
        errors: [
          `Schema version '${version}' is not supported for event type '${eventType}'. Supported versions: [${Array.from(versionMap.keys()).join(', ')}]`
        ],
        errorType: 'unsupported_version'
      };
    }

    const parseResult = registration.schema.safeParse(data);
    if (!parseResult.success) {
      const formattedErrors = parseResult.error.errors.map(
        (e) => `${e.path.join('.') || 'root'}: ${e.message}`
      );
      return {
        success: false,
        errors: formattedErrors,
        errorType: 'validation_failed'
      };
    }

    return {
      success: true,
      data: parseResult.data
    };
  }

  public parseMajorVersion(version: string): number {
    const cleaned = version.replace(/^v/, '');
    const majorPart = cleaned.split('.')[0];
    const parsed = parseInt(majorPart ?? '1', 10);
    return isNaN(parsed) ? 1 : parsed;
  }
}

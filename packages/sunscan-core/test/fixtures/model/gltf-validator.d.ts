// Minimal typings for the Khronos glTF validator (npm 'gltf-validator', no bundled types). Test-only.
declare module 'gltf-validator' {
  export interface ValidationMessage { code: string; message: string; severity: number; pointer?: string; offset?: number }
  export interface ValidationReport {
    issues: { numErrors: number; numWarnings: number; numInfos: number; numHints: number; messages: ValidationMessage[]; truncated: boolean };
    info?: Record<string, unknown>;
  }
  export interface ValidationOptions { uri?: string; format?: 'glb' | 'gltf'; maxIssues?: number; ignoredIssues?: string[]; severityOverrides?: Record<string, number> }
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<ValidationReport>;
  export function validateString(json: string, options?: ValidationOptions): Promise<ValidationReport>;
  export function version(): string;
  const validator: { validateBytes: typeof validateBytes; validateString: typeof validateString; version: typeof version };
  export default validator;
}

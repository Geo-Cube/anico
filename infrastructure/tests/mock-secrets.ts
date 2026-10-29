import * as pulumi from '@pulumi/pulumi';

// Inspect only fake test data; return the original inputs as mock resource state
// so Pulumi secret propagation remains testable.
export function unwrapMockSecrets(value: any): any {
  if (pulumi.runtime.isRpcSecret(value)) return unwrapMockSecrets(value.value);
  if (Array.isArray(value)) return value.map(unwrapMockSecrets);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        unwrapMockSecrets(item),
      ]),
    );
  return value;
}

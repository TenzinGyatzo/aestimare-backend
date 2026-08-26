/** Claves que nunca deben persistirse en payload de auditoría. */
const SENSITIVE_KEY =
  /password|secret|token|jwt|hash|authorization|cookie|emailpass|clabe|cuenta/i;

export function sanitizeAuditPayload(
  input?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!input) return undefined;
  const out = sanitizeValue(input);
  if (!out || typeof out !== 'object' || Array.isArray(out)) {
    return undefined;
  }
  return out as Record<string, unknown>;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeValue(nested);
    }
    return out;
  }
  return value;
}

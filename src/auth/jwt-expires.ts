export const JWT_DEFAULT_EXPIRES_IN = '8h';

export function resolveJwtExpiresIn(
  configured?: string | null,
): string {
  const value = configured?.trim();
  return value || JWT_DEFAULT_EXPIRES_IN;
}

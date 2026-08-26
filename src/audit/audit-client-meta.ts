export type AuditClientMeta = {
  ip?: string;
  userAgent?: string;
};

export type AuditActor = {
  _id?: string;
  email?: string;
  nombre?: string;
  rol?: string;
  tenantId?: string;
};

type RequestLike = {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, unknown>;
};

/** IP / User-Agent solo para eventos de autenticación. */
export function clientMetaFromRequest(req?: RequestLike): AuditClientMeta {
  if (!req) return {};
  const forwarded = req.headers?.['x-forwarded-for'];
  const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ipFromForward =
    typeof forwardedStr === 'string'
      ? forwardedStr.split(',')[0]?.trim()
      : undefined;
  const ip = ipFromForward || req.ip || req.socket?.remoteAddress;
  const uaRaw = req.headers?.['user-agent'];
  const userAgent = Array.isArray(uaRaw)
    ? uaRaw[0]
    : typeof uaRaw === 'string'
      ? uaRaw
      : undefined;
  return {
    ip: ip ? String(ip).slice(0, 64) : undefined,
    userAgent: userAgent ? String(userAgent).slice(0, 256) : undefined,
  };
}

export function actorSnapshotFromUser(user?: AuditActor | null) {
  if (!user) return {};
  const snapshot: { email?: string; nombre?: string; rol?: string } = {};
  if (user.email) snapshot.email = user.email;
  if (user.nombre) snapshot.nombre = user.nombre;
  if (user.rol) snapshot.rol = user.rol;
  return snapshot;
}

export function actorIdFromUser(user?: AuditActor | null): string | undefined {
  if (!user?._id) return undefined;
  return String(user._id);
}

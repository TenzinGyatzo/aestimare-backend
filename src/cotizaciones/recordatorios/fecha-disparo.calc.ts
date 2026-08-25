import { DateTime, DurationLike } from 'luxon';

/** Fallback IANA si tenant_configs.zonaHoraria falta (AD-30). */
export const DEFAULT_TENANT_ZONE = 'America/Mexico_City';

/**
 * Hora UTC del disparo sobre el día civil del tenant.
 * 14:00 UTC = 08:00 en UTC-6 (CDMX) = 07:00 en UTC-7 (Pacífico en verano).
 */
export const HORA_DISPARO_UTC = 14;

export const FAMILIAS_RECETA = [
  'relativo_hoy',
  'relativo_aniversario',
  'fecha_exacta',
] as const;
export type FamiliaReceta = (typeof FAMILIAS_RECETA)[number];

export const PRESETS_RELATIVO_HOY = [
  '1_mes',
  '3_meses',
  '6_meses',
  '11_meses',
  '1_ano',
  '2_anos',
] as const;
export type PresetRelativoHoy = (typeof PRESETS_RELATIVO_HOY)[number];

export const PRESETS_RELATIVO_ANIVERSARIO = [
  '2_semanas_antes',
  '1_mes_antes',
  '2_meses_antes',
] as const;
export type PresetRelativoAniversario =
  (typeof PRESETS_RELATIVO_ANIVERSARIO)[number];

export const ESTADOS_RECORDATORIO = [
  'programado',
  'disparado',
  'cancelado',
  'cerrado',
] as const;
export type EstadoRecordatorio = (typeof ESTADOS_RECORDATORIO)[number];

export type RecetaInput = {
  familia: FamiliaReceta;
  preset?: string;
  fechaExacta?: string | Date;
};

export type CalcFechaDisparoOk = { ok: true; fechaDisparoUtc: Date };
export type CalcFechaDisparoErr = {
  ok: false;
  code: 'invalid_receta' | 'not_future';
  message: string;
};
export type CalcFechaDisparoResult = CalcFechaDisparoOk | CalcFechaDisparoErr;

const HOY_DURATIONS: Record<PresetRelativoHoy, DurationLike> = {
  '1_mes': { months: 1 },
  '3_meses': { months: 3 },
  '6_meses': { months: 6 },
  '11_meses': { months: 11 },
  '1_ano': { years: 1 },
  '2_anos': { years: 2 },
};

const ANIV_OFFSETS: Record<PresetRelativoAniversario, DurationLike> = {
  '2_semanas_antes': { weeks: 2 },
  '1_mes_antes': { months: 1 },
  '2_meses_antes': { months: 2 },
};

export function resolveTenantZone(zonaHoraria?: string | null): string {
  if (typeof zonaHoraria === 'string' && zonaHoraria.trim()) {
    return zonaHoraria.trim();
  }
  return DEFAULT_TENANT_ZONE;
}

/**
 * Día civil en zona del tenant → 14:00 UTC de esa misma fecha (HORA_DISPARO_UTC).
 */
export function atHoraDisparoUtc(civilDayInTenantZone: DateTime): DateTime {
  return DateTime.fromObject(
    {
      year: civilDayInTenantZone.year,
      month: civilDayInTenantZone.month,
      day: civilDayInTenantZone.day,
      hour: HORA_DISPARO_UTC,
      minute: 0,
      second: 0,
      millisecond: 0,
    },
    { zone: 'utc' },
  );
}

/**
 * Calcula fechaDisparoUtc desde receta + Reloj del tenant.
 *
 * Convención (cron-stable): día civil en zona del tenant, disparo a las 14:00 UTC.
 * El cliente NUNCA es fuente de verdad de esta Date (AD-28).
 */
export function calcularFechaDisparoUtc(params: {
  receta: RecetaInput;
  zonaHoraria?: string | null;
  /** Ancla AD-29 — solo para relativo_aniversario. */
  fechaCreacion?: Date | string | null;
  /** Reloj inyectable para tests. Default: ahora real. */
  nowUtc?: Date;
}): CalcFechaDisparoResult {
  const zone = resolveTenantZone(params.zonaHoraria);
  const now = DateTime.fromJSDate(params.nowUtc ?? new Date(), {
    zone: 'utc',
  }).setZone(zone);

  if (!now.isValid) {
    return {
      ok: false,
      code: 'invalid_receta',
      message: 'No se pudo calcular la fecha. Intenta de nuevo.',
    };
  }

  const { familia, preset, fechaExacta } = params.receta;

  let target: DateTime;

  if (familia === 'relativo_hoy') {
    if (
      !preset ||
      !(PRESETS_RELATIVO_HOY as readonly string[]).includes(preset)
    ) {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'Elige dentro de cuánto tiempo quieres el recordatorio.',
      };
    }
    // Relativos a hoy siempre producen futuro (presets ≥ 1 mes).
    target = now
      .plus(HOY_DURATIONS[preset as PresetRelativoHoy])
      .startOf('day');
  } else if (familia === 'relativo_aniversario') {
    if (
      !preset ||
      !(PRESETS_RELATIVO_ANIVERSARIO as readonly string[]).includes(preset)
    ) {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'Elige con cuánta anticipación quieres el recordatorio.',
      };
    }
    if (!params.fechaCreacion) {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'No se pudo calcular esa fecha. Intenta de nuevo.',
      };
    }
    const anchor = DateTime.fromJSDate(
      params.fechaCreacion instanceof Date
        ? params.fechaCreacion
        : new Date(params.fechaCreacion),
      { zone: 'utc' },
    ).setZone(zone);
    if (!anchor.isValid) {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'No se pudo calcular esa fecha. Intenta de nuevo.',
      };
    }
    // Aniversario = mismo mes/día + 1 año desde fechaCreacion (AD-29).
    const anniversary = anchor.plus({ years: 1 }).startOf('day');
    target = anniversary
      .minus(ANIV_OFFSETS[preset as PresetRelativoAniversario])
      .startOf('day');
  } else if (familia === 'fecha_exacta') {
    if (preset != null && String(preset).trim() !== '') {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'Elige un día específico o un plazo, no ambos.',
      };
    }
    if (fechaExacta == null || fechaExacta === '') {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'Elige el día en que quieres el recordatorio.',
      };
    }
    const parsed =
      fechaExacta instanceof Date
        ? DateTime.fromJSDate(fechaExacta, { zone: 'utc' }).setZone(zone)
        : DateTime.fromISO(String(fechaExacta).slice(0, 10), { zone });
    if (!parsed.isValid) {
      return {
        ok: false,
        code: 'invalid_receta',
        message: 'Esa fecha no es válida. Elige otro día.',
      };
    }
    target = parsed.startOf('day');
  } else {
    return {
      ok: false,
      code: 'invalid_receta',
      message: 'Elige cómo quieres recibir el recordatorio.',
    };
  }

  if (!target.isValid) {
    return {
      ok: false,
      code: 'invalid_receta',
      message: 'No se pudo calcular la fecha. Intenta de nuevo.',
    };
  }

  const disparoUtc = atHoraDisparoUtc(target);
  if (!disparoUtc.isValid) {
    return {
      ok: false,
      code: 'invalid_receta',
      message: 'No se pudo calcular la fecha. Intenta de nuevo.',
    };
  }

  // Futuro estricto según Reloj del tenant (FR5 / NFR1).
  if (disparoUtc.toMillis() <= now.toMillis()) {
    return {
      ok: false,
      code: 'not_future',
      message:
        'Esa fecha ya pasó. Elige otra opción.',
    };
  }

  return {
    ok: true,
    fechaDisparoUtc: disparoUtc.toJSDate(),
  };
}

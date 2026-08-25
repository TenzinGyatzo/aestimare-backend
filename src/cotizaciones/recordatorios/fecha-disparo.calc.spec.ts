import {
  calcularFechaDisparoUtc,
  DEFAULT_TENANT_ZONE,
  resolveTenantZone,
} from './fecha-disparo.calc';

describe('fecha-disparo.calc (Story 9.1)', () => {
  const zone = 'America/Mexico_City';
  // 2026-06-15 15:00 UTC = 09:00 en Mexico_City
  const nowUtc = new Date('2026-06-15T15:00:00.000Z');

  describe('resolveTenantZone', () => {
    it('usa America/Mexico_City si falta', () => {
      expect(resolveTenantZone(undefined)).toBe(DEFAULT_TENANT_ZONE);
      expect(resolveTenantZone(null)).toBe(DEFAULT_TENANT_ZONE);
      expect(resolveTenantZone('  ')).toBe(DEFAULT_TENANT_ZONE);
    });

    it('respeta IANA del tenant', () => {
      expect(resolveTenantZone('America/Tijuana')).toBe('America/Tijuana');
    });
  });

  describe('relativo_hoy', () => {
    it('1_mes → día civil +1 mes a las 14:00 UTC', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'relativo_hoy', preset: '1_mes' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toEqual({
        ok: true,
        fechaDisparoUtc: new Date('2026-07-15T14:00:00.000Z'),
      });
    });

    it('3_meses produce futuro', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'relativo_hoy', preset: '3_meses' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r.ok).toBe(true);
      expect(
        (r as { fechaDisparoUtc: Date }).fechaDisparoUtc.getTime(),
      ).toBeGreaterThan(nowUtc.getTime());
    });

    it('preset inválido → invalid_receta', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'relativo_hoy', preset: '5_meses' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toMatchObject({ ok: false, code: 'invalid_receta' });
    });
  });

  describe('relativo_aniversario (ancla fechaCreacion)', () => {
    it('2_semanas_antes del aniversario futuro', () => {
      // COT creada 2026-03-01 → aniversario 2027-03-01 → 2w antes = 2027-02-15
      const r = calcularFechaDisparoUtc({
        receta: {
          familia: 'relativo_aniversario',
          preset: '2_semanas_antes',
        },
        zonaHoraria: zone,
        fechaCreacion: new Date('2026-03-01T18:00:00.000Z'),
        nowUtc,
      });
      expect(r).toEqual({
        ok: true,
        fechaDisparoUtc: new Date('2027-02-15T14:00:00.000Z'),
      });
    });

    it('rechaza si el disparo calculado no es futuro', () => {
      // COT hace 11+ meses: aniversario cerca; 2 meses antes ya pasó
      const r = calcularFechaDisparoUtc({
        receta: {
          familia: 'relativo_aniversario',
          preset: '2_meses_antes',
        },
        zonaHoraria: zone,
        fechaCreacion: new Date('2025-08-01T12:00:00.000Z'),
        nowUtc, // 2026-06-15 → aniv 2026-08-01 → 2m antes = 2026-06-01 ≤ now
      });
      expect(r).toMatchObject({ ok: false, code: 'not_future' });
    });

    it('no usa createdAt — sin fechaCreacion → invalid', () => {
      const r = calcularFechaDisparoUtc({
        receta: {
          familia: 'relativo_aniversario',
          preset: '1_mes_antes',
        },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toMatchObject({ ok: false, code: 'invalid_receta' });
    });
  });

  describe('fecha_exacta', () => {
    it('día futuro a las 14:00 UTC (08:00 UTC-6 / 07:00 UTC-7)', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'fecha_exacta', fechaExacta: '2026-09-01' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toEqual({
        ok: true,
        fechaDisparoUtc: new Date('2026-09-01T14:00:00.000Z'),
      });
    });

    it('mismo instante UTC en America/Tijuana (verano UTC-7)', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'fecha_exacta', fechaExacta: '2026-09-01' },
        zonaHoraria: 'America/Tijuana',
        nowUtc,
      });
      expect(r).toEqual({
        ok: true,
        fechaDisparoUtc: new Date('2026-09-01T14:00:00.000Z'),
      });
    });

    it('rechaza pasado', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'fecha_exacta', fechaExacta: '2026-01-01' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toMatchObject({ ok: false, code: 'not_future' });
    });

    it('rechaza hoy si 14:00 UTC ya pasó', () => {
      const r = calcularFechaDisparoUtc({
        receta: { familia: 'fecha_exacta', fechaExacta: '2026-06-15' },
        zonaHoraria: zone,
        nowUtc,
      });
      expect(r).toMatchObject({ ok: false, code: 'not_future' });
    });
  });
});

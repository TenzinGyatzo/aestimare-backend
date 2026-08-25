import {
  formatRecetaResumen,
  resolveIdentidadDisparada,
} from './receta-resumen.util';

describe('receta-resumen.util', () => {
  describe('formatRecetaResumen', () => {
    it('mapea preset relativo_hoy', () => {
      expect(
        formatRecetaResumen({ familia: 'relativo_hoy', preset: '3_meses' }),
      ).toBe('3 meses');
    });

    it('mapea preset aniversario', () => {
      expect(
        formatRecetaResumen({
          familia: 'relativo_aniversario',
          preset: '2_semanas_antes',
        }),
      ).toBe('2 semanas antes de cumplir un año');
    });

    it('formatea fecha_exacta', () => {
      const res = formatRecetaResumen(
        {
          familia: 'fecha_exacta',
          fechaExacta: new Date('2030-06-15T14:00:00.000Z'),
        },
        new Date('2030-06-15T14:00:00.000Z'),
      );
      expect(res).toMatch(/2030|15|jun/i);
    });

    it('fecha_exacta a las 14:00 UTC es el mismo día civil en México y Pacífico', () => {
      const utc = new Date('2030-06-16T14:00:00.000Z');
      const resMexico = formatRecetaResumen(
        { familia: 'fecha_exacta', fechaExacta: utc },
        utc,
        'America/Mexico_City',
      );
      const resPacific = formatRecetaResumen(
        { familia: 'fecha_exacta', fechaExacta: utc },
        utc,
        'America/Los_Angeles',
      );
      expect(resMexico).toMatch(/16.*2030|2030.*16/i);
      expect(resPacific).toMatch(/16.*2030|2030.*16/i);
    });
  });

  describe('resolveIdentidadDisparada', () => {
    it('prioriza empresa CRM', () => {
      expect(resolveIdentidadDisparada('Acme', 'Ana')).toBe('Acme');
    });

    it('fallback a contacto', () => {
      expect(resolveIdentidadDisparada('', 'Ana Pérez')).toBe('Ana Pérez');
    });

    it('null sin datos (AD-37)', () => {
      expect(resolveIdentidadDisparada('', '  ')).toBeNull();
      expect(resolveIdentidadDisparada(null, undefined)).toBeNull();
    });
  });
});

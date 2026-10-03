import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCotizacionAdminDto } from './create-cotizacion-admin.dto';

const base = {
  items: [{ servicioId: '507f1f77bcf86cd799439011', cantidad: 1 }],
};

function toDto(body: Record<string, unknown>) {
  return plainToInstance(CreateCotizacionAdminDto, body, {
    enableImplicitConversion: true,
  });
}

async function ivaErrors(body: Record<string, unknown>) {
  const errors = await validate(toDto(body));
  return errors.filter((e) => e.property === 'agregarIva');
}

describe('CreateCotizacionAdminDto agregarIva', () => {
  it('omite el campo', async () => {
    expect(await ivaErrors(base)).toHaveLength(0);
  });

  it('acepta boolean', async () => {
    expect(await ivaErrors({ ...base, agregarIva: false })).toHaveLength(0);
    expect(await ivaErrors({ ...base, agregarIva: true })).toHaveLength(0);
  });

  it.each([null, 0, '', 'false', 'true', 1])(
    'rechaza no boolean (%p)',
    async (agregarIva) => {
      expect(await ivaErrors({ ...base, agregarIva })).toHaveLength(1);
    },
  );
});

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CotizacionesService } from './cotizaciones.service';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { TenantSecretsKeyError } from '../tenants/tenant-secrets.crypto';
import { TenantEmailNotConfiguredError } from '../emails/tenant-email-not-configured.error';
import { TipoItem } from '../servicios/enums/tipo-item.enum';

function stubRecordatoriosService() {
  return {
    cancelarPorRepetir: jest.fn().mockResolvedValue(false),
    resolveRecetaRearme: jest.fn(),
    programarEnCotizacionNueva: jest.fn(),
  };
}

describe('CotizacionesService resolveVencimiento (Story 2.4)', () => {
  const tenantConfigService = {
    getForRequest: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      tenantConfigService as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('usa vigenciaDefaultDias del tenant cuando no hay fecha explícita', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 45,
    });
    const before = Date.now();
    const r = await (service as any).resolveVencimiento();
    const deltaMs = r.fechaVencimiento.getTime() - before;
    const dayMs = 24 * 60 * 60 * 1000;
    expect(deltaMs).toBeGreaterThanOrEqual(44 * dayMs);
    expect(deltaMs).toBeLessThanOrEqual(46 * dayMs);
    expect(r.estado).toBe('vigente');
  });

  it('fallback 30 si vigenciaDefaultDias ausente', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({});
    const before = Date.now();
    const r = await (service as any).resolveVencimiento();
    const deltaMs = r.fechaVencimiento.getTime() - before;
    const dayMs = 24 * 60 * 60 * 1000;
    expect(deltaMs).toBeGreaterThanOrEqual(29 * dayMs);
    expect(deltaMs).toBeLessThanOrEqual(31 * dayMs);
  });

  it('rechaza fechaVencimiento inválida', async () => {
    await expect(
      (service as any).resolveVencimiento('no-es-fecha'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza fechaVencimiento anterior a la creación', async () => {
    await expect(
      (service as any).resolveVencimiento('2000-01-01T00:00:00.000Z'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sinVigencia: true omite fechaVencimiento (Story 6.15)', async () => {
    const r = await (service as any).resolveVencimiento(undefined, {
      sinVigencia: true,
    });
    expect(r.sinVigencia).toBe(true);
    expect(r.fechaVencimiento).toBeUndefined();
    expect(r.estado).toBe('vigente');
  });

  it('sinVigencia + fechaVencimiento → 400 (Story 6.15)', async () => {
    await expect(
      (service as any).resolveVencimiento('2030-12-31T23:59:59.000Z', {
        sinVigencia: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CotizacionesService.resolveMagicExpiresAt (Story 6.15)', () => {
  const ModelCtor: any = class {};
  const service = new CotizacionesService(
    ModelCtor as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { getTenantId: jest.fn() } as any,
    {} as any,
    {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );

  it('sinVigencia → fechaCreacion + 365d', () => {
    const creacion = new Date('2026-01-01T00:00:00.000Z');
    const expires = (service as any).resolveMagicExpiresAt({
      sinVigencia: true,
      fechaCreacion: creacion,
    });
    expect(expires.getTime()).toBe(
      creacion.getTime() + 365 * 24 * 60 * 60 * 1000,
    );
  });

  it('!sinVigencia + fecha válida → usa fechaVencimiento', () => {
    const fv = new Date('2030-06-15T23:59:59.000Z');
    const expires = (service as any).resolveMagicExpiresAt({
      sinVigencia: false,
      fechaVencimiento: fv,
    });
    expect(expires.getTime()).toBe(fv.getTime());
  });

  it('!sinVigencia + fecha inválida/ausente → 400', () => {
    expect(() =>
      (service as any).resolveMagicExpiresAt({
        sinVigencia: false,
        fechaVencimiento: 'no-es-fecha',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      (service as any).resolveMagicExpiresAt({ sinVigencia: false }),
    ).toThrow(BadRequestException);
  });
});

describe('CotizacionesService.create — cliente inactivo (Story 3.2)', () => {
  const tenantId = new Types.ObjectId();
  const clientesService = {
    findOne: jest.fn(),
  };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    service = new CotizacionesService(
      {} as any,
      clientesService as any,
      {} as any,
      {} as any,
      tenantContext as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('rechaza create si cliente.activo === false', async () => {
    clientesService.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      tenantId,
      activo: false,
    });

    await expect(
      service.create({
        clienteId: new Types.ObjectId().toString(),
        emailContacto: 'a@b.com',
        items: [{ servicioId: new Types.ObjectId().toString(), cantidad: 1 }],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(clientesService.findOne).toHaveBeenCalled();
  });
});

describe('CotizacionesService.buildItems — servicio inactivo (Story 4.2)', () => {
  const tenantId = new Types.ObjectId();
  const serviciosService = {
    findOne: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      serviciosService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('rechaza buildItems si servicio.activo === false', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: false,
      nombre: 'Examen',
      precioUnitario: 100,
    });

    await expect(
      (service as any).buildItems([{ servicioId, cantidad: 1 }], tenantId),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(serviciosService.findOne).toHaveBeenCalledWith(servicioId);
  });
});

describe('CotizacionesService.buildItems — overrides snapshot (Story 6.4)', () => {
  const tenantId = new Types.ObjectId();
  const serviciosService = {
    findOne: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      serviciosService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    serviciosService.findOne.mockResolvedValue({
      _id: new Types.ObjectId(),
      tenantId,
      activo: true,
      nombre: 'Catálogo',
      descripcion: 'Desc catálogo',
      precioUnitario: 100,
    });
  });

  it('sin overrides usa snapshot del catálogo (≡ 6.2)', async () => {
    const servicioId = new Types.ObjectId().toString();
    const { items, total } = await (service as any).buildItems(
      [{ servicioId, cantidad: 2 }],
      tenantId,
    );
    expect(items[0].nombreServicioSnapshot).toBe('Catálogo');
    expect(items[0].descripcionServicioSnapshot).toBe('Desc catálogo');
    expect(items[0].precioUnitarioSnapshot).toBe(100);
    expect(items[0].subtotal).toBe(200);
    expect(total).toBe(200);
  });

  it('aplica overrides de nombre, descripción y precio al snapshot', async () => {
    const servicioId = new Types.ObjectId().toString();
    const { items, total } = await (service as any).buildItems(
      [
        {
          servicioId,
          cantidad: 3,
          nombre: '  Override  ',
          descripcion: 'Desc override',
          precioUnitario: 50,
        },
      ],
      tenantId,
    );
    expect(items[0].nombreServicioSnapshot).toBe('Override');
    expect(items[0].descripcionServicioSnapshot).toBe('Desc override');
    expect(items[0].precioUnitarioSnapshot).toBe(50);
    expect(items[0].subtotal).toBe(150);
    expect(total).toBe(150);
  });

  it('descripcion vacía omite descripción en el snapshot', async () => {
    const servicioId = new Types.ObjectId().toString();
    const { items } = await (service as any).buildItems(
      [{ servicioId, cantidad: 1, descripcion: '   ' }],
      tenantId,
    );
    expect(items[0].descripcionServicioSnapshot).toBeUndefined();
  });

  it('nombre whitespace/omitido cae al nombre del catálogo', async () => {
    const servicioId = new Types.ObjectId().toString();
    const { items } = await (service as any).buildItems(
      [{ servicioId, cantidad: 1, nombre: '   ' }],
      tenantId,
    );
    expect(items[0].nombreServicioSnapshot).toBe('Catálogo');
  });

  it('precioUnitario 0 se persiste en el snapshot', async () => {
    const servicioId = new Types.ObjectId().toString();
    const { items, total } = await (service as any).buildItems(
      [{ servicioId, cantidad: 2, precioUnitario: 0 }],
      tenantId,
    );
    expect(items[0].precioUnitarioSnapshot).toBe(0);
    expect(items[0].subtotal).toBe(0);
    expect(total).toBe(0);
  });

  it('overrides no mutan el documento de catálogo mockeado', async () => {
    const servicioId = new Types.ObjectId().toString();
    const catalog = {
      _id: new Types.ObjectId(),
      tenantId,
      activo: true,
      nombre: 'Catálogo',
      descripcion: 'Desc catálogo',
      precioUnitario: 100,
    };
    serviciosService.findOne.mockResolvedValue(catalog);
    await (service as any).buildItems(
      [
        {
          servicioId,
          cantidad: 1,
          nombre: 'Override',
          descripcion: 'Otra',
          precioUnitario: 1,
        },
      ],
      tenantId,
    );
    expect(catalog.nombre).toBe('Catálogo');
    expect(catalog.descripcion).toBe('Desc catálogo');
    expect(catalog.precioUnitario).toBe(100);
  });
});

describe('CotizacionesService.buildItems — tipoSnapshot/codigoSnapshot (Story 6.4 tipado SaaS)', () => {
  const tenantId = new Types.ObjectId();
  const serviciosService = {
    findOne: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      serviciosService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('setea tipoSnapshot y codigoSnapshot desde el Servicio', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Kit',
      precioUnitario: 10,
      tipo: 'producto',
      codigo: 'SKU-1',
    });
    const { items } = await (service as any).buildItems(
      [{ servicioId, cantidad: 1 }],
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('producto');
    expect(items[0].codigoSnapshot).toBe('SKU-1');
  });

  it('producto sin código omite codigoSnapshot', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Kit',
      precioUnitario: 10,
      tipo: 'producto',
    });
    const { items } = await (service as any).buildItems(
      [{ servicioId, cantidad: 1 }],
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('producto');
    expect(items[0].codigoSnapshot).toBeUndefined();
  });

  it('legacy sin tipo → tipoSnapshot servicio', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Legacy',
      precioUnitario: 10,
    });
    const { items } = await (service as any).buildItems(
      [{ servicioId, cantidad: 1 }],
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('servicio');
  });

  it('overrides nombre/precio no cambian tipo/código snapshot', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Cat',
      precioUnitario: 100,
      tipo: 'servicio',
      codigo: 'SRV-9',
    });
    const { items } = await (service as any).buildItems(
      [
        {
          servicioId,
          cantidad: 1,
          nombre: 'Override',
          precioUnitario: 1,
        },
      ],
      tenantId,
    );
    expect(items[0].nombreServicioSnapshot).toBe('Override');
    expect(items[0].precioUnitarioSnapshot).toBe(1);
    expect(items[0].tipoSnapshot).toBe('servicio');
    expect(items[0].codigoSnapshot).toBe('SRV-9');
  });

  it('tipoSnapshot/codigoSnapshot espurios del cliente no ganan', async () => {
    const servicioId = new Types.ObjectId().toString();
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Cat',
      precioUnitario: 100,
      tipo: 'servicio',
      codigo: 'SRV-1',
    });
    const { items } = await (service as any).buildItems(
      [
        {
          servicioId,
          cantidad: 1,
          tipoSnapshot: 'producto',
          codigoSnapshot: 'HACK',
          tipo: 'producto',
          codigo: 'HACK',
        } as any,
      ],
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('servicio');
    expect(items[0].codigoSnapshot).toBe('SRV-1');
  });
});

describe('CotizacionesService.buildRepetirItems — tipoSnapshot (Story 6.4 tipado SaaS)', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const serviciosService = {
    findOne: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      serviciosService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('actualizados toma tipo/código del catálogo vivo', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Nuevo nombre',
      precioUnitario: 50,
      tipo: 'producto',
      codigo: 'P-1',
    });
    const fuente = {
      items: [
        {
          servicioId,
          nombreServicioSnapshot: 'Viejo',
          precioUnitarioSnapshot: 10,
          cantidad: 1,
          subtotal: 10,
          tipoSnapshot: 'servicio',
          codigoSnapshot: 'OLD',
        },
      ],
    };
    const { items } = await (service as any).buildRepetirItems(
      fuente,
      { modoPrecios: 'actualizados' },
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('producto');
    expect(items[0].codigoSnapshot).toBe('P-1');
    expect(items[0].nombreServicioSnapshot).toBe('Nuevo nombre');
  });

  it('originales preserva tipoSnapshot/codigoSnapshot de la línea fuente', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Catálogo',
      precioUnitario: 999,
      tipo: 'producto',
      codigo: 'LIVE',
    });
    const fuente = {
      items: [
        {
          servicioId,
          nombreServicioSnapshot: 'Snap',
          precioUnitarioSnapshot: 10,
          cantidad: 2,
          subtotal: 20,
          tipoSnapshot: 'servicio',
          codigoSnapshot: 'LINE-CODE',
        },
      ],
    };
    const { items } = await (service as any).buildRepetirItems(
      fuente,
      { modoPrecios: 'originales' },
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('servicio');
    expect(items[0].codigoSnapshot).toBe('LINE-CODE');
    expect(items[0].precioUnitarioSnapshot).toBe(10);
  });

  it('originales sin snapshot en línea → one-shot desde Servicio vivo', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: false,
      nombre: 'Catálogo',
      precioUnitario: 999,
      tipo: 'producto',
      codigo: ' LIVE-P ',
    });
    const fuente = {
      items: [
        {
          servicioId,
          nombreServicioSnapshot: 'Snap legacy',
          precioUnitarioSnapshot: 10,
          cantidad: 1,
          subtotal: 10,
        },
      ],
    };
    const { items } = await (service as any).buildRepetirItems(
      fuente,
      { modoPrecios: 'originales' },
      tenantId,
    );
    expect(items[0].tipoSnapshot).toBe('producto');
    expect(items[0].codigoSnapshot).toBe('LIVE-P');
    expect(items[0].precioUnitarioSnapshot).toBe(10);
  });
});

describe('UpdateCotizacionDto — sin items (Story 6.4 / AD-22)', () => {
  it('no declara propiedad items (PATCH no reescribe líneas)', () => {
    const dto = new UpdateCotizacionDto();
    expect('items' in dto).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(UpdateCotizacionDto.prototype, 'items'),
    ).toBe(false);
  });

  it('update() $set no incluye items aunque el DTO se casteé con extras', async () => {
    const tenantId = new Types.ObjectId();
    const cotizacionId = new Types.ObjectId();
    const existing = {
      _id: cotizacionId,
      tenantId,
      estado: 'vigente',
      items: [
        {
          servicioId: new Types.ObjectId(),
          tipoSnapshot: 'servicio',
          codigoSnapshot: 'KEEP',
          cantidad: 1,
          precioUnitarioSnapshot: 10,
          subtotal: 10,
          nombreServicioSnapshot: 'X',
        },
      ],
    };
    const ModelCtor: any = {
      findOneAndUpdate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue({
              ...existing,
              emailContacto: 'nuevo@ejemplo.com',
            }),
          }),
        }),
      }),
    };
    const service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      {} as any,
      { getTenantId: jest.fn().mockReturnValue(tenantId) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(existing as any);

    await service.update(
      String(cotizacionId),
      { emailContacto: 'nuevo@ejemplo.com', items: [{ foo: 1 }] } as any,
      { sub: 'u1', email: 'a@b.com' },
    );

    expect(ModelCtor.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set).toEqual({ emailContacto: 'nuevo@ejemplo.com' });
    expect(set).not.toHaveProperty('items');
  });
});

describe('CotizacionesService.buildPlantillasSnapshot (Story 6.5)', () => {
  const tenantId = new Types.ObjectId();
  const plantillaA = new Types.ObjectId();
  const plantillaB = new Types.ObjectId();
  const plantillasService = {
    findOne: jest.fn(),
    assertSeccionesValidas: jest.fn((secciones: unknown) => {
      if (!Array.isArray(secciones) || secciones.length < 1) {
        throw new BadRequestException('Debe incluir al menos una sección');
      }
      return secciones;
    }),
    update: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      plantillasService as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('sin plantillas devuelve array vacío', async () => {
    const snap = await (service as any).buildPlantillasSnapshot(
      undefined,
      tenantId,
    );
    expect(snap).toEqual([]);
    expect(plantillasService.findOne).not.toHaveBeenCalled();
  });

  it('copia deep secciones en el orden del array y no muta maestra', async () => {
    const seccionesA = [
      {
        id: 'a1',
        tipo: 'richtext',
        cuerpo: { text: 'Original A' },
      },
    ];
    const maestraA = {
      _id: plantillaA,
      tenantId,
      activo: true,
      nombre: 'Plantilla A',
      schemaVersion: 1,
      secciones: seccionesA,
    };
    const maestraB = {
      _id: plantillaB,
      tenantId,
      activo: true,
      nombre: 'Plantilla B',
      schemaVersion: 1,
      secciones: [
        {
          id: 'b1',
          tipo: 'tabla',
          encabezados: ['X'],
          filas: [['1']],
        },
      ],
    };
    plantillasService.findOne
      .mockResolvedValueOnce(maestraB)
      .mockResolvedValueOnce(maestraA);

    const snap = await (service as any).buildPlantillasSnapshot(
      [
        { plantillaId: plantillaB.toString() },
        {
          plantillaId: plantillaA.toString(),
          nombre: 'A custom',
          secciones: [
            {
              id: 'a1',
              tipo: 'richtext',
              cuerpo: { text: 'Override A' },
            },
          ],
        },
      ],
      tenantId,
    );

    expect(snap).toHaveLength(2);
    expect(snap[0].plantillaId).toEqual(plantillaB);
    expect(snap[0].nombreSnapshot).toBe('Plantilla B');
    expect(snap[1].nombreSnapshot).toBe('A custom');
    expect(snap[1].secciones[0].cuerpo.text).toBe('Override A');
    expect(plantillasService.assertSeccionesValidas).toHaveBeenCalled();
    // maestra intacta
    expect(maestraA.secciones[0].cuerpo.text).toBe('Original A');
    // deep copy: mutar snapshot no afecta maestra
    snap[0].secciones[0].filas[0][0] = 'mutado';
    expect(maestraB.secciones[0].filas[0][0]).toBe('1');
  });

  it('rechaza plantilla inactiva', async () => {
    plantillasService.findOne.mockResolvedValue({
      _id: plantillaA,
      tenantId,
      activo: false,
      nombre: 'Inactiva',
      secciones: [{ id: 'x', tipo: 'richtext', cuerpo: { text: 'x' } }],
    });
    await expect(
      (service as any).buildPlantillasSnapshot(
        [{ plantillaId: plantillaA.toString() }],
        tenantId,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza maestra sin secciones (evita 500 en JSON.parse)', async () => {
    plantillasService.findOne.mockResolvedValue({
      _id: plantillaA,
      tenantId,
      activo: true,
      nombre: 'Rota',
      secciones: undefined,
    });
    await expect(
      (service as any).buildPlantillasSnapshot(
        [{ plantillaId: plantillaA.toString() }],
        tenantId,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CotizacionesService.createAdminCotizacion — plantillas (Story 6.5)', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const plantillaId = new Types.ObjectId();
  const year = new Date().getFullYear();

  const serviciosService = {
    findOne: jest.fn(),
  };
  const plantillasService = {
    findOne: jest.fn(),
    assertSeccionesValidas: jest.fn((s: unknown) => s),
    update: jest.fn(),
  };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };
  const tenantConfigService = {
    getForRequest: jest.fn().mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
    }),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0001`),
  };

  let service: CotizacionesService;
  let ModelCtor: jest.Mock;
  let lastPersisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
    });
    countersService.nextFolio.mockResolvedValue(`COT-${year}-0001`);
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio',
      precioUnitario: 100,
    });
    lastPersisted = null;
    const savedDoc = {
      _id: new Types.ObjectId(),
      folio: `COT-${year}-0001`,
    };
    ModelCtor = jest.fn().mockImplementation((data: any) => {
      lastPersisted = data;
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      {} as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      plantillasService as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  it('create sin plantillas → plantillasSnapshot vacío', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.plantillasSnapshot).toEqual([]);
    expect(plantillasService.findOne).not.toHaveBeenCalled();
    expect(plantillasService.update).not.toHaveBeenCalled();
  });

  it('create con plantillas → snapshot ordenado y no muta maestra', async () => {
    const secciones = [
      { id: 'p1', tipo: 'richtext', cuerpo: { text: 'Hello' } },
    ];
    plantillasService.findOne.mockResolvedValue({
      _id: plantillaId,
      tenantId,
      activo: true,
      nombre: 'Maestra',
      schemaVersion: 1,
      secciones,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      plantillas: [{ plantillaId: plantillaId.toString() }],
    } as any);

    expect(lastPersisted.plantillasSnapshot).toHaveLength(1);
    expect(lastPersisted.plantillasSnapshot[0].nombreSnapshot).toBe('Maestra');
    expect(lastPersisted.plantillasSnapshot[0].secciones[0].cuerpo.text).toBe(
      'Hello',
    );
    expect(plantillasService.update).not.toHaveBeenCalled();
  });

  it('ya no fuerza incluirDatosBancarios false por falta de bancarios útiles', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: { banco: 'BBVA' }, // sin cuenta/clabe → no útil, pero ya no debe forzar false
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      incluirDatosBancarios: true,
    } as any);

    expect(lastPersisted.incluirDatosBancarios).toBe(true);
  });
});

describe('CotizacionesService.createAdminCotizacion — defaults de tenant para incluirDatosBancarios/incluirDescripciones/incluirImagenesPdf', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const year = new Date().getFullYear();

  const serviciosService = { findOne: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };
  const tenantConfigService = {
    getForRequest: jest.fn(),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0082`),
  };

  let service: CotizacionesService;
  let ModelCtor: jest.Mock;
  let lastPersisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    countersService.nextFolio.mockResolvedValue(`COT-${year}-0082`);
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio',
      precioUnitario: 100,
      tipo: TipoItem.SERVICIO,
    });
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
    });
    lastPersisted = null;
    const savedDoc = {
      _id: new Types.ObjectId(),
      folio: `COT-${year}-0082`,
    };
    ModelCtor = jest.fn().mockImplementation((data: any) => {
      lastPersisted = data;
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      {} as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {
        findOne: jest.fn(),
        assertSeccionesValidas: jest.fn((s: unknown) => s),
        update: jest.fn(),
      } as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  it('omitido + sin prefs de tenant → persiste true en los tres', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.incluirDatosBancarios).toBe(true);
    expect(lastPersisted.incluirDescripciones).toBe(true);
    expect(lastPersisted.incluirImagenesPdf).toBe(true);
  });

  it('omitido + prefs de tenant en false → persiste false en los tres', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultIncluirDatosBancarios: false,
      defaultIncluirDescripciones: false,
      defaultIncluirImagenesPdf: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.incluirDatosBancarios).toBe(false);
    expect(lastPersisted.incluirDescripciones).toBe(false);
    expect(lastPersisted.incluirImagenesPdf).toBe(false);
  });

  it('body explícito false con prefs de tenant en true → respeta false', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultIncluirDatosBancarios: true,
      defaultIncluirDescripciones: true,
      defaultIncluirImagenesPdf: true,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      incluirDatosBancarios: false,
      incluirDescripciones: false,
      incluirImagenesPdf: false,
    } as any);

    expect(lastPersisted.incluirDatosBancarios).toBe(false);
    expect(lastPersisted.incluirDescripciones).toBe(false);
    expect(lastPersisted.incluirImagenesPdf).toBe(false);
  });

  it('body explícito true con prefs de tenant en false → respeta true', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultIncluirDatosBancarios: false,
      defaultIncluirDescripciones: false,
      defaultIncluirImagenesPdf: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      incluirDatosBancarios: true,
      incluirDescripciones: true,
      incluirImagenesPdf: true,
    } as any);

    expect(lastPersisted.incluirDatosBancarios).toBe(true);
    expect(lastPersisted.incluirDescripciones).toBe(true);
    expect(lastPersisted.incluirImagenesPdf).toBe(true);
  });

  it('body null equivale a omitido → aplica prefs de tenant', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultIncluirImagenesPdf: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      incluirImagenesPdf: null,
    } as any);

    expect(lastPersisted.incluirImagenesPdf).toBe(false);
  });

  it('ya no depende de si algún producto de línea tiene imagenUrl (AD-26 retirado)', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Producto',
      precioUnitario: 100,
      tipo: TipoItem.PRODUCTO,
      imagenUrl: `/uploads/catalogo/${tenantId}/${servicioId}.webp`,
    });
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultIncluirImagenesPdf: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.incluirImagenesPdf).toBe(false);
  });
});

describe('CotizacionesService.createAdminCotizacion — defaultUsarVigencia → sinVigencia', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const year = new Date().getFullYear();

  const serviciosService = { findOne: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };
  const tenantConfigService = {
    getForRequest: jest.fn(),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0083`),
  };

  let service: CotizacionesService;
  let ModelCtor: jest.Mock;
  let lastPersisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    countersService.nextFolio.mockResolvedValue(`COT-${year}-0083`);
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio',
      precioUnitario: 100,
      tipo: TipoItem.SERVICIO,
    });
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
    });
    lastPersisted = null;
    const savedDoc = {
      _id: new Types.ObjectId(),
      folio: `COT-${year}-0083`,
    };
    ModelCtor = jest.fn().mockImplementation((data: any) => {
      lastPersisted = data;
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      {} as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {
        findOne: jest.fn(),
        assertSeccionesValidas: jest.fn((s: unknown) => s),
        update: jest.fn(),
      } as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  it('omitido + pref ausente → sinVigencia false (usa vigencia)', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.sinVigencia).toBe(false);
  });

  it('omitido + defaultUsarVigencia true → sinVigencia false', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultUsarVigencia: true,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.sinVigencia).toBe(false);
  });

  it('omitido + defaultUsarVigencia false → sinVigencia true', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultUsarVigencia: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);

    expect(lastPersisted.sinVigencia).toBe(true);
  });

  it('body explícito false con pref false → respeta false (usa vigencia)', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultUsarVigencia: false,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      sinVigencia: false,
    } as any);

    expect(lastPersisted.sinVigencia).toBe(false);
  });

  it('body explícito true con pref true → respeta true', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
      bancarios: {},
      defaultUsarVigencia: true,
    });

    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      sinVigencia: true,
    } as any);

    expect(lastPersisted.sinVigencia).toBe(true);
  });
});

describe('CotizacionesService.createAdminCotizacion — destinatarios (Story 6.6)', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const year = new Date().getFullYear();

  const serviciosService = { findOne: jest.fn() };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const tenantConfigService = {
    getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 30 }),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0001`),
  };
  const emailService = { sendAdminQuotationEmail: jest.fn() };

  let service: CotizacionesService;
  let lastPersisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio',
      precioUnitario: 100,
    });
    lastPersisted = null;
    const savedDoc = { _id: new Types.ObjectId(), folio: `COT-${year}-0001` };
    const ModelCtor: any = jest.fn().mockImplementation((data: any) => {
      lastPersisted = data;
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    ModelCtor.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      serviciosService as any,
      emailService as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  it('create sin destinatarios → arrays vacíos', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
    } as any);
    expect(lastPersisted.emailsPara).toEqual([]);
    expect(lastPersisted.emailsCc).toEqual([]);
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
  });

  it('persiste Para/CC en orden y omite CC duplicado en Para', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      emailsPara: [' A@X.com ', 'b@x.com'],
      emailsCc: ['a@x.com', 'c@x.com'],
    } as any);
    expect(lastPersisted.emailsPara).toEqual(['a@x.com', 'b@x.com']);
    expect(lastPersisted.emailsCc).toEqual(['c@x.com']);
  });

  it('enviarEmail sin Para → 400', async () => {
    await expect(
      service.createAdminCotizacion({
        items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
        enviarEmail: true,
        emailsPara: [],
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CotizacionesService.generateFolio (Story 6.1)', () => {
  const tenantId = new Types.ObjectId();
  const year = new Date().getFullYear();
  const countersService = {
    nextFolio: jest.fn(),
  };
  const cotizacionModel = {
    countDocuments: jest.fn(),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CotizacionesService(
      cotizacionModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('delega a CountersService.nextFolio y no usa countDocuments', async () => {
    countersService.nextFolio.mockResolvedValue(`COT-${year}-0007`);
    const folio = await service.generateFolio(tenantId);
    expect(folio).toBe(`COT-${year}-0007`);
    expect(countersService.nextFolio).toHaveBeenCalledWith(tenantId);
    expect(cotizacionModel.countDocuments).not.toHaveBeenCalled();
  });
});

describe('CotizacionesService.createAdminCotizacion flexible (Story 6.2)', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const year = new Date().getFullYear();

  const cotizacionModel: any = {
    save: jest.fn(),
  };
  const clientesService = { findOne: jest.fn() };
  const serviciosService = { findOne: jest.fn() };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const tenantConfigService = {
    getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 30 }),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0001`),
  };

  let service: CotizacionesService;
  let savedDoc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    countersService.nextFolio.mockResolvedValue(`COT-${year}-0001`);
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
    });
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio A',
      precioUnitario: 100,
      descripcion: 'Desc',
    });
    savedDoc = {
      _id: new Types.ObjectId(),
      folio: `COT-${year}-0001`,
      toObject() {
        return this;
      },
    };
    cotizacionModel.mockImplementation = undefined;
    // Constructor pattern: new model(data).save()
    const ModelCtor: any = jest.fn().mockImplementation((data: any) => ({
      ...data,
      save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
    }));
    ModelCtor.findByIdAndUpdate = jest.fn();
    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  const baseItems = [{ servicioId: servicioId.toString(), cantidad: 1 }];

  it('crea sin identidad (vacío total) con ítem y folio', async () => {
    const result = await service.createAdminCotizacion({
      items: baseItems,
    } as any);
    expect(countersService.nextFolio).toHaveBeenCalledWith(tenantId);
    expect(result).toBeTruthy();
    expect(clientesService.findOne).not.toHaveBeenCalled();
  });

  it('rechaza correo/teléfono sin nombreContacto en modo guest (FR-21)', async () => {
    await expect(
      service.createAdminCotizacion({
        items: baseItems,
        emailContacto: 'a@b.com',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza teléfono sin nombreContacto en modo guest (FR-21)', async () => {
    await expect(
      service.createAdminCotizacion({
        items: baseItems,
        telefonoContacto: '6621234567',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza teléfono sin nombreContacto aunque haya clienteId', async () => {
    const cid = new Types.ObjectId();
    clientesService.findOne.mockResolvedValue({
      _id: cid,
      tenantId,
      activo: true,
      empresa: 'Empresa',
    });
    await expect(
      service.createAdminCotizacion({
        items: baseItems,
        clienteId: cid.toString(),
        telefonoContacto: '6621234567',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('permite email sin nombreContacto si hay clienteId (legacy CRM)', async () => {
    const cid = new Types.ObjectId();
    clientesService.findOne.mockResolvedValue({
      _id: cid,
      tenantId,
      activo: true,
      empresa: 'Empresa',
    });
    await service.createAdminCotizacion({
      items: baseItems,
      clienteId: cid.toString(),
      emailContacto: 'a@b.com',
    } as any);
    expect(countersService.nextFolio).toHaveBeenCalled();
  });

  it('acepta guest solo con nombreContacto', async () => {
    await service.createAdminCotizacion({
      items: baseItems,
      nombreContacto: 'Ana',
    } as any);
    expect(countersService.nextFolio).toHaveBeenCalled();
  });

  it('rechaza cliente inactivo', async () => {
    const cid = new Types.ObjectId();
    clientesService.findOne.mockResolvedValue({
      _id: cid,
      tenantId,
      activo: false,
      empresa: 'X',
    });
    await expect(
      service.createAdminCotizacion({
        items: baseItems,
        clienteId: cid.toString(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persiste clienteId + snapshots cuando CRM activo', async () => {
    const cid = new Types.ObjectId();
    clientesService.findOne.mockResolvedValue({
      _id: cid,
      tenantId,
      activo: true,
      empresa: 'Empresa CRM',
    });
    let captured: any;
    const ModelCtor: any = jest.fn().mockImplementation((data: any) => {
      captured = data;
      return {
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);

    await service.createAdminCotizacion({
      items: baseItems,
      clienteId: cid.toString(),
      nombreContacto: 'Contacto',
      emailContacto: 'c@e.com',
    } as any);

    expect(captured.clienteId).toBeDefined();
    expect(captured.nombreEmpresa).toBe('Empresa CRM');
    expect(captured.nombreContacto).toBe('Contacto');
    expect(captured.emailContacto).toBe('c@e.com');
    expect(captured.moneda).toBe('MXN');
  });

  it('persiste cargoContacto (Story 6.16)', async () => {
    let captured: any;
    const ModelCtor: any = jest.fn().mockImplementation((data: any) => {
      captured = data;
      return {
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);

    await service.createAdminCotizacion({
      items: baseItems,
      nombreContacto: 'Ana',
      cargoContacto: 'Gerente de Compras',
    } as any);

    expect(captured.cargoContacto).toBe('Gerente de Compras');
    expect(captured.nombreContacto).toBe('Ana');
  });

  it('omite cargoContacto vacío (Story 6.16)', async () => {
    let captured: any;
    const ModelCtor: any = jest.fn().mockImplementation((data: any) => {
      captured = data;
      return {
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);

    await service.createAdminCotizacion({
      items: baseItems,
      nombreContacto: 'Ana',
      cargoContacto: '   ',
    } as any);

    expect(captured.cargoContacto).toBeUndefined();
  });
});

describe('CotizacionesService.findAll search escape (Story 6.3)', () => {
  const tenantId = new Types.ObjectId();
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const aggregateExec = jest.fn();
  const cotizacionModel: any = {
    aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    aggregateExec.mockResolvedValue([{ data: [], totalCount: [{ count: 0 }] }]);
    service = new CotizacionesService(
      cotizacionModel as any,
      {} as any,
      {} as any,
      {} as any,
      tenantContext as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('escapa metacaracteres regex en search (p. ej. punto)', async () => {
    await service.findAll({ search: 'COT.', page: 1, limit: 10 });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const searchStage = pipeline.find(
      (s) => s.$match && Array.isArray(s.$match.$or),
    );
    expect(searchStage).toBeTruthy();
    const folioCond = searchStage.$match.$or.find((c: any) => c.folio);
    expect(folioCond.folio.$regex).toBe('COT\\.');
    expect(folioCond.folio.$options).toBe('i');
  });

  it('escapa * para no comportarse como wildcard', async () => {
    await service.findAll({ search: 'Empresa*', page: 1, limit: 10 });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const searchStage = pipeline.find(
      (s) => s.$match && Array.isArray(s.$match.$or),
    );
    const empresaCond = searchStage.$match.$or.find(
      (c: any) => c.nombreEmpresa,
    );
    expect(empresaCond.nombreEmpresa.$regex).toBe('Empresa\\*');
  });

  it('término corto no matchea por substring de estado', async () => {
    await service.findAll({ search: 'a', page: 1, limit: 10 });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const searchStage = pipeline.find(
      (s) => s.$match && Array.isArray(s.$match.$or),
    );
    expect(searchStage).toBeTruthy();
    const estadoCond = searchStage.$match.$or.find(
      (c: any) => Object.prototype.hasOwnProperty.call(c, 'estado'),
    );
    expect(estadoCond).toBeUndefined();
  });

  it('"vigente" (case-insensitive) sí incluye match exacto de estado', async () => {
    await service.findAll({ search: 'Vigente', page: 1, limit: 10 });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const searchStage = pipeline.find(
      (s) => s.$match && Array.isArray(s.$match.$or),
    );
    expect(searchStage).toBeTruthy();
    const estadoExact = searchStage.$match.$or.find(
      (c: any) => c.estado === 'vigente',
    );
    expect(estadoExact).toEqual({ estado: 'vigente' });
    const estadoRegex = searchStage.$match.$or.find(
      (c: any) => c.estado && typeof c.estado === 'object' && c.estado.$regex,
    );
    expect(estadoRegex).toBeUndefined();
  });
});

describe('CotizacionesService.findAll clienteId (Story 3.7)', () => {
  const tenantId = new Types.ObjectId();
  const clienteId = new Types.ObjectId();
  const otherClienteId = new Types.ObjectId();
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const aggregateExec = jest.fn();
  const cotizacionModel: any = {
    aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    aggregateExec.mockResolvedValue([{ data: [], totalCount: [{ count: 0 }] }]);
    service = new CotizacionesService(
      cotizacionModel as any,
      {} as any,
      {} as any,
      {} as any,
      tenantContext as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('añade clienteId + estado al $match junto a tenantId', async () => {
    aggregateExec.mockResolvedValue([{ data: [], totalCount: [{ count: 3 }] }]);
    const result = await service.findAll({
      clienteId: clienteId.toString(),
      estado: 'vigente',
      page: 1,
      limit: 1,
    });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const matchStage = pipeline.find(
      (s) =>
        s.$match &&
        s.$match.tenantId &&
        s.$match.clienteId &&
        !Array.isArray(s.$match.$or),
    );
    expect(matchStage).toBeTruthy();
    expect(matchStage.$match.tenantId).toEqual(tenantId);
    expect(matchStage.$match.estado).toBe('vigente');
    expect(matchStage.$match.clienteId).toEqual(clienteId);
    expect(result.total).toBe(3);
  });

  it('otro clienteId aísla match (tenantId+clienteId) y total 0', async () => {
    aggregateExec.mockResolvedValue([{ data: [], totalCount: [{ count: 0 }] }]);
    const result = await service.findAll({
      clienteId: otherClienteId.toString(),
      estado: 'aceptada',
      limit: 1,
    });
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const matchStage = pipeline.find(
      (s) =>
        s.$match &&
        s.$match.tenantId &&
        s.$match.clienteId &&
        !Array.isArray(s.$match.$or),
    );
    expect(matchStage).toBeTruthy();
    expect(matchStage.$match.tenantId).toEqual(tenantId);
    expect(matchStage.$match.clienteId).toEqual(otherClienteId);
    expect(matchStage.$match.clienteId).not.toEqual(clienteId);
    expect(matchStage.$match.estado).toBe('aceptada');
    expect(result.total).toBe(0);
  });
});

describe('CotizacionesService.findAll creadoPorNombre', () => {
  const tenantId = new Types.ObjectId();
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const aggregateExec = jest.fn();
  const cotizacionModel: any = {
    aggregate: jest.fn().mockReturnValue({ exec: aggregateExec }),
  };

  let service: CotizacionesService;

  beforeEach(() => {
    jest.clearAllMocks();
    aggregateExec.mockResolvedValue([{ data: [], totalCount: [{ count: 0 }] }]);
    service = new CotizacionesService(
      cotizacionModel as any,
      {} as any,
      {} as any,
      {} as any,
      tenantContext as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  function getFacetDataStages(): any[] {
    const pipeline = cotizacionModel.aggregate.mock.calls[0][0] as any[];
    const facet = pipeline.find((s) => s.$facet);
    expect(facet).toBeTruthy();
    return facet.$facet.data;
  }

  it('incluye $lookup users y proyecta creadoPorNombre (nombre o email)', async () => {
    await service.findAll({ page: 1, limit: 10 });
    const dataStages = getFacetDataStages();
    const lookup = dataStages.find(
      (s) => s.$lookup && s.$lookup.from === 'users',
    );
    expect(lookup).toBeTruthy();
    expect(lookup.$lookup.localField).toBe('creadoPorUserId');
    expect(lookup.$lookup.foreignField).toBe('_id');
    expect(lookup.$lookup.as).toBe('_creador');

    const project = dataStages.find((s) => s.$project);
    expect(project).toBeTruthy();
    expect(project.$project.creadoPorNombre).toEqual(
      expect.objectContaining({
        $let: expect.objectContaining({
          vars: expect.objectContaining({
            nombreTrim: expect.any(Object),
            emailTrim: expect.any(Object),
          }),
          in: expect.any(Object),
        }),
      }),
    );
  });

  it('mapea creadoPorNombre desde lookup (happy path)', async () => {
    const id = new Types.ObjectId();
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: id,
            folio: 'COT-2024-001',
            fecha: new Date('2024-01-15T10:00:00.000Z'),
            montoTotal: 1000,
            empresa: 'Empresa ABC',
            nombreSolicitante: 'Juan Pérez',
            creadoPorNombre: 'María López',
            rfc: 'ABC123456789',
            estado: 'vigente',
          },
        ],
        totalCount: [{ count: 1 }],
      },
    ]);
    const result = await service.findAll({ page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].creadoPorNombre).toBe('María López');
  });

  it('mapea fallback email cuando no hay nombre de usuario', async () => {
    const id = new Types.ObjectId();
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: id,
            folio: 'COT-2024-002',
            fecha: new Date('2024-01-16T10:00:00.000Z'),
            montoTotal: 500,
            empresa: 'Empresa XYZ',
            nombreSolicitante: 'Ana',
            creadoPorNombre: 'operador@ames.mx',
            rfc: 'XYZ987654321',
            estado: 'vigente',
          },
        ],
        totalCount: [{ count: 1 }],
      },
    ]);
    const result = await service.findAll({ page: 1, limit: 10 });
    expect(result.data[0].creadoPorNombre).toBe('operador@ames.mx');
  });

  it('sin creador: creadoPorNombre ausente/undefined y no lanza', async () => {
    const id = new Types.ObjectId();
    aggregateExec.mockResolvedValue([
      {
        data: [
          {
            _id: id,
            folio: 'COT-LEGACY-001',
            fecha: new Date('2023-01-01T10:00:00.000Z'),
            montoTotal: 200,
            empresa: 'Legacy SA',
            nombreSolicitante: 'Sin creador',
            rfc: 'LEG000000000',
            estado: 'vencida',
          },
        ],
        totalCount: [{ count: 1 }],
      },
    ]);
    const result = await service.findAll({ page: 1, limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].creadoPorNombre).toBeUndefined();
  });
});

describe('FilterCotizacionDto clienteId (Story 3.7)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { plainToInstance } = require('class-transformer');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { validate } = require('class-validator');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    FilterCotizacionDto: FilterDto,
  } = require('./dto/filter-cotizacion.dto');

  it('acepta ObjectId válido', async () => {
    const dto = plainToInstance(FilterDto, {
      clienteId: '507f1f77bcf86cd799439011',
      estado: 'vigente',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rechaza ObjectId inválido', async () => {
    const dto = plainToInstance(FilterDto, { clienteId: 'not-an-objectid' });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: any) => e.property === 'clienteId')).toBe(true);
  });
});

describe('CotizacionesService.create + enviarCorreoConPdf (Story 6.8)', () => {
  const tenantId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const year = new Date().getFullYear();
  const cotizacionId = new Types.ObjectId();

  const serviciosService = { findOne: jest.fn() };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
  const tenantCfg = {
    vigenciaDefaultDias: 30,
    emailRemitente: 'from@tenant.test',
    branding: { razonSocial: 'AMES Test' },
  };
  const tenantConfigService = {
    getForRequest: jest.fn().mockResolvedValue(tenantCfg),
    findByTenantId: jest.fn().mockResolvedValue(tenantCfg),
    getOutboundSmtpAuth: jest.fn().mockResolvedValue({
      emailUser: 'smtp@tenant.test',
      emailSecretEnc: 'enc-blob',
    }),
  };
  const countersService = {
    nextFolio: jest.fn().mockResolvedValue(`COT-${year}-0001`),
  };
  const emailService = { sendAdminQuotationEmail: jest.fn() };
  const tenantsService = {
    findById: jest.fn().mockResolvedValue({ activo: true }),
  };

  let service: CotizacionesService;
  let ModelCtor: any;
  let lastPersisted: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    tenantConfigService.findByTenantId.mockResolvedValue(tenantCfg);
    tenantConfigService.getForRequest.mockResolvedValue(tenantCfg);
    tenantConfigService.getOutboundSmtpAuth.mockResolvedValue({
      emailUser: 'smtp@tenant.test',
      emailSecretEnc: 'enc-blob',
    });
    tenantsService.findById.mockResolvedValue({ activo: true });
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: true,
      nombre: 'Servicio',
      precioUnitario: 100,
    });
    lastPersisted = null;
    const savedDoc = {
      _id: cotizacionId,
      tenantId,
      folio: `COT-${year}-0001`,
      emailsPara: ['a@x.com'],
      emailsCc: ['b@x.com'],
      nombreContacto: 'Ana',
      fechaVencimiento: new Date('2026-12-31'),
    };
    ModelCtor = jest.fn().mockImplementation((data: any) => {
      lastPersisted = data;
      return {
        ...data,
        save: jest.fn().mockResolvedValue({ ...savedDoc, ...data }),
      };
    });
    ModelCtor.findByIdAndUpdate = jest.fn().mockResolvedValue({});
    ModelCtor.findOne = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(savedDoc),
        }),
      }),
    });
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      serviciosService as any,
      emailService as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      tenantsService as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockResolvedValue(savedDoc as any);
  });

  it('create con enviarEmail NO llama SMTP', async () => {
    await service.createAdminCotizacion({
      items: [{ servicioId: servicioId.toString(), cantidad: 1 }],
      enviarEmail: true,
      emailsPara: ['a@x.com'],
    } as any);
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
    expect(ModelCtor.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('enviarCorreoConPdf OK emite token y SMTP con buffer FE', async () => {
    const pdf = {
      buffer: Buffer.from('%PDF-1.4'),
      mimetype: 'application/pdf',
      originalname: 'c.pdf',
    } as Express.Multer.File;
    emailService.sendAdminQuotationEmail.mockResolvedValue(undefined);

    const res = await service.enviarCorreoConPdf(cotizacionId.toString(), pdf);
    expect(res.ok).toBe(true);
    expect(emailService.sendAdminQuotationEmail).toHaveBeenCalled();
    expect(tenantConfigService.findByTenantId).toHaveBeenCalledWith(tenantId);
    expect(tenantConfigService.getForRequest).not.toHaveBeenCalled();
    const args = emailService.sendAdminQuotationEmail.mock.calls[0];
    expect(args[0]).toEqual(tenantId);
    expect(args[1]).toEqual(['a@x.com']);
    expect(args[4]).toBe(pdf.buffer);
    expect(typeof args[5]).toBe('string'); // magicToken
    expect(args[5].length).toBe(64);
    expect(args[6]).toBe('from@tenant.test');
  });

  it('enviarCorreoConPdf sin tenantId no emite magicToken', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      _id: cotizacionId,
      folio: 'X',
      emailsPara: ['a@x.com'],
      emailsCc: [],
      fechaVencimiento: new Date(),
    } as any);
    const issueSpy = jest.spyOn(service as any, 'issueMagicToken');
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(issueSpy).not.toHaveBeenCalled();
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
  });

  it('enviarCorreoConPdf sin Para → 400', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      _id: cotizacionId,
      folio: 'X',
      emailsPara: [],
      emailsCc: [],
      fechaVencimiento: new Date(),
    } as any);
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('x'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enviarCorreoConPdf sin file → 400', async () => {
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enviarCorreoConPdf mime no-PDF → 400', async () => {
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('not-pdf'),
        mimetype: 'application/octet-stream',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
  });

  it('SMTP fail → unset token y error visible', async () => {
    emailService.sendAdminQuotationEmail.mockRejectedValue(new Error('smtp'));
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ModelCtor.findByIdAndUpdate).toHaveBeenCalledWith(
      cotizacionId.toString(),
      { $unset: { magicToken: 1, magicTokenExpiresAt: 1 } },
    );
  });

  it('fallo TenantSecretsKeyError → HTTP 500 (no 400)', async () => {
    emailService.sendAdminQuotationEmail.mockRejectedValue(
      new TenantSecretsKeyError('clave inválida'),
    );
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('sin credenciales → 400 con mensaje de Configuración sin magicToken (Story 3.4)', async () => {
    tenantConfigService.getOutboundSmtpAuth.mockResolvedValue(null);
    const issueSpy = jest.spyOn(service as any, 'issueMagicToken');
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/Configuración/i),
      }),
    });
    expect(issueSpy).not.toHaveBeenCalled();
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
    expect(ModelCtor.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('TenantEmailNotConfiguredError tardío (p.ej. pass vacío) → 400 + unset magicToken', async () => {
    emailService.sendAdminQuotationEmail.mockRejectedValue(
      new TenantEmailNotConfiguredError(),
    );
    const issueSpy = jest.spyOn(service as any, 'issueMagicToken');
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: expect.stringMatching(/Configuración/i),
      }),
    });
    expect(issueSpy).toHaveBeenCalled();
    expect(ModelCtor.findByIdAndUpdate).toHaveBeenCalledWith(
      cotizacionId.toString(),
      { $unset: { magicToken: 1, magicTokenExpiresAt: 1 } },
    );
  });

  it('tenant inactivo → 403 sin emitir magicToken (Story 3.4 / AD-14)', async () => {
    tenantsService.findById.mockResolvedValue({ activo: false });
    const issueSpy = jest.spyOn(service as any, 'issueMagicToken');
    await expect(
      service.enviarCorreoConPdf(cotizacionId.toString(), {
        buffer: Buffer.from('%PDF'),
        mimetype: 'application/pdf',
        originalname: 'a.pdf',
      } as Express.Multer.File),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(issueSpy).not.toHaveBeenCalled();
    expect(emailService.sendAdminQuotationEmail).not.toHaveBeenCalled();
  });

  it('overrides Para/CC se persisten solo tras SMTP OK', async () => {
    const pdf = {
      buffer: Buffer.from('%PDF-1.4'),
      mimetype: 'application/pdf',
      originalname: 'c.pdf',
    } as Express.Multer.File;
    emailService.sendAdminQuotationEmail.mockResolvedValue(undefined);

    await service.enviarCorreoConPdf(cotizacionId.toString(), pdf, {
      emailsPara: ['nuevo@x.com'],
      emailsCc: ['cc@x.com'],
    });

    const updates = (ModelCtor.findByIdAndUpdate as jest.Mock).mock.calls.map(
      (c) => c[1],
    );
    expect(updates).toContainEqual({
      emailsPara: ['nuevo@x.com'],
      emailsCc: ['cc@x.com'],
    });
    const overrideIdx = updates.findIndex(
      (u) => u?.emailsPara?.[0] === 'nuevo@x.com',
    );
    const tokenIdx = updates.findIndex(
      (u) => typeof u?.magicToken === 'string',
    );
    expect(overrideIdx).toBeGreaterThan(tokenIdx);
  });
});

describe('CotizacionesService public magic link (Story 6.9)', () => {
  const tenantId = new Types.ObjectId();
  const token = 'a'.repeat(64);
  const future = new Date('2030-01-01T00:00:00.000Z');

  const tenantConfigService = {
    findByTenantId: jest.fn().mockResolvedValue({
      branding: { razonSocial: 'AMES Demo', logoUrl: '/uploads/x.png' },
    }),
  };

  let service: CotizacionesService;
  let ModelCtor: any;
  let doc: any;

  beforeEach(() => {
    jest.clearAllMocks();
    doc = {
      _id: new Types.ObjectId(),
      tenantId,
      folio: 'COT-2030-0001',
      estado: 'vigente',
      total: 100,
      moneda: 'MXN',
      fechaCreacion: new Date('2026-01-01'),
      fechaVencimiento: future,
      magicToken: token,
      magicTokenExpiresAt: future,
      nombreEmpresa: 'Acme',
      nombreContacto: 'Ana',
      items: [
        {
          nombreServicioSnapshot: 'Examen',
          descripcionServicioSnapshot: 'Desc',
          cantidad: 1,
          precioUnitarioSnapshot: 100,
          subtotal: 100,
        },
      ],
      emailsPara: ['secret@x.com'],
      notasInternas: [
        {
          _id: new Types.ObjectId(),
          texto: 'Nota interna secreta',
          autorUserId: new Types.ObjectId(),
          autorNombre: 'Admin',
          createdAt: new Date(),
        },
      ],
    };
    ModelCtor = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...doc,
          estado: 'aceptada',
          fechaAceptacion: new Date(),
          estadoOrigen: 'magic_link',
        }),
      }),
    };
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      tenantConfigService as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('GET token OK → DTO público sin fugas', async () => {
    const dto = await service.findOneByMagicToken(token);
    expect(dto.folio).toBe('COT-2030-0001');
    expect(dto.branding?.razonSocial).toBe('AMES Demo');
    expect(dto.items[0].nombre).toBe('Examen');
    expect(dto as any).not.toHaveProperty('magicToken');
    expect(dto as any).not.toHaveProperty('tenantId');
    expect(dto as any).not.toHaveProperty('emailsPara');
    expect(dto as any).not.toHaveProperty('notasInternas');
  });

  it('GET token inválido → 404', async () => {
    ModelCtor.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    await expect(service.findOneByMagicToken('bad')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('GET token expirado → 401', async () => {
    doc.magicTokenExpiresAt = new Date('2000-01-01');
    await expect(service.findOneByMagicToken(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accept vigente → aceptada + origen magic_link; no unset token', async () => {
    const dto = await service.aceptarCotizacionByMagicToken(token);
    expect(dto.estado).toBe('aceptada');
    const call = ModelCtor.findOneAndUpdate.mock.calls[0];
    expect(call[0]).toEqual({
      magicToken: token,
      estado: 'vigente',
      $or: [
        { sinVigencia: true },
        { fechaVencimiento: { $gte: expect.any(Date) } },
      ],
    });
    expect(call[1].$set.estadoOrigen).toBe('magic_link');
    // Limpia actor AMES residual; no toca magicToken (sigue válido para consulta).
    expect(call[1].$unset).toEqual({
      estadoCambiadoPorUserId: '',
      estadoCambiadoPorNombre: '',
    });
    expect(call[1].$unset.magicToken).toBeUndefined();
  });

  it('GET proyecta vencida si fechaVencimiento pasó y DB sigue vigente', async () => {
    doc.fechaVencimiento = new Date('2020-01-01T00:00:00.000Z');
    doc.magicTokenExpiresAt = future; // token aún válido
    const dto = await service.findOneByMagicToken(token);
    expect(dto.estado).toBe('vencida');
  });

  it('accept idempotente si ya aceptada → 200 alreadyResponded', async () => {
    doc.estado = 'aceptada';
    doc.fechaAceptacion = new Date();
    const dto = await service.aceptarCotizacionByMagicToken(token);
    expect(dto.estado).toBe('aceptada');
    expect(dto.alreadyResponded).toBe(true);
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('accept cuando ya rechazada → 400', async () => {
    doc.estado = 'rechazada';
    await expect(
      service.aceptarCotizacionByMagicToken(token),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accept cuando cancelada → 400 sin mutar', async () => {
    doc.estado = 'cancelada';
    try {
      await service.aceptarCotizacionByMagicToken(token);
      fail('expected BadRequestException');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify((e as BadRequestException).getResponse())).toMatch(
        /cancelada/i,
      );
    }
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('reject simétrico + vencida → 400', async () => {
    ModelCtor.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...doc,
        estado: 'rechazada',
        fechaRechazo: new Date(),
        estadoOrigen: 'magic_link',
      }),
    });
    const ok = await service.rechazarCotizacionByMagicToken(token);
    expect(ok.estado).toBe('rechazada');

    doc.estado = 'vencida';
    await expect(
      service.rechazarCotizacionByMagicToken(token),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CotizacionesService cambio manual + provenance (Story 6.10)', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const actor = { _id: String(userId), email: 'edgar@ames.example' };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };
  const usersService = {
    findById: jest.fn().mockResolvedValue({
      _id: userId,
      nombre: 'Edgar',
      email: 'edgar@ames.example',
    }),
  };
  const tenantConfigService = {
    getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 30 }),
  };

  let service: CotizacionesService;
  let ModelCtor: any;
  let doc: any;

  function chainPopulate(result: any) {
    return {
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(result),
        }),
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 30,
    });
    doc = {
      _id: cotizacionId,
      tenantId,
      folio: 'COT-2030-0010',
      estado: 'vigente',
      total: 100,
      fechaVencimiento: new Date('2030-01-01'),
    };
    ModelCtor = {
      findOne: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(doc),
          }),
        }),
      }),
      findOneAndUpdate: jest.fn().mockImplementation((_q: any, update: any) =>
        chainPopulate({
          ...doc,
          ...(update?.$set || {}),
        }),
      ),
    };
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      {} as any,
      {} as any,
      usersService as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(service, 'findOne').mockImplementation(async () => {
      const last = ModelCtor.findOneAndUpdate.mock.calls.at(-1);
      const set = last?.[1]?.$set || {};
      return { ...doc, ...set } as any;
    });
  });

  it('cambiarEstadoManual → aceptada con origen usuario + nombre', async () => {
    const result = await service.cambiarEstadoManual(
      String(cotizacionId),
      'aceptada',
      actor,
    );
    expect(result.estado).toBe('aceptada');
    const call = ModelCtor.findOneAndUpdate.mock.calls[0];
    expect(call[0]).toEqual({
      _id: String(cotizacionId),
      tenantId,
      estado: 'vigente',
    });
    expect(call[1].$set.estadoOrigen).toBe('usuario');
    expect(call[1].$set.estadoCambiadoPorNombre).toBe('Edgar');
    expect(call[1].$set.estado).toBe('aceptada');
    expect(call[1].$set.fechaAceptacion).toBeInstanceOf(Date);
    expect(call[1].$set.fechaRechazo).toBeNull();
  });

  it('mismo estado → 400', async () => {
    await expect(
      service.cambiarEstadoManual(String(cotizacionId), 'vigente', actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('aceptarCotizacionAdmin delega provenance usuario', async () => {
    await service.aceptarCotizacionAdmin(String(cotizacionId), actor);
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.estadoOrigen).toBe('usuario');
    expect(set.estadoCambiadoPorNombre).toBe('Edgar');
  });

  it('fallback a email si UsersService falla', async () => {
    usersService.findById.mockRejectedValueOnce(new Error('not found'));
    await service.cambiarEstadoManual(String(cotizacionId), 'rechazada', actor);
    expect(
      ModelCtor.findOneAndUpdate.mock.calls[0][1].$set.estadoCambiadoPorNombre,
    ).toBe('edgar@ames.example');
  });

  it('transición a vencida setea fechaEstadoVencida y limpia aceptación', async () => {
    doc.estado = 'aceptada';
    await service.cambiarEstadoManual(String(cotizacionId), 'vencida', actor);
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.estado).toBe('vencida');
    expect(set.fechaEstadoVencida).toBeInstanceOf(Date);
    expect(set.fechaAceptacion).toBeNull();
  });

  it('cambiarEstadoManual → cancelada con provenance usuario + fechaEstadoCancelada', async () => {
    await service.cambiarEstadoManual(String(cotizacionId), 'cancelada', actor);
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.estado).toBe('cancelada');
    expect(set.estadoOrigen).toBe('usuario');
    expect(set.estadoCambiadoPorNombre).toBe('Edgar');
    expect(set.fechaEstadoCancelada).toBeInstanceOf(Date);
    expect(set.fechaAceptacion).toBeNull();
    expect(set.fechaRechazo).toBeNull();
  });

  it('cambiarEstadoManual → vigente extiende fechaVencimiento + provenance', async () => {
    doc.estado = 'rechazada';
    const before = Date.now();
    const result = await service.cambiarEstadoManual(
      String(cotizacionId),
      'vigente',
      actor,
    );
    expect(result.estado).toBe('vigente');
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.estadoOrigen).toBe('usuario');
    expect(set.fechaVencimiento).toBeInstanceOf(Date);
    expect((set.fechaVencimiento as Date).getTime()).toBeGreaterThan(before);
    expect(set.fechaRechazo).toBeNull();
    expect(tenantConfigService.getForRequest).toHaveBeenCalled();
  });

  it('vigente con fechaVencimiento pasada → 400', async () => {
    doc.estado = 'vencida';
    await expect(
      service.cambiarEstadoManual(String(cotizacionId), 'vigente', actor, {
        fechaVencimiento: '2020-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('tenant isolation: findOne 404 impide mutación', async () => {
    jest
      .spyOn(service, 'findOne')
      .mockRejectedValueOnce(
        new NotFoundException(
          `Cotización con ID ${cotizacionId} no encontrada`,
        ),
      );
    await expect(
      service.cambiarEstadoManual(String(cotizacionId), 'aceptada', actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('update() que cambia estado delega provenance usuario', async () => {
    await service.update(
      String(cotizacionId),
      { estado: 'vencida' } as any,
      actor,
    );
    const set = ModelCtor.findOneAndUpdate.mock.calls[0][1].$set;
    expect(set.estado).toBe('vencida');
    expect(set.estadoOrigen).toBe('usuario');
    expect(set.estadoCambiadoPorNombre).toBe('Edgar');
  });
});

describe('CotizacionesService markExpiredQuotations (Story 6.11)', () => {
  const tenantId = new Types.ObjectId();
  let service: CotizacionesService;
  let ModelCtor: any;

  beforeEach(() => {
    jest.clearAllMocks();
    ModelCtor = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    };
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('setea estadoOrigen cron + estadoOrigenAt y unset actor AMES', async () => {
    const count = await service.markExpiredQuotations();
    expect(count).toBe(2);
    expect(ModelCtor.updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = ModelCtor.updateMany.mock.calls[0];
    expect(filter).toEqual({
      estado: 'vigente',
      sinVigencia: { $ne: true },
      fechaVencimiento: { $lt: expect.any(Date) },
    });
    expect(filter.tenantId).toBeUndefined();
    expect(update.$set.estado).toBe('vencida');
    expect(update.$set.estadoOrigen).toBe('cron');
    expect(update.$set.estadoOrigenAt).toBeInstanceOf(Date);
    expect(update.$set.fechaEstadoVencida).toBeInstanceOf(Date);
    expect(update.$unset).toEqual({
      estadoCambiadoPorUserId: '',
      estadoCambiadoPorNombre: '',
    });
  });

  it('mix vigente-expirada + aceptada/rechazada: solo vigentes expiradas reciben cron', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const future = new Date('2099-01-01T00:00:00.000Z');
    const docs: Array<{
      estado: string;
      fechaVencimiento: Date;
      estadoOrigen?: string;
    }> = [
      { estado: 'vigente', fechaVencimiento: past },
      { estado: 'aceptada', fechaVencimiento: past },
      { estado: 'rechazada', fechaVencimiento: past },
      { estado: 'vigente', fechaVencimiento: future },
    ];
    ModelCtor.updateMany.mockImplementation(
      (filter: Record<string, any>, update: Record<string, any>) => {
        const cutoff = filter.fechaVencimiento?.$lt as Date;
        const matched = docs.filter(
          (d) =>
            d.estado === filter.estado &&
            (d as any).sinVigencia !== true &&
            d.fechaVencimiento.getTime() < cutoff.getTime(),
        );
        for (const d of matched) {
          d.estado = update.$set.estado;
          d.estadoOrigen = update.$set.estadoOrigen;
        }
        return Promise.resolve({ modifiedCount: matched.length });
      },
    );

    const count = await service.markExpiredQuotations();
    expect(count).toBe(1);
    expect(docs.filter((d) => d.estadoOrigen === 'cron')).toHaveLength(1);
    expect(
      docs.find((d) => d.estado === 'aceptada')?.estadoOrigen,
    ).toBeUndefined();
    expect(
      docs.find((d) => d.estado === 'rechazada')?.estadoOrigen,
    ).toBeUndefined();
    expect(
      docs.find((d) => d.fechaVencimiento.getTime() === future.getTime())
        ?.estado,
    ).toBe('vigente');
  });

  it('cron no modifica cotizaciones canceladas', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    const docs = [{ estado: 'cancelada', fechaVencimiento: past }];
    ModelCtor.updateMany.mockImplementation(
      (filter: Record<string, any>, update: Record<string, any>) => {
        const cutoff = filter.fechaVencimiento?.$lt as Date;
        const matched = docs.filter(
          (d) =>
            d.estado === filter.estado &&
            d.fechaVencimiento.getTime() < cutoff.getTime(),
        );
        for (const d of matched) {
          d.estado = update.$set.estado;
        }
        return Promise.resolve({ modifiedCount: matched.length });
      },
    );
    const count = await service.markExpiredQuotations();
    expect(count).toBe(0);
    expect(docs[0].estado).toBe('cancelada');
  });

  it('excluye sinVigencia del cron (Story 6.15)', async () => {
    const past = new Date('2020-01-01T00:00:00.000Z');
    ModelCtor.updateMany.mockImplementation((filter: Record<string, any>) => {
      const cutoff = filter.fechaVencimiento?.$lt as Date;
      const docs = [
        { estado: 'vigente', fechaVencimiento: past, sinVigencia: true },
        { estado: 'vigente', fechaVencimiento: past, sinVigencia: false },
      ];
      const matched = docs.filter(
        (d) =>
          d.estado === filter.estado &&
          d.sinVigencia !== true &&
          filter.sinVigencia?.$ne === true &&
          d.fechaVencimiento.getTime() < cutoff.getTime(),
      );
      return Promise.resolve({ modifiedCount: matched.length });
    });
    const count = await service.markExpiredQuotations();
    expect(count).toBe(1);
    const filter = ModelCtor.updateMany.mock.calls[0][0];
    expect(filter.sinVigencia).toEqual({ $ne: true });
  });

  it('con tenantId el filter incluye tenant (HTTP mark-expired)', async () => {
    await service.markExpiredQuotations(tenantId);
    const filter = ModelCtor.updateMany.mock.calls[0][0];
    expect(filter.tenantId).toEqual(tenantId);
    expect(filter.estado).toBe('vigente');
    const update = ModelCtor.updateMany.mock.calls[0][1];
    expect(update.$set.estadoOrigen).toBe('cron');
  });

  it('handleCronMarkExpired delega sin tenant (global)', async () => {
    const spy = jest
      .spyOn(service, 'markExpiredQuotations')
      .mockResolvedValue(3);
    await service.handleCronMarkExpired();
    expect(spy).toHaveBeenCalledWith();
    spy.mockRestore();
  });
});

describe('CotizacionesService repetirCotizacion (Story 6.12)', () => {
  const tenantId = new Types.ObjectId();
  const fuenteId = new Types.ObjectId().toString();
  const servicioId = new Types.ObjectId();
  const servicioIdStr = servicioId.toString();

  let service: CotizacionesService;
  let ModelCtor: any;
  let savedPayload: any;
  let serviciosService: { findOne: jest.Mock };
  let clientesService: { findOne: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };
  let tenantConfigService: { getForRequest: jest.Mock };
  let countersService: { nextFolio: jest.Mock };

  const fuenteBase = () => ({
    _id: fuenteId,
    tenantId,
    folio: 'COT-2026-0001',
    estado: 'aceptada',
    nombreEmpresa: 'Acme',
    nombreContacto: 'Ana',
    emailContacto: 'ana@acme.com',
    emailsPara: ['ana@acme.com'],
    emailsCc: ['cc@acme.com'],
    incluirDatosBancarios: true,
    incluirImagenesPdf: true,
    plantillasSnapshot: [
      {
        plantillaId: new Types.ObjectId(),
        nombreSnapshot: 'Comercial',
        schemaVersion: 1,
        secciones: [{ id: 's1', tipo: 'richtext', titulo: 'T', cuerpo: {} }],
      },
    ],
    magicToken: 'should-not-copy',
    estadoOrigen: 'usuario',
    items: [
      {
        servicioId,
        nombreServicioSnapshot: 'Snap Nombre',
        descripcionServicioSnapshot: 'Snap Desc',
        precioUnitarioSnapshot: 100,
        cantidad: 2,
        subtotal: 200,
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    savedPayload = null;
    serviciosService = {
      findOne: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        activo: true,
        nombre: 'Catálogo Nombre',
        descripcion: 'Catálogo Desc',
        precioUnitario: 250,
      }),
    };
    clientesService = { findOne: jest.fn() };
    tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
    tenantConfigService = {
      getForRequest: jest.fn().mockResolvedValue({
        vigenciaDefaultDias: 15,
        bancarios: { banco: 'X', clabe: '123' },
      }),
    };
    countersService = {
      nextFolio: jest.fn().mockResolvedValue('COT-2026-0099'),
    };

    ModelCtor = function ModelCtor(this: any, data: any) {
      savedPayload = data;
      this.save = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ...data,
      });
      return this;
    };

    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );

    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        return fuenteBase() as any;
      }
      return {
        _id: id,
        folio: 'COT-2026-0099',
        estado: 'vigente',
        items: savedPayload?.items,
        total: savedPayload?.total,
        magicToken: undefined,
      } as any;
    });
  });

  it('originales: snapshots de fuente, folio nuevo, vigente, sin magicToken', async () => {
    const created = await service.repetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });
    expect(countersService.nextFolio).toHaveBeenCalledWith(tenantId);
    expect(savedPayload.folio).toBe('COT-2026-0099');
    expect(savedPayload.estado).toBe('vigente');
    expect(savedPayload.magicToken).toBeUndefined();
    expect(savedPayload.estadoOrigen).toBeUndefined();
    expect(savedPayload.items[0].nombreServicioSnapshot).toBe('Snap Nombre');
    expect(savedPayload.items[0].precioUnitarioSnapshot).toBe(100);
    expect(savedPayload.items[0].cantidad).toBe(2);
    expect(savedPayload.emailsPara).toEqual(['ana@acme.com']);
    expect(savedPayload.plantillasSnapshot[0].nombreSnapshot).toBe('Comercial');
    expect(savedPayload.incluirImagenesPdf).toBe(true);
    expect((created.cotizacion as any).folio).toBe('COT-2026-0099');
    expect(created.originalCancelada).toBe(false);
    expect(created.originalCancelacionError).toBeUndefined();
    // fuente no mutada vía update
    expect(ModelCtor.updateMany).toBeUndefined();
  });

  it('ya no fuerza incluirDatosBancarios false por falta de bancarios útiles', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 15,
      bancarios: {}, // sin datos útiles
    });

    await service.repetirCotizacion(fuenteId, { modoPrecios: 'originales' });

    // fuente tenía incluirDatosBancarios: true → se copia igual, sin forzar false
    expect(savedPayload.incluirDatosBancarios).toBe(true);
  });

  it('campos ausentes en fuente antigua → aplica default del tenant (??true)', async () => {
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        const { incluirDescripciones, incluirImagenesPdf, ...rest } =
          fuenteBase() as any;
        return rest;
      }
      return {
        _id: id,
        folio: 'COT-2026-0099',
        estado: 'vigente',
        items: savedPayload?.items,
        total: savedPayload?.total,
        magicToken: undefined,
      } as any;
    });
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 15,
      bancarios: { banco: 'X', clabe: '123' },
      defaultIncluirDescripciones: false,
    });

    await service.repetirCotizacion(fuenteId, { modoPrecios: 'originales' });

    expect(savedPayload.incluirDescripciones).toBe(false); // default tenant
    expect(savedPayload.incluirImagenesPdf).toBe(true); // sin default tenant → true
  });

  it('originales + servicio inactivo: OK (no 400)', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: false,
      nombre: 'Inactivo',
      precioUnitario: 1,
    });
    await service.repetirCotizacion(fuenteId, { modoPrecios: 'originales' });
    expect(savedPayload.items[0].precioUnitarioSnapshot).toBe(100);
    expect(savedPayload.items[0].nombreServicioSnapshot).toBe('Snap Nombre');
  });

  it('actualizados: usa nombre/precio del catálogo', async () => {
    await service.repetirCotizacion(fuenteId, { modoPrecios: 'actualizados' });
    expect(savedPayload.items[0].nombreServicioSnapshot).toBe(
      'Catálogo Nombre',
    );
    expect(savedPayload.items[0].precioUnitarioSnapshot).toBe(250);
    expect(savedPayload.items[0].descripcionServicioSnapshot).toBe(
      'Catálogo Desc',
    );
    expect(savedPayload.total).toBe(500);
  });

  it('actualizados + inactivo sin resolución → 400 con warnings', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: false,
      nombre: 'Inactivo',
      precioUnitario: 1,
    });
    try {
      await service.repetirCotizacion(fuenteId, {
        modoPrecios: 'actualizados',
      });
      fail('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const body = (e as HttpException).getResponse() as any;
      expect(body.warnings).toEqual([
        {
          index: 0,
          servicioId: servicioIdStr,
          motivo: 'inactivo',
        },
      ]);
    }
    expect(savedPayload).toBeNull();
  });

  it('actualizados + omitirServicioIds crea sin el ítem problemático', async () => {
    const otroId = new Types.ObjectId();
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        const f = fuenteBase();
        f.items.push({
          servicioId: otroId,
          nombreServicioSnapshot: 'Otro',
          precioUnitarioSnapshot: 10,
          cantidad: 1,
          subtotal: 10,
        } as any);
        return f as any;
      }
      return { _id: id, folio: 'COT-2026-0099', estado: 'vigente' } as any;
    });
    serviciosService.findOne.mockImplementation(async (sid: string) => {
      if (String(sid) === servicioIdStr) {
        return {
          _id: servicioId,
          tenantId,
          activo: false,
          nombre: 'Inactivo',
          precioUnitario: 1,
        };
      }
      return {
        _id: otroId,
        tenantId,
        activo: true,
        nombre: 'Activo',
        precioUnitario: 40,
      };
    });

    await service.repetirCotizacion(fuenteId, {
      modoPrecios: 'actualizados',
      omitirServicioIds: [servicioIdStr],
    });
    expect(savedPayload.items).toHaveLength(1);
    expect(savedPayload.items[0].nombreServicioSnapshot).toBe('Activo');
    expect(savedPayload.total).toBe(40);
  });

  it('actualizados + sustituciones crea con servicio de reemplazo', async () => {
    const reemplazoId = new Types.ObjectId();
    serviciosService.findOne.mockImplementation(async (sid: string) => {
      if (String(sid) === servicioIdStr) {
        return {
          _id: servicioId,
          tenantId,
          activo: false,
          nombre: 'Inactivo',
          precioUnitario: 1,
        };
      }
      if (String(sid) === reemplazoId.toString()) {
        return {
          _id: reemplazoId,
          tenantId,
          activo: true,
          nombre: 'Reemplazo',
          descripcion: 'Nuevo',
          precioUnitario: 75,
        };
      }
      throw new NotFoundException(`Servicio ${sid}`);
    });

    await service.repetirCotizacion(fuenteId, {
      modoPrecios: 'actualizados',
      sustituciones: [
        {
          fromServicioId: servicioIdStr,
          toServicioId: reemplazoId.toString(),
        },
      ],
    });
    expect(savedPayload.items).toHaveLength(1);
    expect(savedPayload.items[0].nombreServicioSnapshot).toBe('Reemplazo');
    expect(savedPayload.items[0].precioUnitarioSnapshot).toBe(75);
    expect(savedPayload.items[0].cantidad).toBe(2);
    expect(savedPayload.total).toBe(150);
  });

  it('tenant isolation: findOne 404 impide repetir', async () => {
    jest
      .spyOn(service, 'findOne')
      .mockRejectedValue(
        new NotFoundException(`Cotización con ID ${fuenteId} no encontrada`),
      );
    await expect(
      service.repetirCotizacion(fuenteId, { modoPrecios: 'originales' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(savedPayload).toBeNull();
  });

  it('cancelarOriginal=true cancela fuente vía cambiarEstadoManual', async () => {
    const actor = { _id: new Types.ObjectId().toString(), email: 'a@ames.test' };
    const cancelSpy = jest
      .spyOn(service, 'cambiarEstadoManual')
      .mockResolvedValue({ estado: 'cancelada' } as any);
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        return { ...fuenteBase(), estado: 'vigente' } as any;
      }
      return {
        _id: id,
        folio: 'COT-2026-0099',
        estado: 'vigente',
      } as any;
    });

    const result = await service.repetirCotizacion(
      fuenteId,
      { modoPrecios: 'originales', cancelarOriginal: true },
      actor,
    );
    expect((result.cotizacion as any).folio).toBe('COT-2026-0099');
    expect(result.originalCancelada).toBe(true);
    expect(result.originalCancelacionError).toBeUndefined();
    expect(cancelSpy).toHaveBeenCalledWith(fuenteId, 'cancelada', actor);
  });

  it('cancelarOriginal omitido no muta la fuente', async () => {
    const cancelSpy = jest.spyOn(service, 'cambiarEstadoManual');
    const result = await service.repetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });
    expect(result.originalCancelada).toBe(false);
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('cancelarOriginal desde fuente ya cancelada es no-op', async () => {
    const cancelSpy = jest.spyOn(service, 'cambiarEstadoManual');
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        return { ...fuenteBase(), estado: 'cancelada' } as any;
      }
      return { _id: id, folio: 'COT-2026-0099', estado: 'vigente' } as any;
    });
    const result = await service.repetirCotizacion(
      fuenteId,
      { modoPrecios: 'originales', cancelarOriginal: true },
      { _id: new Types.ObjectId().toString(), email: 'a@ames.test' },
    );
    expect(result.originalCancelada).toBe(true);
    expect(result.originalCancelacionError).toBeUndefined();
    expect(cancelSpy).not.toHaveBeenCalled();
  });

  it('create OK + fallo al cancelar → envelope parcial sin rollback', async () => {
    const actor = { _id: new Types.ObjectId().toString(), email: 'a@ames.test' };
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        return { ...fuenteBase(), estado: 'vigente' } as any;
      }
      return { _id: id, folio: 'COT-2026-0099', estado: 'vigente' } as any;
    });
    jest
      .spyOn(service, 'cambiarEstadoManual')
      .mockRejectedValue(new BadRequestException('lock conflict'));

    const result = await service.repetirCotizacion(
      fuenteId,
      { modoPrecios: 'originales', cancelarOriginal: true },
      actor,
    );
    expect(savedPayload).not.toBeNull();
    expect((result.cotizacion as any).folio).toBe('COT-2026-0099');
    expect(result.originalCancelada).toBe(false);
    expect(result.originalCancelacionError).toMatch(/lock conflict|cancelar/i);
  });
});

describe('CotizacionesService repetirCotizacion recordatorio (Story 11.1)', () => {
  const tenantId = new Types.ObjectId();
  const fuenteId = new Types.ObjectId().toString();
  const servicioId = new Types.ObjectId();
  const nuevaId = new Types.ObjectId();

  let service: CotizacionesService;
  let savedPayload: any;
  let recordatoriosService: {
    cancelarPorRepetir: jest.Mock;
    resolveRecetaRearme: jest.Mock;
    assertRecetaRearmeValida: jest.Mock;
    programarEnCotizacionNueva: jest.Mock;
  };

  const fuenteBase = () => ({
    _id: fuenteId,
    tenantId,
    folio: 'COT-2026-0001',
    estado: 'aceptada',
    items: [
      {
        servicioId,
        nombreServicioSnapshot: 'Snap',
        descripcionServicioSnapshot: 'D',
        precioUnitarioSnapshot: 100,
        cantidad: 1,
        subtotal: 100,
      },
    ],
    plantillasSnapshot: [],
    emailsPara: [],
    emailsCc: [],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    savedPayload = null;
    recordatoriosService = {
      cancelarPorRepetir: jest.fn().mockResolvedValue(true),
      resolveRecetaRearme: jest.fn(),
      assertRecetaRearmeValida: jest.fn().mockResolvedValue(undefined),
      programarEnCotizacionNueva: jest.fn().mockResolvedValue({}),
    };

    const ModelCtor = function ModelCtor(this: any, data: any) {
      savedPayload = data;
      this.save = jest.fn().mockResolvedValue({
        _id: nuevaId,
        ...data,
      });
      return this;
    };

    service = new CotizacionesService(
      ModelCtor as any,
      { findOne: jest.fn() } as any,
      {
        findOne: jest.fn().mockResolvedValue({
          _id: servicioId,
          tenantId,
          activo: true,
          nombre: 'Srv',
          precioUnitario: 100,
          descripcion: 'd',
        }),
      } as any,
      {} as any,
      { getTenantId: jest.fn().mockReturnValue(tenantId) } as any,
      {
        getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 15 }),
      } as any,
      { nextFolio: jest.fn().mockResolvedValue('COT-2026-0099') } as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      recordatoriosService as any,
    );

    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId)) {
        return fuenteBase() as any;
      }
      return {
        _id: nuevaId,
        folio: 'COT-2026-0099',
        estado: 'vigente',
      } as any;
    });
  });

  it('siempre cancela recordatorio origen tras crear', async () => {
    await service.repetirCotizacion(fuenteId, { modoPrecios: 'originales' });
    expect(recordatoriosService.cancelarPorRepetir).toHaveBeenCalledWith(
      fuenteId,
    );
    expect(recordatoriosService.resolveRecetaRearme).not.toHaveBeenCalled();
    expect(recordatoriosService.programarEnCotizacionNueva).not.toHaveBeenCalled();
  });

  it('rearmar: resolve + programar en COT nueva', async () => {
    recordatoriosService.resolveRecetaRearme.mockResolvedValue({
      familia: 'relativo_hoy',
      preset: '3_meses',
    });
    await service.repetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
      rearmarRecordatorio: true,
    });
    expect(recordatoriosService.resolveRecetaRearme).toHaveBeenCalledWith(
      fuenteId,
      undefined,
    );
    expect(recordatoriosService.assertRecetaRearmeValida).toHaveBeenCalled();
    expect(recordatoriosService.programarEnCotizacionNueva).toHaveBeenCalledWith(
      String(nuevaId),
      { familia: 'relativo_hoy', preset: '3_meses' },
    );
  });

  it('rearmar: receta inválida falla antes de crear', async () => {
    recordatoriosService.resolveRecetaRearme.mockResolvedValue({
      familia: 'fecha_exacta',
    });
    recordatoriosService.assertRecetaRearmeValida.mockRejectedValue(
      new BadRequestException('fechaExacta requerida para fecha_exacta'),
    );
    await expect(
      service.repetirCotizacion(fuenteId, {
        modoPrecios: 'originales',
        rearmarRecordatorio: true,
        recetaRecordatorio: { familia: 'fecha_exacta' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedPayload).toBeNull();
    expect(recordatoriosService.cancelarPorRepetir).not.toHaveBeenCalled();
  });

  it('rearmar fecha_exacta sin receta falla antes de crear', async () => {
    recordatoriosService.resolveRecetaRearme.mockRejectedValue(
      new BadRequestException(
        'rearmar con fecha exacta requiere recetaRecordatorio en el body',
      ),
    );
    await expect(
      service.repetirCotizacion(fuenteId, {
        modoPrecios: 'originales',
        rearmarRecordatorio: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(savedPayload).toBeNull();
    expect(recordatoriosService.cancelarPorRepetir).not.toHaveBeenCalled();
  });
});

describe('CotizacionesService previewRepetirCotizacion', () => {
  const tenantId = new Types.ObjectId();
  const fuenteId = new Types.ObjectId().toString();
  const servicioId = new Types.ObjectId();
  const servicioIdStr = servicioId.toString();

  let service: CotizacionesService;
  let ModelCtor: any;
  let savedPayload: any;
  let serviciosService: { findOne: jest.Mock };
  let clientesService: { findOne: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };
  let tenantConfigService: { getForRequest: jest.Mock };

  const fuenteBase = () => ({
    _id: fuenteId,
    tenantId,
    folio: 'COT-2026-0001',
    estado: 'aceptada',
    nombreEmpresa: 'Acme',
    nombreContacto: 'Ana',
    emailContacto: 'ana@acme.com',
    emailsPara: ['ana@acme.com'],
    emailsCc: ['cc@acme.com'],
    incluirDatosBancarios: true,
    incluirDescripciones: true,
    incluirImagenesPdf: true,
    plantillasSnapshot: [
      {
        plantillaId: new Types.ObjectId(),
        nombreSnapshot: 'Comercial',
        schemaVersion: 1,
        secciones: [{ id: 's1', tipo: 'richtext', titulo: 'T', cuerpo: {} }],
      },
    ],
    items: [
      {
        servicioId,
        nombreServicioSnapshot: 'Snap Nombre',
        descripcionServicioSnapshot: 'Snap Desc',
        precioUnitarioSnapshot: 100,
        cantidad: 2,
        subtotal: 200,
      },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    savedPayload = null;
    serviciosService = {
      findOne: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        activo: true,
        nombre: 'Catálogo Nombre',
        descripcion: 'Catálogo Desc',
        precioUnitario: 250,
      }),
    };
    clientesService = { findOne: jest.fn() };
    tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
    tenantConfigService = {
      getForRequest: jest.fn().mockResolvedValue({
        vigenciaDefaultDias: 15,
        bancarios: { banco: 'X', clabe: '123' },
      }),
    };

    ModelCtor = function ModelCtor(this: any, data: any) {
      savedPayload = data;
      this.save = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ...data,
      });
      return this;
    };

    service = new CotizacionesService(
      ModelCtor as any,
      clientesService as any,
      serviciosService as any,
      {} as any,
      tenantContext as any,
      tenantConfigService as any,
      { nextFolio: jest.fn() } as any,
      {} as any,
      {} as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );

    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        return fuenteBase() as any;
      }
      return { _id: id } as any;
    });
  });

  it('no persiste — ModelCtor.save no se invoca', async () => {
    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });
    expect(preview.items[0].nombre).toBe('Snap Nombre');
    expect(preview.items[0].precioUnitario).toBe(100);
    expect(preview.moneda).toBe('MXN');
    expect(preview.emailsPara).toEqual(['ana@acme.com']);
    expect(preview.plantillas[0].nombre).toBe('Comercial');
    expect(savedPayload).toBeNull();
  });

  it('originales: snapshots de fuente en items wizard-ready', async () => {
    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });
    expect(preview.items[0]).toMatchObject({
      servicioId: servicioIdStr,
      cantidad: 2,
      nombre: 'Snap Nombre',
      descripcion: 'Snap Desc',
      precioUnitario: 100,
    });
    expect(preview.incluirDescripciones).toBe(true);
    expect(preview.incluirImagenesPdf).toBe(true);
  });

  it('ya no fuerza incluirDatosBancarios false por falta de bancarios útiles', async () => {
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 15,
      bancarios: {}, // sin datos útiles
    });

    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });

    expect(preview.incluirDatosBancarios).toBe(true);
  });

  it('campos ausentes en fuente antigua → aplica default del tenant (??true)', async () => {
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        const { incluirDescripciones, incluirImagenesPdf, ...rest } =
          fuenteBase() as any;
        return rest;
      }
      return { _id: id } as any;
    });
    tenantConfigService.getForRequest.mockResolvedValue({
      vigenciaDefaultDias: 15,
      bancarios: { banco: 'X', clabe: '123' },
      defaultIncluirImagenesPdf: false,
    });

    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'originales',
    });

    expect(preview.incluirDescripciones).toBe(true); // sin default tenant → true
    expect(preview.incluirImagenesPdf).toBe(false); // default tenant
  });

  it('actualizados: precios del catálogo', async () => {
    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'actualizados',
    });
    expect(preview.items[0].nombre).toBe('Catálogo Nombre');
    expect(preview.items[0].precioUnitario).toBe(250);
    expect(savedPayload).toBeNull();
  });

  it('actualizados + inactivo → 400 con warnings sin persistir', async () => {
    serviciosService.findOne.mockResolvedValue({
      _id: servicioId,
      tenantId,
      activo: false,
      nombre: 'Inactivo',
      precioUnitario: 1,
    });
    try {
      await service.previewRepetirCotizacion(fuenteId, {
        modoPrecios: 'actualizados',
      });
      fail('expected HttpException');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      const body = (e as HttpException).getResponse() as any;
      expect(body.warnings).toEqual([
        {
          index: 0,
          servicioId: servicioIdStr,
          motivo: 'inactivo',
        },
      ]);
    }
    expect(savedPayload).toBeNull();
  });

  it('actualizados + omitirServicioIds: preview coherente con repetir', async () => {
    const otroId = new Types.ObjectId();
    jest.spyOn(service, 'findOne').mockImplementation(async (id: string) => {
      if (String(id) === String(fuenteId) || id === fuenteId) {
        const f = fuenteBase();
        f.items.push({
          servicioId: otroId,
          nombreServicioSnapshot: 'Otro',
          precioUnitarioSnapshot: 10,
          cantidad: 1,
          subtotal: 10,
        } as any);
        return f as any;
      }
      return { _id: id } as any;
    });
    serviciosService.findOne.mockImplementation(async (sid: string) => {
      if (String(sid) === servicioIdStr) {
        return {
          _id: servicioId,
          tenantId,
          activo: false,
          nombre: 'Inactivo',
          precioUnitario: 1,
        };
      }
      return {
        _id: otroId,
        tenantId,
        activo: true,
        nombre: 'Activo',
        precioUnitario: 40,
      };
    });

    const preview = await service.previewRepetirCotizacion(fuenteId, {
      modoPrecios: 'actualizados',
      omitirServicioIds: [servicioIdStr],
    });
    expect(preview.items).toHaveLength(1);
    expect(preview.items[0].nombre).toBe('Activo');
    expect(preview.items[0].precioUnitario).toBe(40);
  });
});

describe('CotizacionesService notificaciones internas magic link (Story 6.13)', () => {
  const tenantId = new Types.ObjectId();
  const token = 'notif-token-6-13';
  const future = new Date('2030-06-01T00:00:00.000Z');
  const creadorId = new Types.ObjectId();

  let service: CotizacionesService;
  let ModelCtor: any;
  let doc: any;
  let emailService: { sendInternalDecisionNotification: jest.Mock };
  let tenantConfigService: {
    findByTenantId: jest.Mock;
    getForRequest: jest.Mock;
  };
  let usersService: { findById: jest.Mock };
  let tenantContext: { getTenantId: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    emailService = {
      sendInternalDecisionNotification: jest.fn().mockResolvedValue(undefined),
    };
    tenantConfigService = {
      findByTenantId: jest.fn().mockResolvedValue({
        emailRemitente: 'from@tenant.test',
        correosNotificacion: ['extra@ames.test'],
        branding: { razonSocial: 'AMES' },
      }),
      getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 15 }),
    };
    usersService = { findById: jest.fn() };
    tenantContext = { getTenantId: jest.fn().mockReturnValue(tenantId) };
    doc = {
      _id: new Types.ObjectId(),
      tenantId,
      folio: 'COT-2030-0099',
      estado: 'vigente',
      total: 100,
      moneda: 'MXN',
      fechaCreacion: new Date('2026-01-01'),
      fechaVencimiento: future,
      magicToken: token,
      magicTokenExpiresAt: future,
      nombreEmpresa: 'Acme',
      nombreContacto: 'Ana',
      creadoPorUserId: creadorId,
      creadoPorEmail: 'creador@ames.test',
      items: [
        {
          nombreServicioSnapshot: 'Examen',
          cantidad: 1,
          precioUnitarioSnapshot: 100,
          subtotal: 100,
        },
      ],
    };
    ModelCtor = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      }),
      findOneAndUpdate: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          ...doc,
          estado: 'aceptada',
          fechaAceptacion: new Date(),
          estadoOrigen: 'magic_link',
        }),
      }),
    };
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      emailService as any,
      tenantContext as any,
      tenantConfigService as any,
      {} as any,
      {} as any,
      usersService as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  it('accept magic → notifica creador + correosNotificacion 1×', async () => {
    await service.aceptarCotizacionByMagicToken(token);
    expect(emailService.sendInternalDecisionNotification).toHaveBeenCalledTimes(
      1,
    );
    const args = emailService.sendInternalDecisionNotification.mock.calls[0][0];
    expect(args.tenantId).toEqual(tenantId);
    expect(args.folio).toBe('COT-2030-0099');
    expect(args.decision).toBe('aceptada');
    expect(args.solicitanteLabel).toContain('Acme');
    expect(args.to).toEqual(
      expect.arrayContaining(['creador@ames.test', 'extra@ames.test']),
    );
    expect(args.fromOverride).toBe('from@tenant.test');
    expect(tenantConfigService.findByTenantId).toHaveBeenCalled();
    expect(tenantConfigService.getForRequest).not.toHaveBeenCalled();
  });

  it('reject magic → mismos destinatarios + fromOverride', async () => {
    ModelCtor.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...doc,
        estado: 'rechazada',
        fechaRechazo: new Date(),
        estadoOrigen: 'magic_link',
      }),
    });
    const dto = await service.rechazarCotizacionByMagicToken(token);
    expect(emailService.sendInternalDecisionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        decision: 'rechazada',
        folio: 'COT-2030-0099',
        fromOverride: 'from@tenant.test',
        to: expect.arrayContaining(['creador@ames.test', 'extra@ames.test']),
      }),
    );
    expect(dto).not.toHaveProperty('creadoPorUserId');
    expect(dto).not.toHaveProperty('creadoPorEmail');
  });

  it('accept DTO público sin creadoPor*', async () => {
    const dto = await service.aceptarCotizacionByMagicToken(token);
    expect(dto.estado).toBe('aceptada');
    expect(dto).not.toHaveProperty('creadoPorUserId');
    expect(dto).not.toHaveProperty('creadoPorEmail');
  });

  it('dedupe case-insensitive creador vs lista', async () => {
    tenantConfigService.findByTenantId.mockResolvedValue({
      emailRemitente: 'from@tenant.test',
      correosNotificacion: ['CREADOR@ames.test', 'extra@ames.test'],
    });
    await service.aceptarCotizacionByMagicToken(token);
    const args = emailService.sendInternalDecisionNotification.mock.calls[0][0];
    const creadorHits = args.to.filter(
      (e: string) => e.toLowerCase() === 'creador@ames.test',
    );
    expect(creadorHits).toHaveLength(1);
    expect(args.to).toEqual(
      expect.arrayContaining(['creador@ames.test', 'extra@ames.test']),
    );
  });

  it('idempotent accept → no reenvía', async () => {
    doc.estado = 'aceptada';
    await service.aceptarCotizacionByMagicToken(token);
    expect(ModelCtor.findOneAndUpdate).not.toHaveBeenCalled();
    expect(
      emailService.sendInternalDecisionNotification,
    ).not.toHaveBeenCalled();
  });

  it('SMTP fail → estado aceptada y no lanza', async () => {
    emailService.sendInternalDecisionNotification.mockRejectedValue(
      new Error('smtp down'),
    );
    const dto = await service.aceptarCotizacionByMagicToken(token);
    expect(dto.estado).toBe('aceptada');
    expect(emailService.sendInternalDecisionNotification).toHaveBeenCalled();
  });

  it('sin creador + lista vacía → no SMTP', async () => {
    delete doc.creadoPorEmail;
    delete doc.creadoPorUserId;
    tenantConfigService.findByTenantId.mockResolvedValue({
      correosNotificacion: [],
    });
    ModelCtor.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...doc,
        estado: 'aceptada',
        estadoOrigen: 'magic_link',
      }),
    });
    await service.aceptarCotizacionByMagicToken(token);
    expect(
      emailService.sendInternalDecisionNotification,
    ).not.toHaveBeenCalled();
  });

  it('cambiarEstadoManual no notifica', async () => {
    const cotizacionId = doc._id;
    const actor = { _id: String(creadorId), email: 'edgar@ames.example' };
    usersService.findById.mockResolvedValue({
      _id: creadorId,
      nombre: 'Edgar',
      email: 'edgar@ames.example',
    });
    ModelCtor.findOneAndUpdate = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            ...doc,
            estado: 'aceptada',
            estadoOrigen: 'usuario',
          }),
        }),
      }),
    });
    jest.spyOn(service, 'findOne').mockResolvedValue({
      ...doc,
      estado: 'vigente',
    } as any);

    await service.cambiarEstadoManual(String(cotizacionId), 'aceptada', actor);
    expect(
      emailService.sendInternalDecisionNotification,
    ).not.toHaveBeenCalled();
  });

  it('createAdminCotizacion persiste creador del actor JWT', async () => {
    const servicioId = new Types.ObjectId();
    let savedPayload: any;
    const SaveModel = function SaveModel(this: any, data: any) {
      savedPayload = data;
      this.save = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ...data,
      });
      return this;
    };
    const serviciosService = {
      findOne: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        activo: true,
        nombre: 'Srv',
        precioUnitario: 10,
      }),
    };
    const countersService = {
      nextFolio: jest.fn().mockResolvedValue('COT-2030-0100'),
    };
    const createService = new CotizacionesService(
      SaveModel as any,
      { findOne: jest.fn() } as any,
      serviciosService as any,
      emailService as any,
      tenantContext as any,
      tenantConfigService as any,
      countersService as any,
      {} as any,
      usersService as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(createService, 'findOne').mockResolvedValue({
      _id: new Types.ObjectId(),
      folio: 'COT-2030-0100',
    } as any);

    await createService.createAdminCotizacion(
      {
        items: [{ servicioId: String(servicioId), cantidad: 1 }],
      } as any,
      { _id: String(creadorId), email: 'creador@ames.test' },
    );
    expect(String(savedPayload.creadoPorUserId)).toBe(String(creadorId));
    expect(savedPayload.creadoPorEmail).toBe('creador@ames.test');
  });

  it('sin snapshot: usa email vivo de findById', async () => {
    delete doc.creadoPorEmail;
    usersService.findById.mockResolvedValue({
      _id: creadorId,
      email: 'vivo@ames.test',
    });
    tenantConfigService.findByTenantId.mockResolvedValue({
      correosNotificacion: [],
      emailRemitente: 'from@tenant.test',
    });
    ModelCtor.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...doc,
        creadoPorEmail: undefined,
        estado: 'aceptada',
        estadoOrigen: 'magic_link',
      }),
    });
    await service.aceptarCotizacionByMagicToken(token);
    expect(usersService.findById).toHaveBeenCalledWith(String(creadorId));
    expect(emailService.sendInternalDecisionNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['vivo@ames.test'],
        decision: 'aceptada',
      }),
    );
  });

  it('snapshot inválido → fallback findById', async () => {
    doc.creadoPorEmail = 'no-es-email';
    usersService.findById.mockResolvedValue({
      _id: creadorId,
      email: 'vivo@ames.test',
    });
    tenantConfigService.findByTenantId.mockResolvedValue({
      correosNotificacion: [],
      emailRemitente: 'from@tenant.test',
    });
    ModelCtor.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...doc,
        creadoPorEmail: 'no-es-email',
        estado: 'aceptada',
        estadoOrigen: 'magic_link',
      }),
    });
    await service.aceptarCotizacionByMagicToken(token);
    expect(usersService.findById).toHaveBeenCalledWith(String(creadorId));
    expect(emailService.sendInternalDecisionNotification).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['vivo@ames.test'] }),
    );
  });

  it('omite emails inválidos en correosNotificacion', async () => {
    tenantConfigService.findByTenantId.mockResolvedValue({
      emailRemitente: 'from@tenant.test',
      correosNotificacion: ['no-es-email', 'extra@ames.test'],
    });
    await service.aceptarCotizacionByMagicToken(token);
    const args = emailService.sendInternalDecisionNotification.mock.calls[0][0];
    expect(args.to).toEqual(
      expect.arrayContaining(['creador@ames.test', 'extra@ames.test']),
    );
    expect(args.to).not.toContain('no-es-email');
  });

  it('repetirCotizacion setea actor JWT y no clona creador de fuente', async () => {
    const fuenteId = new Types.ObjectId();
    const servicioId = new Types.ObjectId();
    const actorId = new Types.ObjectId();
    const fuenteCreadorId = new Types.ObjectId();
    let savedPayload: any;
    const SaveModel = function SaveModel(this: any, data: any) {
      savedPayload = data;
      this.save = jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        ...data,
      });
      return this;
    };
    const serviciosService = {
      findOne: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        activo: true,
        nombre: 'Srv',
        precioUnitario: 10,
        descripcion: 'd',
      }),
    };
    const countersService = {
      nextFolio: jest.fn().mockResolvedValue('COT-2030-0200'),
    };
    const repetirService = new CotizacionesService(
      SaveModel as any,
      { findOne: jest.fn() } as any,
      serviciosService as any,
      emailService as any,
      tenantContext as any,
      {
        getForRequest: jest.fn().mockResolvedValue({ vigenciaDefaultDias: 15 }),
        findByTenantId: tenantConfigService.findByTenantId,
      } as any,
      countersService as any,
      {} as any,
      usersService as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
    jest.spyOn(repetirService, 'findOne').mockImplementation(async (id) => {
      if (String(id) === String(fuenteId)) {
        return {
          _id: fuenteId,
          tenantId,
          folio: 'COT-OLD',
          estado: 'aceptada',
          creadoPorUserId: fuenteCreadorId,
          creadoPorEmail: 'fuente@ames.test',
          items: [
            {
              servicioId,
              nombreServicioSnapshot: 'Snap',
              precioUnitarioSnapshot: 10,
              cantidad: 1,
              subtotal: 10,
            },
          ],
        } as any;
      }
      return { _id: id, folio: 'COT-2030-0200' } as any;
    });

    await repetirService.repetirCotizacion(
      String(fuenteId),
      { modoPrecios: 'originales' },
      { _id: String(actorId), email: 'actor@ames.test' },
    );
    expect(String(savedPayload.creadoPorUserId)).toBe(String(actorId));
    expect(savedPayload.creadoPorEmail).toBe('actor@ames.test');
    expect(String(savedPayload.creadoPorUserId)).not.toBe(
      String(fuenteCreadorId),
    );
  });
});

describe('CotizacionesService notas internas', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const otherUserId = new Types.ObjectId();
  const notaId = new Types.ObjectId();

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  };
  const usersService = {
    findById: jest.fn().mockResolvedValue({ nombre: 'Usuario Test' }),
  };

  let service: CotizacionesService;
  let ModelCtor: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    ModelCtor = {
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
    };
    service = new CotizacionesService(
      ModelCtor,
      {} as any,
      {} as any,
      {} as any,
      tenantContext as any,
      {} as any,
      {} as any,
      {} as any,
      usersService as any,
      { findById: jest.fn().mockResolvedValue({ activo: true }) } as any,
      stubRecordatoriosService() as any,
    );
  });

  function mockFindOneAndUpdateChain(result: any) {
    ModelCtor.findOneAndUpdate.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(result),
        }),
      }),
    });
  }

  function mockNotaLookup(autorUserId: Types.ObjectId) {
    ModelCtor.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            notasInternas: [
              {
                _id: notaId,
                texto: 'Nota existente',
                autorUserId,
              },
            ],
          }),
        }),
      }),
    });
  }

  it('agregarNotaInterna persiste autor y texto', async () => {
    const updated = { _id: cotizacionId, folio: 'COT-1' };
    mockFindOneAndUpdateChain(updated);
    const actor = { _id: String(userId), email: 'user@test.com' };
    const result = await service.agregarNotaInterna(
      String(cotizacionId),
      { texto: '  Nota de prueba  ' },
      actor,
    );
    expect(result).toBe(updated);
    const updateCall = ModelCtor.findOneAndUpdate.mock.calls[0];
    expect(updateCall[0]).toEqual({ _id: String(cotizacionId), tenantId });
    expect(updateCall[1].$push.notasInternas.texto).toBe('Nota de prueba');
    expect(String(updateCall[1].$push.notasInternas.autorUserId)).toBe(
      String(userId),
    );
    expect(updateCall[1].$push.notasInternas.autorNombre).toBe('Usuario Test');
  });

  it('actualizarNotaInterna de otro autor → 403', async () => {
    mockNotaLookup(otherUserId);
    await expect(
      service.actualizarNotaInterna(
        String(cotizacionId),
        String(notaId),
        { texto: 'Intento editar' },
        { _id: String(userId), email: 'user@test.com' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('eliminarNotaInterna de otro autor → 403', async () => {
    mockNotaLookup(otherUserId);
    await expect(
      service.eliminarNotaInterna(String(cotizacionId), String(notaId), {
        _id: String(userId),
        email: 'user@test.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('actualizarNotaInterna propia actualiza texto', async () => {
    mockNotaLookup(userId);
    const updated = { _id: cotizacionId, folio: 'COT-1' };
    mockFindOneAndUpdateChain(updated);
    const result = await service.actualizarNotaInterna(
      String(cotizacionId),
      String(notaId),
      { texto: 'Texto editado' },
      { _id: String(userId), email: 'user@test.com' },
    );
    expect(result).toBe(updated);
    const updateCall = ModelCtor.findOneAndUpdate.mock.calls[0];
    expect(updateCall[1].$set['notasInternas.$.texto']).toBe('Texto editado');
    expect(updateCall[1].$set['notasInternas.$.updatedAt']).toBeInstanceOf(
      Date,
    );
  });
});

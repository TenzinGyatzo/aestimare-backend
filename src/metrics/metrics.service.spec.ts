/// <reference types="jest" />
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import { FilterMetricsDto } from './dto/filter-metrics.dto';
import { MetricsService } from './metrics.service';
import { TipoItem } from '../servicios/enums/tipo-item.enum';

function isVolumeMatch(filter: any): boolean {
  return filter?.estado?.$ne === 'cancelada';
}

describe('MetricsService (Story 7.1 / 7.2)', () => {
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();

  let countCalls: any[];
  let aggregatePipelines: any[];
  let ModelCtor: any;
  let tenantContext: { getTenantId: jest.Mock };
  let service: MetricsService;

  beforeEach(() => {
    countCalls = [];
    aggregatePipelines = [];
    tenantContext = {
      getTenantId: jest.fn().mockReturnValue(tenantA),
    };
    ModelCtor = {
      countDocuments: jest.fn().mockImplementation(async (filter: any) => {
        countCalls.push(filter);
        if (filter?.estado === 'aceptada') return 4;
        if (filter?.estado === 'rechazada') return 2;
        if (filter?.estado === 'cancelada') return 0;
        if (isVolumeMatch(filter)) return 10;
        return 12;
      }),
      aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
        aggregatePipelines.push(pipeline);
        return { exec: jest.fn().mockResolvedValue([]) };
      }),
    };
    service = new MetricsService(ModelCtor as any, tenantContext as any);
  });

  it('buildMatch / totals siempre incluyen tenantId del contexto', async () => {
    const totals = await service.getTotalsMetrics();
    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(countCalls.length).toBeGreaterThan(0);
    for (const filter of countCalls) {
      expect(String(filter.tenantId)).toBe(String(tenantA));
    }
    expect(totals.cotizacionesEmitidas).toBe(10);
    expect(totals.cotizacionesAceptadas).toBe(4);
    expect(totals.cotizacionesRechazadas).toBe(2);
    expect(totals.cotizacionesCanceladas).toBe(0);
    expect(totals.cotizacionesTotales).toBe(10);
    expect(totals.tasaConversion).toBeCloseTo(0.4);
    const volumeCounts = countCalls.filter((f) => isVolumeMatch(f));
    expect(volumeCounts.length).toBe(4);
    for (const filter of volumeCounts) {
      expect(filter.estado).toEqual({ $ne: 'cancelada' });
    }
  });

  it('tasaConversion usa emitidas (sin restar canceladas dedicadas)', async () => {
    ModelCtor.countDocuments.mockImplementation(async (filter: any) => {
      countCalls.push(filter);
      if (filter?.estado === 'aceptada') return 4;
      if (filter?.estado === 'rechazada') return 2;
      if (filter?.estado === 'cancelada') return 2;
      if (isVolumeMatch(filter)) return 10;
      return 12;
    });
    const totals = await service.getTotalsMetrics();
    // 4 / 10 = 0.4 (canceladas=2 no restan del denominador)
    expect(totals.cotizacionesCanceladas).toBe(2);
    expect(totals.cotizacionesEmitidas).toBe(10);
    expect(totals.tasaConversion).toBeCloseTo(0.4);
  });

  it('tasaConversion 0 si emitidas = 0 (periodo solo canceladas)', async () => {
    ModelCtor.countDocuments.mockImplementation(async (filter: any) => {
      countCalls.push(filter);
      if (filter?.estado === 'aceptada') return 0;
      if (filter?.estado === 'rechazada') return 0;
      if (filter?.estado === 'cancelada') return 10;
      if (isVolumeMatch(filter)) return 0;
      return 0;
    });
    const totals = await service.getTotalsMetrics();
    expect(totals.cotizacionesEmitidas).toBe(0);
    expect(totals.tasaConversion).toBe(0);
  });

  it('filtro fecha acota fechaCreacion en emitidas, aceptadas y rechazadas', async () => {
    await service.getTotalsMetrics({
      fechaDesde: '2026-01-01T00:00:00.000Z',
      fechaHasta: '2026-06-30T23:59:59.000Z',
    });
    const desde = new Date('2026-01-01T00:00:00.000Z').getTime();
    const hasta = new Date('2026-06-30T23:59:59.000Z').getTime();

    const emitidasFilter = countCalls.find(
      (f) =>
        isVolumeMatch(f) &&
        f.fechaCreacion?.$gte?.getTime() === desde &&
        f.fechaCreacion?.$lte?.getTime() === hasta &&
        !f.fechaCreacion?.$lt,
    );
    expect(emitidasFilter).toBeDefined();
    expect(String(emitidasFilter.tenantId)).toBe(String(tenantA));

    for (const estado of ['aceptada', 'rechazada', 'cancelada'] as const) {
      const estadoFilter = countCalls.find(
        (f) =>
          f.estado === estado &&
          f.fechaCreacion?.$gte?.getTime() === desde &&
          f.fechaCreacion?.$lte?.getTime() === hasta,
      );
      expect(estadoFilter).toBeDefined();
      expect(String(estadoFilter.tenantId)).toBe(String(tenantA));
    }
  });

  it('withMatch: fechaDesde posterior a startOfDay no ensancha Hoy hacia atrás', async () => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    await service.getTotalsMetrics({
      fechaDesde: tomorrow.toISOString(),
    });

    const hoyFilter = countCalls.find(
      (f) => isVolumeMatch(f) && f.fechaCreacion?.$lt instanceof Date,
    );
    expect(hoyFilter).toBeDefined();
    // Intersección: gana el $gte más tardío (usuario), no startOfDay
    expect(hoyFilter.fechaCreacion.$gte.getTime()).toBe(tomorrow.getTime());
    expect(hoyFilter.fechaCreacion.$gte.getTime()).not.toBe(
      startOfToday.getTime(),
    );
  });

  it('withMatch: fechaDesde anterior a Hoy no ensancha hacia atrás', async () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setHours(0, 0, 0, 0);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    await service.getTotalsMetrics({
      fechaDesde: threeDaysAgo.toISOString(),
    });

    const hoyFilter = countCalls.find(
      (f) => isVolumeMatch(f) && f.fechaCreacion?.$lt instanceof Date,
    );
    expect(hoyFilter).toBeDefined();
    expect(hoyFilter.fechaCreacion.$gte.getTime()).toBe(startOfToday.getTime());
  });

  it('Hoy usa $lt fin de día (no cuenta fechas futuras indefinidas)', async () => {
    await service.getTotalsMetrics();
    const hoyFilter = countCalls.find(
      (f) => isVolumeMatch(f) && f.fechaCreacion?.$lt instanceof Date,
    );
    expect(hoyFilter).toBeDefined();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    expect(hoyFilter.fechaCreacion.$gte.getTime()).toBe(start.getTime());
    expect(hoyFilter.fechaCreacion.$lt.getTime()).toBe(end.getTime());
  });

  it('tasaConversion 0 si emitidas = 0', async () => {
    ModelCtor.countDocuments.mockResolvedValue(0);
    const totals = await service.getTotalsMetrics();
    expect(totals.cotizacionesEmitidas).toBe(0);
    expect(totals.tasaConversion).toBe(0);
  });

  it('aislamiento: tenant B no usa tenant A en match', async () => {
    tenantContext.getTenantId.mockReturnValue(tenantB);
    await service.getClientsMetrics();
    const pipeline = aggregatePipelines[0];
    const firstMatch = pipeline.find((s: any) => s.$match?.tenantId);
    expect(String(firstMatch.$match.tenantId)).toBe(String(tenantB));
    expect(String(firstMatch.$match.tenantId)).not.toBe(String(tenantA));
    expect(firstMatch.$match.estado).toEqual({ $ne: 'cancelada' });
  });

  it('lookup clientes incluye match de tenantId', async () => {
    await service.getClientsMetrics();
    const pipeline = aggregatePipelines[0];
    const firstMatch = pipeline.find((s: any) => s.$match?.tenantId);
    expect(firstMatch.$match.estado).toEqual({ $ne: 'cancelada' });
    const lookup = pipeline.find((s: any) => s.$lookup?.from === 'clientes');
    expect(lookup.$lookup.pipeline).toBeDefined();
    const lookupMatch = lookup.$lookup.pipeline[0].$match.$expr.$and;
    expect(lookupMatch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          $eq: ['$tenantId', tenantA],
        }),
      ]),
    );
  });

  describe('Story 7.2 — cambio de contexto admin (selector → nuevo tenantId)', () => {
    it('al cambiar getTenantId A→B, totals solo usa B (no mezcla A)', async () => {
      await service.getTotalsMetrics();
      expect(
        countCalls.every((f) => String(f.tenantId) === String(tenantA)),
      ).toBe(true);

      countCalls.length = 0;
      tenantContext.getTenantId.mockReturnValue(tenantB);
      await service.getTotalsMetrics();

      expect(countCalls.length).toBeGreaterThan(0);
      for (const filter of countCalls) {
        expect(String(filter.tenantId)).toBe(String(tenantB));
        expect(String(filter.tenantId)).not.toBe(String(tenantA));
      }
    });

    it('clients / services / totals tras cambio de contexto usan solo tenant B', async () => {
      tenantContext.getTenantId.mockReturnValue(tenantB);
      await Promise.all([
        service.getClientsMetrics(),
        service.getServicesMetrics(),
        service.getTotalsMetrics(),
      ]);

      for (const filter of countCalls) {
        expect(String(filter.tenantId)).toBe(String(tenantB));
      }
      for (const pipeline of aggregatePipelines) {
        const firstMatch = pipeline.find((s: any) => s.$match?.tenantId);
        expect(firstMatch).toBeDefined();
        expect(String(firstMatch.$match.tenantId)).toBe(String(tenantB));
        expect(String(firstMatch.$match.tenantId)).not.toBe(String(tenantA));
      }
    });

    it('métricas no agregan por userId ni creadoPor*', async () => {
      await service.getTotalsMetrics();
      await service.getClientsMetrics();
      await service.getServicesMetrics();

      for (const filter of countCalls) {
        expect(filter).not.toHaveProperty('userId');
        expect(filter).not.toHaveProperty('creadoPorUserId');
        expect(filter).not.toHaveProperty('creadoPorEmail');
      }
      const serialized = JSON.stringify(aggregatePipelines);
      expect(serialized).not.toMatch(/creadoPor/);
      expect(serialized).not.toMatch(/"userId"/);
    });
  });
});

function isDesglosePorTipoPipeline(pipeline: any[]): boolean {
  return pipeline.some(
    (s) =>
      s.$group &&
      s.$group._id?.$switch &&
      JSON.stringify(s.$group._id).includes('items.tipoSnapshot'),
  );
}

describe('MetricsService — tipoSnapshot SaaS / Story 7.1 tipado', () => {
  const tenantA = new Types.ObjectId();
  let aggregatePipelines: any[];
  let ModelCtor: any;
  let service: MetricsService;

  beforeEach(() => {
    aggregatePipelines = [];
    ModelCtor = {
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
        aggregatePipelines.push(pipeline);
        let rows: any[] = [];
        if (isDesglosePorTipoPipeline(pipeline)) {
          rows = [
            { _id: 'producto', ingresosTotales: 100, vecesContratado: 2 },
            { _id: 'servicio', ingresosTotales: 50, vecesContratado: 1 },
            { _id: 'sin_tipo', ingresosTotales: 25, vecesContratado: 3 },
          ];
        }
        return { exec: jest.fn().mockResolvedValue(rows) };
      }),
    };
    service = new MetricsService(ModelCtor as any, {
      getTenantId: jest.fn().mockReturnValue(tenantA),
    } as any);
  });

  it('pipeline de desglose agrupa por items.tipoSnapshot ($switch) sin $lookup servicios', async () => {
    await service.getTotalsMetrics();
    const desglose = aggregatePipelines.find(isDesglosePorTipoPipeline);
    expect(desglose).toBeDefined();
    const matchStage = desglose.find((s: any) => s.$match?.estado === 'aceptada');
    expect(matchStage).toBeDefined();
    const serialized = JSON.stringify(desglose);
    expect(serialized).toContain('items.tipoSnapshot');
    expect(serialized).toContain('producto');
    expect(serialized).toContain('servicio');
    expect(serialized).toContain('sin_tipo');
    expect(desglose.some((s: any) => s.$lookup)).toBe(false);
    expect(serialized).not.toMatch(/Servicio\.tipo|"\$servicio\.tipo"/);
  });

  it('mezcla producto + servicio + legacy → tres buckets', async () => {
    const totals = await service.getTotalsMetrics();
    expect(totals.desglosePorTipo.producto).toEqual({
      ingresosTotales: 100,
      vecesContratado: 2,
    });
    expect(totals.desglosePorTipo.servicio).toEqual({
      ingresosTotales: 50,
      vecesContratado: 1,
    });
    expect(totals.desglosePorTipo.sinTipo).toEqual({
      ingresosTotales: 25,
      vecesContratado: 3,
    });
  });

  it('legacy sin filas de bucket → ceros (sinTipo incluido)', async () => {
    ModelCtor.aggregate.mockImplementation((pipeline: any[]) => {
      aggregatePipelines.push(pipeline);
      return { exec: jest.fn().mockResolvedValue([]) };
    });
    const totals = await service.getTotalsMetrics();
    expect(totals.desglosePorTipo).toEqual({
      producto: { ingresosTotales: 0, vecesContratado: 0 },
      servicio: { ingresosTotales: 0, vecesContratado: 0 },
      sinTipo: { ingresosTotales: 0, vecesContratado: 0 },
    });
  });

  it('solo legacy (sin_tipo) cuenta en sinTipo', async () => {
    ModelCtor.aggregate.mockImplementation((pipeline: any[]) => {
      aggregatePipelines.push(pipeline);
      const rows = isDesglosePorTipoPipeline(pipeline)
        ? [{ _id: 'sin_tipo', ingresosTotales: 40, vecesContratado: 4 }]
        : [];
      return { exec: jest.fn().mockResolvedValue(rows) };
    });
    const totals = await service.getTotalsMetrics();
    expect(totals.desglosePorTipo.sinTipo.ingresosTotales).toBe(40);
    expect(totals.desglosePorTipo.sinTipo.vecesContratado).toBe(4);
    expect(totals.desglosePorTipo.producto.ingresosTotales).toBe(0);
    expect(totals.desglosePorTipo.servicio.ingresosTotales).toBe(0);
  });

  it('getServicesMetrics expone tipoSnapshot desde $first de línea (null si legacy)', async () => {
    ModelCtor.aggregate.mockImplementation((pipeline: any[]) => {
      aggregatePipelines.push(pipeline);
      return {
        exec: jest.fn().mockResolvedValue([
          {
            servicioId: 's1',
            nombreServicio: 'Kit',
            precioUnitario: 10,
            vecesContratado: 2,
            tipoSnapshot: 'producto',
          },
          {
            servicioId: 's2',
            nombreServicio: 'Legacy',
            precioUnitario: 5,
            vecesContratado: 1,
            tipoSnapshot: undefined,
          },
        ]),
      };
    });
    const rows = await service.getServicesMetrics();
    expect(rows[0].tipoSnapshot).toBe('producto');
    expect(rows[1].tipoSnapshot).toBeNull();

    const pipeline = aggregatePipelines[0];
    const group = pipeline.find((s: any) => s.$group?._id === '$items.servicioId');
    expect(group.$group.tipoSnapshot).toEqual({ $first: '$items.tipoSnapshot' });
    // lookup nombre OK; no proyectar servicio.tipo
    const project = pipeline.find((s: any) => s.$project?.servicioId);
    expect(JSON.stringify(project)).not.toContain('servicio.tipo');
  });
});

function hasTipoSnapshotLineMatch(
  pipeline: any[],
  tipo: 'producto' | 'servicio',
): boolean {
  const unwindIdx = pipeline.findIndex((s) => s.$unwind === '$items');
  if (unwindIdx < 0) return false;
  return pipeline
    .slice(unwindIdx + 1)
    .some((s) => s.$match?.['items.tipoSnapshot'] === tipo);
}

function isServicesMetricsPipeline(pipeline: any[]): boolean {
  return pipeline.some(
    (s) => s.$group && s.$group._id === '$items.servicioId' && s.$group.vecesContratado,
  );
}

function isTopSolicitadoPipeline(pipeline: any[]): boolean {
  return pipeline.some(
    (s) => s.$group && s.$group.vecesSolicitado && s.$group._id === '$items.servicioId',
  );
}

function isTopRentablePipeline(pipeline: any[]): boolean {
  return pipeline.some(
    (s) =>
      s.$group &&
      s.$group.ingresosTotales &&
      s.$group._id === '$items.servicioId' &&
      !s.$group.vecesSolicitado,
  );
}

describe('FilterMetricsDto — Story 7.2', () => {
  it('acepta producto|servicio y omite vacío', () => {
    const producto = plainToInstance(FilterMetricsDto, { tipo: TipoItem.PRODUCTO });
    const servicio = plainToInstance(FilterMetricsDto, { tipo: TipoItem.SERVICIO });
    const vacio = plainToInstance(FilterMetricsDto, { tipo: '' });
    expect(validateSync(producto)).toHaveLength(0);
    expect(validateSync(servicio)).toHaveLength(0);
    expect(vacio.tipo).toBeUndefined();
    expect(validateSync(vacio)).toHaveLength(0);
  });

  it('rechaza tipo=todos y tipo=sin_tipo', () => {
    const todos = plainToInstance(FilterMetricsDto, { tipo: 'todos' });
    const sinTipo = plainToInstance(FilterMetricsDto, { tipo: 'sin_tipo' });
    expect(validateSync(todos).some((e) => e.property === 'tipo')).toBe(true);
    expect(validateSync(sinTipo).some((e) => e.property === 'tipo')).toBe(true);
  });
});

function isIngresosDocumentoPipeline(pipeline: any[]): boolean {
  return pipeline.some(
    (s) =>
      s.$group &&
      s.$group._id === null &&
      s.$group.total?.$sum === '$total',
  );
}

function postUnwindTipoMatch(pipeline: any[]): Record<string, unknown> | undefined {
  const unwindIdx = pipeline.findIndex((s) => s.$unwind === '$items');
  if (unwindIdx < 0) return undefined;
  const match = pipeline
    .slice(unwindIdx + 1)
    .find((s) => s.$match && 'items.tipoSnapshot' in s.$match);
  return match?.$match;
}

describe('MetricsService — filtro tipo SaaS / Story 7.2', () => {
  const tenantA = new Types.ObjectId();
  let aggregatePipelines: any[];
  let countCalls: any[];
  let ModelCtor: any;
  let service: MetricsService;

  beforeEach(() => {
    aggregatePipelines = [];
    countCalls = [];
    ModelCtor = {
      countDocuments: jest.fn().mockImplementation(async (filter: any) => {
        countCalls.push(filter);
        return 0;
      }),
      aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
        aggregatePipelines.push(pipeline);
        return { exec: jest.fn().mockResolvedValue([]) };
      }),
    };
    service = new MetricsService(ModelCtor as any, {
      getTenantId: jest.fn().mockReturnValue(tenantA),
    } as any);
  });

  it('tipo=producto → services/desglose/tops match items.tipoSnapshot post-unwind', async () => {
    await service.getServicesMetrics({ tipo: TipoItem.PRODUCTO });
    await service.getTotalsMetrics({ tipo: TipoItem.PRODUCTO });

    const services = aggregatePipelines.find(isServicesMetricsPipeline);
    expect(services).toBeDefined();
    expect(hasTipoSnapshotLineMatch(services, 'producto')).toBe(true);
    expect(JSON.stringify(services)).not.toMatch(/Servicio\.tipo|"\$servicio\.tipo"/);

    const desglose = aggregatePipelines.find(isDesglosePorTipoPipeline);
    expect(desglose).toBeDefined();
    expect(hasTipoSnapshotLineMatch(desglose, 'producto')).toBe(true);
    expect(desglose.some((s: any) => s.$lookup)).toBe(false);

    const topSol = aggregatePipelines.find(isTopSolicitadoPipeline);
    const topRen = aggregatePipelines.find(isTopRentablePipeline);
    expect(hasTipoSnapshotLineMatch(topSol, 'producto')).toBe(true);
    expect(hasTipoSnapshotLineMatch(topRen, 'producto')).toBe(true);
  });

  it('sin tipo → pipelines de línea sin $match items.tipoSnapshot', async () => {
    await service.getServicesMetrics();
    await service.getTotalsMetrics();

    const services = aggregatePipelines.find(isServicesMetricsPipeline);
    const desglose = aggregatePipelines.find(isDesglosePorTipoPipeline);
    const topSol = aggregatePipelines.find(isTopSolicitadoPipeline);
    expect(hasTipoSnapshotLineMatch(services, 'producto')).toBe(false);
    expect(hasTipoSnapshotLineMatch(services, 'servicio')).toBe(false);
    expect(hasTipoSnapshotLineMatch(desglose, 'producto')).toBe(false);
    expect(hasTipoSnapshotLineMatch(topSol, 'servicio')).toBe(false);
  });

  it('getClientsMetrics ignora tipo (sin match tipoSnapshot)', async () => {
    await service.getClientsMetrics({ tipo: TipoItem.PRODUCTO });
    const clients = aggregatePipelines[0];
    expect(clients).toBeDefined();
    const firstMatch = clients.find((s: any) => s.$match?.tenantId);
    expect(firstMatch.$match.estado).toEqual({ $ne: 'cancelada' });
    const serialized = JSON.stringify(clients);
    expect(serialized).not.toContain('items.tipoSnapshot');
    expect(serialized).not.toContain('tipoSnapshot');
  });

  it('tipo=servicio → match exacto servicio; sin lookup para filtrar', async () => {
    await service.getTotalsMetrics({ tipo: TipoItem.SERVICIO });
    const desglose = aggregatePipelines.find(isDesglosePorTipoPipeline);
    expect(hasTipoSnapshotLineMatch(desglose, 'servicio')).toBe(true);
    expect(hasTipoSnapshotLineMatch(desglose, 'producto')).toBe(false);
    expect(JSON.stringify(desglose)).not.toMatch(/\$lookup|Servicio\.tipo/);
  });

  it('AC3: match exacto excluye legacy/sin_tipo (solo equality string)', async () => {
    await service.getServicesMetrics({ tipo: TipoItem.PRODUCTO });
    await service.getTotalsMetrics({ tipo: TipoItem.PRODUCTO });

    for (const pipeline of [
      aggregatePipelines.find(isServicesMetricsPipeline),
      aggregatePipelines.find(isDesglosePorTipoPipeline),
      aggregatePipelines.find(isTopSolicitadoPipeline),
      aggregatePipelines.find(isTopRentablePipeline),
    ]) {
      const m = postUnwindTipoMatch(pipeline);
      expect(m).toEqual({ 'items.tipoSnapshot': 'producto' });
      expect(m).not.toHaveProperty('$or');
      expect(m).not.toHaveProperty('$in');
    }
  });

  it('AC2: con tipo activo, counts e ingresos documento no usan tipoSnapshot', async () => {
    await service.getTotalsMetrics({ tipo: TipoItem.PRODUCTO });

    for (const filter of countCalls) {
      expect(JSON.stringify(filter)).not.toContain('tipoSnapshot');
    }

    const ingresos = aggregatePipelines.find(isIngresosDocumentoPipeline);
    expect(ingresos).toBeDefined();
    expect(JSON.stringify(ingresos)).not.toContain('tipoSnapshot');
    expect(
      ingresos.some((s: any) => s.$group?.total?.$sum === '$total'),
    ).toBe(true);
    expect(hasTipoSnapshotLineMatch(ingresos, 'producto')).toBe(false);
  });
});

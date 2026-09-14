import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ClientesService } from './clientes.service';
import { TenantContextService } from '../tenants/tenant-context.service';

describe('ClientesService (Stories 3.1–3.2)', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();

  const savedDocs: any[] = [];

  const clienteModel: any = jest.fn().mockImplementation((data: any) => {
    const doc = {
      ...data,
      _id: new Types.ObjectId(),
      save: jest.fn().mockImplementation(async function (this: any) {
        savedDocs.push(this);
        return this;
      }),
    };
    return doc;
  });

  clienteModel.find = jest.fn();
  clienteModel.findOne = jest.fn();
  clienteModel.findOneAndUpdate = jest.fn();
  clienteModel.countDocuments = jest.fn();

  const contactoModel: any = { aggregate: jest.fn().mockResolvedValue([]) };
  const cotizacionModel: any = { aggregate: jest.fn().mockResolvedValue([]) };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;

  const service = new ClientesService(
    clienteModel as any,
    tenantContext,
    contactoModel,
    cotizacionModel,
  );

  function mockFindAll(docs: unknown[], total = docs.length) {
    const execFind = jest.fn().mockResolvedValue(docs);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    clienteModel.find.mockReturnValue({ sort });
    clienteModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(total),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    savedDocs.length = 0;
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    clienteModel.mockClear();
    contactoModel.aggregate.mockResolvedValue([]);
    cotizacionModel.aggregate.mockResolvedValue([]);
  });

  it('findAll default solo activos + paginado scoped', async () => {
    mockFindAll([{ empresa: 'A' }], 1);

    const res = await service.findAll({ page: 1, limit: 20 });

    expect(clienteModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        activo: { $ne: false },
      }),
    );
    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
  });

  it('findAll activo=false lista inactivos', async () => {
    mockFindAll([]);

    await service.findAll({ activo: false });

    expect(clienteModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, activo: false }),
    );
  });

  it('findAll escapa metacaracteres regex', async () => {
    mockFindAll([]);

    await service.findAll({ empresa: 'Acme (SA)' });

    expect(clienteModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        empresa: { $regex: 'Acme \\(SA\\)', $options: 'i' },
      }),
    );
  });

  it('findOne cross-tenant: NotFound', async () => {
    clienteModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.findOne(new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tenantId).not.toEqual(otherTenantId);
  });

  it('create solo con empresa', async () => {
    const created = await service.create({ empresa: '  Acme SA  ' });
    expect(created.empresa).toBe('Acme SA');
    expect(created.activo).toBe(true);
  });

  it('create persiste razonSocial trimmeada', async () => {
    const created = await service.create({
      empresa: 'Acme',
      razonSocial: '  Servicios Industriales del Pacífico  ',
    });
    expect(created.razonSocial).toBe('Servicios Industriales del Pacífico');
    expect(clienteModel).toHaveBeenCalledWith(
      expect.objectContaining({
        empresa: 'Acme',
        razonSocial: 'Servicios Industriales del Pacífico',
      }),
    );
  });

  it('create omite razonSocial vacía', async () => {
    await service.create({ empresa: 'Acme', razonSocial: '   ' });
    expect(clienteModel).toHaveBeenCalledWith(
      expect.not.objectContaining({ razonSocial: expect.anything() }),
    );
  });

  it('findAll filtra por razonSocial con regex escapado', async () => {
    mockFindAll([]);

    await service.findAll({ razonSocial: 'Pacífico (SA)' });

    expect(clienteModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        razonSocial: { $regex: 'Pacífico \\(SA\\)', $options: 'i' },
      }),
    );
  });

  it('update setea razonSocial', async () => {
    const id = new Types.ObjectId().toString();
    const updated = {
      _id: id,
      empresa: 'Acme',
      razonSocial: 'Nueva RS',
      tenantId,
    };
    clienteModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const res = await service.update(id, { razonSocial: '  Nueva RS  ' });
    expect(res.razonSocial).toBe('Nueva RS');
    expect(clienteModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      { $set: { razonSocial: 'Nueva RS' } },
      { new: true },
    );
  });

  it('update vacía razonSocial → $unset', async () => {
    const id = new Types.ObjectId().toString();
    const updated = { _id: id, empresa: 'Acme', tenantId };
    clienteModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    await service.update(id, { razonSocial: '   ' });
    expect(clienteModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      { $unset: { razonSocial: 1 } },
      { new: true },
    );
  });

  it('create RFC duplicado → ConflictException', async () => {
    clienteModel.mockImplementationOnce((data: any) => ({
      ...data,
      save: jest.fn().mockRejectedValue({ code: 11000 }),
    }));
    await expect(
      service.create({ empresa: 'X', rfc: 'AAA010101AAA' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('remove soft-delete pone activo=false', async () => {
    const id = new Types.ObjectId().toString();
    const updated = { _id: id, activo: false, tenantId };
    clienteModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    const res = await service.remove(id);
    expect(res.activo).toBe(false);
    expect(clienteModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      { $set: { activo: false } },
      { new: true },
    );
  });

  it('toggleActivo invierte estado', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      activo: true,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    clienteModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const res = await service.toggleActivo(id);
    expect(res.activo).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it('toggleActivo reactiva false→true', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      activo: false,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    clienteModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    const res = await service.toggleActivo(id);
    expect(res.activo).toBe(true);
  });

  it('toggleActivo E11000 al reactivar → ConflictException', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      activo: false,
      save: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    clienteModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    await expect(service.toggleActivo(id)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('create rechaza empresa vacía', async () => {
    await expect(service.create({ empresa: '   ' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('findAll adjunta conteos de la página (activos; sin canceladas)', async () => {
    const clienteId = new Types.ObjectId();
    mockFindAll([{ _id: clienteId, empresa: 'Acme', activo: true }], 1);
    contactoModel.aggregate.mockResolvedValue([{ _id: clienteId, n: 3 }]);
    cotizacionModel.aggregate.mockResolvedValue([{ _id: clienteId, n: 4 }]);

    const res = await service.findAll({ page: 1, limit: 20 });

    expect(res.data[0]).toEqual(
      expect.objectContaining({
        totalContactos: 3,
        totalCotizaciones: 4,
      }),
    );
    expect(contactoModel.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          tenantId,
          clienteId: { $in: [clienteId] },
          activo: { $ne: false },
        },
      },
      { $group: { _id: '$clienteId', n: { $sum: 1 } } },
    ]);
    expect(cotizacionModel.aggregate).toHaveBeenCalledWith([
      {
        $match: {
          tenantId,
          clienteId: { $in: [clienteId] },
          estado: { $ne: 'cancelada' },
        },
      },
      { $group: { _id: '$clienteId', n: { $sum: 1 } } },
    ]);
  });

  it('findAll sin actividad CRM → conteos 0', async () => {
    const clienteId = new Types.ObjectId();
    mockFindAll([{ _id: clienteId, empresa: 'Vacio' }], 1);

    const res = await service.findAll();

    expect(res.data[0].totalContactos).toBe(0);
    expect(res.data[0].totalCotizaciones).toBe(0);
  });

  it('findAll página vacía no agrega conteos', async () => {
    mockFindAll([]);

    const res = await service.findAll({ empresa: 'zzz' });

    expect(res.data).toEqual([]);
    expect(contactoModel.aggregate).not.toHaveBeenCalled();
    expect(cotizacionModel.aggregate).not.toHaveBeenCalled();
  });

  it('findAll inactivo conserva historial de conteos', async () => {
    const clienteId = new Types.ObjectId();
    mockFindAll([{ _id: clienteId, empresa: 'Old', activo: false }], 1);
    contactoModel.aggregate.mockResolvedValue([{ _id: clienteId, n: 2 }]);
    cotizacionModel.aggregate.mockResolvedValue([{ _id: clienteId, n: 1 }]);

    const res = await service.findAll({ activo: false });

    expect(res.data[0]).toEqual(
      expect.objectContaining({
        activo: false,
        totalContactos: 2,
        totalCotizaciones: 1,
      }),
    );
  });
});

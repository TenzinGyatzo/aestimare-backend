import {
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ValidationPipe,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ServiciosService } from './servicios.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { TipoItem } from './enums/tipo-item.enum';
import { FilterServicioDto } from './dto/filter-servicio.dto';
import { ServicioOrden } from './enums/servicio-orden.enum';

const queryPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

describe('ServiciosService (Stories 4.x / 5.3 / 6.1 tipo / 6.2 codigo)', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();
  const categoriaId = new Types.ObjectId();
  const otherCategoriaId = new Types.ObjectId();
  const savedDocs: any[] = [];

  const servicioModel: any = jest.fn().mockImplementation((data: any) => {
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

  servicioModel.find = jest.fn();
  servicioModel.findOne = jest.fn();
  servicioModel.findOneAndUpdate = jest.fn();
  servicioModel.findOneAndDelete = jest.fn();
  servicioModel.countDocuments = jest.fn();
  servicioModel.deleteOne = jest.fn().mockReturnValue({
    exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  });

  const categoriaModel: any = {
    findOne: jest.fn(),
    findById: jest.fn(),
  };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;

  const tenantsService = {
    findById: jest.fn(),
  } as unknown as TenantsService;

  const service = new ServiciosService(
    servicioModel as any,
    categoriaModel as any,
    tenantContext,
    tenantsService,
  );

  function mockCategoriaActiva(
    id: Types.ObjectId = categoriaId,
    tid: Types.ObjectId = tenantId,
    codigo = 'MED',
  ) {
    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        tenantId: tid,
        codigo,
        activo: true,
      }),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    savedDocs.length = 0;
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    servicioModel.mockClear();
    (tenantsService.findById as jest.Mock).mockReset();
    mockCategoriaActiva();
  });

  it('create asocia tenantId + categoriaId + MXN', async () => {
    const created = await service.create({
      nombre: '  Examen médico  ',
      precioUnitario: 500,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      moneda: 'USD',
    });

    expect(created.nombre).toBe('Examen médico');
    expect(created.categoriaId).toEqual(categoriaId);
    expect(created.tipo).toBe(TipoItem.SERVICIO);
    expect(created.moneda).toBe('MXN');
    expect(created.tenantId).toEqual(tenantId);
    expect(created.activo).toBe(true);
    expect(categoriaModel.findOne).toHaveBeenCalledWith({
      _id: categoriaId.toString(),
      tenantId,
    });
  });

  it('create persiste tipo producto', async () => {
    const created = await service.create({
      nombre: 'Extintor',
      precioUnitario: 800,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.PRODUCTO,
    });
    expect(created.tipo).toBe(TipoItem.PRODUCTO);
  });

  it('create persiste codigo no vacío', async () => {
    const created = await service.create({
      nombre: 'Extintor',
      precioUnitario: 800,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.PRODUCTO,
      codigo: '  SKU-1  ',
    });
    expect(created.codigo).toBe('SKU-1');
  });

  it('create con codigo vacío/whitespace no persiste el campo', async () => {
    const created = await service.create({
      nombre: 'Sin código',
      precioUnitario: 10,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      codigo: '   ',
    });
    expect(created.codigo).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(created, 'codigo')).toBe(
      false,
    );
  });

  it('create codigo duplicado → ConflictException', async () => {
    servicioModel.mockImplementationOnce((data: any) => ({
      ...data,
      save: jest.fn().mockRejectedValue({ code: 11000 }),
    }));
    await expect(
      service.create({
        nombre: 'Dup',
        precioUnitario: 10,
        categoriaId: categoriaId.toString(),
        tipo: TipoItem.SERVICIO,
        codigo: 'SKU-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('CreateServicioDto exige tipo y rechaza valores inválidos', () => {
    const sinTipo = plainToInstance(CreateServicioDto, {
      nombre: 'Servicio',
      precioUnitario: 10,
      categoriaId: categoriaId.toString(),
    });
    expect(validateSync(sinTipo).some((e) => e.property === 'tipo')).toBe(true);

    const invalido = plainToInstance(CreateServicioDto, {
      nombre: 'Servicio',
      precioUnitario: 10,
      categoriaId: categoriaId.toString(),
      tipo: 'otro',
    });
    expect(validateSync(invalido).some((e) => e.property === 'tipo')).toBe(
      true,
    );
  });

  it('create con descripción opcional vacía no la persiste', async () => {
    const created = await service.create({
      nombre: 'Capacitación',
      precioUnitario: 100,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      descripcion: '   ',
    });

    expect(created.descripcion).toBeUndefined();
  });

  it('create rechaza categoría de otro tenant (findOne null)', async () => {
    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.create({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: new Types.ObjectId().toString(),
      tipo: TipoItem.SERVICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create rechaza categoría inactiva (activo: false)', async () => {
    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: categoriaId,
        tenantId,
        codigo: 'MED',
        activo: false,
      }),
    });

    await expect(
      service.create({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create propaga ForbiddenException de tenant', async () => {
    (tenantContext.getTenantId as jest.Mock).mockImplementation(() => {
      throw new ForbiddenException('Contexto de tenant no resuelto');
    });

    await expect(
      service.create({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('CreateServicioDto exige categoriaId ObjectId y rechaza enum legacy', () => {
    const invalid = plainToInstance(CreateServicioDto, {
      nombre: 'Servicio',
      precioUnitario: 10,
      categoriaId: 'INVALIDA',
      tipo: TipoItem.SERVICIO,
    });
    expect(
      validateSync(invalid).some((e) => e.property === 'categoriaId'),
    ).toBe(true);

    const withEnum = plainToInstance(CreateServicioDto, {
      nombre: 'Servicio',
      precioUnitario: 10,
      categoria: 'MED',
    });
    // whitelist en pipe; validateSync sin whitelist no quita — property categoria no está en DTO
    expect(withEnum).not.toHaveProperty('categoriaId');
  });

  it('CreateServicioDto ValidationPipe forbidNonWhitelisted rechaza categoria enum', async () => {
    await expect(
      queryPipe().transform(
        {
          nombre: 'Servicio',
          precioUnitario: 10,
          categoria: 'MED',
        },
        { type: 'body', metatype: CreateServicioDto, data: '' },
      ),
    ).rejects.toBeTruthy();
  });

  it('FilterServicioDto Transform: query string "false" → boolean false', () => {
    const dto = plainToInstance(FilterServicioDto, { activo: 'false' });
    expect(dto.activo).toBe(false);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('FilterServicioDto Transform: query string "true" → boolean true', () => {
    const dto = plainToInstance(FilterServicioDto, { activo: 'true' });
    expect(dto.activo).toBe(true);
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('FilterServicioDto ValidationPipe: activo=false no se convierte a true', async () => {
    const dto = (await queryPipe().transform(
      { activo: 'false', page: '1', limit: '20' },
      { type: 'query', metatype: FilterServicioDto, data: '' },
    )) as FilterServicioDto;
    expect(dto.activo).toBe(false);
  });

  it('FilterServicioDto ValidationPipe: omitido → undefined', async () => {
    const dto = (await queryPipe().transform(
      { page: '1' },
      { type: 'query', metatype: FilterServicioDto, data: '' },
    )) as FilterServicioDto;
    expect(dto.activo).toBeUndefined();
  });

  it('FilterServicioDto ValidationPipe: objeto anidado → 400', async () => {
    await expect(
      queryPipe().transform(
        { activo: { foo: 'false' } },
        { type: 'query', metatype: FilterServicioDto, data: '' },
      ),
    ).rejects.toBeTruthy();
  });

  it('update con categoriaId fuerza MXN y $unset descripción + categoria legacy', async () => {
    const id = new Types.ObjectId().toString();
    const updated = {
      _id: id,
      nombre: 'Nuevo',
      categoriaId,
      precioUnitario: 200,
      moneda: 'MXN',
      tenantId,
    };
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const res = await service.update(id, {
      nombre: '  Nuevo  ',
      categoriaId: categoriaId.toString(),
      precioUnitario: 200,
      descripcion: '   ',
      moneda: 'USD',
    });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: {
          nombre: 'Nuevo',
          categoriaId,
          precioUnitario: 200,
          moneda: 'MXN',
        },
        $unset: { categoria: '', descripcion: 1 },
      },
      { new: true },
    );
    expect(res.nombre).toBe('Nuevo');
  });

  it('update cambia tipo', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        tipo: TipoItem.PRODUCTO,
        tenantId,
      }),
    });

    await service.update(id, { tipo: TipoItem.PRODUCTO });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: {
          tipo: TipoItem.PRODUCTO,
          moneda: 'MXN',
        },
      },
      { new: true },
    );
  });

  it('update con tipo null no hace $set de tipo', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        nombre: 'X',
        tenantId,
      }),
    });

    await service.update(id, {
      tipo: null as unknown as TipoItem,
      nombre: 'X',
    });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: {
          nombre: 'X',
          moneda: 'MXN',
        },
      },
      { new: true },
    );
  });

  it('update cambia codigo', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        codigo: 'SKU-2',
        tenantId,
      }),
    });

    await service.update(id, { codigo: '  SKU-2  ' });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: {
          codigo: 'SKU-2',
          moneda: 'MXN',
        },
      },
      { new: true },
    );
  });

  it('update limpia codigo → $unset', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        tenantId,
      }),
    });

    await service.update(id, { codigo: '   ' });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: { moneda: 'MXN' },
        $unset: { codigo: 1 },
      },
      { new: true },
    );
  });

  it('update codigo duplicado → ConflictException', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });

    await expect(
      service.update(id, { codigo: 'SKU-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update sin categoriaId no hace $unset de categoria legacy', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: id,
        nombre: 'Solo nombre',
        categoriaId,
        tenantId,
      }),
    });

    await service.update(id, { nombre: 'Solo nombre' });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      {
        $set: {
          nombre: 'Solo nombre',
          moneda: 'MXN',
        },
      },
      { new: true },
    );
  });

  it('findOne cross-tenant → NotFound con filtro tenantId', async () => {
    const id = new Types.ObjectId().toString();
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(service.findOne(id)).rejects.toBeInstanceOf(NotFoundException);

    expect(servicioModel.findOne).toHaveBeenCalledWith({
      _id: id,
      tenantId,
    });
    expect(tenantId).not.toEqual(otherTenantId);
  });

  it('findAll default filtra activos ($ne: false) paginado con tenantId', async () => {
    const execFind = jest.fn().mockResolvedValue([{ nombre: 'A' }]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    const res = await service.findAll();

    expect(servicioModel.find).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
    });
    expect(sort).toHaveBeenCalledWith({ createdAt: 1, _id: 1 });
    expect(res.data).toHaveLength(1);
    expect(res.total).toBe(1);
    expect(res.page).toBe(1);
    expect(res.limit).toBe(20);
    expect(res.totalPages).toBe(1);
  });

  it('findAll orden nombre_asc usa sort alfabético ascendente', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ orden: ServicioOrden.NOMBRE_ASC });

    expect(sort).toHaveBeenCalledWith({ nombre: 1 });
  });

  it('findAll orden nombre_desc usa sort alfabético descendente', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ orden: ServicioOrden.NOMBRE_DESC });

    expect(sort).toHaveBeenCalledWith({ nombre: -1 });
  });

  it('findAll({ activo: false }) solo inactivos', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ activo: false });

    expect(servicioModel.find).toHaveBeenCalledWith({
      tenantId,
      activo: false,
    });
  });

  it('findAll escapa metacaracteres regex en nombre', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ nombre: 'Examen (MED)' });

    expect(servicioModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        nombre: { $regex: 'Examen \\(MED\\)', $options: 'i' },
      }),
    );
  });

  it('findAll filtra por categoriaId + nombre + activo', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limitFn = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit: limitFn });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({
      nombre: 'Rx',
      categoriaId: categoriaId.toString(),
      activo: false,
      page: 2,
      limit: 10,
    });

    expect(servicioModel.find).toHaveBeenCalledWith({
      tenantId,
      activo: false,
      nombre: { $regex: 'Rx', $options: 'i' },
      categoriaId,
    });
    expect(skip).toHaveBeenCalledWith(10);
    expect(limitFn).toHaveBeenCalledWith(10);
  });

  it('findAll filtra por tipo', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limitFn = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit: limitFn });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ tipo: TipoItem.PRODUCTO });

    expect(servicioModel.find).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
      tipo: TipoItem.PRODUCTO,
    });
  });

  it('findAll tipo=servicio incluye docs legacy sin campo', async () => {
    const execFind = jest.fn().mockResolvedValue([]);
    const limitFn = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit: limitFn });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    });

    await service.findAll({ tipo: TipoItem.SERVICIO });

    expect(servicioModel.find).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
      $or: [
        { tipo: TipoItem.SERVICIO },
        { tipo: { $exists: false } },
        { tipo: null },
      ],
    });
  });

  it('findAll totalPages con varios resultados', async () => {
    const execFind = jest.fn().mockResolvedValue([{ nombre: 'A' }]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(25),
    });

    const res = await service.findAll({ page: 1, limit: 10 });
    expect(res.totalPages).toBe(3);
    expect(res.total).toBe(25);
  });

  it('remove soft-delete: activo=false sin findOneAndDelete', async () => {
    const id = new Types.ObjectId().toString();
    const deactivated = {
      _id: id,
      nombre: 'X',
      activo: false,
      tenantId,
    };
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(deactivated),
    });

    const res = await service.remove(id);

    expect(servicioModel.findOneAndDelete).not.toHaveBeenCalled();
    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, tenantId },
      { $set: { activo: false } },
      { new: true },
    );
    expect(res.activo).toBe(false);
  });

  it('toggleActivo reactiva servicio inactivo si categoría activa', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      activo: false,
      categoriaId,
      tenantId,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    mockCategoriaActiva();

    const res = await service.toggleActivo(id);

    expect(res.activo).toBe(true);
    expect(doc.save).toHaveBeenCalled();
    expect(categoriaModel.findOne).toHaveBeenCalledWith({
      _id: String(categoriaId),
      tenantId,
    });
  });

  it('toggleActivo no reactiva si categoría inactiva', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      activo: false,
      categoriaId,
      tenantId,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });
    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: categoriaId,
        tenantId,
        codigo: 'MED',
        activo: false,
      }),
    });

    await expect(service.toggleActivo(id)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('toggleActivo con activo ausente (legacy) desactiva a false', async () => {
    const id = new Types.ObjectId().toString();
    const doc = {
      _id: id,
      tenantId,
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(doc),
    });

    const res = await service.toggleActivo(id);

    expect(res.activo).toBe(false);
    expect(doc.save).toHaveBeenCalled();
  });

  it('createForTenants remapea categoriaId por codigo en cada tenant', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });

    // 1) assert fuente (tenant contexto) 2) resolve destino 1 3) resolve destino 2
    categoriaModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: otherCategoriaId,
          tenantId: otherTenantId,
          codigo: 'MED',
          activo: true,
        }),
      });

    const res = await service.createForTenants({
      nombre: 'Examen',
      precioUnitario: 100,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
      tenantIds: [tenantId.toString(), otherTenantId.toString()],
    });

    expect(res.created).toHaveLength(2);
    expect(savedDocs).toHaveLength(2);
    expect(savedDocs[0].tenantId).toEqual(tenantId);
    expect(savedDocs[0].categoriaId).toEqual(categoriaId);
    expect(savedDocs[0].tipo).toBe(TipoItem.SERVICIO);
    expect(savedDocs[1].tenantId).toEqual(otherTenantId);
    expect(savedDocs[1].categoriaId).toEqual(otherCategoriaId);
    expect(savedDocs[1].tipo).toBe(TipoItem.SERVICIO);
    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(categoriaModel.findOne).toHaveBeenNthCalledWith(1, {
      _id: categoriaId.toString(),
      tenantId,
    });
  });

  it('createForTenants propaga tipo producto a ambos destinos', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });
    categoriaModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: otherCategoriaId,
          tenantId: otherTenantId,
          codigo: 'MED',
          activo: true,
        }),
      });

    await service.createForTenants({
      nombre: 'Kit',
      precioUnitario: 50,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.PRODUCTO,
      tenantIds: [tenantId.toString(), otherTenantId.toString()],
    });

    expect(savedDocs).toHaveLength(2);
    expect(savedDocs[0].tipo).toBe(TipoItem.PRODUCTO);
    expect(savedDocs[1].tipo).toBe(TipoItem.PRODUCTO);
  });

  it('createForTenants propaga codigo de ítem a ambos destinos', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });
    categoriaModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: otherCategoriaId,
          tenantId: otherTenantId,
          codigo: 'MED',
          activo: true,
        }),
      });

    await service.createForTenants({
      nombre: 'Extintor',
      precioUnitario: 800,
      categoriaId: categoriaId.toString(),
      tipo: TipoItem.PRODUCTO,
      codigo: 'SKU-MT',
      tenantIds: [tenantId.toString(), otherTenantId.toString()],
    });

    expect(savedDocs).toHaveLength(2);
    expect(savedDocs[0].codigo).toBe('SKU-MT');
    expect(savedDocs[1].codigo).toBe('SKU-MT');
    expect(savedDocs[0].tenantId).toEqual(tenantId);
    expect(savedDocs[1].tenantId).toEqual(otherTenantId);
  });

  it('createForTenants codigo duplicado en un destino → ConflictException + compensación', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });
    categoriaModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: otherCategoriaId,
          tenantId: otherTenantId,
          codigo: 'MED',
          activo: true,
        }),
      });

    const originalImpl = servicioModel.getMockImplementation();
    let saveCount = 0;
    servicioModel.mockImplementation((data: any) => {
      const doc = {
        ...data,
        _id: new Types.ObjectId(),
        save: jest.fn().mockImplementation(async function (this: any) {
          saveCount += 1;
          if (saveCount === 2) {
            throw { code: 11000 };
          }
          savedDocs.push(this);
          return this;
        }),
      };
      return doc;
    });

    try {
      await expect(
        service.createForTenants({
          nombre: 'Extintor',
          precioUnitario: 800,
          categoriaId: categoriaId.toString(),
          tipo: TipoItem.PRODUCTO,
          codigo: 'SKU-DUP',
          tenantIds: [tenantId.toString(), otherTenantId.toString()],
        }),
      ).rejects.toMatchObject({
        constructor: ConflictException,
        response: {
          message: expect.stringContaining(String(otherTenantId)),
        },
      });

      expect(servicioModel.deleteOne).toHaveBeenCalledTimes(1);
      expect(servicioModel.deleteOne).toHaveBeenCalledWith({
        _id: savedDocs[0]._id,
      });
    } finally {
      if (originalImpl) {
        servicioModel.mockImplementation(originalImpl);
      }
    }
  });

  it('createForTenants rechaza categoría fuente de otro tenant', async () => {
    (tenantsService.findById as jest.Mock).mockResolvedValue({
      _id: tenantId,
      activo: true,
    });
    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.createForTenants({
        nombre: 'Examen',
        precioUnitario: 100,
        categoriaId: otherCategoriaId.toString(),
      tipo: TipoItem.SERVICIO,
        tenantIds: [tenantId.toString()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(servicioModel).not.toHaveBeenCalled();
  });

  it('createForTenants 400 si un destino no tiene el codigo', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });

    categoriaModel.findOne
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue({
          _id: categoriaId,
          tenantId,
          codigo: 'MED',
          activo: true,
        }),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(null),
      });

    await expect(
      service.createForTenants({
        nombre: 'Examen',
        precioUnitario: 100,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
        tenantIds: [tenantId.toString(), otherTenantId.toString()],
      }),
    ).rejects.toMatchObject({
      response: {
        message: expect.stringContaining(String(otherTenantId)),
      },
    });

    expect(servicioModel.deleteOne).toHaveBeenCalledTimes(1);
  });

  it('createForTenants rechaza tenant inactivo', async () => {
    (tenantsService.findById as jest.Mock).mockResolvedValue({
      _id: tenantId,
      activo: false,
    });

    await expect(
      service.createForTenants({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
        tenantIds: [tenantId.toString()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createForTenants rechaza tenant inexistente', async () => {
    (tenantsService.findById as jest.Mock).mockResolvedValue(null);

    await expect(
      service.createForTenants({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
        tenantIds: [new Types.ObjectId().toString()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('createForTenants rechaza tenantId malformado con BadRequest (no 404)', async () => {
    await expect(
      service.createForTenants({
        nombre: 'X',
        precioUnitario: 1,
        categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
        tenantIds: ['not-a-valid-object-id'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tenantsService.findById).not.toHaveBeenCalled();
  });

  it('createForTenants compensa best-effort si falla el 2º save', async () => {
    (tenantsService.findById as jest.Mock)
      .mockResolvedValueOnce({ _id: tenantId, activo: true })
      .mockResolvedValueOnce({ _id: otherTenantId, activo: true });

    categoriaModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: categoriaId,
        tenantId,
        codigo: 'MED',
        activo: true,
      }),
    });

    const originalImpl = servicioModel.getMockImplementation();
    let saveCount = 0;
    servicioModel.mockImplementation((data: any) => {
      const doc = {
        ...data,
        _id: new Types.ObjectId(),
        save: jest.fn().mockImplementation(async function (this: any) {
          saveCount += 1;
          if (saveCount === 2) {
            throw new Error('mongo write failed');
          }
          savedDocs.push(this);
          return this;
        }),
      };
      return doc;
    });

    try {
      await expect(
        service.createForTenants({
          nombre: 'Examen',
          precioUnitario: 100,
          categoriaId: categoriaId.toString(),
      tipo: TipoItem.SERVICIO,
          tenantIds: [tenantId.toString(), otherTenantId.toString()],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(servicioModel.deleteOne).toHaveBeenCalledTimes(1);
      expect(servicioModel.deleteOne).toHaveBeenCalledWith({
        _id: savedDocs[0]._id,
      });
    } finally {
      if (originalImpl) {
        servicioModel.mockImplementation(originalImpl);
      }
    }
  });
});

jest.mock('sharp', () => {
  const chain = {
    rotate: jest.fn().mockReturnThis(),
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('webp-bytes')),
  };
  const sharpFn = jest.fn(() => chain);
  return {
    __esModule: true,
    default: Object.assign(sharpFn, { __chain: chain }),
  };
});

jest.mock('../common/uploads/disk-upload', () => ({
  ensureDir: jest.fn(),
  writeBufferFile: jest.fn(),
  unlinkQuiet: jest.fn(),
}));

describe('ServiciosService — imagen producto / Story 8.1', () => {
  const tenantId = new Types.ObjectId();
  const productoId = new Types.ObjectId();
  const servicioId = new Types.ObjectId();
  const MAX_WEBP_OUTPUT_BYTES = 200 * 1024;

  const sharpMock = jest.requireMock('sharp').default as jest.Mock & {
    __chain: {
      rotate: jest.Mock;
      resize: jest.Mock;
      webp: jest.Mock;
      toBuffer: jest.Mock;
    };
  };
  const sharpChain = sharpMock.__chain;

  const servicioModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  };
  const categoriaModel: any = { findOne: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;
  const tenantsService = { findById: jest.fn() } as unknown as TenantsService;

  const service = new ServiciosService(
    servicioModel as any,
    categoriaModel as any,
    tenantContext,
    tenantsService,
  );

  const { writeBufferFile, unlinkQuiet } = jest.requireMock(
    '../common/uploads/disk-upload',
  ) as {
    writeBufferFile: jest.Mock;
    unlinkQuiet: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getTenantId = jest.fn().mockReturnValue(tenantId);
    sharpChain.rotate.mockReturnThis();
    sharpChain.resize.mockReturnThis();
    sharpChain.webp.mockReturnThis();
    sharpChain.toBuffer.mockResolvedValue(Buffer.from('webp-bytes'));
  });

  function mockProductoUpload() {
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: productoId,
        tenantId,
        tipo: TipoItem.PRODUCTO,
      }),
    });
    const updated = {
      _id: productoId,
      tipo: TipoItem.PRODUCTO,
      imagenUrl: `/uploads/catalogo/${tenantId}/${productoId}.webp`,
    };
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    return updated;
  }

  function pngFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname: 'p.png',
      encoding: '7bit',
      mimetype: 'image/png',
      size: 100,
      buffer: Buffer.from('fake-png'),
      ...overrides,
    } as Express.Multer.File;
  }

  it('uploadImagen producto → path canónico + imagenUrl', async () => {
    mockProductoUpload();

    const result = await service.uploadImagen(productoId.toString(), pngFile());
    expect(writeBufferFile).toHaveBeenCalled();
    const absPath = (writeBufferFile as jest.Mock).mock.calls[0][0] as string;
    expect(absPath.replace(/\\/g, '/')).toContain(
      `uploads/catalogo/${tenantId}/${productoId}.webp`,
    );
    expect(result.imagenUrl).toBe(
      `/uploads/catalogo/${tenantId}/${productoId}.webp`,
    );
  });

  describe('WebP quality threshold', () => {
    const resized = Buffer.from('resized-raw');

    it('bajo umbral → una sola pasada @ quality 80', async () => {
      mockProductoUpload();
      const small = Buffer.alloc(1000, 1);
      sharpChain.toBuffer
        .mockResolvedValueOnce(resized)
        .mockResolvedValueOnce(small);

      await service.uploadImagen(productoId.toString(), pngFile());

      expect(sharpChain.webp).toHaveBeenCalledTimes(1);
      expect(sharpChain.webp).toHaveBeenCalledWith({ quality: 80 });
      expect(writeBufferFile).toHaveBeenCalledWith(
        expect.any(String),
        small,
        expect.any(String),
      );
    });

    it('exactamente 200KB @80 → no baja calidad', async () => {
      mockProductoUpload();
      const exact = Buffer.alloc(MAX_WEBP_OUTPUT_BYTES, 1);
      sharpChain.toBuffer
        .mockResolvedValueOnce(resized)
        .mockResolvedValueOnce(exact);

      await service.uploadImagen(productoId.toString(), pngFile());

      expect(sharpChain.webp).toHaveBeenCalledTimes(1);
      expect(sharpChain.webp).toHaveBeenCalledWith({ quality: 80 });
      expect(writeBufferFile).toHaveBeenCalledWith(
        expect.any(String),
        exact,
        expect.any(String),
      );
    });

    it('sobre umbral → re-encode bajando calidad hasta ≤200KB', async () => {
      mockProductoUpload();
      const large = Buffer.alloc(MAX_WEBP_OUTPUT_BYTES + 1, 1);
      const ok = Buffer.alloc(1000, 2);
      sharpChain.toBuffer
        .mockResolvedValueOnce(resized)
        .mockResolvedValueOnce(large)
        .mockResolvedValueOnce(ok);

      await service.uploadImagen(productoId.toString(), pngFile());

      const qualities = sharpChain.webp.mock.calls.map(
        (c: unknown[]) => (c[0] as { quality: number }).quality,
      );
      expect(qualities[0]).toBe(80);
      expect(qualities[1]).toBe(70);
      expect(qualities.length).toBe(2);
      expect(writeBufferFile).toHaveBeenCalledWith(
        expect.any(String),
        ok,
        expect.any(String),
      );
    });

    it('aún >200KB a quality 55 → persiste último buffer y upload OK', async () => {
      mockProductoUpload();
      const large = Buffer.alloc(MAX_WEBP_OUTPUT_BYTES + 50, 1);
      sharpChain.toBuffer
        .mockResolvedValueOnce(resized)
        .mockResolvedValue(large);

      const result = await service.uploadImagen(
        productoId.toString(),
        pngFile(),
      );

      const qualities = sharpChain.webp.mock.calls.map(
        (c: unknown[]) => (c[0] as { quality: number }).quality,
      );
      expect(qualities).toEqual([80, 70, 60, 55]);
      expect(writeBufferFile).toHaveBeenCalledWith(
        expect.any(String),
        large,
        expect.any(String),
      );
      expect(result.imagenUrl).toBe(
        `/uploads/catalogo/${tenantId}/${productoId}.webp`,
      );
    });
  });

  it('uploadImagen en tipo=servicio → 400', async () => {
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        tipo: TipoItem.SERVICIO,
      }),
    });
    await expect(
      service.uploadImagen(servicioId.toString(), pngFile()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(writeBufferFile).not.toHaveBeenCalled();
  });

  it('uploadImagen rechaza mime inválido / vacío / >1MB', async () => {
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: productoId,
        tenantId,
        tipo: TipoItem.PRODUCTO,
      }),
    });
    await expect(
      service.uploadImagen(
        productoId.toString(),
        pngFile({ mimetype: 'application/pdf' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadImagen(
        productoId.toString(),
        pngFile({ buffer: Buffer.alloc(0), size: 0 }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadImagen(
        productoId.toString(),
        pngFile({ size: 1_000_001, buffer: Buffer.alloc(10) }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clearImagen unset imagenUrl y unlink', async () => {
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: productoId,
        tenantId,
        tipo: TipoItem.PRODUCTO,
        imagenUrl: `/uploads/catalogo/${tenantId}/${productoId}.webp`,
      }),
    });
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: productoId,
        tipo: TipoItem.PRODUCTO,
      }),
    });
    await service.clearImagen(productoId.toString());
    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: productoId.toString(), tenantId },
      { $unset: { imagenUrl: 1 } },
      { new: true },
    );
    expect(unlinkQuiet).toHaveBeenCalled();
  });

  it('clearImagen en tipo=servicio → 400', async () => {
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: servicioId,
        tenantId,
        tipo: TipoItem.SERVICIO,
        imagenUrl: `/uploads/catalogo/${tenantId}/${servicioId}.webp`,
      }),
    });
    await expect(
      service.clearImagen(servicioId.toString()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(servicioModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(unlinkQuiet).not.toHaveBeenCalled();
  });

  it('update tipo→servicio unset imagenUrl + unlink', async () => {
    const updated = {
      _id: productoId,
      tenantId,
      tipo: TipoItem.SERVICIO,
    };
    servicioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    await service.update(productoId.toString(), { tipo: TipoItem.SERVICIO });

    expect(servicioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: productoId.toString(), tenantId },
      {
        $set: { tipo: TipoItem.SERVICIO, moneda: 'MXN' },
        $unset: { imagenUrl: 1 },
      },
      { new: true },
    );
    expect(unlinkQuiet).toHaveBeenCalled();
    const absPath = (unlinkQuiet as jest.Mock).mock.calls[0][0] as string;
    expect(absPath.replace(/\\/g, '/')).toContain(
      `uploads/catalogo/${tenantId}/${productoId}.webp`,
    );
  });

  it('findOne / list conservan imagenUrl cuando existe', async () => {
    const withImg = {
      _id: productoId,
      tenantId,
      tipo: TipoItem.PRODUCTO,
      imagenUrl: `/uploads/catalogo/${tenantId}/${productoId}.webp`,
    };
    servicioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(withImg),
    });
    const one = await service.findOne(productoId.toString());
    expect((one as any).imagenUrl).toBe(withImg.imagenUrl);

    const execFind = jest.fn().mockResolvedValue([withImg]);
    const limit = jest.fn().mockReturnValue({ exec: execFind });
    const skip = jest.fn().mockReturnValue({ limit });
    const sort = jest.fn().mockReturnValue({ skip });
    servicioModel.find.mockReturnValue({ sort });
    servicioModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });
    const list = await service.findAll();
    expect(list.data).toHaveLength(1);
    expect((list.data[0] as any).imagenUrl).toBe(withImg.imagenUrl);
  });
});

describe('ServiciosService — carga masiva catálogo', () => {
  const ExcelJS = require('exceljs') as typeof import('exceljs');
  const tenantId = new Types.ObjectId();
  const categoriaId = new Types.ObjectId();
  const savedDocs: any[] = [];

  const servicioModel: any = jest.fn().mockImplementation((data: any) => {
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
  servicioModel.find = jest.fn();

  const categoriaModel: any = { findOne: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;
  const tenantsService = { findById: jest.fn() } as unknown as TenantsService;
  const service = new ServiciosService(
    servicioModel as any,
    categoriaModel as any,
    tenantContext,
    tenantsService,
  );

  async function xlsxFromRows(
    rows: (string | number)[][],
    headers: string[] = [
      'tipo',
      'nombre',
      'codigo',
      'categoria',
      'precio',
      'descripcion',
      'activo',
    ],
    sheetName = 'Datos',
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(sheetName);
    sheet.addRow(headers);
    for (const row of rows) sheet.addRow(row);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  function fileFrom(buffer: Buffer, name = 'carga.xlsx') {
    return { buffer, originalname: name, size: buffer.length };
  }

  function mockExisting(
    docs: Array<{ nombre?: string; codigo?: string }> = [],
  ) {
    servicioModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(docs),
        }),
      }),
    });
  }

  function mockCategoria(codigo = 'MED', found = true) {
    categoriaModel.findOne.mockImplementation((q: { codigo?: string }) => ({
      exec: jest.fn().mockResolvedValue(
        found && (!q.codigo || q.codigo === codigo)
          ? { _id: categoriaId, tenantId, codigo, activo: true }
          : null,
      ),
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    savedDocs.length = 0;
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    servicioModel.mockClear();
    mockExisting([]);
    mockCategoria();
  });

  it('happy path crea filas válidas', async () => {
    const buffer = await xlsxFromRows([
      ['servicio', 'Consulta general', 'CONS-001', 'MED', 500, 'Desc', 'si'],
      ['producto', 'Kit', 'KIT-001', 'MED', 150, '', 'si'],
    ]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(2);
    expect(result.failed).toBe(0);
    expect(savedDocs).toHaveLength(2);
    expect(savedDocs[0].tipo).toBe(TipoItem.SERVICIO);
    expect(savedDocs[1].tipo).toBe(TipoItem.PRODUCTO);
    expect(result.reporteBase64).toBeUndefined();
  });

  it('mixto crea válidas y reporta fallos', async () => {
    const buffer = await xlsxFromRows([
      ['servicio', 'Consulta A', 'A-1', 'MED', 100, '', 'si'],
      ['servicio', 'Consulta B', 'B-1', 'XXX', 100, '', 'si'],
      ['servicio', 'Consulta C', 'C-1', 'MED', 100, '', 'si'],
    ]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toBe('Categoría inválida o inactiva');
    expect(result.errors[0].row).toBe(3);
    expect(result.reporteBase64).toBeTruthy();
  });

  it('código existente no actualiza', async () => {
    mockExisting([{ nombre: 'Otro', codigo: 'SKU-1' }]);
    const buffer = await xlsxFromRows([
      ['servicio', 'Nuevo nombre', 'SKU-1', 'MED', 10, '', 'si'],
      ['servicio', 'Otro ítem', 'SKU-2', 'MED', 10, '', 'si'],
    ]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/código/);
    expect(savedDocs[0].nombre).toBe('Otro ítem');
  });

  it('nombre duplicado (case) en tenant o archivo falla', async () => {
    mockExisting([{ nombre: 'Consulta General' }]);
    const buffer = await xlsxFromRows([
      ['servicio', 'consulta general', '', 'MED', 10, '', 'si'],
      ['servicio', 'Gemelo', '', 'MED', 10, '', 'si'],
      ['servicio', 'gemelo', '', 'MED', 20, '', 'si'],
    ]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.errors.every((e) => /nombre/.test(e.error))).toBe(true);
  });

  it('archivo inválido: extensión, headers y tope', async () => {
    await expect(
      service.importFromXlsx(fileFrom(Buffer.from('x'), 'carga.csv')),
    ).rejects.toBeInstanceOf(BadRequestException);

    const badHeaders = await xlsxFromRows([['servicio', 'X', '', 'MED', 1]], [
      'foo',
      'nombre',
      'codigo',
      'categoria',
      'precio',
    ]);
    await expect(service.importFromXlsx(fileFrom(badHeaders))).rejects.toThrow(
      /Faltan columnas/,
    );

    const tooMany = await xlsxFromRows(
      Array.from({ length: 501 }, (_, i) => [
        'servicio',
        `Item ${i}`,
        '',
        'MED',
        1,
      ]),
    );
    await expect(service.importFromXlsx(fileFrom(tooMany))).rejects.toThrow(
      /500 filas/,
    );
    expect(savedDocs).toHaveLength(0);
  });

  it('precio 1,500 (miles) no se importa como 1.5', async () => {
    const buffer = await xlsxFromRows([
      ['servicio', 'Precio malo', 'P-1', 'MED', '1,500', '', 'si'],
      ['servicio', 'Precio ok', 'P-2', 'MED', '1500,50', '', 'si'],
    ]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toMatch(/precio/);
    expect(savedDocs[0].precioUnitario).toBe(1500.5);
  });

  it('solo headers → 0 created, sin error de archivo', async () => {
    const buffer = await xlsxFromRows([]);
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('reintento: columna extra error se ignora', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Datos');
    sheet.addRow([
      'tipo',
      'nombre',
      'codigo',
      'categoria',
      'precio',
      'descripcion',
      'activo',
      'error',
    ]);
    sheet.addRow([
      'servicio',
      'Desde reporte',
      'REP-1',
      'MED',
      30,
      '',
      'si',
      'Categoría inválida o inactiva',
    ]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const result = await service.importFromXlsx(fileFrom(buffer));
    expect(result.created).toBe(1);
    expect(savedDocs[0].nombre).toBe('Desde reporte');
  });

  it('plantilla tiene hojas Instrucciones y Datos', async () => {
    const buffer = await service.getCatalogoImportPlantilla();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Instrucciones')).toBeTruthy();
    const datos = wb.getWorksheet('Datos');
    expect(datos).toBeTruthy();
    expect(datos!.getRow(1).getCell(1).value).toBe('tipo');
  });
});

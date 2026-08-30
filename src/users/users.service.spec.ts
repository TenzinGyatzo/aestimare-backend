import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { Roles } from '../auth/enums/roles.enum';

describe('UsersService (Story 1.6 / 2.3)', () => {
  const tenantId = new Types.ObjectId();
  const userModel = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
    updateMany: jest
      .fn()
      .mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      }),
  };

  const tenantsService = {
    findById: jest.fn(),
  };

  // Constructor will call onModuleInit via Nest in prod; unit: new without init side effects after mock
  let service: UsersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UsersService(userModel as any, tenantsService as any);
    userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
  });

  it('create operativo sin tenantId → BadRequest', async () => {
    await expect(
      service.create({
        email: 'op@ames.mx',
        password: 'secret1',
        nombre: 'Op',
        rol: Roles.OPERATIVO,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create operativo con tenant activo → OK', async () => {
    tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
    const save = jest.fn().mockResolvedValue({
      toObject: () => ({
        _id: new Types.ObjectId(),
        email: 'op@ames.mx',
        nombre: 'Op',
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
      }),
    });
    // Intercept `new this.userModel`
    const ModelCtor = function (this: any, data: any) {
      Object.assign(this, data);
      this.save = save;
      this.toObject = () => ({ ...data, passwordHash: 'x' });
    } as any;
    (service as any).userModel = Object.assign(ModelCtor, userModel);

    const doc = await service.create({
      email: 'OP@AMES.MX',
      password: 'secret1',
      nombre: 'Op',
      rol: Roles.OPERATIVO,
      tenantId: tenantId.toString(),
    });

    expect(save).toHaveBeenCalled();
    expect(doc).toBeDefined();
  });

  it('create admin con tenantId → BadRequest', async () => {
    await expect(
      service.create({
        email: 'admin@ames.mx',
        password: 'secret1',
        nombre: 'Admin',
        rol: Roles.ADMIN_SISTEMA,
        tenantId: tenantId.toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create admin_tenant sin tenantId → BadRequest', async () => {
    await expect(
      service.create({
        email: 'at@ames.mx',
        password: 'secret1',
        nombre: 'AT',
        rol: Roles.ADMIN_TENANT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create admin_tenant con tenant activo → OK', async () => {
    tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
    const save = jest.fn().mockResolvedValue({
      toObject: () => ({
        _id: new Types.ObjectId(),
        email: 'at@ames.mx',
        nombre: 'AT',
        rol: Roles.ADMIN_TENANT,
        tenantId,
        activo: true,
      }),
    });
    const ModelCtor = function (this: any, data: any) {
      Object.assign(this, data);
      this.save = save;
      this.toObject = () => ({ ...data, passwordHash: 'x' });
    } as any;
    (service as any).userModel = Object.assign(ModelCtor, userModel);

    const doc = await service.create({
      email: 'at@ames.mx',
      password: 'secret1',
      nombre: 'AT',
      rol: Roles.ADMIN_TENANT,
      tenantId: tenantId.toString(),
    });

    expect(save).toHaveBeenCalled();
    expect(doc).toBeDefined();
  });

  it('update a admin_tenant con tenant activo → OK', async () => {
    const userId = new Types.ObjectId();
    tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
      }),
    });
    const updated = {
      _id: userId,
      rol: Roles.ADMIN_TENANT,
      tenantId,
      activo: true,
    };
    userModel.findByIdAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const doc = await service.update(userId.toString(), {
      rol: Roles.ADMIN_TENANT,
      tenantId: tenantId.toString(),
    });

    expect(tenantsService.findById).toHaveBeenCalledWith(tenantId.toString());
    expect(userModel.findByIdAndUpdate).toHaveBeenCalled();
    expect(doc.rol).toBe(Roles.ADMIN_TENANT);
  });

  it('update a admin_tenant sin tenant → BadRequest', async () => {
    const userId = new Types.ObjectId();
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: userId,
        rol: Roles.ADMIN_SISTEMA,
        activo: true,
      }),
    });
    userModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(2),
    });

    await expect(
      service.update(userId.toString(), {
        rol: Roles.ADMIN_TENANT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create email duplicado → Conflict', async () => {
    userModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ email: 'a@a.com' }),
    });
    await expect(
      service.create({
        email: 'a@a.com',
        password: 'secret1',
        nombre: 'A',
        rol: Roles.ADMIN_SISTEMA,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findAll default filtra activo:true', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const select = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ select });
    userModel.find.mockReturnValue({ sort });

    await service.findAll();

    expect(userModel.find).toHaveBeenCalledWith({ activo: true });
  });

  it('findById id inválido → NotFound', async () => {
    await expect(service.findById('bad-id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('create sin rol → BadRequest', async () => {
    await expect(
      service.create({
        email: 'x@ames.mx',
        password: 'secret1',
        nombre: 'X',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create nombre solo espacios → BadRequest', async () => {
    await expect(
      service.create({
        email: 'x@ames.mx',
        password: 'secret1',
        nombre: '   ',
        rol: Roles.ADMIN_SISTEMA,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('softDelete del último admin activo → BadRequest', async () => {
    const oid = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    userModel.findById.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        _id: oid,
        rol: Roles.ADMIN_SISTEMA,
        activo: true,
        save: jest.fn(),
      }),
    });
    userModel.countDocuments.mockReturnValue({
      exec: jest.fn().mockResolvedValue(1),
    });

    await expect(service.softDelete(oid)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('actor scoping (Story 2.3)', () => {
    const actorTenant = {
      rol: Roles.ADMIN_TENANT,
      tenantId: tenantId.toString(),
    };
    const otherTenant = new Types.ObjectId().toString();

    function mockSaveModel() {
      const save = jest.fn().mockResolvedValue({
        toObject: () => ({ email: 'x@ames.mx' }),
      });
      const ModelCtor = function (this: any, data: any) {
        Object.assign(this, data);
        this.save = save;
      } as any;
      (service as any).userModel = Object.assign(ModelCtor, userModel);
      return save;
    }

    it('admin_tenant create operativo same-tenant → OK', async () => {
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      const save = mockSaveModel();
      await service.create(
        {
          email: 'op2@ames.mx',
          password: 'secret1',
          nombre: 'Op2',
          rol: Roles.OPERATIVO,
          tenantId: tenantId.toString(),
        },
        actorTenant,
      );
      expect(save).toHaveBeenCalled();
    });

    it('admin_tenant create admin_sistema → Forbidden', async () => {
      await expect(
        service.create(
          {
            email: 'sys@ames.mx',
            password: 'secret1',
            nombre: 'Sys',
            rol: Roles.ADMIN_SISTEMA,
          },
          actorTenant,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin_tenant create con tenant ajeno → Forbidden', async () => {
      await expect(
        service.create(
          {
            email: 'op3@ames.mx',
            password: 'secret1',
            nombre: 'Op3',
            rol: Roles.OPERATIVO,
            tenantId: otherTenant,
          },
          actorTenant,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin_tenant findAll filtra por tenantId', async () => {
      const exec = jest.fn().mockResolvedValue([]);
      const select = jest.fn().mockReturnValue({ exec });
      const sort = jest.fn().mockReturnValue({ select });
      userModel.find.mockReturnValue({ sort });

      await service.findAll(undefined, actorTenant);

      expect(userModel.find).toHaveBeenCalledWith({
        activo: true,
        tenantId: new Types.ObjectId(tenantId.toString()),
      });
    });

    it('admin_tenant findAll con tenantId inválido → Forbidden', async () => {
      await expect(
        service.findAll(undefined, {
          rol: Roles.ADMIN_TENANT,
          tenantId: 'not-an-objectid',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admin_sistema sin supportTenant → findAll vacío', async () => {
      const list = await service.findAll(undefined, {
        rol: Roles.ADMIN_SISTEMA,
        supportTenantId: null,
      });
      expect(list).toEqual([]);
      expect(userModel.find).not.toHaveBeenCalled();
    });

    it('admin_sistema + supportTenant findAll incluye peers', async () => {
      const exec = jest.fn().mockResolvedValue([]);
      const select = jest.fn().mockReturnValue({ exec });
      const sort = jest.fn().mockReturnValue({ select });
      userModel.find.mockReturnValue({ sort });

      await service.findAll(undefined, {
        rol: Roles.ADMIN_SISTEMA,
        supportTenantId: tenantId.toString(),
      });

      expect(userModel.find).toHaveBeenCalledWith({
        activo: true,
        $or: [
          { tenantId: new Types.ObjectId(tenantId.toString()) },
          { rol: Roles.ADMIN_SISTEMA, tenantId: { $exists: false } },
          { rol: Roles.ADMIN_SISTEMA, tenantId: null },
        ],
      });
    });

    it('admin_sistema + supportTenant create operativo anclado (sin tenantId body)', async () => {
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      const save = mockSaveModel();
      await service.create(
        {
          email: 'op4@ames.mx',
          password: 'secret1',
          nombre: 'Op4',
          rol: Roles.OPERATIVO,
        },
        {
          rol: Roles.ADMIN_SISTEMA,
          supportTenantId: tenantId.toString(),
        },
      );
      expect(save).toHaveBeenCalled();
      expect(tenantsService.findById).toHaveBeenCalledWith(tenantId.toString());
    });

    it('admin_sistema sin supportTenant create operativo → BadRequest', async () => {
      await expect(
        service.create(
          {
            email: 'op5@ames.mx',
            password: 'secret1',
            nombre: 'Op5',
            rol: Roles.OPERATIVO,
          },
          { rol: Roles.ADMIN_SISTEMA, supportTenantId: null },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('findManagedById admin_tenant cross-tenant → NotFound', async () => {
      const userId = new Types.ObjectId();
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: userId,
          rol: Roles.OPERATIVO,
          tenantId: new Types.ObjectId(),
          activo: true,
        }),
      });
      await expect(
        service.findManagedById(userId.toString(), actorTenant),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('softDelete último admin_tenant del tenant → BadRequest', async () => {
      const oid = 'bbbbbbbbbbbbbbbbbbbbbbbb';
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: oid,
          rol: Roles.ADMIN_TENANT,
          tenantId,
          activo: true,
          save: jest.fn(),
        }),
      });
      userModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      await expect(
        service.softDelete(oid, actorTenant),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(userModel.countDocuments).toHaveBeenCalledWith({
        rol: Roles.ADMIN_TENANT,
        tenantId,
        activo: true,
      });
    });

    it('update degrada último admin_tenant → BadRequest', async () => {
      const userId = new Types.ObjectId();
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: userId,
          rol: Roles.ADMIN_TENANT,
          tenantId,
          activo: true,
        }),
      });
      userModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      await expect(
        service.update(
          userId.toString(),
          { rol: Roles.OPERATIVO },
          actorTenant,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('softDelete admin_tenant con peers activos → OK', async () => {
      const oid = 'cccccccccccccccccccccccc';
      const save = jest.fn().mockResolvedValue({ activo: false });
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: oid,
          rol: Roles.ADMIN_TENANT,
          tenantId,
          activo: true,
          save,
        }),
      });
      userModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(2),
      });

      await service.softDelete(oid, actorTenant);
      expect(save).toHaveBeenCalled();
    });

    it('findAuthPrincipal id inválido → null (nunca 404)', async () => {
      await expect(service.findAuthPrincipal('bad-id')).resolves.toBeNull();
      expect(userModel.findById).not.toHaveBeenCalled();
    });

    it('findAuthPrincipal inexistente → null', async () => {
      const oid = new Types.ObjectId().toString();
      userModel.findById.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue(null),
          }),
        }),
      });
      await expect(service.findAuthPrincipal(oid)).resolves.toBeNull();
    });

    function mockUpdateCurrent(current: Record<string, unknown>) {
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(current),
      });
      userModel.findByIdAndUpdate.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...current }),
      });
    }

    it('update activo false incrementa credentialsVersion (0 → 1)', async () => {
      const userId = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
        credentialsVersion: 0,
      });

      await service.update(userId.toString(), { activo: false });

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        userId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            activo: false,
            credentialsVersion: 1,
          }),
        }),
        { new: true },
      );
    });

    it('update activo false incrementa de nuevo (1 → 2)', async () => {
      const userId = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
        credentialsVersion: 1,
      });

      await service.update(userId.toString(), { activo: false });

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        userId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            activo: false,
            credentialsVersion: 2,
          }),
        }),
        { new: true },
      );
    });

    it('reactivar con versión 0/ausente establece 1', async () => {
      const userId = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: false,
      });

      await service.update(userId.toString(), { activo: true });

      expect(userModel.findByIdAndUpdate).toHaveBeenCalledWith(
        userId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            activo: true,
            credentialsVersion: 1,
          }),
        }),
        { new: true },
      );
    });

    it('reactivar con versión >= 1 no modifica credentialsVersion', async () => {
      const userId = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: false,
        credentialsVersion: 2,
      });

      await service.update(userId.toString(), { activo: true });

      const updateArg = userModel.findByIdAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.activo).toBe(true);
      expect(updateArg.$set.credentialsVersion).toBeUndefined();
    });

    it('update nombre/email/password no incrementa credentialsVersion', async () => {
      const userId = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({ _id: tenantId, activo: true });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
        credentialsVersion: 4,
        email: 'old@ames.mx',
      });
      userModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await service.update(userId.toString(), {
        nombre: 'Nuevo Nombre',
        email: 'nuevo@ames.mx',
        password: 'secret99',
      });

      const updateArg = userModel.findByIdAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.nombre).toBe('Nuevo Nombre');
      expect(updateArg.$set.email).toBe('nuevo@ames.mx');
      expect(updateArg.$set.passwordHash).toBeDefined();
      expect(updateArg.$set.credentialsVersion).toBeUndefined();
    });

    it('update rol/tenant no incrementa credentialsVersion', async () => {
      const userId = new Types.ObjectId();
      const otherTenant = new Types.ObjectId();
      tenantsService.findById.mockResolvedValue({
        _id: otherTenant,
        activo: true,
      });
      mockUpdateCurrent({
        _id: userId,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
        credentialsVersion: 1,
      });

      await service.update(userId.toString(), {
        rol: Roles.ADMIN_TENANT,
        tenantId: otherTenant.toString(),
      });

      const updateArg = userModel.findByIdAndUpdate.mock.calls[0][1];
      expect(updateArg.$set.rol).toBe(Roles.ADMIN_TENANT);
      expect(updateArg.$set.credentialsVersion).toBeUndefined();
    });

    it('softDelete incrementa credentialsVersion igual que PATCH activo:false', async () => {
      const oid = 'dddddddddddddddddddddddd';
      const doc = {
        _id: oid,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: true,
        credentialsVersion: 0,
        save: jest.fn().mockImplementation(function (this: {
          activo: boolean;
          credentialsVersion: number;
        }) {
          return Promise.resolve(this);
        }),
      };
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      });

      await service.softDelete(oid);

      expect(doc.activo).toBe(false);
      expect(doc.credentialsVersion).toBe(1);
      expect(doc.save).toHaveBeenCalled();
    });

    it('softDelete de usuario ya inactivo no incrementa de nuevo', async () => {
      const oid = 'eeeeeeeeeeeeeeeeeeeeeeee';
      const doc = {
        _id: oid,
        rol: Roles.OPERATIVO,
        tenantId,
        activo: false,
        credentialsVersion: 3,
        save: jest.fn().mockImplementation(function (this: unknown) {
          return Promise.resolve(this);
        }),
      };
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      });

      await service.softDelete(oid);

      expect(doc.activo).toBe(false);
      expect(doc.credentialsVersion).toBe(3);
    });

    it('update actor admin_tenant cross-tenant → NotFound', async () => {
      const userId = new Types.ObjectId();
      userModel.findById.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: userId,
          rol: Roles.OPERATIVO,
          tenantId: new Types.ObjectId(),
          activo: true,
        }),
      });

      await expect(
        service.update(
          userId.toString(),
          { nombre: 'X' },
          actorTenant,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});

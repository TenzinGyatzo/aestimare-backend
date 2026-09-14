import { Types } from 'mongoose';
import { DashboardService } from './dashboard.service';
import { Roles } from '../auth/enums/roles.enum';

describe('DashboardService getEntityTotals (Story 7.3)', () => {
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();

  const clientesService = { countActive: jest.fn() };
  const contactosService = { countActive: jest.fn() };
  const serviciosService = { countActive: jest.fn() };
  const usersService = { countOperativosByTenant: jest.fn() };
  const tenantContext = { getTenantId: jest.fn() };

  let service: DashboardService;

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.getTenantId.mockReturnValue(tenantA);
    clientesService.countActive.mockResolvedValue(10);
    contactosService.countActive.mockResolvedValue(25);
    usersService.countOperativosByTenant.mockResolvedValue(3);
    serviciosService.countActive.mockResolvedValue(8);
    service = new DashboardService(
      clientesService as any,
      contactosService as any,
      serviciosService as any,
      usersService as any,
      tenantContext as any,
    );
  });

  it('agrega conteos del tenant en contexto', async () => {
    const r = await service.getEntityTotals();
    expect(r).toEqual({
      clientes: 10,
      contactos: 25,
      usuarios: 3,
      servicios: 8,
    });
    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(clientesService.countActive).toHaveBeenCalledTimes(1);
    expect(contactosService.countActive).toHaveBeenCalledTimes(1);
    expect(serviciosService.countActive).toHaveBeenCalledTimes(1);
    expect(usersService.countOperativosByTenant).toHaveBeenCalledWith(tenantA);
  });

  it('cambia de tenant → otro getTenantId (aislamiento)', async () => {
    tenantContext.getTenantId.mockReturnValue(tenantB);
    clientesService.countActive.mockResolvedValue(1);
    contactosService.countActive.mockResolvedValue(2);
    usersService.countOperativosByTenant.mockResolvedValue(0);
    serviciosService.countActive.mockResolvedValue(4);
    const r = await service.getEntityTotals();
    expect(r).toEqual({
      clientes: 1,
      contactos: 2,
      usuarios: 0,
      servicios: 4,
    });
    expect(usersService.countOperativosByTenant).toHaveBeenCalledWith(tenantB);
    expect(usersService.countOperativosByTenant).not.toHaveBeenCalledWith(
      tenantA,
    );
    expect(clientesService.countActive).toHaveBeenCalledTimes(1);
    expect(contactosService.countActive).toHaveBeenCalledTimes(1);
    expect(serviciosService.countActive).toHaveBeenCalledTimes(1);
  });
});

describe('UsersService.countOperativosByTenant (Story 7.3)', () => {
  it('filtra rol operativo + tenantId + activo (excluye admin_sistema)', async () => {
    const tenantId = new Types.ObjectId();
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(4),
    });
    const { UsersService } = await import('../users/users.service');
    const service = new UsersService({ countDocuments } as any, {} as any);
    const n = await service.countOperativosByTenant(tenantId);
    expect(n).toBe(4);
    expect(countDocuments).toHaveBeenCalledWith({
      rol: Roles.OPERATIVO,
      tenantId,
      activo: { $ne: false },
    });
    expect(countDocuments.mock.calls[0][0].rol).not.toBe(Roles.ADMIN_SISTEMA);
  });
});

describe('ContactosService.countActive (Story 7.3)', () => {
  it('cuenta solo tenant + activos', async () => {
    const tenantId = new Types.ObjectId();
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(7),
    });
    const { ContactosService } = await import('../clientes/contactos.service');
    const service = new ContactosService(
      { countDocuments } as any,
      {} as any,
      { getTenantId: () => tenantId } as any,
    );
    const n = await service.countActive();
    expect(n).toBe(7);
    expect(countDocuments).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
    });
  });
});

describe('ClientesService.countActive (Story 7.3)', () => {
  it('cuenta solo tenant + activos', async () => {
    const tenantId = new Types.ObjectId();
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(5),
    });
    const { ClientesService } = await import('../clientes/clientes.service');
    const service = new ClientesService(
      { countDocuments } as any,
      { getTenantId: () => tenantId } as any,
      {} as any,
      {} as any,
    );
    const n = await service.countActive();
    expect(n).toBe(5);
    expect(countDocuments).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
    });
  });
});

describe('ServiciosService.countActive (Story 7.3)', () => {
  it('cuenta solo tenant + activos', async () => {
    const tenantId = new Types.ObjectId();
    const countDocuments = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(9),
    });
    const { ServiciosService } = await import('../servicios/servicios.service');
    const service = new ServiciosService(
      { countDocuments } as any,
      {} as any,
      { getTenantId: () => tenantId } as any,
      {} as any,
    );
    const n = await service.countActive();
    expect(n).toBe(9);
    expect(countDocuments).toHaveBeenCalledWith({
      tenantId,
      activo: { $ne: false },
    });
  });
});

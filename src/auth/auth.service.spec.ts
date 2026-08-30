import { AuthService } from './auth.service';
import { Roles } from './enums/roles.enum';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService.login', () => {
  const jwtService = { sign: jest.fn(() => 'token') };
  const usersService = {};
  const tenantsService = { findById: jest.fn() };
  const service = new AuthService(
    usersService as any,
    jwtService as any,
    tenantsService as any,
  );

  it('emite JWT con rol operativo y tipoUsuario alineado', async () => {
    const result = await service.login({
      _id: 'u1',
      email: 'op@ames.test',
      nombre: 'Op',
      rol: Roles.OPERATIVO,
      tenantId: 't1',
      activo: true,
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u1',
        rol: Roles.OPERATIVO,
        tipoUsuario: Roles.OPERATIVO,
        tenantId: 't1',
        credentialsVersion: 0,
      }),
    );
    expect(result.user.rol).toBe(Roles.OPERATIVO);
    expect(result.user.tipoUsuario).toBe(Roles.OPERATIVO);
    expect(result.access_token).toBe('token');
  });

  it('admin_sistema sin tenantId en payload', async () => {
    await service.login({
      _id: 'u2',
      email: 'admin@ames.test',
      nombre: 'Admin',
      rol: Roles.ADMIN_SISTEMA,
      activo: true,
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.not.objectContaining({ tenantId: expect.anything() }),
    );
  });

  it('emite JWT con rol admin_tenant y tipoUsuario alineado', async () => {
    const result = await service.login({
      _id: 'u3',
      email: 'at@ames.test',
      nombre: 'Admin Tenant',
      rol: Roles.ADMIN_TENANT,
      tenantId: 't2',
      activo: true,
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: 'u3',
        rol: Roles.ADMIN_TENANT,
        tipoUsuario: Roles.ADMIN_TENANT,
        tenantId: 't2',
        credentialsVersion: 0,
      }),
    );
    expect(result.user.rol).toBe(Roles.ADMIN_TENANT);
    expect(result.user.tipoUsuario).toBe(Roles.ADMIN_TENANT);
  });

  it('incluye credentialsVersion del usuario (o 0 si ausente)', async () => {
    await service.login({
      _id: 'u4',
      email: 'op2@ames.test',
      nombre: 'Op2',
      rol: Roles.OPERATIVO,
      tenantId: 't1',
      activo: true,
      credentialsVersion: 3,
    });

    expect(jwtService.sign).toHaveBeenCalledWith(
      expect.objectContaining({ credentialsVersion: 3 }),
    );
  });
});

describe('AuthService.validateUser', () => {
  const jwtService = { sign: jest.fn() };
  const usersService = {
    findByEmailWithPassword: jest.fn(),
  };
  const tenantsService = {
    findById: jest.fn(),
  };
  const service = new AuthService(
    usersService as any,
    jwtService as any,
    tenantsService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rechaza usuario con activo: false', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      email: 'inactivo@ames.test',
      passwordHash: 'hash',
      activo: false,
      toObject: () => ({ email: 'inactivo@ames.test', activo: false }),
    });

    const result = await service.validateUser(
      'inactivo@ames.test',
      'cualquier-password',
    );

    expect(result).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('acepta usuario activo con password válida y tenant activo', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      email: 'activo@ames.test',
      passwordHash: 'hash',
      activo: true,
      rol: Roles.OPERATIVO,
      tenantId: 't1',
      toObject: () => ({
        email: 'activo@ames.test',
        activo: true,
        rol: Roles.OPERATIVO,
        tenantId: 't1',
      }),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tenantsService.findById.mockResolvedValue({ _id: 't1', activo: true });

    const result = await service.validateUser('activo@ames.test', 'ok');

    expect(result).toEqual(
      expect.objectContaining({ email: 'activo@ames.test', activo: true }),
    );
    expect(tenantsService.findById).toHaveBeenCalledWith('t1');
  });

  it('rechaza operativo de tenant inactivo (Story 4.3 / AD-14)', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      email: 'op@ames.test',
      passwordHash: 'hash',
      activo: true,
      rol: Roles.OPERATIVO,
      tenantId: 't-off',
      toObject: () => ({
        email: 'op@ames.test',
        activo: true,
        rol: Roles.OPERATIVO,
        tenantId: 't-off',
      }),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tenantsService.findById.mockResolvedValue({ _id: 't-off', activo: false });

    const result = await service.validateUser('op@ames.test', 'ok');

    expect(result).toBeNull();
  });

  it('rechaza admin_tenant de tenant inactivo (Story 4.3 / AD-14)', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      email: 'at@ames.test',
      passwordHash: 'hash',
      activo: true,
      rol: Roles.ADMIN_TENANT,
      tenantId: 't-off',
      toObject: () => ({
        email: 'at@ames.test',
        activo: true,
        rol: Roles.ADMIN_TENANT,
        tenantId: 't-off',
      }),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tenantsService.findById.mockResolvedValue({ _id: 't-off', activo: false });

    const result = await service.validateUser('at@ames.test', 'ok');

    expect(result).toBeNull();
  });

  it('admin_sistema no consulta Tenant.activo', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      email: 'sys@ames.test',
      passwordHash: 'hash',
      activo: true,
      rol: Roles.ADMIN_SISTEMA,
      toObject: () => ({
        email: 'sys@ames.test',
        activo: true,
        rol: Roles.ADMIN_SISTEMA,
      }),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.validateUser('sys@ames.test', 'ok');

    expect(result).toEqual(
      expect.objectContaining({ email: 'sys@ames.test', rol: Roles.ADMIN_SISTEMA }),
    );
    expect(tenantsService.findById).not.toHaveBeenCalled();
  });
});

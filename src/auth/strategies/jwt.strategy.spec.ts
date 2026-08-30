import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Roles } from '../enums/roles.enum';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const usersService = {
    findAuthPrincipal: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? 'test-secret-at-least-16' : undefined,
    ),
  };

  let strategy: JwtStrategy;

  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();
  const userId = new Types.ObjectId();

  const activeOperativo = {
    _id: userId,
    email: 'op@ames.test',
    rol: Roles.OPERATIVO,
    tenantId: tenantA,
    activo: true,
    credentialsVersion: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(configService as any, usersService as any);
  });

  it('usuario activo + versión coincidente → hidrata req.user desde Mongo', async () => {
    usersService.findAuthPrincipal.mockResolvedValue(activeOperativo);

    const result = await strategy.validate({
      sub: String(userId),
      rol: Roles.OPERATIVO,
      tenantId: String(tenantA),
      credentialsVersion: 0,
    });

    expect(result).toEqual({
      _id: userId,
      email: 'op@ames.test',
      rol: Roles.OPERATIVO,
      tipoUsuario: Roles.OPERATIVO,
      tenantId: tenantA,
    });
  });

  it('JWT legacy sin claim + usuario legacy sin campo → permitido (versión 0)', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      credentialsVersion: undefined,
    });

    const result = await strategy.validate({
      sub: String(userId),
      rol: Roles.OPERATIVO,
      tenantId: String(tenantA),
    });

    expect(result.rol).toBe(Roles.OPERATIVO);
  });

  it('suspensión: JWT v0 vs usuario v1 → 401', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      credentialsVersion: 1,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('suspensión → reactivación: JWT v0 vs usuario activo v1 → 401', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      activo: true,
      credentialsVersion: 1,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login nuevo tras reactivación: JWT v1 + usuario v1 → válido', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      credentialsVersion: 1,
    });

    const result = await strategy.validate({
      sub: String(userId),
      rol: Roles.OPERATIVO,
      tenantId: String(tenantA),
      credentialsVersion: 1,
    });

    expect(result.rol).toBe(Roles.OPERATIVO);
  });

  it('segunda suspensión: JWT v1 vs usuario v2 → 401', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      credentialsVersion: 2,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
        credentialsVersion: 1,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cambio admin_sistema → admin_tenant: JWT viejo = 401 (mismatch rol)', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      _id: userId,
      email: 'sys@ames.test',
      rol: Roles.ADMIN_TENANT,
      tenantId: tenantA,
      activo: true,
      credentialsVersion: 0,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.ADMIN_SISTEMA,
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cambio admin_tenant → operativo: JWT viejo = 401 (mismatch rol)', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      rol: Roles.OPERATIVO,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.ADMIN_TENANT,
        tenantId: String(tenantA),
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('cambio tenant A → B: JWT viejo = 401 aunque versión coincida', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      tenantId: tenantB,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('nombre/email no invalidan si versión, rol y tenant coinciden', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      email: 'nuevo@ames.test',
    });

    const result = await strategy.validate({
      sub: String(userId),
      rol: Roles.OPERATIVO,
      tenantId: String(tenantA),
      credentialsVersion: 0,
    });

    expect(result.email).toBe('nuevo@ames.test');
  });

  it('usuario inactivo → 401 independientemente de versión', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      activo: false,
      credentialsVersion: 0,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
        credentialsVersion: 0,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('usuario inexistente → 401 (nunca 404)', async () => {
    usersService.findAuthPrincipal.mockResolvedValue(null);

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.findAuthPrincipal).toHaveBeenCalledWith(String(userId));
  });

  it('sub inválido / ausente → 401', async () => {
    await expect(strategy.validate({})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.findAuthPrincipal).not.toHaveBeenCalled();

    usersService.findAuthPrincipal.mockResolvedValue(null);
    await expect(
      strategy.validate({ sub: 'not-an-objectid' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('inactivo pre-despliegue reactivado (v1) rechaza JWT legacy v0', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      ...activeOperativo,
      credentialsVersion: 1,
    });

    await expect(
      strategy.validate({
        sub: String(userId),
        rol: Roles.OPERATIVO,
        tenantId: String(tenantA),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('admin_sistema vigente sin tenant en JWT ni Mongo → permitido', async () => {
    usersService.findAuthPrincipal.mockResolvedValue({
      _id: userId,
      email: 'sys@ames.test',
      rol: Roles.ADMIN_SISTEMA,
      activo: true,
      credentialsVersion: 0,
    });

    const result = await strategy.validate({
      sub: String(userId),
      rol: Roles.ADMIN_SISTEMA,
      credentialsVersion: 0,
    });

    expect(result.rol).toBe(Roles.ADMIN_SISTEMA);
    expect(result.tenantId).toBeUndefined();
  });
});

import { AuthService } from '../auth/auth.service';
import { Roles } from '../auth/enums/roles.enum';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from './audit-action-type';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService auditoría de login', () => {
  const jwtService = { sign: jest.fn(() => 'token') };
  const usersService = { findByEmailWithPassword: jest.fn() };
  const tenantsService = { findById: jest.fn() };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new AuthService(
    usersService as any,
    jwtService as any,
    tenantsService as any,
    auditService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('login fallido (usuario desconocido) registra failure + email, sin password', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(null);

    const result = await service.validateUser('ghost@ames.test', 'secret', {
      ip: '10.0.0.1',
      userAgent: 'jest',
    });

    expect(result).toBeNull();
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.AUTH_LOGIN_FAILURE,
        resourceType: AuditResourceType.AUTH,
        result: AuditResult.FAILURE,
        actorSnapshot: expect.objectContaining({ email: 'ghost@ames.test' }),
        payload: { reason: 'unknown_user' },
        ip: '10.0.0.1',
      }),
    );
    const payload = auditService.record.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('login exitoso registra success con tenant y actor', async () => {
    const user = {
      _id: 'u1',
      email: 'op@ames.test',
      nombre: 'Op',
      rol: Roles.OPERATIVO,
      tenantId: 't1',
      activo: true,
    };

    await service.login(user, { ip: '10.0.0.2' });

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.AUTH_LOGIN_SUCCESS,
        result: AuditResult.SUCCESS,
        tenantId: 't1',
        actorId: 'u1',
        ip: '10.0.0.2',
      }),
    );
    expect(jwtService.sign).toHaveBeenCalled();
  });

  it('tenant inactivo registra reason inactive_tenant', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue({
      _id: 'u2',
      email: 'op@ames.test',
      passwordHash: 'hash',
      activo: true,
      rol: Roles.OPERATIVO,
      tenantId: 't-off',
      toObject: () => ({}),
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    tenantsService.findById.mockResolvedValue({ _id: 't-off', activo: false });

    await service.validateUser('op@ames.test', 'ok');

    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.AUTH_LOGIN_FAILURE,
        payload: { reason: 'inactive_tenant' },
        tenantId: 't-off',
      }),
    );
  });
});

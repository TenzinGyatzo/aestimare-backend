import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditService } from './audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from './audit-action-type';
import { Roles } from '../auth/enums/roles.enum';
import { sanitizeAuditPayload } from './audit-sanitize';

describe('sanitizeAuditPayload', () => {
  it('redacta secretos, tokens y datos bancarios', () => {
    const out = sanitizeAuditPayload({
      fields: ['emailRemitente'],
      emailPass: 'app-password-secret',
      password: 'plain',
      clabe: '012345678901234567',
      nested: { token: 'abc', ok: 1 },
    });
    expect(out?.emailPass).toBe('[redacted]');
    expect(out?.password).toBe('[redacted]');
    expect(out?.clabe).toBe('[redacted]');
    expect((out?.nested as { token: string; ok: number }).token).toBe(
      '[redacted]',
    );
    expect((out?.nested as { token: string; ok: number }).ok).toBe(1);
    expect(out?.fields).toEqual(['emailRemitente']);
  });
});

describe('AuditService.record', () => {
  const create = jest.fn();
  const service = new AuditService({ create } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue({});
  });

  it('persiste login fallido sin secretos y no lanza si Mongo falla', async () => {
    await service.record({
      tenantId: new Types.ObjectId().toString(),
      actorSnapshot: { email: 'op@ames.test', rol: Roles.OPERATIVO },
      actionType: AuditActionType.AUTH_LOGIN_FAILURE,
      resourceType: AuditResourceType.AUTH,
      result: AuditResult.FAILURE,
      payload: { reason: 'invalid_password', password: 'secret' },
      ip: '1.2.3.4',
      userAgent: 'jest',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.AUTH_LOGIN_FAILURE,
        result: AuditResult.FAILURE,
        ip: '1.2.3.4',
        payload: expect.objectContaining({
          reason: 'invalid_password',
          password: '[redacted]',
        }),
      }),
    );

    create.mockRejectedValueOnce(new Error('mongo down'));
    await expect(
      service.record({
        actionType: AuditActionType.AUTH_LOGIN_SUCCESS,
        resourceType: AuditResourceType.AUTH,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('AuditService.buildScopedQuery (segregación multitenant)', () => {
  const service = new AuditService({} as any);
  const tenantA = new Types.ObjectId();
  const tenantB = new Types.ObjectId();

  it('admin_tenant solo ve su tenant (nunca el de otro)', () => {
    const query = service.buildScopedQuery(
      { rol: Roles.ADMIN_TENANT, tenantId: String(tenantA) },
      {},
    );
    expect(query.tenantId).toEqual(tenantA);
    expect(String(query.tenantId)).not.toBe(String(tenantB));
  });

  it('admin_tenant sin tenant → 403', () => {
    expect(() =>
      service.buildScopedQuery({ rol: Roles.ADMIN_TENANT }, {}),
    ).toThrow(ForbiddenException);
  });

  it('operativo no consulta auditoría', () => {
    expect(() =>
      service.buildScopedQuery({ rol: Roles.OPERATIVO, tenantId: String(tenantA) }, {}),
    ).toThrow(ForbiddenException);
  });

  it('admin_sistema con X-Tenant-Id filtra ese tenant', () => {
    const query = service.buildScopedQuery(
      { rol: Roles.ADMIN_SISTEMA, supportTenantId: String(tenantB) },
      {},
    );
    expect(query.tenantId).toEqual(tenantB);
  });

  it('admin_sistema + includePlatform incluye eventos sin tenant', () => {
    const query = service.buildScopedQuery(
      { rol: Roles.ADMIN_SISTEMA, supportTenantId: String(tenantA) },
      { includePlatform: true },
    );
    expect(query.$or).toEqual(
      expect.arrayContaining([
        { tenantId: tenantA },
        { tenantId: { $exists: false } },
        { tenantId: null },
      ]),
    );
  });

  it('admin_sistema sin header no filtra por tenant (plataforma)', () => {
    const query = service.buildScopedQuery(
      { rol: Roles.ADMIN_SISTEMA, supportTenantId: null },
      { actionType: AuditActionType.AUTH_LOGIN_SUCCESS },
    );
    expect(query.tenantId).toBeUndefined();
    expect(query.$or).toBeUndefined();
    expect(query.actionType).toBe(AuditActionType.AUTH_LOGIN_SUCCESS);
  });

  it('filtra por actor, acción y recurso', () => {
    const actorId = new Types.ObjectId();
    const query = service.buildScopedQuery(
      { rol: Roles.ADMIN_TENANT, tenantId: String(tenantA) },
      {
        actorId: String(actorId),
        actionType: AuditActionType.USER_CREATED,
        resourceType: AuditResourceType.USER,
        resourceId: 'abc',
        result: AuditResult.SUCCESS,
      },
    );
    expect(query.actorId).toEqual(actorId);
    expect(query.actionType).toBe(AuditActionType.USER_CREATED);
    expect(query.resourceType).toBe(AuditResourceType.USER);
    expect(query.resourceId).toBe('abc');
    expect(query.result).toBe(AuditResult.SUCCESS);
  });
});

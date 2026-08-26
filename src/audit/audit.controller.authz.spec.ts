import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/enums/roles.enum';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { AuditController } from './audit.controller';

describe('AuditController roles metadata', () => {
  const reflector = new Reflector();

  it('GET solo admin_tenant | admin_sistema (no operativo)', () => {
    const roles = reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      AuditController.prototype.findAll,
      AuditController,
    ]);
    expect(roles).toEqual([Roles.ADMIN_TENANT, Roles.ADMIN_SISTEMA]);
    expect(roles).not.toContain(Roles.OPERATIVO);
  });

  it('no expone PATCH ni DELETE', () => {
    expect((AuditController.prototype as any).update).toBeUndefined();
    expect((AuditController.prototype as any).remove).toBeUndefined();
    expect((AuditController.prototype as any).delete).toBeUndefined();
  });
});

describe('AuditController RolesGuard', () => {
  const reflector = new Reflector();
  const rolesGuard = new RolesGuard(reflector);

  function ctx(user: { rol?: string } | null) {
    return {
      getHandler: () => AuditController.prototype.findAll,
      getClass: () => AuditController,
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as any;
  }

  it('admin_tenant → allow', () => {
    expect(
      rolesGuard.canActivate(ctx({ rol: Roles.ADMIN_TENANT })),
    ).toBe(true);
  });

  it('admin_sistema → allow', () => {
    expect(
      rolesGuard.canActivate(ctx({ rol: Roles.ADMIN_SISTEMA })),
    ).toBe(true);
  });

  it('operativo → deny', () => {
    expect(() =>
      rolesGuard.canActivate(ctx({ rol: Roles.OPERATIVO })),
    ).toThrow(ForbiddenException);
  });
});

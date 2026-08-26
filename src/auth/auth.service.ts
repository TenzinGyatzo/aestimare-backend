import { Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { Roles } from './enums/roles.enum';
import * as bcrypt from 'bcrypt';
import { AuditService } from '../audit/audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit/audit-action-type';
import type { AuditClientMeta } from '../audit/audit-client-meta';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private tenantsService: TenantsService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  async validateUser(
    email: string,
    passwordPlain: string,
    meta?: AuditClientMeta,
  ): Promise<any> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.usersService.findByEmailWithPassword(email);

    if (!user) {
      await this.auditLoginFailure(normalizedEmail, 'unknown_user', null, meta);
      return null;
    }

    if (!user.activo) {
      await this.auditLoginFailure(
        normalizedEmail,
        'inactive_user',
        user,
        meta,
      );
      return null;
    }

    const isPasswordValid = await bcrypt.compare(
      passwordPlain,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      await this.auditLoginFailure(
        normalizedEmail,
        'invalid_password',
        user,
        meta,
      );
      return null;
    }

    // Story 4.3 / AD-14: operativo/admin_tenant de tenant inactivo → mismo 401 genérico.
    if (user.rol !== Roles.ADMIN_SISTEMA && user.tenantId) {
      const tenant = await this.tenantsService.findById(String(user.tenantId));
      if (!tenant || tenant.activo === false) {
        await this.auditLoginFailure(
          normalizedEmail,
          'inactive_tenant',
          user,
          meta,
        );
        return null;
      }
    }

    const { ...result } = user.toObject();
    return result;
  }

  async login(user: any, meta?: AuditClientMeta) {
    const payload: Record<string, unknown> = {
      sub: user._id,
      email: user.email,
      rol: user.rol,
      tipoUsuario: user.rol,
    };
    if (user.tenantId) {
      payload.tenantId = user.tenantId;
    }

    await this.auditService?.record({
      tenantId: user.tenantId ? String(user.tenantId) : undefined,
      actorId: user._id ? String(user._id) : undefined,
      actorSnapshot: {
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
      },
      actionType: AuditActionType.AUTH_LOGIN_SUCCESS,
      resourceType: AuditResourceType.AUTH,
      resourceId: user._id ? String(user._id) : undefined,
      result: AuditResult.SUCCESS,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        _id: user._id,
        email: user.email,
        nombre: user.nombre,
        rol: user.rol,
        tipoUsuario: user.rol,
        tenantId: user.tenantId,
        activo: user.activo,
      },
    };
  }

  private async auditLoginFailure(
    email: string,
    reason: string,
    user: { _id?: unknown; tenantId?: unknown; rol?: string; nombre?: string } | null,
    meta?: AuditClientMeta,
  ): Promise<void> {
    await this.auditService?.record({
      tenantId: user?.tenantId ? String(user.tenantId) : undefined,
      actorId: user?._id ? String(user._id) : undefined,
      actorSnapshot: {
        email,
        nombre: user?.nombre,
        rol: user?.rol,
      },
      actionType: AuditActionType.AUTH_LOGIN_FAILURE,
      resourceType: AuditResourceType.AUTH,
      resourceId: user?._id ? String(user._id) : undefined,
      result: AuditResult.FAILURE,
      payload: { reason },
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }
}

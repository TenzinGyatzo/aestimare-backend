import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { Roles } from '../auth/enums/roles.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import {
  X_TENANT_ID_HEADER,
  X_TENANT_ID_API_HEADER,
} from '../tenants/tenant-context.guard';
import { TenantsService } from '../tenants/tenants.service';
import { isStrictObjectId } from '../common/strict-object-id';
import { AuditService, type AuditQueryActor } from './audit.service';
import { FilterAuditEventDto } from './dto/filter-audit-event.dto';
import { PaginatedAuditEventsResponseDto } from './dto/audit-event-response.dto';

@ApiTags('audit-events')
@Controller('audit-events')
@UseGuards(JwtAuthGuard, RolesGuard)
@RolesDecorator(Roles.ADMIN_TENANT, Roles.ADMIN_SISTEMA)
@ApiBearerAuth()
@ApiHeader({
  ...X_TENANT_ID_API_HEADER,
  required: false,
  description:
    'admin_sistema: filtra eventos del tenant. Sin header = visión de plataforma. admin_tenant: se ignora (usa JWT).',
})
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly tenantsService: TenantsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar eventos de auditoría de seguridad',
    description:
      'Solo lectura. admin_tenant: su tenant. admin_sistema: tenant de X-Tenant-Id, o todos si no hay header. Append-only: no hay PATCH/DELETE.',
  })
  @ApiResponse({ status: 200, type: PaginatedAuditEventsResponseDto })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  async findAll(
    @Query() filters: FilterAuditEventDto,
    @CurrentUser() user: { rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    return this.auditService.findForActor(
      await this.actorFrom(user, req),
      filters,
    );
  }

  private async actorFrom(
    user: { rol?: string; tenantId?: string },
    req: { headers?: Record<string, unknown> },
  ): Promise<AuditQueryActor> {
    const rol = user?.rol;
    if (!rol) {
      throw new BadRequestException('Usuario sin rol');
    }

    if (rol === Roles.ADMIN_TENANT) {
      const tid = user.tenantId != null ? String(user.tenantId) : '';
      if (!tid || !isStrictObjectId(tid)) {
        throw new ForbiddenException(
          'Usuario admin_tenant sin tenant asignado',
        );
      }
      const tenant = await this.tenantsService.findById(tid);
      if (!tenant || tenant.activo === false) {
        throw new ForbiddenException('Tenant no encontrado o inactivo');
      }
      return { rol, tenantId: tid, supportTenantId: null };
    }

    if (rol === Roles.ADMIN_SISTEMA) {
      let supportTenantId: string | null = null;
      const raw = req.headers?.[X_TENANT_ID_HEADER];
      if (Array.isArray(raw) && raw.length !== 1) {
        throw new BadRequestException(
          'Header X-Tenant-Id ambiguo: se esperaba un único valor',
        );
      }
      const header = Array.isArray(raw) ? raw[0] : raw;
      if (typeof header === 'string' && header.trim()) {
        const tid = header.trim();
        if (!isStrictObjectId(tid)) {
          throw new BadRequestException('X-Tenant-Id inválido');
        }
        const tenant = await this.tenantsService.findById(tid);
        if (!tenant) {
          throw new ForbiddenException('Tenant no encontrado');
        }
        supportTenantId = tid;
      }
      return {
        rol,
        tenantId: user.tenantId ?? null,
        supportTenantId,
      };
    }

    throw new ForbiddenException('No autorizado para consultar auditoría');
  }
}

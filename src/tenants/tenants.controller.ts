import {
  Body,
  Controller,
  Get,
  Optional,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/enums/roles.enum';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OnboardTenantDto } from './dto/onboard-tenant.dto';
import { UpdateTenantActivoDto } from './dto/update-tenant-activo.dto';
import { AuditService } from '../audit/audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit/audit-action-type';
import {
  actorIdFromUser,
  actorSnapshotFromUser,
} from '../audit/audit-client-meta';

@ApiTags('tenants')
@Controller('tenants')
@UseGuards(JwtAuthGuard, RolesGuard)
@RolesDecorator(Roles.ADMIN_SISTEMA)
@ApiBearerAuth()
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Inventario de tenants de plataforma (activos e inactivos — AD-16 / AD-14)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de tenants (_id, nombre, clave, activo, createdAt?)',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  findAll() {
    return this.tenantsService.findAllForPlatform();
  }

  @Patch(':id/activo')
  @ApiOperation({
    summary:
      'Suspender o reactivar tenant (Tenant.activo — AD-14 / AD-16). Idempotente.',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant actualizado (_id, nombre, clave, activo, createdAt?)',
  })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 404, description: 'Tenant no encontrado' })
  async setActivo(
    @Param('id') id: string,
    @Body() dto: UpdateTenantActivoDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const updated = await this.tenantsService.setActivo(id, dto.activo);
    await this.auditService?.record({
      tenantId: updated._id,
      actorId: actorIdFromUser(user),
      actorSnapshot: actorSnapshotFromUser(user),
      actionType: dto.activo
        ? AuditActionType.TENANT_ACTIVATED
        : AuditActionType.TENANT_SUSPENDED,
      resourceType: AuditResourceType.TENANT,
      resourceId: updated._id,
      result: AuditResult.SUCCESS,
      payload: { clave: updated.clave, activo: updated.activo },
    });
    return updated;
  }

  @Post('onboard')
  @ApiOperation({
    summary:
      'Onboarding atómico: tenant + config + seeds + primer admin_tenant (AD-13)',
  })
  @ApiResponse({ status: 201, description: 'Tenant provisionado' })
  @ApiResponse({ status: 403, description: 'Rol no autorizado' })
  @ApiResponse({ status: 409, description: 'Clave o email en conflicto' })
  async onboard(
    @Body() dto: OnboardTenantDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const result = await this.tenantsService.onboard(dto);
    await this.auditService?.record({
      tenantId: result.tenant._id,
      actorId: actorIdFromUser(user),
      actorSnapshot: actorSnapshotFromUser(user),
      actionType: AuditActionType.TENANT_ONBOARDED,
      resourceType: AuditResourceType.TENANT,
      resourceId: result.tenant._id,
      result: AuditResult.SUCCESS,
      payload: {
        clave: result.tenant.clave,
        adminUserId: result.admin._id,
        adminEmail: result.admin.email,
      },
    });
    return result;
  }
}

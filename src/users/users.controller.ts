import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
  ApiHeader,
} from '@nestjs/swagger';
import { UsersService, type UsersActor } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FilterUserDto } from './dto/filter-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { Roles } from '../auth/enums/roles.enum';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { X_TENANT_ID_HEADER } from '../tenants/tenant-context.guard';
import { TenantsService } from '../tenants/tenants.service';
import { isStrictObjectId } from '../common/strict-object-id';
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

@ApiTags('users')

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@RolesDecorator(Roles.ADMIN_TENANT, Roles.ADMIN_SISTEMA)
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Tenant-Id',
  required: false,
  description:
    'Para admin_sistema: tenant de soporte al listar/crear operativo|admin_tenant. No aplica a admin_tenant (usa JWT).',
})
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  private async actorFrom(
    user: {
      rol?: string;
      tenantId?: string;
    },
    req: { headers?: Record<string, unknown> },
  ): Promise<UsersActor> {
    const rol = user?.rol;
    if (!rol) {
      throw new BadRequestException('Usuario sin rol');
    }

    if (rol === Roles.ADMIN_TENANT) {
      const tid = user.tenantId != null ? String(user.tenantId) : '';
      if (!tid || !isStrictObjectId(tid)) {
        throw new ForbiddenException('Usuario admin_tenant sin tenant asignado');
      }
      // Story 4.3 / AD-14: JWT previo no opera si el tenant está suspendido.
      const tenant = await this.tenantsService.findById(tid);
      if (!tenant || tenant.activo === false) {
        throw new ForbiddenException('Tenant no encontrado o inactivo');
      }
      return { rol, tenantId: tid, supportTenantId: null };
    }

    let supportTenantId: string | null = null;
    if (rol === Roles.ADMIN_SISTEMA) {
      const raw = req.headers?.[X_TENANT_ID_HEADER];
      if (Array.isArray(raw)) {
        if (raw.length !== 1) {
          throw new BadRequestException(
            'Header X-Tenant-Id ambiguo: se esperaba un único valor',
          );
        }
      }
      const header = Array.isArray(raw) ? raw[0] : raw;
      if (typeof header === 'string' && header.trim()) {
        const tid = header.trim();
        if (!isStrictObjectId(tid)) {
          throw new BadRequestException('X-Tenant-Id inválido');
        }
        const tenant = await this.tenantsService.findById(tid);
        // AD-14: admin_sistema puede soportar tenants inactivos (Usar contexto).
        if (!tenant) {
          throw new ForbiddenException('Tenant no encontrado');
        }
        supportTenantId = tid;
      }
    }

    return {
      rol,
      tenantId: user.tenantId ?? null,
      supportTenantId,
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear usuario',
    description:
      'admin_tenant: solo operativo|admin_tenant de su tenant (403 si tenant inactivo). admin_sistema: soporte del tenant en header (activo o inactivo) o peers admin_sistema (AD-11 / AD-14 / AD-16 / Story 2.3).',
  })
  @ApiResponse({ status: 201, type: UserResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Datos o reglas rol↔tenant inválidas',
  })
  @ApiResponse({ status: 409, description: 'Email duplicado' })
  @ApiResponse({ status: 403, description: 'Sin permiso o escalada denegada' })
  async create(
    @Body() createUserDto: CreateUserDto,
    @CurrentUser() user: { rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    const actor = await this.actorFrom(user, req);
    const created = await this.usersService.create(createUserDto, actor);
    await this.auditService?.record({
      tenantId: created.tenantId ? String(created.tenantId) : undefined,
      actorId: actorIdFromUser(user as { _id?: string }),
      actorSnapshot: actorSnapshotFromUser({
        email: (user as { email?: string }).email,
        rol: user.rol,
      }),
      actionType: AuditActionType.USER_CREATED,
      resourceType: AuditResourceType.USER,
      resourceId: String(created._id),
      result: AuditResult.SUCCESS,
      payload: {
        rol: created.rol,
        email: created.email,
        viaSupport: actor.rol === Roles.ADMIN_SISTEMA && !!actor.supportTenantId,
      },
    });
    return this.usersService.sanitize(created);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar usuarios (default: activos)',
    description:
      'admin_tenant: solo su tenant. admin_sistema: usuarios del tenant en X-Tenant-Id más peers admin_sistema (vacío si no hay header).',
  })
  @ApiQuery({ name: 'activo', required: false, type: Boolean })
  @ApiQuery({
    name: 'rol',
    required: false,
    enum: ['operativo', 'admin_tenant', 'admin_sistema'],
  })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiResponse({ status: 200, type: [UserResponseDto] })
  async findAll(
    @Query() filters: FilterUserDto | undefined,
    @CurrentUser() user: { rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    return this.usersService.findAll(filters, await this.actorFrom(user, req));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener usuario por ID' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: { rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    const found = await this.usersService.findManagedById(
      id,
      await this.actorFrom(user, req),
    );
    return this.usersService.sanitize(found);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar usuario' })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 404, description: 'No encontrado' })
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    const actor = await this.actorFrom(user, req);
    const before = await this.usersService.findManagedById(id, actor);
    const updated = await this.usersService.update(id, updateUserDto, actor);
    const viaSupport =
      actor.rol === Roles.ADMIN_SISTEMA && !!actor.supportTenantId;
    const base = {
      tenantId: updated.tenantId
        ? String(updated.tenantId)
        : before.tenantId
          ? String(before.tenantId)
          : undefined,
      actorId: actorIdFromUser(user),
      actorSnapshot: actorSnapshotFromUser(user),
      resourceType: AuditResourceType.USER as const,
      resourceId: String(updated._id),
      result: AuditResult.SUCCESS,
    };

    if (updateUserDto.rol !== undefined && updateUserDto.rol !== before.rol) {
      await this.auditService?.record({
        ...base,
        actionType: AuditActionType.USER_ROLE_CHANGED,
        payload: {
          from: before.rol,
          to: updated.rol,
          viaSupport,
        },
      });
    }
    if (
      updateUserDto.activo !== undefined &&
      updateUserDto.activo !== before.activo
    ) {
      await this.auditService?.record({
        ...base,
        actionType: updateUserDto.activo
          ? AuditActionType.USER_ACTIVATED
          : AuditActionType.USER_SUSPENDED,
        payload: { viaSupport },
      });
    }
    if (updateUserDto.password) {
      await this.auditService?.record({
        ...base,
        actionType: AuditActionType.USER_PASSWORD_CHANGED,
        payload: { viaSupport },
      });
    }
    return this.usersService.sanitize(updated);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactivar usuario (soft delete)',
    description: 'Marca activo=false (AD-10). No hard-delete.',
  })
  @ApiParam({ name: 'id' })
  @ApiResponse({ status: 200, type: UserResponseDto })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string; tenantId?: string },
    @Req() req: { headers?: Record<string, unknown> },
  ) {
    const actor = await this.actorFrom(user, req);
    const removed = await this.usersService.softDelete(id, actor);
    await this.auditService?.record({
      tenantId: removed.tenantId ? String(removed.tenantId) : undefined,
      actorId: actorIdFromUser(user),
      actorSnapshot: actorSnapshotFromUser(user),
      actionType: AuditActionType.USER_DELETED,
      resourceType: AuditResourceType.USER,
      resourceId: String(removed._id),
      result: AuditResult.SUCCESS,
      payload: {
        viaSupport: actor.rol === Roles.ADMIN_SISTEMA && !!actor.supportTenantId,
      },
    });
    return this.usersService.sanitize(removed);
  }
}

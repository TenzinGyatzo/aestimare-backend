import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Body,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UseFilters,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { AMES_ROLES, Roles } from '../auth/enums/roles.enum';
import {
  TenantContextGuard,
  X_TENANT_ID_API_HEADER,
} from './tenant-context.guard';
import { TenantContextInterceptor } from './tenant-context.interceptor';
import { TenantConfigService } from './tenant-config.service';
import { TenantConfigResponseDto } from './dto/tenant-config-response.dto';
import { UpdateTenantBrandingDto } from './dto/update-tenant-branding.dto';
import { UpdateTenantEmailDto } from './dto/update-tenant-email.dto';
import { UpdateTenantVigenciaBancariosDto } from './dto/update-tenant-vigencia-bancarios.dto';
import { MulterBadRequestFilter } from './multer-bad-request.filter';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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

/** Escritura config: admin_tenant | admin_sistema (FR42 / AD-16 / Story 2.4). */
const CONFIG_WRITE_ROLES = [Roles.ADMIN_TENANT, Roles.ADMIN_SISTEMA] as const;

@ApiTags('tenant-config')
@Controller('tenant-config')
@UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
@UseInterceptors(TenantContextInterceptor)
@RolesDecorator(...AMES_ROLES)
@ApiBearerAuth()
@ApiHeader({
  ...X_TENANT_ID_API_HEADER,
  required: false,
  description:
    'Obligatorio para admin_sistema. Operativo y admin_tenant: no enviar (tenant del JWT). Define qué configuración se lee/escribe (AD-2).',
})
export class TenantConfigController {
  constructor(
    private readonly tenantConfigService: TenantConfigService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Obtener configuración del tenant activo',
    description:
      'Roles AMES (operativo | admin_tenant | admin_sistema). Lectura para PDF/núcleo. Escritura restringida a admin_tenant | admin_sistema (Story 2.4 / FR42).',
  })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({
    status: 400,
    description: 'X-Tenant-Id ausente o ambiguo (admin_sistema)',
  })
  @ApiResponse({ status: 401, description: 'JWT ausente o inválido' })
  @ApiResponse({
    status: 403,
    description:
      'Rol no AMES; o X-Tenant-Id inválido / tenant inexistente o inactivo',
  })
  async get() {
    const doc = await this.tenantConfigService.getForRequest();
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Patch('branding')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Actualizar branding y datos legales del tenant activo',
    description:
      'Partial update. String vacío limpia el campo. No incluye logo (usar POST/DELETE logo). admin_tenant | admin_sistema (FR42).',
  })
  @ApiBody({ type: UpdateTenantBrandingDto })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Validación o X-Tenant-Id' })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  async patchBranding(
    @Body() dto: UpdateTenantBrandingDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const doc = await this.tenantConfigService.updateBranding(dto);
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_BRANDING_UPDATED,
      {
        fields: (
          [
            'razonSocial',
            'rfc',
            'domicilio',
            'telefono',
            'emailContacto',
            'sitioWeb',
          ] as const
        ).filter((k) => dto[k] !== undefined),
      },
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Patch('email')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary:
      'Actualizar remitente, notificaciones y credenciales SMTP del tenant',
    description:
      'Partial update. emailRemitente vacío limpia. correosNotificacion: [] es válido. emailUser + emailPass (app password) → cifra a emailSecretEnc (FR55). Response nunca incluye el secret. admin_tenant | admin_sistema (FR42).',
  })
  @ApiBody({ type: UpdateTenantEmailDto })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Validación o X-Tenant-Id' })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  async patchEmail(
    @Body() dto: UpdateTenantEmailDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const doc = await this.tenantConfigService.updateEmailConfig(dto);
    const fields = (
      ['emailRemitente', 'correosNotificacion', 'emailUser'] as const
    ).filter((k) => dto[k] !== undefined);
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_EMAIL_UPDATED,
      {
        fields,
        credentialsUpdated: dto.emailPass != null && dto.emailPass !== '',
      },
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Patch('vigencia-bancarios')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Actualizar vigencia default y datos bancarios del tenant activo',
    description:
      'Partial update. admin_tenant | admin_sistema (FR42). String vacío limpia subcampo bancario. ' +
      'defaultIncluirDatosBancarios/Descripciones/ImagenesPdf y defaultUsarVigencia: true/false configura el default de la cotización nueva; null limpia (vuelve a sin configurar); omitido = no tocar.',
  })
  @ApiBody({ type: UpdateTenantVigenciaBancariosDto })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validación (días fuera de rango, etc.)',
  })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  async patchVigenciaBancarios(
    @Body() dto: UpdateTenantVigenciaBancariosDto,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const doc = await this.tenantConfigService.updateVigenciaBancarios(dto);
    const fields: string[] = [];
    if (dto.vigenciaDefaultDias !== undefined) fields.push('vigenciaDefaultDias');
    if (dto.defaultIncluirDatosBancarios !== undefined) {
      fields.push('defaultIncluirDatosBancarios');
    }
    if (dto.defaultIncluirDescripciones !== undefined) {
      fields.push('defaultIncluirDescripciones');
    }
    if (dto.defaultIncluirImagenesPdf !== undefined) {
      fields.push('defaultIncluirImagenesPdf');
    }
    if (dto.defaultUsarVigencia !== undefined) fields.push('defaultUsarVigencia');
    if (dto.bancarios !== undefined) {
      if (dto.bancarios === null) {
        fields.push('bancarios');
      } else {
        for (const key of [
          'titular',
          'banco',
          'cuenta',
          'clabe',
          'domicilio',
          'rfc',
          'email',
        ] as const) {
          if (dto.bancarios[key] !== undefined) {
            fields.push(`bancarios.${key}`);
          }
        }
      }
    }
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_VIGENCIA_BANCARIOS_UPDATED,
      { fields },
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Post('branding/logo')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Subir o reemplazar logo del tenant activo',
    description: 'admin_tenant | admin_sistema (FR42).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Archivo inválido / tamaño / mime' })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  @UseFilters(MulterBadRequestFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1_000_000 },
    }),
  )
  async uploadLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Archivo de logo requerido');
    }
    const doc = await this.tenantConfigService.saveLogo(file);
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_LOGO_UPDATED,
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Delete('branding/logo')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Eliminar logo del tenant activo',
    description: 'admin_tenant | admin_sistema (FR42).',
  })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  async deleteLogo(
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const doc = await this.tenantConfigService.clearLogo();
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_LOGO_DELETED,
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Post('bancarios/logo')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Subir o reemplazar logo del banco',
    description:
      'No pisa branding.logoUrl. admin_tenant | admin_sistema (FR42). PNG/JPEG/WebP ≤1MB.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Archivo inválido / tamaño / mime' })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  @UseFilters(MulterBadRequestFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1_000_000 },
    }),
  )
  async uploadBankLogo(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    if (!file) {
      throw new BadRequestException('Archivo de logo requerido');
    }
    const doc = await this.tenantConfigService.saveBankLogo(file);
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_BANK_LOGO_UPDATED,
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  @Delete('bancarios/logo')
  @RolesDecorator(...CONFIG_WRITE_ROLES)
  @ApiOperation({
    summary: 'Eliminar logo del banco del tenant activo',
    description: 'admin_tenant | admin_sistema (FR42).',
  })
  @ApiResponse({ status: 200, type: TenantConfigResponseDto })
  @ApiResponse({
    status: 403,
    description: 'operativo u otro rol sin permiso / tenant inválido',
  })
  async deleteBankLogo(
    @CurrentUser() user: { _id?: string; email?: string; rol?: string },
  ) {
    const doc = await this.tenantConfigService.clearBankLogo();
    await this.recordConfigWrite(
      user,
      doc,
      AuditActionType.TENANT_CONFIG_BANK_LOGO_DELETED,
    );
    return this.tenantConfigService.toResponseAsync(doc);
  }

  private async recordConfigWrite(
    user: { _id?: string; email?: string; rol?: string },
    doc: { _id?: unknown; tenantId?: unknown },
    actionType: AuditActionType,
    extraPayload?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService?.record({
      tenantId: doc.tenantId ? String(doc.tenantId) : undefined,
      actorId: actorIdFromUser(user),
      actorSnapshot: actorSnapshotFromUser(user),
      actionType,
      resourceType: AuditResourceType.TENANT_CONFIG,
      resourceId: doc._id ? String(doc._id) : undefined,
      result: AuditResult.SUCCESS,
      payload: {
        ...extraPayload,
        viaSupport: user.rol === Roles.ADMIN_SISTEMA,
      },
    });
  }
}

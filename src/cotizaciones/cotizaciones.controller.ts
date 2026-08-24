import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UseFilters,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiHeader,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { isEmail } from 'class-validator';
import { CotizacionesService } from './cotizaciones.service';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import { CreateCotizacionAdminDto } from './dto/create-cotizacion-admin.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { FilterCotizacionDto } from './dto/filter-cotizacion.dto';
import { PaginatedCotizacionesResponseDto } from './dto/paginated-cotizaciones-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AMES_ROLES } from '../auth/enums/roles.enum';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { AceptarCotizacionDto } from './dto/aceptar-cotizacion.dto';
import { TenantContextGuard } from '../tenants/tenant-context.guard';
import { TenantContextInterceptor } from '../tenants/tenant-context.interceptor';
import { TenantContextService } from '../tenants/tenant-context.service';
import {
  MulterPdfBadRequestFilter,
  PDF_UPLOAD_MAX_BYTES,
} from './multer-pdf-bad-request.filter';
import { PublicCotizacionResponseDto } from './dto/public-cotizacion-response.dto';
import { CambiarEstadoDto } from './dto/cambiar-estado.dto';
import { RepetirCotizacionDto } from './dto/repetir-cotizacion.dto';
import { CreateNotaInternaDto } from './dto/create-nota-interna.dto';
import { UpdateNotaInternaDto } from './dto/update-nota-interna.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RecordatoriosService } from './recordatorios/recordatorios.service';
import { UpsertRecordatorioDto } from './recordatorios/dto/upsert-recordatorio.dto';
import { RecordatoriosDisparadosResponseDto } from './recordatorios/dto/recordatorio-disparado-item.dto';

@ApiTags('cotizaciones')
@Controller('cotizaciones')
export class CotizacionesController {
  constructor(
    private readonly cotizacionesService: CotizacionesService,
    private readonly tenantContext: TenantContextService,
    private readonly recordatoriosService: RecordatoriosService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({ summary: 'Crear una nueva cotización' })
  @ApiResponse({
    status: 201,
    description: 'Cotización creada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos, o cliente inactivo (no se puede cotizar)',
  })
  @ApiResponse({
    status: 404,
    description: 'Cliente o servicio no encontrado',
  })
  create(@Body() createCotizacionDto: CreateCotizacionDto) {
    return this.cotizacionesService.create(createCotizacionDto);
  }

  @Post('admin')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Crear cotización (identidad CRM/guest flexible)',
    description:
      'Crea una cotización con identidad opcional: cliente CRM (`clienteId`), snapshots guest, o vacío total. Requiere ≥1 ítem; folio vía counters; moneda MXN. Legacy: con clienteId se permite email sin nombreContacto.',
  })
  @ApiResponse({
    status: 201,
    description: 'Cotización creada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({
    status: 404,
    description: 'Servicio no encontrado',
  })
  createAdminCotizacion(
    @Body() createCotizacionAdminDto: CreateCotizacionAdminDto,
    @CurrentUser() user: { _id?: string; sub?: string; email?: string },
  ) {
    return this.cotizacionesService.createAdminCotizacion(
      createCotizacionAdminDto,
      user,
    );
  }

  @Post(':id/enviar-correo')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary:
      'Enviar cotización por correo con PDF del frontend (Story 6.8 / 6.17)',
    description:
      'Multipart: PDF generado en FE + opcional overrides emailsPara/emailsCc (JSON). Emite magic link; no persiste el PDF. Sirve al crear (wizard) y al reenviar desde el detalle de una cotización ya creada.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        emailsPara: {
          type: 'string',
          description: 'JSON array de emails Para (override opcional)',
        },
        emailsCc: {
          type: 'string',
          description: 'JSON array de emails CC (override opcional)',
        },
      },
      required: ['file'],
    },
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 200, description: 'Correo enviado' })
  @ApiResponse({
    status: 400,
    description: 'PDF/destinatarios inválidos o SMTP falló',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  @UseFilters(MulterPdfBadRequestFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: PDF_UPLOAD_MAX_BYTES },
    }),
  )
  enviarCorreo(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: { emailsPara?: string; emailsCc?: string },
  ) {
    const overrides: { emailsPara?: string[]; emailsCc?: string[] } = {};
    if (body?.emailsPara !== undefined) {
      overrides.emailsPara = this.parseEmailJsonField(
        body.emailsPara,
        'emailsPara',
      );
    }
    if (body?.emailsCc !== undefined) {
      overrides.emailsCc = this.parseEmailJsonField(body.emailsCc, 'emailsCc');
    }
    return this.cotizacionesService.enviarCorreoConPdf(
      id,
      file,
      Object.keys(overrides).length ? overrides : undefined,
    );
  }

  private parseEmailJsonField(raw: string, field: string): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        throw new BadRequestException(`${field} debe ser un JSON array`);
      }
      const emails: string[] = [];
      for (const item of parsed) {
        if (typeof item !== 'string') {
          throw new BadRequestException(`${field} contiene un correo inválido`);
        }
        const email = item.trim();
        if (!email || !isEmail(email)) {
          throw new BadRequestException(`${field} contiene un correo inválido`);
        }
        emails.push(email);
      }
      return emails;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`${field} debe ser un JSON array válido`);
    }
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Listar cotizaciones con filtros opcionales y paginación',
    description:
      'Listado paginado del tenant: filtro por estado/fechas y búsqueda por folio, empresa, solicitante, RFC o correo.',
  })
  @ApiQuery({
    name: 'estado',
    required: false,
    enum: ['vigente', 'vencida', 'aceptada', 'rechazada', 'cancelada'],
    description: 'Filtrar por estado de la cotización',
  })
  @ApiQuery({
    name: 'search',
    required: false,
    type: String,
    description: 'Búsqueda por folio, empresa, solicitante, RFC o correo',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Número de página (default: 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Número de elementos por página (default: 10)',
  })
  @ApiQuery({
    name: 'fechaDesde',
    required: false,
    type: String,
    description: 'Fecha desde (ISO string)',
  })
  @ApiQuery({
    name: 'fechaHasta',
    required: false,
    type: String,
    description: 'Fecha hasta (ISO string)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de cotizaciones obtenida exitosamente',
    type: PaginatedCotizacionesResponseDto,
  })
  findAll(@Query() filters?: FilterCotizacionDto) {
    return this.cotizacionesService.findAll(filters);
  }

  @Patch('mark-expired')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar todas las cotizaciones vencidas automáticamente',
    description:
      'Marca como vencidas las cotizaciones vigentes cuya fecha de vencimiento ya pasó, solo del tenant efectivo (AD-2). El cron diario sigue siendo global.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cotizaciones vencidas marcadas exitosamente',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Se marcaron 5 cotizaciones como vencidas',
        },
        count: {
          type: 'number',
          example: 5,
        },
      },
    },
  })
  async markExpired() {
    const count = await this.cotizacionesService.markExpiredQuotations(
      this.tenantContext.getTenantId(),
    );
    return {
      message: `Se marcaron ${count} cotización(es) como vencida(s)`,
      count,
    };
  }

  @Get('recordatorios/disparados')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Listar recordatorios disparados (Story 10.2)',
    description:
      'Bandeja de trabajo del tenant: folio, identidad (AD-37), fechaDisparo, recetaResumen. Misma proyección para Dashboard y listado (10.3).',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de recordatorios disparados',
    type: RecordatoriosDisparadosResponseDto,
  })
  listRecordatoriosDisparados(): Promise<RecordatoriosDisparadosResponseDto> {
    return this.recordatoriosService.listDisparados();
  }

  @Post('recordatorios/:recordatorioId/cerrar')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar recordatorio disparado (Story 10.2)',
    description:
      'Transición disparado → cerrado. El recordatorio desaparece del listado de disparados (FR8).',
  })
  @ApiParam({
    name: 'recordatorioId',
    description: 'ID del documento recordatorio_recotizacion',
  })
  @ApiResponse({
    status: 200,
    description: 'Recordatorio cerrado',
    schema: {
      type: 'object',
      properties: { estado: { type: 'string', example: 'cerrado' } },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'No está en estado disparado',
  })
  @ApiResponse({ status: 404, description: 'Recordatorio no encontrado' })
  cerrarRecordatorio(@Param('recordatorioId') recordatorioId: string) {
    return this.recordatoriosService.cerrar(recordatorioId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({ summary: 'Obtener una cotización por ID' })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({
    status: 200,
    description: 'Cotización encontrada',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  findOne(@Param('id') id: string) {
    return this.cotizacionesService.findOne(id);
  }

  @Post(':id/repetir')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Repetir cotización (Story 6.12 + 11.1 recordatorio)',
    description:
      'Clona con precios originales (snapshot) o actualizados (catálogo). Folio nuevo, vigente, vigencia recalculada. Sin correo ni magic link. Si hay servicios inexistentes/inactivos (modo actualizados), responde 400 con warnings para omitir o sustituir. Con cancelarOriginal=true cancela la fuente tras crear (sin rollback si falla la cancelación). Story 11.1: siempre cancela recordatorio origen; rearmarRecordatorio + recetaRecordatorio opcional crean recordatorio programado en la COT nueva.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización fuente' })
  @ApiResponse({
    status: 201,
    description:
      'Envelope: cotizacion (nueva), originalCancelada, originalCancelacionError?',
  })
  @ApiResponse({
    status: 400,
    description: 'Warnings de servicios o body inválido',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  @HttpCode(HttpStatus.CREATED)
  repetir(
    @Param('id') id: string,
    @Body() dto: RepetirCotizacionDto,
    @CurrentUser() user: { _id?: string; sub?: string; email?: string },
  ) {
    return this.cotizacionesService.repetirCotizacion(id, dto, user);
  }

  @Post(':id/repetir/preview')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Preview repetir cotización (wizard precargado)',
    description:
      'Misma lógica que repetir pero sin persistir. Devuelve payload wizard-ready. 400 con warnings si hay servicios inactivos/inexistentes (modo actualizados).',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización fuente' })
  @ApiResponse({ status: 200, description: 'Preview wizard-ready' })
  @ApiResponse({
    status: 400,
    description: 'Warnings de servicios o body inválido',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  previewRepetir(@Param('id') id: string, @Body() dto: RepetirCotizacionDto) {
    return this.cotizacionesService.previewRepetirCotizacion(id, dto);
  }

  @Get(':id/recordatorio')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Obtener recordatorio de recotización (Story 9.2)',
    description:
      'Lectura simétrica a PUT/DELETE. 404 = Ausente (sin documento). Si cancelado sin disparo previo, FE trata como CTA programar.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 200, description: 'Recordatorio encontrado' })
  @ApiResponse({
    status: 404,
    description: 'Cotización o recordatorio no encontrado',
  })
  getRecordatorio(@Param('id') id: string) {
    return this.recordatoriosService.findByCotizacion(id);
  }

  @Put(':id/recordatorio')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Programar o editar recordatorio de recotización (Story 9.1)',
    description:
      'Upsert de Receta. Calcula fechaDisparoUtc con Reloj del tenant (luxon). Cliente no envía fechaDisparoUtc como verdad. Rechaza post-disparo (everDisparado) y fechas no futuras.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 200, description: 'Recordatorio programado' })
  @ApiResponse({
    status: 400,
    description: 'Receta inválida o fecha no futura',
  })
  @ApiResponse({
    status: 409,
    description: 'COT ya tuvo disparo; no admite otra receta',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  upsertRecordatorio(
    @Param('id') id: string,
    @Body() dto: UpsertRecordatorioDto,
  ) {
    return this.recordatoriosService.upsert(id, dto);
  }

  @Delete(':id/recordatorio')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Cancelar recordatorio programado (Story 9.1)',
    description:
      'Transición programado → cancelado. Reprogramar solo si never disparó (everDisparado=false).',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 200, description: 'Recordatorio cancelado' })
  @ApiResponse({ status: 400, description: 'No está en estado programado' })
  @ApiResponse({
    status: 404,
    description: 'Cotización o recordatorio no encontrado',
  })
  cancelarRecordatorio(@Param('id') id: string) {
    return this.recordatoriosService.cancelar(id);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({ summary: 'Actualizar una cotización' })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({
    status: 200,
    description: 'Cotización actualizada exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  update(
    @Param('id') id: string,
    @Body() updateCotizacionDto: UpdateCotizacionDto,
    @CurrentUser() user: { _id?: string; email?: string },
  ) {
    return this.cotizacionesService.update(id, updateCotizacionDto, user);
  }

  @Patch(':id/estado')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Cambiar estado manualmente (Story 6.10)',
    description:
      'Transición a cualquiera de los otros estados. Persiste estadoOrigen=usuario + identidad. Sin correo ni OT. Al marcar vigente, fechaVencimiento futura o extensión con vigenciaDefaultDias.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 200, description: 'Estado actualizado' })
  @ApiResponse({
    status: 400,
    description: 'Estado inválido o igual al actual',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  cambiarEstado(
    @Param('id') id: string,
    @Body() dto: CambiarEstadoDto,
    @CurrentUser() user: { _id?: string; email?: string },
  ) {
    return this.cotizacionesService.cambiarEstadoManual(id, dto.estado, user, {
      fechaVencimiento: dto.fechaVencimiento,
    });
  }

  @Patch(':id/admin/aceptar')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Aceptar una cotización como administrador',
    description:
      'Atajo a cambio manual → aceptada. Origen usuario + identidad. Sin OT ni correo.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({
    status: 200,
    description: 'Cotización aceptada exitosamente',
  })
  @ApiResponse({
    status: 400,
    description: 'Estado inválido o datos faltantes',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  aceptarCotizacionAdmin(
    @Param('id') id: string,
    @Body() _aceptarDto: AceptarCotizacionDto,
    @CurrentUser() user: { _id?: string; email?: string },
  ) {
    return this.cotizacionesService.aceptarCotizacionAdmin(id, user);
  }

  @Patch(':id/admin/rechazar')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Rechazar una cotización como administrador',
    description:
      'Atajo a cambio manual → rechazada. Origen usuario + identidad. Sin correo.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({
    status: 200,
    description: 'Cotización rechazada exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Estado inválido' })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  rechazarCotizacionAdmin(
    @Param('id') id: string,
    @CurrentUser() user: { _id?: string; email?: string },
  ) {
    return this.cotizacionesService.rechazarCotizacionAdmin(id, user);
  }

  @Patch(':id/marcar-vencida')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Marcar una cotización específica como vencida',
    description:
      'Atajo a cambio manual → vencida (origen usuario). Cron → 6.11.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({
    status: 200,
    description: 'Cotización marcada como vencida exitosamente',
  })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  marcarVencida(
    @Param('id') id: string,
    @CurrentUser() user: { _id?: string; email?: string },
  ) {
    return this.cotizacionesService.marcarVencida(id, user);
  }

  @Post(':id/notas-internas')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Agregar nota interna a una cotización',
    description:
      'Solo visible para usuarios AMES. No aparece en PDF ni en la vista pública del cliente.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiResponse({ status: 201, description: 'Nota agregada' })
  @ApiResponse({ status: 404, description: 'Cotización no encontrada' })
  agregarNotaInterna(
    @Param('id') id: string,
    @Body() dto: CreateNotaInternaDto,
    @CurrentUser() user: { _id?: string; sub?: string; email?: string },
  ) {
    return this.cotizacionesService.agregarNotaInterna(id, dto, user);
  }

  @Patch(':id/notas-internas/:notaId')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Editar nota interna propia',
    description: 'Solo el autor puede editar su nota.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiParam({ name: 'notaId', description: 'ID de la nota interna' })
  @ApiResponse({ status: 200, description: 'Nota actualizada' })
  @ApiResponse({ status: 403, description: 'No es autor de la nota' })
  @ApiResponse({ status: 404, description: 'Cotización o nota no encontrada' })
  actualizarNotaInterna(
    @Param('id') id: string,
    @Param('notaId') notaId: string,
    @Body() dto: UpdateNotaInternaDto,
    @CurrentUser() user: { _id?: string; sub?: string; email?: string },
  ) {
    return this.cotizacionesService.actualizarNotaInterna(
      id,
      notaId,
      dto,
      user,
    );
  }

  @Delete(':id/notas-internas/:notaId')
  @UseGuards(JwtAuthGuard, RolesGuard, TenantContextGuard)
  @UseInterceptors(TenantContextInterceptor)
  @RolesDecorator(...AMES_ROLES)
  @ApiBearerAuth()
  @ApiHeader({
    name: 'X-Tenant-Id',
    required: false,
    description:
      'Obligatorio para admin_sistema (400 si ausente; 403 si inválido/inactivo). Operativo y admin_tenant: no enviar — se ignora; tenant del JWT.',
  })
  @ApiOperation({
    summary: 'Eliminar nota interna propia',
    description: 'Solo el autor puede eliminar su nota.',
  })
  @ApiParam({ name: 'id', description: 'ID de la cotización' })
  @ApiParam({ name: 'notaId', description: 'ID de la nota interna' })
  @ApiResponse({ status: 200, description: 'Nota eliminada' })
  @ApiResponse({ status: 403, description: 'No es autor de la nota' })
  @ApiResponse({ status: 404, description: 'Cotización o nota no encontrada' })
  eliminarNotaInterna(
    @Param('id') id: string,
    @Param('notaId') notaId: string,
    @CurrentUser() user: { _id?: string; sub?: string; email?: string },
  ) {
    return this.cotizacionesService.eliminarNotaInterna(id, notaId, user);
  }

  // --- ENDPOINTS PÚBLICOS (MAGIC LINK) — sin TenantGuard (AD-3 / Story 6.9) ---

  @Get('public/:token')
  @ApiOperation({
    summary: 'Obtener cotización mediante magic token (público)',
    description:
      'Sin JWT. DTO acotado (sin magicToken/tenantId/emails). Token válido hasta expiry aunque ya respondida.',
  })
  @ApiParam({ name: 'token', description: 'Token de acceso seguro' })
  @ApiResponse({ status: 200, type: PublicCotizacionResponseDto })
  @ApiResponse({ status: 404, description: 'Enlace inválido' })
  @ApiResponse({ status: 401, description: 'Enlace expirado' })
  findOneByToken(@Param('token') token: string) {
    return this.cotizacionesService.findOneByMagicToken(token);
  }

  @Patch('public/:token/aceptar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aceptar cotización mediante magic token (público)',
    description:
      'Solo vigente. Idempotente si ya aceptada (200 + alreadyResponded). Persiste estadoOrigen=magic_link.',
  })
  @ApiParam({ name: 'token', description: 'Token de acceso seguro' })
  @ApiResponse({ status: 200, type: PublicCotizacionResponseDto })
  @ApiResponse({ status: 400, description: 'Estado incompatible / vencida' })
  @ApiResponse({ status: 404, description: 'Enlace inválido' })
  @ApiResponse({ status: 401, description: 'Enlace expirado' })
  aceptarByToken(@Param('token') token: string) {
    return this.cotizacionesService.aceptarCotizacionByMagicToken(token);
  }

  @Patch('public/:token/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rechazar cotización mediante magic token (público)',
    description:
      'Solo vigente. Idempotente si ya rechazada (200 + alreadyResponded). Persiste estadoOrigen=magic_link.',
  })
  @ApiParam({ name: 'token', description: 'Token de acceso seguro' })
  @ApiResponse({ status: 200, type: PublicCotizacionResponseDto })
  @ApiResponse({ status: 400, description: 'Estado incompatible / vencida' })
  @ApiResponse({ status: 404, description: 'Enlace inválido' })
  @ApiResponse({ status: 401, description: 'Enlace expirado' })
  rechazarByToken(@Param('token') token: string) {
    return this.cotizacionesService.rechazarCotizacionByMagicToken(token);
  }
}

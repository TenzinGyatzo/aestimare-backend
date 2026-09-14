import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  Delete,
  HttpCode,
  HttpStatus,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
  StreamableFile,
  Res,
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
import { ServiciosService } from './servicios.service';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { CreateServicioMultiDto } from './dto/create-servicio-multi.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { FilterServicioDto } from './dto/filter-servicio.dto';
import { PaginatedServiciosResponseDto } from './dto/paginated-servicios-response.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AMES_ROLES } from '../auth/enums/roles.enum';
import { Roles as RolesDecorator } from '../auth/decorators/roles.decorator';
import { TenantContextGuard } from '../tenants/tenant-context.guard';
import { TenantContextInterceptor } from '../tenants/tenant-context.interceptor';
import { MulterBadRequestFilter } from '../common/uploads/multer-bad-request.filter';
import { MulterCatalogoImportFilter } from '../common/uploads/multer-catalogo-import.filter';
import { CATALOGO_IMPORT_MAX_BYTES } from './catalogo-import';
import type { Response } from 'express';
import { SERVICIO_ORDEN_VALUES } from './enums/servicio-orden.enum';
import { TIPO_ITEM_VALUES } from './enums/tipo-item.enum';

@ApiTags('servicios')
@Controller('servicios')
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
export class ServiciosController {
  constructor(private readonly serviciosService: ServiciosService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo servicio' })
  @ApiResponse({ status: 201, description: 'Servicio creado exitosamente' })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  create(@Body() createServicioDto: CreateServicioDto) {
    return this.serviciosService.create(createServicioDto);
  }

  /**
   * Story 4.4 — alta multi-tenant create-only (admin_sistema).
   * `tenantIds` en body = destinos de creación (excepción acotada AD-2).
   */
  @Post('multi-tenant')
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary:
      'Crear servicio en uno o ambos tenants (solo admin_sistema, solo creación)',
  })
  @ApiResponse({
    status: 201,
    description: 'Servicios creados (uno por tenant destino)',
  })
  @ApiResponse({ status: 400, description: 'Datos o tenants inválidos' })
  @ApiResponse({ status: 403, description: 'Solo administrador de sistema' })
  createMulti(@Body() dto: CreateServicioMultiDto) {
    return this.serviciosService.createForTenants(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar servicios con búsqueda, categoría, tipo y paginación',
  })
  @ApiQuery({ name: 'nombre', required: false, type: String })
  @ApiQuery({
    name: 'categoriaId',
    required: false,
    type: String,
    description: 'ObjectId de categoría del tenant',
  })
  @ApiQuery({
    name: 'tipo',
    required: false,
    enum: TIPO_ITEM_VALUES,
    description: 'Filtrar por tipo: servicio | producto (Story 6.1)',
  })
  @ApiQuery({ name: 'activo', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({
    name: 'orden',
    required: false,
    enum: SERVICIO_ORDEN_VALUES,
    description:
      'Orden de listado: creacion (default), nombre_asc, nombre_desc',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista paginada de servicios',
    type: PaginatedServiciosResponseDto,
  })
  findAll(
    @Query() filters?: FilterServicioDto,
  ): Promise<PaginatedServiciosResponseDto> {
    return this.serviciosService.findAll(filters);
  }

  @Get('import/plantilla')
  @ApiOperation({ summary: 'Descargar plantilla Excel de carga masiva' })
  @ApiResponse({ status: 200, description: 'Archivo .xlsx' })
  async downloadImportPlantilla(
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const buffer = await this.serviciosService.getCatalogoImportPlantilla();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-catalogo.xlsx"',
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseFilters(MulterCatalogoImportFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: CATALOGO_IMPORT_MAX_BYTES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Carga masiva de productos y servicios (.xlsx)' })
  @ApiResponse({ status: 201, description: 'Resumen de importación' })
  @ApiResponse({ status: 400, description: 'Archivo inválido' })
  importCatalogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Debe adjuntar un archivo .xlsx');
    }
    return this.serviciosService.importFromXlsx(file);
  }

  @Post(':id/imagen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Subir o reemplazar imagen de producto',
    description:
      'Solo tipo=producto. PNG/JPEG/WebP ≤1MB → sharp WebP (lado ≤1200). AD-23 / Story 8.1.',
  })
  @ApiParam({ name: 'id', description: 'ID del ítem' })
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
  @ApiResponse({ status: 200, description: 'Imagen guardada; ítem con imagenUrl' })
  @ApiResponse({ status: 400, description: 'Archivo inválido / no es producto' })
  @ApiResponse({ status: 404, description: 'Ítem no encontrado' })
  @UseFilters(MulterBadRequestFilter)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1_000_000 },
    }),
  )
  uploadImagen(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Archivo de imagen requerido');
    }
    return this.serviciosService.uploadImagen(id, file);
  }

  @Delete(':id/imagen')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Eliminar imagen de producto',
    description: 'Solo tipo=producto. Unset imagenUrl + borra archivo. Story 8.1.',
  })
  @ApiParam({ name: 'id', description: 'ID del ítem' })
  @ApiResponse({ status: 200, description: 'Imagen eliminada' })
  @ApiResponse({ status: 400, description: 'No es producto' })
  @ApiResponse({ status: 404, description: 'Ítem no encontrado' })
  clearImagen(@Param('id') id: string) {
    return this.serviciosService.clearImagen(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un servicio por ID' })
  @ApiParam({ name: 'id', description: 'ID del servicio' })
  @ApiResponse({ status: 200, description: 'Servicio encontrado' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  findOne(@Param('id') id: string) {
    return this.serviciosService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Actualizar un servicio' })
  @ApiParam({ name: 'id', description: 'ID del servicio' })
  update(
    @Param('id') id: string,
    @Body() updateServicioDto: UpdateServicioDto,
  ) {
    return this.serviciosService.update(id, updateServicioDto);
  }

  @Patch(':id/toggle-activo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar o desactivar un servicio' })
  @ApiParam({ name: 'id', description: 'ID del servicio' })
  toggleActivo(@Param('id') id: string) {
    return this.serviciosService.toggleActivo(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar un servicio (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID del servicio' })
  @ApiResponse({ status: 200, description: 'Servicio desactivado' })
  @ApiResponse({ status: 404, description: 'Servicio no encontrado' })
  remove(@Param('id') id: string) {
    return this.serviciosService.remove(id);
  }
}

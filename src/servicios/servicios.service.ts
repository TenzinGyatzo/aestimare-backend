import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { join } from 'path';
import sharp from 'sharp';
import { Servicio, ServicioDocument } from './schemas/servicio.schema';
import {
  CategoriaServicioEntity,
  CategoriaServicioDocument,
} from './schemas/categoria-servicio.schema';
import { CreateServicioDto } from './dto/create-servicio.dto';
import { CreateServicioMultiDto } from './dto/create-servicio-multi.dto';
import { UpdateServicioDto } from './dto/update-servicio.dto';
import { FilterServicioDto } from './dto/filter-servicio.dto';
import { PaginatedServiciosResponseDto } from './dto/paginated-servicios-response.dto';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  assertStrictObjectIdOrNotFound,
  isStrictObjectId,
} from '../common/strict-object-id';
import {
  unlinkQuiet,
  writeBufferFile,
} from '../common/uploads/disk-upload';
import { ServicioOrden } from './enums/servicio-orden.enum';
import { TipoItem } from './enums/tipo-item.enum';
import {
  assertCatalogoImportFile,
  buildCatalogoImportPlantilla,
  buildCatalogoImportReporte,
  parseCatalogoImportBuffer,
  toImportErrorRow,
  validateCatalogoImportRow,
  type CatalogoImportErrorRow,
} from './catalogo-import';

export type CatalogoImportResult = {
  created: number;
  failed: number;
  skippedEmpty: number;
  errors: CatalogoImportErrorRow[];
  reporteBase64?: string;
};

const MAX_IMAGEN_BYTES = 1_000_000;
const WEBP_QUALITY_START = 80;
const WEBP_QUALITY_MIN = 55;
const WEBP_QUALITY_STEP = 10;
const MAX_WEBP_OUTPUT_BYTES = 200 * 1024;
const ALLOWED_IMAGEN_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);

@Injectable()
export class ServiciosService {
  constructor(
    @InjectModel(Servicio.name) private servicioModel: Model<ServicioDocument>,
    @InjectModel(CategoriaServicioEntity.name)
    private categoriaModel: Model<CategoriaServicioDocument>,
    private tenantContext: TenantContextService,
    private tenantsService: TenantsService,
  ) {}

  private escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      ((err as { code?: number | string }).code === 11000 ||
        (err as { code?: number | string }).code === 'E11000')
    );
  }

  private rethrowPersistError(err: unknown, fallbackMessage: string): never {
    if (
      err instanceof BadRequestException ||
      err instanceof NotFoundException ||
      err instanceof ForbiddenException ||
      err instanceof ConflictException
    ) {
      throw err;
    }
    if (this.isDuplicateKeyError(err)) {
      throw new ConflictException(
        'Ya existe un ítem con ese código en este tenant',
      );
    }
    throw new BadRequestException(fallbackMessage);
  }

  private buildSort(orden?: ServicioOrden): Record<string, 1 | -1> {
    switch (orden) {
      case ServicioOrden.NOMBRE_ASC:
        return { nombre: 1 };
      case ServicioOrden.NOMBRE_DESC:
        return { nombre: -1 };
      case ServicioOrden.CREACION:
      default:
        return { createdAt: 1, _id: 1 };
    }
  }

  /**
   * Valida que categoriaId exista, sea del tenant y esté activa.
   * Story 5.3 / AD-20.
   */
  private async assertCategoriaActivaDelTenant(
    categoriaId: string,
    tenantId: Types.ObjectId,
  ): Promise<CategoriaServicioDocument> {
    if (!isStrictObjectId(categoriaId)) {
      throw new BadRequestException('Categoría inválida o inactiva');
    }
    const cat = await this.categoriaModel
      .findOne({ _id: categoriaId, tenantId })
      .exec();
    if (!cat || cat.activo === false) {
      throw new BadRequestException('Categoría inválida o inactiva');
    }
    return cat;
  }

  private async findCategoriaActivaByCodigo(
    codigo: string,
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId | null> {
    const cat = await this.categoriaModel
      .findOne({
        tenantId,
        codigo,
        activo: { $ne: false },
      })
      .exec();
    if (!cat) return null;
    return cat._id as Types.ObjectId;
  }

  /**
   * Resuelve categoría activa del tenant destino por código (multi-tenant).
   */
  private async resolveCategoriaIdByCodigo(
    codigo: string,
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId> {
    const id = await this.findCategoriaActivaByCodigo(codigo, tenantId);
    if (!id) {
      throw new BadRequestException(
        `Categoría «${codigo}» no existe o está inactiva en tenant ${String(tenantId)}`,
      );
    }
    return id;
  }

  private buildDocPayload(
    dto: CreateServicioDto,
    tenantId: Types.ObjectId,
    categoriaId: Types.ObjectId,
  ): Record<string, unknown> {
    const descripcion = dto.descripcion?.trim();
    const codigo = dto.codigo?.trim();
    return {
      nombre: dto.nombre.trim(),
      ...(descripcion ? { descripcion } : {}),
      ...(codigo ? { codigo } : {}),
      precioUnitario: dto.precioUnitario,
      categoriaId,
      tenantId,
      tipo: dto.tipo,
      moneda: 'MXN',
      activo: dto.activo !== undefined ? dto.activo : true,
    };
  }

  getCatalogoImportPlantilla(): Promise<Buffer> {
    return buildCatalogoImportPlantilla();
  }

  async importFromXlsx(file: {
    originalname?: string;
    size?: number;
    buffer?: Buffer;
  }): Promise<CatalogoImportResult> {
    assertCatalogoImportFile(file);
    const rows = await parseCatalogoImportBuffer(file.buffer as Buffer);
    const tenantId = this.tenantContext.getTenantId();

    const existentes = (await this.servicioModel
      .find({ tenantId })
      .select('nombre codigo')
      .lean()
      .exec()) as Array<{ nombre?: string; codigo?: string }>;

    const nombres = new Set(
      existentes
        .map((s) => (s.nombre ?? '').trim().toLowerCase())
        .filter(Boolean),
    );
    const codigos = new Set(
      existentes.map((s) => (s.codigo ?? '').trim()).filter(Boolean),
    );
    const seenNombres = new Set<string>();
    const seenCodigos = new Set<string>();

    let created = 0;
    let failed = 0;
    let skippedEmpty = 0;
    const errors: CatalogoImportErrorRow[] = [];

    for (const raw of rows) {
      if (raw.empty) {
        skippedEmpty += 1;
        continue;
      }
      const validated = validateCatalogoImportRow(raw);
      if ('error' in validated) {
        failed += 1;
        errors.push(toImportErrorRow(raw, validated.error));
        continue;
      }
      const nombreKey = validated.nombre.toLowerCase();
      if (nombres.has(nombreKey) || seenNombres.has(nombreKey)) {
        failed += 1;
        errors.push(
          toImportErrorRow(
            raw,
            'Ya existe un ítem con ese nombre en este tenant',
          ),
        );
        continue;
      }
      if (
        validated.codigo &&
        (codigos.has(validated.codigo) || seenCodigos.has(validated.codigo))
      ) {
        failed += 1;
        errors.push(
          toImportErrorRow(
            raw,
            'Ya existe un ítem con ese código en este tenant',
          ),
        );
        continue;
      }

      const categoriaId = await this.findCategoriaActivaByCodigo(
        validated.categoriaCodigo,
        tenantId,
      );
      if (!categoriaId) {
        failed += 1;
        errors.push(toImportErrorRow(raw, 'Categoría inválida o inactiva'));
        continue;
      }

      try {
        const dto: CreateServicioDto = {
          nombre: validated.nombre,
          precioUnitario: validated.precioUnitario,
          categoriaId: String(categoriaId),
          tipo: validated.tipo,
          activo: validated.activo,
          ...(validated.codigo ? { codigo: validated.codigo } : {}),
          ...(validated.descripcion
            ? { descripcion: validated.descripcion }
            : {}),
        };
        const doc = new this.servicioModel(
          this.buildDocPayload(dto, tenantId, categoriaId),
        );
        await doc.save();
        created += 1;
        seenNombres.add(nombreKey);
        nombres.add(nombreKey);
        if (validated.codigo) {
          seenCodigos.add(validated.codigo);
          codigos.add(validated.codigo);
        }
      } catch (err) {
        failed += 1;
        const message = this.isDuplicateKeyError(err)
          ? 'Ya existe un ítem con ese código en este tenant'
          : 'Error al crear el servicio';
        errors.push(toImportErrorRow(raw, message));
      }
    }

    const result: CatalogoImportResult = {
      created,
      failed,
      skippedEmpty,
      errors,
    };
    if (errors.length) {
      try {
        const reporte = await buildCatalogoImportReporte(errors);
        result.reporteBase64 = reporte.toString('base64');
      } catch {
        /* El resumen y errors ya alcanzan para corregir; no tumbar altas hechas. */
      }
    }
    return result;
  }

  async create(createServicioDto: CreateServicioDto): Promise<Servicio> {
    try {
      const tenantId = this.tenantContext.getTenantId();
      const cat = await this.assertCategoriaActivaDelTenant(
        createServicioDto.categoriaId,
        tenantId,
      );
      const servicio = new this.servicioModel(
        this.buildDocPayload(
          createServicioDto,
          tenantId,
          cat._id as Types.ObjectId,
        ),
      );
      return await servicio.save();
    } catch (err) {
      this.rethrowPersistError(err, 'Error al crear el servicio');
    }
  }

  /**
   * Story 4.4 — create-only multi-tenant (admin).
   * Destinos = dto.tenantIds. categoriaId del body se remapea por `codigo` en cada destino (5.3).
   */
  async createForTenants(
    dto: CreateServicioMultiDto,
  ): Promise<{ created: Servicio[] }> {
    const uniqueIds = [...new Set(dto.tenantIds.map((id) => String(id)))];
    if (uniqueIds.length < 1 || uniqueIds.length > 2) {
      throw new BadRequestException('Debe indicar entre 1 y 2 tenants destino');
    }

    const resolved: Types.ObjectId[] = [];
    for (const id of uniqueIds) {
      if (!isStrictObjectId(id)) {
        throw new BadRequestException(
          `Tenant destino inválido o inactivo: ${id}`,
        );
      }
      const tenant = await this.tenantsService.findById(id);
      if (!tenant || (tenant as { activo?: boolean }).activo === false) {
        throw new BadRequestException(
          `Tenant destino inválido o inactivo: ${id}`,
        );
      }
      resolved.push(tenant._id as Types.ObjectId);
    }

    // Código canónico desde la categoría del tenant de contexto (X-Tenant-Id / JWT)
    const contextTenantId = this.tenantContext.getTenantId();
    const sourceCat = await this.assertCategoriaActivaDelTenant(
      dto.categoriaId,
      contextTenantId,
    );
    const codigoCategoria = sourceCat.codigo;

    const created: Servicio[] = [];
    try {
      for (const tenantId of resolved) {
        const categoriaId = await this.resolveCategoriaIdByCodigo(
          codigoCategoria,
          tenantId,
        );
        const servicio = new this.servicioModel(
          this.buildDocPayload(dto, tenantId, categoriaId),
        );
        try {
          created.push(await servicio.save());
        } catch (err) {
          // Incluir tenant destino: en multi el mensaje genérico de «este tenant» es opaco
          if (this.isDuplicateKeyError(err)) {
            throw new ConflictException(
              `Ya existe un ítem con ese código en el tenant ${String(tenantId)}`,
            );
          }
          throw err;
        }
      }
      return { created };
    } catch (err) {
      for (const doc of created) {
        try {
          const id = (doc as { _id?: Types.ObjectId })._id;
          if (id) await this.servicioModel.deleteOne({ _id: id }).exec();
        } catch {
          /* ignore */
        }
      }
      this.rethrowPersistError(
        err,
        'Error al crear el servicio en los tenants indicados',
      );
    }
  }

  async findAll(
    filters?: FilterServicioDto,
  ): Promise<PaginatedServiciosResponseDto> {
    const tenantId = this.tenantContext.getTenantId();
    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const limit =
      filters?.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;

    const matchConditions: Record<string, unknown> = { tenantId };

    if (filters?.activo === undefined || filters.activo === true) {
      matchConditions.activo = { $ne: false };
    } else {
      matchConditions.activo = false;
    }

    if (filters?.nombre?.trim()) {
      matchConditions.nombre = {
        $regex: this.escapeRegex(filters.nombre.trim()),
        $options: 'i',
      };
    }

    if (filters?.categoriaId) {
      matchConditions.categoriaId = new Types.ObjectId(filters.categoriaId);
    }

    if (filters?.tipo) {
      // servicio: incluir docs legacy sin campo (default schema no aplica en query)
      if (filters.tipo === TipoItem.SERVICIO) {
        matchConditions.$or = [
          { tipo: TipoItem.SERVICIO },
          { tipo: { $exists: false } },
          { tipo: null },
        ];
      } else {
        matchConditions.tipo = filters.tipo;
      }
    }

    const [data, total] = await Promise.all([
      this.servicioModel
        .find(matchConditions)
        .sort(this.buildSort(filters?.orden))
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.servicioModel.countDocuments(matchConditions).exec(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
    };
  }

  /** Story 7.3 — dashboard Totales.servicios */
  async countActive(): Promise<number> {
    const tenantId = this.tenantContext.getTenantId();
    return this.servicioModel
      .countDocuments({ tenantId, activo: { $ne: false } })
      .exec();
  }

  async findOne(id: string): Promise<Servicio> {
    assertStrictObjectIdOrNotFound(id, 'Servicio');
    const tenantId = this.tenantContext.getTenantId();
    const servicio = await this.servicioModel
      .findOne({ _id: id, tenantId })
      .exec();
    if (!servicio) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
    }
    return servicio;
  }

  /**
   * Lookup live imagenUrl/tipo por ids (PDF público / paridad).
   * No usa TenantContext — el caller pasa tenantId (magic link sin JWT).
   * Cotizacion.items es `type: [Object]`, así que populate('items.servicioId') no aporta.
   */
  async findImagenMetaByIds(
    tenantId: Types.ObjectId,
    ids: string[],
  ): Promise<
    Array<{ _id: Types.ObjectId; imagenUrl?: string; tipo?: string }>
  > {
    const unique = [
      ...new Set(
        ids
          .map((id) => String(id || '').trim())
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    if (!unique.length) return [];
    return this.servicioModel
      .find({
        tenantId,
        _id: { $in: unique.map((id) => new Types.ObjectId(id)) },
      })
      .select({ imagenUrl: 1, tipo: 1 })
      .lean()
      .exec() as Promise<
      Array<{ _id: Types.ObjectId; imagenUrl?: string; tipo?: string }>
    >;
  }

  async update(
    id: string,
    updateServicioDto: UpdateServicioDto,
  ): Promise<Servicio> {
    assertStrictObjectIdOrNotFound(id, 'Servicio');
    const tenantId = this.tenantContext.getTenantId();

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1 | ''> = {};

    if (updateServicioDto.nombre !== undefined) {
      $set.nombre = updateServicioDto.nombre.trim();
    }
    if (updateServicioDto.descripcion !== undefined) {
      const d = updateServicioDto.descripcion.trim();
      if (d) $set.descripcion = d;
      else $unset.descripcion = 1;
    }
    if (updateServicioDto.precioUnitario !== undefined) {
      $set.precioUnitario = updateServicioDto.precioUnitario;
    }
    // != null: IsOptional salta @IsEnum cuando llega null → no persistir null
    if (updateServicioDto.tipo != null) {
      $set.tipo = updateServicioDto.tipo;
      // Story 8.1 review: servicio no lleva imagen — limpiar al cambiar tipo
      if (updateServicioDto.tipo === TipoItem.SERVICIO) {
        $unset.imagenUrl = 1;
      }
    }
    if (updateServicioDto.codigo !== undefined) {
      const c = String(updateServicioDto.codigo ?? '').trim();
      if (c) $set.codigo = c;
      else $unset.codigo = 1;
    }
    if (updateServicioDto.categoriaId !== undefined) {
      const cat = await this.assertCategoriaActivaDelTenant(
        updateServicioDto.categoriaId,
        tenantId,
      );
      $set.categoriaId = cat._id;
      // Solo limpiar enum legacy al asignar categoriaId (protege docs pre-5.4)
      $unset.categoria = '';
    }
    if (updateServicioDto.activo !== undefined) {
      if (
        updateServicioDto.activo === true &&
        updateServicioDto.categoriaId === undefined
      ) {
        const existing = await this.servicioModel
          .findOne({ _id: id, tenantId })
          .exec();
        if (!existing) {
          throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
        }
        await this.assertCategoriaActivaDelTenant(
          String(existing.categoriaId),
          tenantId,
        );
      }
      $set.activo = updateServicioDto.activo;
    }
    $set.moneda = 'MXN';

    const update: Record<string, unknown> = { $set };
    if (Object.keys($unset).length > 0) {
      update.$unset = $unset;
    }

    try {
      const servicio = await this.servicioModel
        .findOneAndUpdate({ _id: id, tenantId }, update, { new: true })
        .exec();
      if (!servicio) {
        throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
      }
      if (updateServicioDto.tipo === TipoItem.SERVICIO) {
        const { absPath } = this.catalogoImagenPaths(
          tenantId,
          String(servicio._id),
        );
        unlinkQuiet(absPath);
      }
      return servicio;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.rethrowPersistError(err, 'Error al actualizar el servicio');
    }
  }

  async toggleActivo(id: string): Promise<Servicio> {
    const servicio = await this.findOne(id);
    const doc = servicio as ServicioDocument;
    const currentlyActive = doc.activo !== false;
    if (currentlyActive) {
      doc.activo = false;
    } else {
      await this.assertCategoriaActivaDelTenant(
        String(doc.categoriaId),
        this.tenantContext.getTenantId(),
      );
      doc.activo = true;
    }
    return await doc.save();
  }

  async remove(id: string): Promise<Servicio> {
    assertStrictObjectIdOrNotFound(id, 'Servicio');
    const tenantId = this.tenantContext.getTenantId();
    const servicio = await this.servicioModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { activo: false } },
        { new: true },
      )
      .exec();
    if (!servicio) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
    }
    return servicio;
  }

  /** Normaliza mime: lowercase + sin parámetros. */
  private normalizeMime(raw?: string): string {
    if (!raw) return '';
    return raw.split(';')[0].trim().toLowerCase();
  }

  private catalogoImagenPaths(
    tenantId: Types.ObjectId,
    servicioId: string,
  ): { absPath: string; imagenUrl: string } {
    const imagenUrl = `/uploads/catalogo/${String(tenantId)}/${servicioId}.webp`;
    const absPath = join(
      process.cwd(),
      'uploads',
      'catalogo',
      String(tenantId),
      `${servicioId}.webp`,
    );
    return { absPath, imagenUrl };
  }

  private assertValidProductoImagen(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Archivo de imagen requerido');
    }
    if (file.size > MAX_IMAGEN_BYTES) {
      throw new BadRequestException('La imagen no puede superar 1MB');
    }
    const mime = this.normalizeMime(file.mimetype);
    if (!ALLOWED_IMAGEN_MIME.has(mime)) {
      throw new BadRequestException(
        'Tipo de imagen no permitido (use PNG, JPEG o WebP)',
      );
    }
  }

  /**
   * Story 8.1 / AD-23 — upload + sharp → WebP en path canónico.
   * Solo `tipo=producto`.
   */
  async uploadImagen(
    id: string,
    file: Express.Multer.File,
  ): Promise<Servicio> {
    const doc = (await this.findOne(id)) as ServicioDocument;
    if (doc.tipo !== TipoItem.PRODUCTO) {
      throw new BadRequestException(
        'Solo los ítems tipo producto aceptan imagen',
      );
    }
    this.assertValidProductoImagen(file);

    let webp: Buffer;
    try {
      const qualities: number[] = [];
      for (
        let q = WEBP_QUALITY_START;
        q > WEBP_QUALITY_MIN;
        q -= WEBP_QUALITY_STEP
      ) {
        qualities.push(q);
      }
      qualities.push(WEBP_QUALITY_MIN);

      // Resize una vez; re-encode WebP solo baja quality si supera el umbral.
      // Si a WEBP_QUALITY_MIN sigue > MAX_WEBP_OUTPUT_BYTES, se persiste best-effort.
      const resized = await sharp(file.buffer)
        .rotate()
        .resize({
          width: 1200,
          height: 1200,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toBuffer();

      webp = await sharp(resized)
        .webp({ quality: qualities[0] })
        .toBuffer();
      for (let i = 1; i < qualities.length; i++) {
        if (webp.length <= MAX_WEBP_OUTPUT_BYTES) {
          break;
        }
        webp = await sharp(resized)
          .webp({ quality: qualities[i] })
          .toBuffer();
      }
    } catch {
      throw new BadRequestException('No se pudo procesar la imagen');
    }

    const tenantId = this.tenantContext.getTenantId();
    const servicioId = String(doc._id);
    const { absPath, imagenUrl } = this.catalogoImagenPaths(
      tenantId,
      servicioId,
    );
    writeBufferFile(
      absPath,
      webp,
      'No se pudo escribir la imagen en disco',
    );

    try {
      const updated = await this.servicioModel
        .findOneAndUpdate(
          { _id: id, tenantId },
          { $set: { imagenUrl } },
          { new: true },
        )
        .exec();
      if (!updated) {
        unlinkQuiet(absPath);
        throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
      }
      return updated;
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      unlinkQuiet(absPath);
      throw err;
    }
  }

  /** Story 8.1 — quitar imagen de producto + archivo en disco. */
  async clearImagen(id: string): Promise<Servicio> {
    const doc = (await this.findOne(id)) as ServicioDocument;
    if (doc.tipo !== TipoItem.PRODUCTO) {
      throw new BadRequestException(
        'Solo los ítems tipo producto aceptan imagen',
      );
    }
    const tenantId = this.tenantContext.getTenantId();
    const { absPath } = this.catalogoImagenPaths(tenantId, String(doc._id));
    const updated = await this.servicioModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        { $unset: { imagenUrl: 1 } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new NotFoundException(`Servicio con ID ${id} no encontrado`);
    }
    unlinkQuiet(absPath);
    return updated;
  }
}

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  Cotizacion,
  CotizacionDocument,
  ItemCotizacion,
  PlantillaSnapshot,
} from './schemas/cotizacion.schema';
import { TipoItem } from '../servicios/enums/tipo-item.enum';
import { CreateCotizacionDto } from './dto/create-cotizacion.dto';
import {
  CreateCotizacionAdminDto,
  CreatePlantillaCotizacionDto,
} from './dto/create-cotizacion-admin.dto';
import { UpdateCotizacionDto } from './dto/update-cotizacion.dto';
import { FilterCotizacionDto } from './dto/filter-cotizacion.dto';
import { PaginatedCotizacionesResponseDto } from './dto/paginated-cotizaciones-response.dto';
import { CotizacionListItemDto } from './dto/cotizacion-list-item.dto';
import { ClientesService } from '../clientes/clientes.service';
import { ServiciosService } from '../servicios/servicios.service';
import { PlantillasService } from '../plantillas/plantillas.service';
import { EmailService } from './services/email.service';
import { TenantContextService } from '../tenants/tenant-context.service';
import { TenantConfigService } from '../tenants/tenant-config.service';
import { TenantsService } from '../tenants/tenants.service';
import { TenantSecretsKeyError } from '../tenants/tenant-secrets.crypto';
import { TenantEmailNotConfiguredError } from '../emails/tenant-email-not-configured.error';
import { TenantInactiveForOutboundError } from '../emails/tenant-inactive-for-outbound.error';
import { CountersService } from '../counters/counters.service';
import {
  assertStrictObjectIdOrNotFound,
  isStrictObjectId,
} from '../common/strict-object-id';
import { isEmail } from 'class-validator';
import { PublicCotizacionResponseDto } from './dto/public-cotizacion-response.dto';
import { UsersService } from '../users/users.service';
import { ESTADOS_COTIZACION, EstadoCotizacion } from './dto/cambiar-estado.dto';
import { RepetirCotizacionDto } from './dto/repetir-cotizacion.dto';
import { RepetirCotizacionPreviewDto } from './dto/repetir-cotizacion-preview.dto';
import { RepetirCotizacionResponseDto } from './dto/repetir-cotizacion-response.dto';
import { RecordatoriosService } from './recordatorios/recordatorios.service';
import { RecetaRecordatorioDto } from './recordatorios/dto/receta-recordatorio.dto';
import { CreateNotaInternaDto } from './dto/create-nota-interna.dto';
import { UpdateNotaInternaDto } from './dto/update-nota-interna.dto';
import { hasBancariosUtiles } from '../tenants/bancarios.util';

export type EstadoActorJwt = {
  _id?: string;
  sub?: string;
  email?: string;
};

@Injectable()
export class CotizacionesService {
  private readonly logger = new Logger(CotizacionesService.name);

  constructor(
    @InjectModel(Cotizacion.name)
    private cotizacionModel: Model<CotizacionDocument>,
    private clientesService: ClientesService,
    private serviciosService: ServiciosService,
    private emailService: EmailService,
    private tenantContext: TenantContextService,
    private tenantConfigService: TenantConfigService,
    private countersService: CountersService,
    private plantillasService: PlantillasService,
    private usersService: UsersService,
    private tenantsService: TenantsService,
    private recordatoriosService: RecordatoriosService,
  ) {}

  private escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async generateFolio(tenantId: Types.ObjectId): Promise<string> {
    return this.countersService.nextFolio(tenantId);
  }

  /**
   * AD-22 / Story 6.4 — snapshots tipados solo desde el `Servicio` de catálogo
   * (escritos en servidor; nunca del DTO cliente).
   * Legacy sin `tipo` → `servicio`. `codigo` vacío → omitir campo.
   */
  private applyTipoCodigoSnapshotsFromServicio(
    item: Record<string, unknown>,
    servicio: { tipo?: string | null; codigo?: string | null },
  ): void {
    item.tipoSnapshot =
      servicio.tipo === TipoItem.PRODUCTO
        ? TipoItem.PRODUCTO
        : TipoItem.SERVICIO;
    const codigo =
      typeof servicio.codigo === 'string' ? servicio.codigo.trim() : '';
    if (codigo) {
      item.codigoSnapshot = codigo;
    } else {
      delete item.codigoSnapshot;
    }
  }

  /** Rama `originales` de repetir: preferir snapshot de línea; fallback one-shot al catálogo. */
  private applyTipoCodigoSnapshotsForOriginales(
    item: Record<string, unknown>,
    rawLine: {
      tipoSnapshot?: string | null;
      codigoSnapshot?: string | null;
    },
    servicio: { tipo?: string | null; codigo?: string | null },
  ): void {
    if (
      rawLine.tipoSnapshot === TipoItem.PRODUCTO ||
      rawLine.tipoSnapshot === TipoItem.SERVICIO
    ) {
      item.tipoSnapshot = rawLine.tipoSnapshot;
      const codigoLine =
        typeof rawLine.codigoSnapshot === 'string'
          ? rawLine.codigoSnapshot.trim()
          : '';
      if (codigoLine) {
        item.codigoSnapshot = codigoLine;
      } else {
        delete item.codigoSnapshot;
      }
      return;
    }
    this.applyTipoCodigoSnapshotsFromServicio(item, servicio);
  }

  /** Solo boolean estricto cuenta como elección explícita del cliente (null/omitido → sin elegir). */
  private normalizeClienteFlag(value: unknown): boolean | undefined {
    return typeof value === 'boolean' ? value : undefined;
  }

  /**
   * Preferencias opcionales de tenant para defaults de cotización nueva.
   * Boolean explícito del cliente > default configurado del tenant > true.
   */
  private resolveDisplayFlag(
    dtoFlag: boolean | undefined,
    tenantDefault: boolean | null | undefined,
  ): boolean {
    return dtoFlag !== undefined ? dtoFlag === true : (tenantDefault ?? true);
  }

  private async buildItems(
    itemsDto: {
      servicioId: string;
      cantidad: number;
      nombre?: string;
      descripcion?: string;
      precioUnitario?: number;
    }[],
    tenantId: Types.ObjectId,
  ): Promise<{
    items: ItemCotizacion[];
    total: number;
  }> {
    const items: ItemCotizacion[] = [];
    let total = 0;
    for (const itemDto of itemsDto) {
      const servicio = await this.serviciosService.findOne(itemDto.servicioId);
      const servicioDoc = servicio as any;
      if (
        !servicioDoc.tenantId ||
        String(servicioDoc.tenantId) !== String(tenantId)
      ) {
        throw new NotFoundException(
          `Servicio con ID ${itemDto.servicioId} no encontrado`,
        );
      }
      if (servicio.activo === false) {
        throw new BadRequestException(
          'No se puede crear una cotización con un servicio inactivo',
        );
      }

      const nombreOverride = itemDto.nombre?.trim();
      const nombreServicioSnapshot = nombreOverride || servicio.nombre;
      const precioUnitarioSnapshot =
        itemDto.precioUnitario !== undefined && itemDto.precioUnitario !== null
          ? itemDto.precioUnitario
          : servicio.precioUnitario;
      const subtotal = precioUnitarioSnapshot * itemDto.cantidad;
      total += subtotal;

      const item: any = {
        servicioId: servicioDoc._id || servicioDoc.id,
        nombreServicioSnapshot,
        precioUnitarioSnapshot,
        cantidad: itemDto.cantidad,
        subtotal,
      };

      if (itemDto.descripcion !== undefined && itemDto.descripcion !== null) {
        if (typeof itemDto.descripcion !== 'string') {
          throw new BadRequestException(
            'descripcion de ítem debe ser una cadena',
          );
        }
        const desc = itemDto.descripcion.trim();
        if (desc) {
          item.descripcionServicioSnapshot = desc;
        }
      } else if (servicio.descripcion) {
        item.descripcionServicioSnapshot = servicio.descripcion;
      }

      this.applyTipoCodigoSnapshotsFromServicio(item, servicioDoc);

      items.push(item);
    }
    return { items, total };
  }

  /**
   * Story 6.5 — deep-copy plantillas activas al snapshot (orden = array).
   * Nunca muta documentos Plantilla.
   */
  private async buildPlantillasSnapshot(
    plantillasDto: CreatePlantillaCotizacionDto[] | undefined,
    tenantId: Types.ObjectId,
  ): Promise<PlantillaSnapshot[]> {
    if (!plantillasDto?.length) return [];
    const snapshots: PlantillaSnapshot[] = [];
    for (const p of plantillasDto) {
      const maestra = (await this.plantillasService.findOne(
        p.plantillaId,
      )) as any;
      if (!maestra.tenantId || String(maestra.tenantId) !== String(tenantId)) {
        throw new NotFoundException(
          `Plantilla con ID ${p.plantillaId} no encontrada`,
        );
      }
      if (maestra.activo === false) {
        throw new BadRequestException(
          'No se puede aplicar una plantilla inactiva a una cotización nueva',
        );
      }
      const nombreOverride = p.nombre?.trim();
      const seccionesSource =
        p.secciones !== undefined && p.secciones !== null
          ? p.secciones
          : maestra.secciones;
      if (
        seccionesSource === undefined ||
        seccionesSource === null ||
        !Array.isArray(seccionesSource) ||
        seccionesSource.length < 1
      ) {
        throw new BadRequestException(
          `Plantilla «${maestra.nombre || p.plantillaId}» no tiene secciones válidas`,
        );
      }
      const seccionesValidadas =
        this.plantillasService.assertSeccionesValidas(seccionesSource);
      snapshots.push({
        plantillaId: maestra._id || maestra.id,
        nombreSnapshot: nombreOverride || maestra.nombre,
        schemaVersion: maestra.schemaVersion ?? 1,
        secciones: JSON.parse(JSON.stringify(seccionesValidadas)),
      });
    }
    return snapshots;
  }

  /**
   * Resuelve fechas de create/repetir (Story 2.4 / 6.15).
   * `sinVigencia: true` → sin fechaVencimiento; estado vigente.
   */
  private async resolveVencimiento(
    fechaVencimiento?: string,
    opts?: { sinVigencia?: boolean },
  ): Promise<{
    fechaCreacion: Date;
    fechaVencimiento?: Date;
    sinVigencia: boolean;
    estado: string;
  }> {
    const fechaCreacion = new Date();
    if (opts?.sinVigencia) {
      if (fechaVencimiento != null && String(fechaVencimiento).trim() !== '') {
        throw new BadRequestException(
          'No envíe fechaVencimiento cuando sinVigencia es true',
        );
      }
      return {
        fechaCreacion,
        sinVigencia: true,
        estado: 'vigente',
      };
    }

    let fechaVenc: Date;
    if (fechaVencimiento != null) {
      fechaVenc = new Date(fechaVencimiento);
      if (Number.isNaN(fechaVenc.getTime())) {
        throw new BadRequestException('fechaVencimiento inválida');
      }
    } else {
      let days = 30;
      try {
        const cfg = await this.tenantConfigService.getForRequest();
        if (typeof cfg.vigenciaDefaultDias === 'number') {
          if (cfg.vigenciaDefaultDias >= 1 && cfg.vigenciaDefaultDias <= 365) {
            days = cfg.vigenciaDefaultDias;
          } else {
            this.logger.warn(
              `vigenciaDefaultDias fuera de rango (${cfg.vigenciaDefaultDias}); se usará 30`,
            );
          }
        }
      } catch (cfgErr) {
        this.logger.warn(
          `No se pudo leer vigenciaDefaultDias del tenant; se usará 30: ${cfgErr}`,
        );
      }
      fechaVenc = new Date(
        fechaCreacion.getTime() + days * 24 * 60 * 60 * 1000,
      );
    }
    if (fechaVenc < fechaCreacion) {
      throw new BadRequestException(
        'La fecha de vencimiento no puede ser anterior a la fecha de creación',
      );
    }
    return {
      fechaCreacion,
      fechaVencimiento: fechaVenc,
      sinVigencia: false,
      estado: 'vigente',
    };
  }

  /** TTL magic link: fechaVencimiento o fechaCreacion + 365d si sin vigencia (6.15). */
  private resolveMagicExpiresAt(cotizacion: {
    fechaVencimiento?: Date | string;
    fechaCreacion?: Date | string;
    sinVigencia?: boolean;
  }): Date {
    if (cotizacion.sinVigencia) {
      const base = cotizacion.fechaCreacion
        ? new Date(cotizacion.fechaCreacion)
        : new Date();
      const creacion = Number.isNaN(base.getTime()) ? new Date() : base;
      return new Date(creacion.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
    if (cotizacion.fechaVencimiento) {
      const fv = new Date(cotizacion.fechaVencimiento);
      if (!Number.isNaN(fv.getTime())) return fv;
    }
    throw new BadRequestException(
      'No se puede emitir el enlace: fecha de vencimiento inválida o ausente',
    );
  }

  private async issueMagicToken(cotizacionId: string, expiresAt: Date) {
    const magicToken = crypto.randomBytes(32).toString('hex');
    await this.cotizacionModel.findByIdAndUpdate(cotizacionId, {
      magicToken,
      magicTokenExpiresAt: expiresAt,
    });
    return magicToken;
  }

  async create(createCotizacionDto: CreateCotizacionDto): Promise<Cotizacion> {
    // Legacy CRM endpoint: exige clienteId + email. Delega al create flexible (6.2).
    return this.createAdminCotizacion({
      clienteId: createCotizacionDto.clienteId,
      emailContacto: createCotizacionDto.emailContacto,
      items: createCotizacionDto.items.map((i) => ({
        servicioId: i.servicioId,
        cantidad: i.cantidad,
        ...(i.nombre !== undefined ? { nombre: i.nombre } : {}),
        ...(i.descripcion !== undefined ? { descripcion: i.descripcion } : {}),
        ...(i.precioUnitario !== undefined
          ? { precioUnitario: i.precioUnitario }
          : {}),
      })),
      moneda: createCotizacionDto.moneda,
      fechaVencimiento: createCotizacionDto.fechaVencimiento,
    });
  }

  /** Story 6.13 — snapshot de creador AMES (create / repetir). */
  private applyCreadorFields(
    data: Record<string, unknown>,
    actor?: EstadoActorJwt,
  ) {
    if (!actor) return;
    const rawId = actor._id || actor.sub;
    if (rawId && isStrictObjectId(String(rawId))) {
      data.creadoPorUserId = new Types.ObjectId(String(rawId));
    }
    const email =
      typeof actor.email === 'string' ? actor.email.trim().toLowerCase() : '';
    if (email) {
      data.creadoPorEmail = email;
    }
  }

  /**
   * Create flexible (Story 6.2): identidad CRM/guest opcional; ítems + folio + vigente.
   * Endpoint FE: POST /cotizaciones/admin
   */
  async createAdminCotizacion(
    dto: CreateCotizacionAdminDto,
    actor?: EstadoActorJwt,
  ): Promise<Cotizacion> {
    const tenantId = this.tenantContext.getTenantId();
    const nombreEmpresa = this.trimOrUndef(dto.nombreEmpresa);
    const nombreContacto = this.trimOrUndef(dto.nombreContacto);
    const emailContacto = this.trimOrUndef(dto.emailContacto);
    const telefonoContacto = this.trimOrUndef(dto.telefonoContacto);
    const cargoContacto = this.trimOrUndef(dto.cargoContacto);

    // FR-21: correo/tel sin nombre → 400, salvo legacy CRM con email solo.
    // clienteId + teléfono sin nombre no exime (Completion Notes 6.2).
    const legacyCrmEmailOnly = !!(dto.clienteId && emailContacto);
    if (
      (emailContacto || telefonoContacto) &&
      !nombreContacto &&
      !legacyCrmEmailOnly
    ) {
      throw new BadRequestException(
        'El nombre del solicitante es obligatorio cuando se indica correo o teléfono',
      );
    }

    let clienteId: Types.ObjectId | undefined;
    let empresaFromCliente: string | undefined;
    if (dto.clienteId) {
      const cliente = (await this.clientesService.findOne(
        dto.clienteId,
      )) as any;
      if (!cliente.tenantId || String(cliente.tenantId) !== String(tenantId)) {
        throw new NotFoundException(
          `Cliente con ID ${dto.clienteId} no encontrado`,
        );
      }
      if (cliente.activo === false) {
        throw new BadRequestException(
          'No se puede crear una cotización para un cliente inactivo',
        );
      }
      clienteId = new Types.ObjectId(dto.clienteId);
      empresaFromCliente = this.trimOrUndef(
        typeof cliente.empresa === 'string' ? cliente.empresa : undefined,
      );
    }

    const { items, total } = await this.buildItems(dto.items, tenantId);
    const plantillasSnapshot = await this.buildPlantillasSnapshot(
      dto.plantillas,
      tenantId,
    );
    const folio = await this.generateFolio(tenantId);

    let tenantCfg:
      | {
          defaultIncluirDatosBancarios?: boolean | null;
          defaultIncluirDescripciones?: boolean | null;
          defaultIncluirImagenesPdf?: boolean | null;
          defaultUsarVigencia?: boolean | null;
        }
      | undefined;
    try {
      tenantCfg = await this.tenantConfigService.getForRequest();
    } catch (cfgErr) {
      this.logger.warn(
        `No se pudieron leer defaults de cotización del tenant; se usará true: ${cfgErr}`,
      );
    }
    // Omit: fecha explícita implica usar vigencia; si no, preferencia tenant ?? true.
    const sinVigenciaResolved =
      dto.sinVigencia !== undefined
        ? !!dto.sinVigencia
        : dto.fechaVencimiento
          ? false
          : !(tenantCfg?.defaultUsarVigencia ?? true);
    const { fechaCreacion, fechaVencimiento, sinVigencia, estado } =
      await this.resolveVencimiento(dto.fechaVencimiento, {
        sinVigencia: sinVigenciaResolved,
      });
    const incluirDatosBancarios = this.resolveDisplayFlag(
      this.normalizeClienteFlag(dto.incluirDatosBancarios),
      tenantCfg?.defaultIncluirDatosBancarios,
    );
    const incluirDescripciones = this.resolveDisplayFlag(
      this.normalizeClienteFlag(dto.incluirDescripciones),
      tenantCfg?.defaultIncluirDescripciones,
    );
    const incluirImagenesPdf = this.resolveDisplayFlag(
      this.normalizeClienteFlag(dto.incluirImagenesPdf),
      tenantCfg?.defaultIncluirImagenesPdf,
    );

    const emailsPara = this.normalizeEmailList(dto.emailsPara);
    const emailsCc = this.normalizeEmailList(dto.emailsCc).filter(
      (e) => !emailsPara.includes(e),
    );
    if (dto.enviarEmail && emailsPara.length === 0) {
      throw new BadRequestException(
        'Para enviar por correo debe indicar al menos un destinatario en Para',
      );
    }

    const data: any = {
      tenantId,
      folio,
      items,
      total,
      moneda: 'MXN',
      fechaCreacion,
      estado,
      sinVigencia,
      incluirDatosBancarios,
      incluirDescripciones,
      incluirImagenesPdf,
      plantillasSnapshot,
      emailsPara,
      emailsCc,
      fechaEstadoVigente: estado === 'vigente' ? fechaCreacion : undefined,
      fechaEstadoVencida: estado === 'vencida' ? fechaCreacion : undefined,
    };
    if (fechaVencimiento) {
      data.fechaVencimiento = fechaVencimiento;
    }

    if (clienteId) {
      data.clienteId = clienteId;
    }
    const empresaFinal = nombreEmpresa || empresaFromCliente;
    if (empresaFinal) {
      data.nombreEmpresa = empresaFinal;
    }
    if (nombreContacto) {
      data.nombreContacto = nombreContacto;
    }
    if (emailContacto) {
      data.emailContacto = emailContacto;
    }
    if (telefonoContacto) {
      data.telefonoContacto = telefonoContacto;
    }
    if (cargoContacto) {
      data.cargoContacto = cargoContacto;
    }
    this.applyCreadorFields(data, actor);

    let saved: CotizacionDocument;
    try {
      saved = await new this.cotizacionModel(data).save();
    } catch {
      throw new BadRequestException('Error al crear la cotización');
    }

    // Story 6.8 / AD-5: create no genera PDF ni SMTP. Envío → enviarCorreoConPdf.
    return this.findOne((saved as any)._id.toString());
  }

  private refId(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && '_id' in value) {
      return String((value as { _id: unknown })._id);
    }
    return String(value);
  }

  /**
   * Story 6.12 / FR-35 / FR-36 — clona cotización con precios originales o actualizados.
   * No SMTP / magic token. Permite servicio inactivo en modo originales.
   */
  private parseRepetirResoluciones(dto: RepetirCotizacionDto): {
    omitSet: Set<string>;
    sustMap: Map<string, string>;
  } {
    const omitSet = new Set(
      (dto.omitirServicioIds || []).map((s) => String(s)),
    );
    const sustMap = new Map<string, string>();
    for (const s of dto.sustituciones || []) {
      const from = String(s.fromServicioId);
      const to = String(s.toServicioId);
      if (sustMap.has(from)) {
        throw new BadRequestException(
          'fromServicioId duplicado en sustituciones',
        );
      }
      sustMap.set(from, to);
    }
    for (const id of omitSet) {
      if (sustMap.has(id)) {
        throw new BadRequestException(
          'No mezclar omitir y sustituir el mismo servicio',
        );
      }
    }
    return { omitSet, sustMap };
  }

  private assertFuenteRepetible(fuente: any): void {
    if (!ESTADOS_COTIZACION.includes(fuente.estado as EstadoCotizacion)) {
      throw new BadRequestException(
        'Solo se pueden repetir cotizaciones vigentes, vencidas, aceptadas, rechazadas o canceladas',
      );
    }
  }

  private async buildRepetirItems(
    fuente: any,
    dto: RepetirCotizacionDto,
    tenantId: Types.ObjectId,
  ): Promise<{
    items: ItemCotizacion[];
    total: number;
    warnings: Array<{
      index: number;
      servicioId: string;
      motivo: 'inexistente' | 'inactivo';
    }>;
  }> {
    const { omitSet, sustMap } = this.parseRepetirResoluciones(dto);
    const warnings: Array<{
      index: number;
      servicioId: string;
      motivo: 'inexistente' | 'inactivo';
    }> = [];
    const items: ItemCotizacion[] = [];
    let total = 0;

    const assertPrecioValido = (precio: number, label: string) => {
      if (!Number.isFinite(precio) || precio < 0) {
        throw new BadRequestException(label);
      }
    };

    const sourceItems: any[] = Array.isArray(fuente.items) ? fuente.items : [];
    for (let i = 0; i < sourceItems.length; i++) {
      const raw = sourceItems[i];
      const fromId = this.refId(raw.servicioId);
      if (!fromId) {
        warnings.push({
          index: i,
          servicioId: String(raw.servicioId ?? ''),
          motivo: 'inexistente',
        });
        continue;
      }
      if (omitSet.has(fromId)) {
        continue;
      }

      const cantidad = Number(raw.cantidad);
      if (!Number.isFinite(cantidad) || cantidad < 1) {
        throw new BadRequestException(
          `Cantidad inválida en ítem ${i} de la cotización fuente`,
        );
      }

      const toId = sustMap.get(fromId);
      if (toId) {
        let reemplazo: any;
        try {
          reemplazo = await this.serviciosService.findOne(toId);
        } catch {
          throw new BadRequestException(
            `Servicio de sustitución ${toId} no encontrado`,
          );
        }
        if (
          !reemplazo.tenantId ||
          String(reemplazo.tenantId) !== String(tenantId)
        ) {
          throw new BadRequestException(
            `Servicio de sustitución ${toId} no encontrado`,
          );
        }
        if (reemplazo.activo === false) {
          throw new BadRequestException(
            'El servicio de sustitución debe estar activo',
          );
        }
        const precio = Number(reemplazo.precioUnitario);
        assertPrecioValido(
          precio,
          `Precio de sustitución inválido para servicio ${toId}`,
        );
        const subtotal = precio * cantidad;
        total += subtotal;
        const item: any = {
          servicioId: reemplazo._id || reemplazo.id,
          nombreServicioSnapshot: reemplazo.nombre,
          precioUnitarioSnapshot: precio,
          cantidad,
          subtotal,
        };
        if (reemplazo.descripcion) {
          item.descripcionServicioSnapshot = reemplazo.descripcion;
        }
        this.applyTipoCodigoSnapshotsFromServicio(item, reemplazo);
        items.push(item);
        continue;
      }

      let servicio: any = null;
      let inexistente = false;
      try {
        servicio = await this.serviciosService.findOne(fromId);
        if (
          !servicio?.tenantId ||
          String(servicio.tenantId) !== String(tenantId)
        ) {
          inexistente = true;
          servicio = null;
        }
      } catch {
        inexistente = true;
      }

      if (inexistente) {
        warnings.push({
          index: i,
          servicioId: fromId,
          motivo: 'inexistente',
        });
        continue;
      }

      if (dto.modoPrecios === 'actualizados' && servicio.activo === false) {
        warnings.push({
          index: i,
          servicioId: fromId,
          motivo: 'inactivo',
        });
        continue;
      }

      if (dto.modoPrecios === 'originales') {
        const precio = Number(raw.precioUnitarioSnapshot);
        assertPrecioValido(
          precio,
          `Precio snapshot inválido en ítem ${i} de la cotización fuente`,
        );
        const subtotal = precio * cantidad;
        total += subtotal;
        const item: any = {
          servicioId: servicio._id || servicio.id,
          nombreServicioSnapshot:
            String(
              raw.nombreServicioSnapshot || servicio.nombre || '',
            ).trim() || servicio.nombre,
          precioUnitarioSnapshot: precio,
          cantidad,
          subtotal,
        };
        const desc = raw.descripcionServicioSnapshot;
        if (typeof desc === 'string' && desc.trim()) {
          item.descripcionServicioSnapshot = desc.trim();
        }
        this.applyTipoCodigoSnapshotsForOriginales(item, raw, servicio);
        items.push(item);
      } else {
        const precio = Number(servicio.precioUnitario);
        assertPrecioValido(
          precio,
          `Precio catálogo inválido en ítem ${i} de la cotización fuente`,
        );
        const subtotal = precio * cantidad;
        total += subtotal;
        const item: any = {
          servicioId: servicio._id || servicio.id,
          nombreServicioSnapshot: servicio.nombre,
          precioUnitarioSnapshot: precio,
          cantidad,
          subtotal,
        };
        if (servicio.descripcion) {
          item.descripcionServicioSnapshot = servicio.descripcion;
        }
        this.applyTipoCodigoSnapshotsFromServicio(item, servicio);
        items.push(item);
      }
    }

    return { items, total, warnings };
  }

  private throwRepetirWarnings(
    warnings: Array<{
      index: number;
      servicioId: string;
      motivo: 'inexistente' | 'inactivo';
    }>,
  ): never {
    throw new HttpException(
      {
        statusCode: 400,
        message: 'Hay servicios que requieren exclusión o sustitución',
        warnings,
      },
      HttpStatus.BAD_REQUEST,
    );
  }

  private async resolveRepetirClienteId(
    fuente: any,
    tenantId: Types.ObjectId,
  ): Promise<Types.ObjectId | undefined> {
    const fuenteClienteId = this.refId(fuente.clienteId);
    if (!fuenteClienteId) return undefined;
    try {
      const cliente = (await this.clientesService.findOne(
        fuenteClienteId,
      )) as any;
      if (
        cliente?.tenantId &&
        String(cliente.tenantId) === String(tenantId) &&
        cliente.activo !== false
      ) {
        return new Types.ObjectId(fuenteClienteId);
      }
    } catch {
      // omitir clienteId; conservar snapshots de nombre
    }
    return undefined;
  }

  /**
   * Preferencias opcionales de tenant (repetir/preview): copia el flag de la fuente
   * si está definido; si la fuente no lo tiene (cotización antigua), aplica el
   * default del tenant (?? true) — igual que en create.
   */
  private async resolveRepetirDisplayFlags(fuente: any): Promise<{
    incluirDatosBancarios: boolean;
    incluirDescripciones: boolean;
    incluirImagenesPdf: boolean;
  }> {
    let tenantCfg:
      | {
          defaultIncluirDatosBancarios?: boolean | null;
          defaultIncluirDescripciones?: boolean | null;
          defaultIncluirImagenesPdf?: boolean | null;
        }
      | undefined;
    try {
      tenantCfg = await this.tenantConfigService.getForRequest();
    } catch (cfgErr) {
      this.logger.warn(
        `No se pudieron leer defaults de cotización del tenant al repetir; se usará true: ${cfgErr}`,
      );
    }
    const fromFuente = (
      value: unknown,
      tenantDefault: boolean | null | undefined,
    ) =>
      this.resolveDisplayFlag(
        this.normalizeClienteFlag(value),
        tenantDefault,
      );
    // Leer del _doc / hasOwnProperty para no confundir ausencia con default mongoose.
    const stored = (key: string): boolean | undefined => {
      const raw = (fuente as any)?._doc ?? fuente;
      if (!raw || !Object.prototype.hasOwnProperty.call(raw, key)) {
        return undefined;
      }
      return this.normalizeClienteFlag(raw[key]);
    };
    return {
      incluirDatosBancarios: fromFuente(
        stored('incluirDatosBancarios'),
        tenantCfg?.defaultIncluirDatosBancarios,
      ),
      incluirDescripciones: fromFuente(
        stored('incluirDescripciones'),
        tenantCfg?.defaultIncluirDescripciones,
      ),
      incluirImagenesPdf: fromFuente(
        stored('incluirImagenesPdf'),
        tenantCfg?.defaultIncluirImagenesPdf,
      ),
    };
  }

  private buildRepetirPreviewDto(
    fuente: any,
    dto: RepetirCotizacionDto,
    items: ItemCotizacion[],
    clienteId?: Types.ObjectId,
    flags?: {
      incluirDatosBancarios: boolean;
      incluirDescripciones: boolean;
      incluirImagenesPdf: boolean;
    },
  ): RepetirCotizacionPreviewDto {
    const sinVigencia =
      dto.sinVigencia !== undefined ? !!dto.sinVigencia : !!fuente.sinVigencia;
    const plantillasSnapshot: PlantillaSnapshot[] = JSON.parse(
      JSON.stringify(fuente.plantillasSnapshot || []),
    );
    const emailsPara = Array.isArray(fuente.emailsPara)
      ? [...fuente.emailsPara]
      : [];
    const emailsCc = Array.isArray(fuente.emailsCc) ? [...fuente.emailsCc] : [];

    const preview: RepetirCotizacionPreviewDto = {
      items: items.map((it: any) => {
        const item: RepetirCotizacionPreviewDto['items'][number] = {
          servicioId: this.refId(it.servicioId) || String(it.servicioId),
          cantidad: it.cantidad,
          nombre: it.nombreServicioSnapshot,
          precioUnitario: it.precioUnitarioSnapshot,
        };
        if (it.descripcionServicioSnapshot) {
          item.descripcion = it.descripcionServicioSnapshot;
        }
        return item;
      }),
      emailsPara,
      emailsCc,
      sinVigencia,
      incluirDatosBancarios: flags?.incluirDatosBancarios ?? true,
      incluirDescripciones: flags?.incluirDescripciones ?? true,
      incluirImagenesPdf: flags?.incluirImagenesPdf ?? true,
      plantillas: plantillasSnapshot.map((p) => ({
        plantillaId: this.refId(p.plantillaId) || String(p.plantillaId),
        nombre: p.nombreSnapshot,
        secciones: p.secciones,
      })),
      moneda: 'MXN',
    };

    if (clienteId) {
      preview.clienteId = clienteId.toString();
    }
    if (fuente.nombreEmpresa) {
      preview.nombreEmpresa = String(fuente.nombreEmpresa);
    }
    if (fuente.nombreContacto) {
      preview.nombreContacto = String(fuente.nombreContacto);
    }
    if (fuente.emailContacto) {
      preview.emailContacto = String(fuente.emailContacto);
    }
    if (fuente.telefonoContacto) {
      preview.telefonoContacto = String(fuente.telefonoContacto);
    }
    const cargoRepetir = this.trimOrUndef(
      fuente.cargoContacto != null ? String(fuente.cargoContacto) : undefined,
    );
    if (cargoRepetir) {
      preview.cargoContacto = cargoRepetir;
    }

    return preview;
  }

  /**
   * Preview wizard-ready sin persistir (repetir → cotizador).
   */
  async previewRepetirCotizacion(
    id: string,
    dto: RepetirCotizacionDto,
  ): Promise<RepetirCotizacionPreviewDto> {
    const fuente = (await this.findOne(id)) as any;
    this.assertFuenteRepetible(fuente);

    const tenantId = this.tenantContext.getTenantId();
    const { items, warnings } = await this.buildRepetirItems(
      fuente,
      dto,
      tenantId,
    );

    if (warnings.length > 0) {
      this.throwRepetirWarnings(warnings);
    }

    if (items.length < 1) {
      throw new BadRequestException(
        'Debe quedar al menos un ítem tras omitir o sustituir',
      );
    }

    const [clienteId, flags] = await Promise.all([
      this.resolveRepetirClienteId(fuente, tenantId),
      this.resolveRepetirDisplayFlags(fuente),
    ]);

    return this.buildRepetirPreviewDto(fuente, dto, items, clienteId, flags);
  }

  async repetirCotizacion(
    id: string,
    dto: RepetirCotizacionDto,
    actor?: EstadoActorJwt,
  ): Promise<RepetirCotizacionResponseDto> {
    const fuente = (await this.findOne(id)) as any;
    this.assertFuenteRepetible(fuente);

    let recetaRearme: RecetaRecordatorioDto | undefined;
    if (dto.rearmarRecordatorio === true) {
      recetaRearme = await this.recordatoriosService.resolveRecetaRearme(
        id,
        dto.recetaRecordatorio,
      );
    }

    const tenantId = this.tenantContext.getTenantId();
    const { items, total, warnings } = await this.buildRepetirItems(
      fuente,
      dto,
      tenantId,
    );

    if (warnings.length > 0) {
      this.throwRepetirWarnings(warnings);
    }

    if (items.length < 1) {
      throw new BadRequestException(
        'Debe quedar al menos un ítem tras omitir o sustituir',
      );
    }

    const [clienteId, flags] = await Promise.all([
      this.resolveRepetirClienteId(fuente, tenantId),
      this.resolveRepetirDisplayFlags(fuente),
    ]);

    const plantillasSnapshot: PlantillaSnapshot[] = JSON.parse(
      JSON.stringify(fuente.plantillasSnapshot || []),
    );

    const folio = await this.generateFolio(tenantId);
    const sinVigencia =
      dto.sinVigencia !== undefined ? !!dto.sinVigencia : !!fuente.sinVigencia;
    const { fechaCreacion, fechaVencimiento, estado } =
      await this.resolveVencimiento(
        sinVigencia ? undefined : dto.fechaVencimiento,
        { sinVigencia },
      );

    if (recetaRearme) {
      await this.recordatoriosService.assertRecetaRearmeValida(
        recetaRearme,
        fechaCreacion,
      );
    }

    const emailsPara = Array.isArray(fuente.emailsPara)
      ? [...fuente.emailsPara]
      : [];
    const emailsCc = Array.isArray(fuente.emailsCc) ? [...fuente.emailsCc] : [];

    const data: any = {
      tenantId,
      folio,
      items,
      total,
      moneda: 'MXN',
      fechaCreacion,
      estado,
      sinVigencia,
      incluirDatosBancarios: flags.incluirDatosBancarios,
      incluirDescripciones: flags.incluirDescripciones,
      incluirImagenesPdf: flags.incluirImagenesPdf,
      plantillasSnapshot,
      emailsPara,
      emailsCc,
      fechaEstadoVigente: estado === 'vigente' ? fechaCreacion : undefined,
      fechaEstadoVencida: estado === 'vencida' ? fechaCreacion : undefined,
    };
    if (fechaVencimiento) {
      data.fechaVencimiento = fechaVencimiento;
    }

    if (clienteId) {
      data.clienteId = clienteId;
    }
    if (fuente.nombreEmpresa) {
      data.nombreEmpresa = String(fuente.nombreEmpresa);
    }
    if (fuente.nombreContacto) {
      data.nombreContacto = String(fuente.nombreContacto);
    }
    if (fuente.emailContacto) {
      data.emailContacto = String(fuente.emailContacto);
    }
    if (fuente.telefonoContacto) {
      data.telefonoContacto = String(fuente.telefonoContacto);
    }
    const cargoRepetir = this.trimOrUndef(
      fuente.cargoContacto != null ? String(fuente.cargoContacto) : undefined,
    );
    if (cargoRepetir) {
      data.cargoContacto = cargoRepetir;
    }
    // Creador = actor JWT del repetir (no clonar de la fuente).
    this.applyCreadorFields(data, actor);

    let saved: CotizacionDocument;
    try {
      saved = await new this.cotizacionModel(data).save();
    } catch {
      throw new BadRequestException('Error al crear la cotización repetida');
    }

    const cotizacion = await this.findOne((saved as any)._id.toString());
    const nuevaCotizacionId = (saved as any)._id.toString();
    let originalCancelada = false;
    let originalCancelacionError: string | undefined;

    try {
      await this.recordatoriosService.cancelarPorRepetir(id);
    } catch (err) {
      this.logger.warn(
        `Repetir OK pero falló cancelar recordatorio origen ${id}: ${this.extractErrorMessage(err, 'error desconocido')}`,
      );
    }

    if (recetaRearme) {
      try {
        await this.recordatoriosService.programarEnCotizacionNueva(
          nuevaCotizacionId,
          recetaRearme,
        );
      } catch (err) {
        this.logger.warn(
          `Repetir OK pero falló rearmar recordatorio en ${nuevaCotizacionId}: ${this.extractErrorMessage(err, 'error desconocido')}`,
        );
      }
    }

    if (dto.cancelarOriginal === true) {
      try {
        const fuenteActual = (await this.findOne(id)) as any;
        if (fuenteActual.estado === 'cancelada') {
          originalCancelada = true;
        } else if (!actor) {
          originalCancelacionError =
            'No se pudo cancelar la cotización original: falta actor autenticado';
        } else {
          await this.cambiarEstadoManual(id, 'cancelada', actor);
          originalCancelada = true;
        }
      } catch (err) {
        // Carrera: otra petición pudo dejarla cancelada; tratar como éxito idempotente.
        try {
          const again = (await this.findOne(id)) as any;
          if (again?.estado === 'cancelada') {
            originalCancelada = true;
          } else {
            originalCancelada = false;
            originalCancelacionError = this.extractErrorMessage(
              err,
              'No se pudo cancelar la cotización original',
            );
            this.logger.warn(
              `Repetir OK pero falló cancelar original ${id}: ${originalCancelacionError}`,
            );
          }
        } catch {
          originalCancelada = false;
          originalCancelacionError = this.extractErrorMessage(
            err,
            'No se pudo cancelar la cotización original',
          );
          this.logger.warn(
            `Repetir OK pero falló cancelar original ${id}: ${originalCancelacionError}`,
          );
        }
      }
    }

    const response: RepetirCotizacionResponseDto = {
      cotizacion,
      originalCancelada,
    };
    if (originalCancelacionError) {
      response.originalCancelacionError = originalCancelacionError;
    }
    return response;
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof HttpException) {
      const body = err.getResponse();
      if (typeof body === 'string') return body;
      if (body && typeof body === 'object' && 'message' in body) {
        const msg = (body as { message?: string | string[] }).message;
        if (Array.isArray(msg)) return msg.join(', ');
        if (typeof msg === 'string' && msg.trim()) return msg;
      }
    }
    if (err instanceof Error && err.message.trim()) return err.message;
    return fallback;
  }

  /**
   * Story 6.8 / 6.17 — envía cotización con PDF generado en FE (multipart).
   * Emite magic token (TTL = vigencia); propaga errores SMTP; unset token si falla.
   * Usado tras create (wizard) y al reenviar desde el detalle.
   */
  async enviarCorreoConPdf(
    id: string,
    pdfFile: Express.Multer.File | undefined,
    overrides?: { emailsPara?: string[]; emailsCc?: string[] },
  ): Promise<{ ok: true; folio: string }> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    if (!pdfFile?.buffer?.length) {
      throw new BadRequestException('Archivo PDF requerido');
    }
    const mime = (pdfFile.mimetype || '').toLowerCase();
    if (mime !== 'application/pdf') {
      throw new BadRequestException('El archivo debe ser application/pdf');
    }

    const cotizacion = await this.findOne(id);
    const cotizacionId = (cotizacion as any)._id.toString();

    const emailsPara = this.normalizeEmailList(
      overrides?.emailsPara ?? (cotizacion as any).emailsPara,
    );
    const emailsCc = this.normalizeEmailList(
      overrides?.emailsCc ?? (cotizacion as any).emailsCc,
    ).filter((e) => !emailsPara.includes(e));

    if (emailsPara.length === 0) {
      throw new BadRequestException(
        'Para enviar por correo debe indicar al menos un destinatario en Para',
      );
    }

    const magicExpiresAt = this.resolveMagicExpiresAt(cotizacion as any);
    const folio = (cotizacion as any).folio as string;
    const nombreContacto = (cotizacion as any).nombreContacto || 'Cliente';

    const emisorTenantId = (cotizacion as any).tenantId;
    if (!emisorTenantId) {
      throw new BadRequestException(
        'La cotización no tiene tenant asociado; no se puede enviar correo',
      );
    }
    const emisorOid =
      emisorTenantId instanceof Types.ObjectId
        ? emisorTenantId
        : new Types.ObjectId(String(emisorTenantId));

    // AD-14 / Story 3.4 — bloquear envío si el tenant emisor está inactivo (antes del magic token).
    const emisorTenant = await this.tenantsService.findById(String(emisorOid));
    if (!emisorTenant || !emisorTenant.activo) {
      throw new ForbiddenException(
        'No se puede enviar: el tenant está inactivo.',
      );
    }

    // From/branding del tenant de la cotización (no ALS / getForRequest).
    let fromOverride: string | undefined;
    let emisorNombre: string | undefined;
    try {
      const cfg = await this.tenantConfigService.findByTenantId(emisorOid);
      fromOverride = cfg?.emailRemitente || undefined;
      emisorNombre = cfg?.branding?.razonSocial || undefined;
    } catch (cfgErr) {
      this.logger.warn(
        `No se pudo leer config email del tenant emisor para cotización ${folio}: ${
          cfgErr instanceof Error ? cfgErr.message : cfgErr
        }`,
      );
    }

    // Story 3.4 — sin credenciales: fallar antes del magic token (simétrico a AD-14).
    const outboundAuth =
      await this.tenantConfigService.getOutboundSmtpAuth(emisorOid);
    if (!outboundAuth) {
      throw new BadRequestException(
        'No se puede enviar: el correo del tenant no está configurado. Un administrador puede configurarlo en Configuración.',
      );
    }

    const magicToken = await this.issueMagicToken(cotizacionId, magicExpiresAt);

    try {
      await this.emailService.sendAdminQuotationEmail(
        emisorOid,
        emailsPara,
        nombreContacto,
        folio,
        pdfFile.buffer,
        magicToken,
        fromOverride,
        emailsCc.length ? emailsCc : undefined,
        {
          emisorNombre,
          fechaVencimiento: magicExpiresAt,
        },
      );
    } catch (err) {
      try {
        await this.cotizacionModel.findByIdAndUpdate(cotizacionId, {
          $unset: { magicToken: 1, magicTokenExpiresAt: 1 },
        });
      } catch (unsetErr) {
        this.logger.error(
          `No se pudo limpiar magicToken tras fallo SMTP cotización ${folio}: ${
            unsetErr instanceof Error ? unsetErr.message : unsetErr
          }`,
        );
      }
      this.logger.error(
        `Fallo SMTP cotización ${folio}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (err instanceof TenantSecretsKeyError) {
        throw new InternalServerErrorException(
          'No se pudo enviar el correo por un error de cifrado en el servidor.',
        );
      }
      if (err instanceof TenantEmailNotConfiguredError) {
        throw new BadRequestException(
          'No se puede enviar: el correo del tenant no está configurado. Un administrador puede configurarlo en Configuración.',
        );
      }
      if (err instanceof TenantInactiveForOutboundError) {
        throw new ForbiddenException(
          'No se puede enviar: el tenant está inactivo.',
        );
      }
      throw new BadRequestException(
        'No se pudo enviar el correo. Verifica la configuración SMTP o intenta de nuevo.',
      );
    }

    if (
      overrides?.emailsPara !== undefined ||
      overrides?.emailsCc !== undefined
    ) {
      await this.cotizacionModel.findByIdAndUpdate(cotizacionId, {
        emailsPara,
        emailsCc,
      });
    }

    return { ok: true, folio };
  }

  /** Story 6.6 — trim, lower-case, unique, max 20. */
  private normalizeEmailList(list?: string[]): string[] {
    if (!list?.length) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of list) {
      if (typeof raw !== 'string') continue;
      const e = raw.trim().toLowerCase();
      if (!e || seen.has(e)) continue;
      seen.add(e);
      out.push(e);
      if (out.length >= 20) break;
    }
    return out;
  }

  private trimOrUndef(v?: string): string | undefined {
    if (v == null) return undefined;
    const t = String(v).trim();
    return t.length ? t : undefined;
  }

  async findAll(
    filters?: FilterCotizacionDto,
  ): Promise<PaginatedCotizacionesResponseDto> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 10;
    const skip = (page - 1) * limit;
    const pipeline: any[] = [];

    pipeline.push({
      $lookup: {
        from: 'clientes',
        localField: 'clienteId',
        foreignField: '_id',
        as: 'cliente',
      },
    });
    pipeline.push({
      $unwind: { path: '$cliente', preserveNullAndEmptyArrays: true },
    });

    // Scope por tenant efectivo (AD-2)
    const tenantId = this.tenantContext.getTenantId();
    const matchConditions: any = { tenantId };
    if (filters?.estado) {
      matchConditions.estado = filters.estado;
    }
    if (filters?.clienteId) {
      matchConditions.clienteId = new Types.ObjectId(filters.clienteId);
    }
    if (filters?.fechaDesde || filters?.fechaHasta) {
      matchConditions.fechaCreacion = {};
      if (filters.fechaDesde) {
        matchConditions.fechaCreacion.$gte = new Date(filters.fechaDesde);
      }
      if (filters.fechaHasta) {
        matchConditions.fechaCreacion.$lte = new Date(filters.fechaHasta);
      }
    }
    if (Object.keys(matchConditions).length > 0) {
      pipeline.push({ $match: matchConditions });
    }

    if (filters?.search?.trim()) {
      const term = filters.search.trim();
      const searchRegex = {
        $regex: this.escapeRegex(term),
        $options: 'i',
      };
      const estadoMap: Record<string, string> = {
        vigente: 'vigente',
        vencida: 'vencida',
        aceptada: 'aceptada',
        rechazada: 'rechazada',
        cancelada: 'cancelada',
      };
      const searchLower = term.toLowerCase();
      const estadoMatch = estadoMap[searchLower];
      const orConditions: any[] = [
        { 'cliente.empresa': searchRegex },
        { 'cliente.rfc': searchRegex },
        { folio: searchRegex },
        { emailContacto: searchRegex },
        { nombreEmpresa: searchRegex },
        { nombreContacto: searchRegex },
      ];
      if (estadoMatch) {
        orConditions.push({ estado: estadoMatch });
      }
      pipeline.push({ $match: { $or: orConditions } });
    }

    pipeline.push({
      $facet: {
        data: [
          { $sort: { fechaCreacion: -1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: 'users',
              localField: 'creadoPorUserId',
              foreignField: '_id',
              as: '_creador',
            },
          },
          {
            $project: {
              folio: 1,
              fecha: '$fechaCreacion',
              montoTotal: '$total',
              empresa: { $ifNull: ['$cliente.empresa', '$nombreEmpresa'] },
              nombreSolicitante: '$nombreContacto',
              creadoPorNombre: {
                $let: {
                  vars: {
                    nombreTrim: {
                      $trim: {
                        input: {
                          $ifNull: [
                            { $arrayElemAt: ['$_creador.nombre', 0] },
                            '',
                          ],
                        },
                      },
                    },
                    emailTrim: {
                      $trim: {
                        input: { $ifNull: ['$creadoPorEmail', ''] },
                      },
                    },
                  },
                  in: {
                    $cond: [
                      { $gt: [{ $strLenCP: '$$nombreTrim' }, 0] },
                      '$$nombreTrim',
                      {
                        $cond: [
                          { $gt: [{ $strLenCP: '$$emailTrim' }, 0] },
                          '$$emailTrim',
                          null,
                        ],
                      },
                    ],
                  },
                },
              },
              rfc: { $ifNull: ['$cliente.rfc', ''] },
              estado: 1,
              pdfUrl: 1,
              fechaAceptacion: 1,
              fechaRechazo: 1,
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    });

    const [facet] = await this.cotizacionModel.aggregate(pipeline).exec();
    const results = facet?.data || [];
    const total = facet?.totalCount?.[0]?.count || 0;

    const data: CotizacionListItemDto[] = results.map((item: any) => ({
      id: item._id.toString(),
      folio: item.folio,
      fecha: item.fecha,
      montoTotal: item.montoTotal,
      empresa: item.empresa,
      nombreSolicitante: item.nombreSolicitante,
      ...(typeof item.creadoPorNombre === 'string' &&
      item.creadoPorNombre.trim()
        ? { creadoPorNombre: item.creadoPorNombre.trim() }
        : {}),
      rfc: item.rfc || '',
      estado: item.estado,
      pdfUrl: item.pdfUrl,
      fechaAceptacion: item.fechaAceptacion,
      fechaRechazo: item.fechaRechazo,
    }));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const cotizacion = await this.cotizacionModel
      .findOne({ _id: id, tenantId })
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(`Cotización con ID ${id} no encontrada`);
    }
    return cotizacion;
  }

  /**
   * Actualiza campos no-estado. Si muta `estado` (explícito o vía fechaVencimiento),
   * delega en `cambiarEstadoManual` para provenance (AD-4 / Story 6.10).
   */
  async update(
    id: string,
    updateCotizacionDto: UpdateCotizacionDto,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const current = await this.findOne(id);
    const ahora = new Date();

    const {
      estado: estadoDto,
      fechaVencimiento: fechaVencDto,
      ...restDto
    } = updateCotizacionDto;

    const updateData: Record<string, unknown> = { ...restDto };
    // AD-22 / Story 6.4 — UpdateCotizacionDto no declara `items`; no reescribir líneas/snapshots.
    delete updateData.items;
    let fechaVenc: Date | undefined;
    if (fechaVencDto) {
      fechaVenc = new Date(fechaVencDto);
      if (Number.isNaN(fechaVenc.getTime())) {
        throw new BadRequestException('fechaVencimiento inválida');
      }
      updateData.fechaVencimiento = fechaVenc;
    }

    let targetEstado: string | undefined = estadoDto;
    if (!targetEstado && fechaVenc) {
      targetEstado = fechaVenc < ahora ? 'vencida' : 'vigente';
    }

    if (targetEstado && targetEstado !== current.estado) {
      await this.cambiarEstadoManual(id, targetEstado, actor, {
        fechaVencimiento: fechaVenc,
      });
      // fechaVencimiento ya aplicada en pipeline si → vigente
      if (targetEstado === 'vigente') {
        delete updateData.fechaVencimiento;
      }
    }

    const remainingKeys = Object.keys(updateData).filter(
      (k) => updateData[k] !== undefined,
    );
    if (remainingKeys.length === 0) {
      return this.findOne(id);
    }

    const cotizacion = await this.cotizacionModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        { $set: updateData },
        { new: true },
      )
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(`Cotización con ID ${id} no encontrada`);
    }
    return cotizacion;
  }

  /**
   * Story 6.10 — cambio manual unificado (FR-27).
   * Origen siempre `usuario` + snapshot de identidad. Sin SMTP / sin tocar magic token.
   */
  async cambiarEstadoManual(
    cotizacionId: string,
    nuevoEstado: EstadoCotizacion | string,
    actor: EstadoActorJwt,
    opts?: { fechaVencimiento?: string | Date },
  ): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    if (!ESTADOS_COTIZACION.includes(nuevoEstado as EstadoCotizacion)) {
      throw new BadRequestException(
        `Estado inválido. Use: ${ESTADOS_COTIZACION.join(', ')}`,
      );
    }
    const cotizacion = await this.findOne(cotizacionId);
    const estadoActual = cotizacion.estado;
    if (estadoActual === nuevoEstado) {
      throw new BadRequestException(
        `La cotización ya está en estado '${nuevoEstado}'`,
      );
    }

    const { userId, nombre } = await this.resolveActorNombre(actor);
    const now = new Date();
    const update: Record<string, unknown> = {
      estado: nuevoEstado,
      estadoOrigen: 'usuario',
      estadoOrigenAt: now,
      estadoCambiadoPorUserId: userId,
      estadoCambiadoPorNombre: nombre,
    };

    if (nuevoEstado === 'aceptada') {
      update.fechaAceptacion = now;
      update.fechaEstadoAceptada = now;
      update.fechaRechazo = null;
    } else if (nuevoEstado === 'rechazada') {
      update.fechaRechazo = now;
      update.fechaEstadoRechazada = now;
      update.fechaAceptacion = null;
    } else if (nuevoEstado === 'vencida') {
      update.fechaEstadoVencida = now;
      update.fechaAceptacion = null;
      update.fechaRechazo = null;
    } else if (nuevoEstado === 'cancelada') {
      update.fechaEstadoCancelada = now;
      update.fechaAceptacion = null;
      update.fechaRechazo = null;
    } else if (nuevoEstado === 'vigente') {
      update.fechaEstadoVigente = now;
      update.fechaAceptacion = null;
      update.fechaRechazo = null;
      update.fechaVencimiento = await this.resolveFechaVigenteManual(
        opts?.fechaVencimiento,
        now,
      );
    }

    const tenantId = this.tenantContext.getTenantId();
    const updated = await this.cotizacionModel
      .findOneAndUpdate(
        { _id: cotizacionId, tenantId, estado: estadoActual },
        { $set: update },
        { new: true },
      )
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!updated) {
      const again = await this.findOne(cotizacionId);
      if (again.estado === nuevoEstado) {
        throw new BadRequestException(
          `La cotización ya está en estado '${nuevoEstado}'`,
        );
      }
      throw new BadRequestException(
        `No se pudo cambiar el estado (estado actual: ${again.estado}). Intente de nuevo.`,
      );
    }
    return updated;
  }

  /** Futura explícita, o extensión con vigenciaDefaultDias del tenant (1C). */
  private async resolveFechaVigenteManual(
    fechaVencimiento: string | Date | undefined,
    now: Date,
  ): Promise<Date> {
    if (fechaVencimiento != null && String(fechaVencimiento).trim() !== '') {
      const fv = new Date(fechaVencimiento);
      if (Number.isNaN(fv.getTime())) {
        throw new BadRequestException('fechaVencimiento inválida');
      }
      if (fv <= now) {
        throw new BadRequestException(
          'Para marcar como vigente, fechaVencimiento debe ser futura',
        );
      }
      return fv;
    }

    let days = 30;
    try {
      const cfg = await this.tenantConfigService.getForRequest();
      if (
        typeof cfg.vigenciaDefaultDias === 'number' &&
        cfg.vigenciaDefaultDias >= 1 &&
        cfg.vigenciaDefaultDias <= 365
      ) {
        days = cfg.vigenciaDefaultDias;
      }
    } catch (cfgErr) {
      this.logger.warn(
        `No se pudo leer vigenciaDefaultDias al marcar vigente; se usará 30: ${cfgErr}`,
      );
    }
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private async resolveActorNombre(
    actor: EstadoActorJwt,
  ): Promise<{ userId: Types.ObjectId; nombre: string }> {
    const rawId = String(actor?._id || actor?.sub || '').trim();
    if (!rawId || !isStrictObjectId(rawId)) {
      throw new BadRequestException('Usuario autenticado inválido');
    }
    const userId = new Types.ObjectId(rawId);
    const emailFallback = actor.email?.trim() || 'Usuario AMES';
    try {
      const user = await this.usersService.findById(rawId);
      const nombre = (user as any).nombre?.trim() || emailFallback;
      return { userId, nombre };
    } catch {
      return { userId, nombre: emailFallback };
    }
  }

  async aceptarCotizacionAdmin(
    cotizacionId: string,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    return this.cambiarEstadoManual(cotizacionId, 'aceptada', actor);
  }

  async rechazarCotizacionAdmin(
    cotizacionId: string,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    return this.cambiarEstadoManual(cotizacionId, 'rechazada', actor);
  }

  async marcarVencida(id: string, actor: EstadoActorJwt): Promise<Cotizacion> {
    return this.cambiarEstadoManual(id, 'vencida', actor);
  }

  /** Notas internas — solo usuarios AMES; no expuestas en API pública ni PDF. */
  async agregarNotaInterna(
    id: string,
    dto: CreateNotaInternaDto,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const texto = dto.texto.trim();
    if (!texto) {
      throw new BadRequestException('El texto de la nota no puede estar vacío');
    }
    const { userId, nombre } = await this.resolveActorNombre(actor);
    const now = new Date();
    const cotizacion = await this.cotizacionModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        {
          $push: {
            notasInternas: {
              texto,
              autorUserId: userId,
              autorNombre: nombre,
              createdAt: now,
            },
          },
        },
        { new: true },
      )
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(`Cotización con ID ${id} no encontrada`);
    }
    return cotizacion;
  }

  async actualizarNotaInterna(
    id: string,
    notaId: string,
    dto: UpdateNotaInternaDto,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    assertStrictObjectIdOrNotFound(notaId, 'Nota');
    const tenantId = this.tenantContext.getTenantId();
    const texto = dto.texto.trim();
    if (!texto) {
      throw new BadRequestException('El texto de la nota no puede estar vacío');
    }
    await this.assertNotaInternaAutor(id, notaId, actor, tenantId);
    const now = new Date();
    const cotizacion = await this.cotizacionModel
      .findOneAndUpdate(
        {
          _id: id,
          tenantId,
          'notasInternas._id': new Types.ObjectId(notaId),
        },
        {
          $set: {
            'notasInternas.$.texto': texto,
            'notasInternas.$.updatedAt': now,
          },
        },
        { new: true },
      )
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(`Nota con ID ${notaId} no encontrada`);
    }
    return cotizacion;
  }

  async eliminarNotaInterna(
    id: string,
    notaId: string,
    actor: EstadoActorJwt,
  ): Promise<Cotizacion> {
    assertStrictObjectIdOrNotFound(id, 'Cotización');
    assertStrictObjectIdOrNotFound(notaId, 'Nota');
    const tenantId = this.tenantContext.getTenantId();
    await this.assertNotaInternaAutor(id, notaId, actor, tenantId);
    const cotizacion = await this.cotizacionModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        { $pull: { notasInternas: { _id: new Types.ObjectId(notaId) } } },
        { new: true },
      )
      .populate('clienteId')
      .populate('items.servicioId')
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(`Cotización con ID ${id} no encontrada`);
    }
    return cotizacion;
  }

  private async assertNotaInternaAutor(
    cotizacionId: string,
    notaId: string,
    actor: EstadoActorJwt,
    tenantId: Types.ObjectId,
  ): Promise<void> {
    const cotizacion = await this.cotizacionModel
      .findOne({ _id: cotizacionId, tenantId })
      .select('notasInternas')
      .lean()
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(
        `Cotización con ID ${cotizacionId} no encontrada`,
      );
    }
    const nota = (cotizacion.notasInternas || []).find(
      (n: any) => String(n._id) === notaId,
    );
    if (!nota) {
      throw new NotFoundException(`Nota con ID ${notaId} no encontrada`);
    }
    const { userId } = await this.resolveActorNombre(actor);
    if (String(nota.autorUserId) !== String(userId)) {
      throw new ForbiddenException('Solo puede modificar sus propias notas');
    }
  }

  /**
   * Batch a vencida por fecha (Story 6.11 / FR-25).
   * Origen siempre `cron` + limpia actor AMES. No usa `cambiarEstadoManual` (eso es usuario/JWT).
   * Sin tenantId: cron global. Con tenantId: HTTP mark-expired (AD-2).
   * Manual single → `marcarVencida` / origen `usuario`.
   */
  async markExpiredQuotations(tenantId?: Types.ObjectId): Promise<number> {
    const now = new Date();
    const filter: Record<string, unknown> = {
      estado: 'vigente',
      sinVigencia: { $ne: true },
      fechaVencimiento: { $lt: now },
    };
    if (tenantId) {
      filter.tenantId = tenantId;
    }
    const result = await this.cotizacionModel.updateMany(filter, {
      $set: {
        estado: 'vencida',
        fechaEstadoVencida: now,
        estadoOrigen: 'cron',
        estadoOrigenAt: now,
      },
      $unset: {
        estadoCambiadoPorUserId: '',
        estadoCambiadoPorNombre: '',
      },
    });
    return result.modifiedCount || 0;
  }

  /** Cron diario 01:00 (TZ del proceso host). No SMTP (6.13). */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCronMarkExpired() {
    const count = await this.markExpiredQuotations();
    this.logger.log(`Cron: ${count} cotización(es) marcadas como vencidas`);
  }

  /**
   * Story 6.9 — carga por magic token (sin unset post-respuesta).
   * Token válido hasta magicTokenExpiresAt aunque ya esté aceptada/rechazada.
   */
  async findOneByMagicTokenRaw(token: string): Promise<CotizacionDocument> {
    if (!token?.trim()) {
      throw new NotFoundException('Enlace inválido');
    }
    const cotizacion = await this.cotizacionModel
      .findOne({ magicToken: token.trim() })
      .exec();

    if (!cotizacion) {
      throw new NotFoundException('Enlace inválido');
    }

    if (
      cotizacion.magicTokenExpiresAt &&
      cotizacion.magicTokenExpiresAt < new Date()
    ) {
      throw new UnauthorizedException(
        'El enlace ha expirado (vigencia superada)',
      );
    }

    return cotizacion;
  }

  async findOneByMagicToken(
    token: string,
  ): Promise<PublicCotizacionResponseDto> {
    const cotizacion = await this.findOneByMagicTokenRaw(token);
    return this.toPublicDto(cotizacion);
  }

  async aceptarCotizacionByMagicToken(
    token: string,
  ): Promise<PublicCotizacionResponseDto> {
    return this.responderByMagicToken(token, 'aceptada');
  }

  async rechazarCotizacionByMagicToken(
    token: string,
  ): Promise<PublicCotizacionResponseDto> {
    return this.responderByMagicToken(token, 'rechazada');
  }

  private async responderByMagicToken(
    token: string,
    decision: 'aceptada' | 'rechazada',
  ): Promise<PublicCotizacionResponseDto> {
    const cotizacion = await this.findOneByMagicTokenRaw(token);
    const now = new Date();

    if (cotizacion.estado === decision) {
      return this.toPublicDto(cotizacion, { alreadyResponded: true });
    }

    if (cotizacion.estado === 'aceptada' || cotizacion.estado === 'rechazada') {
      throw new BadRequestException(
        `La cotización ya fue ${cotizacion.estado} y no admite otra respuesta`,
      );
    }

    if (cotizacion.estado === 'cancelada') {
      throw new BadRequestException(
        'No se puede responder una cotización cancelada',
      );
    }

    if (cotizacion.estado === 'vencida') {
      throw new BadRequestException(
        'No se puede responder una cotización vencida',
      );
    }
    if (
      !cotizacion.sinVigencia &&
      cotizacion.fechaVencimiento &&
      cotizacion.fechaVencimiento < now
    ) {
      throw new BadRequestException(
        'No se puede responder una cotización vencida',
      );
    }

    if (cotizacion.estado !== 'vigente') {
      throw new BadRequestException(
        `La cotización no puede ser ${decision === 'aceptada' ? 'aceptada' : 'rechazada'}. Estado actual: ${cotizacion.estado}`,
      );
    }

    const update: Record<string, unknown> = {
      estado: decision,
      estadoOrigen: 'magic_link',
      estadoOrigenAt: now,
    };
    if (decision === 'aceptada') {
      update.fechaAceptacion = now;
      update.fechaEstadoAceptada = now;
    } else {
      update.fechaRechazo = now;
      update.fechaEstadoRechazada = now;
    }

    const updated = await this.cotizacionModel
      .findOneAndUpdate(
        {
          magicToken: token.trim(),
          estado: 'vigente',
          $or: [{ sinVigencia: true }, { fechaVencimiento: { $gte: now } }],
        },
        {
          $set: update,
          $unset: {
            estadoCambiadoPorUserId: '',
            estadoCambiadoPorNombre: '',
          },
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      // Carrera / vigencia: re-leer y aplicar semántica idempotente o 400 claro.
      const again = await this.findOneByMagicTokenRaw(token);
      if (again.estado === decision) {
        return this.toPublicDto(again, { alreadyResponded: true });
      }
      if (again.estado === 'cancelada') {
        throw new BadRequestException(
          'No se puede responder una cotización cancelada',
        );
      }
      if (again.estado === 'vencida') {
        throw new BadRequestException(
          'No se puede responder una cotización vencida',
        );
      }
      if (
        !again.sinVigencia &&
        again.fechaVencimiento &&
        again.fechaVencimiento < now
      ) {
        throw new BadRequestException(
          'No se puede responder una cotización vencida',
        );
      }
      throw new BadRequestException(
        `La cotización no puede ser ${decision === 'aceptada' ? 'aceptada' : 'rechazada'}. Estado actual: ${again.estado}`,
      );
    }

    // Story 6.13 — notif interna solo tras mutación real (no idempotente / no manual).
    try {
      await this.notifyRespuestaMagicLink(updated, decision);
    } catch (err) {
      const safeMsg =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err && 'message' in err
            ? String((err as { message?: unknown }).message)
            : 'error de notificación interna';
      this.logger.error(
        `Notif interna magic_link falló (${(updated as any).folio}): ${safeMsg}`,
      );
    }

    return this.toPublicDto(updated);
  }

  /**
   * FR-37/38 — creador + correosNotificacion. Fallos SMTP no revierten estado.
   * Usa findByTenantId (ruta pública sin TenantContext).
   */
  private async notifyRespuestaMagicLink(
    cotizacion: Cotizacion | CotizacionDocument,
    decision: 'aceptada' | 'rechazada',
  ): Promise<void> {
    const c = cotizacion as any;
    const to = new Set<string>();

    const addRecipient = (raw: string) => {
      const email = raw.trim().toLowerCase();
      if (email && isEmail(email)) to.add(email);
    };

    const snapEmail =
      typeof c.creadoPorEmail === 'string' ? c.creadoPorEmail : '';
    if (snapEmail.trim()) {
      addRecipient(snapEmail);
    }
    // Fallback a email vivo si no hay snapshot válido en `to` (vacío o inválido).
    if (to.size === 0 && c.creadoPorUserId) {
      try {
        const user = await this.usersService.findById(
          String(c.creadoPorUserId),
        );
        const live =
          typeof (user as any)?.email === 'string'
            ? String((user as any).email)
            : '';
        if (live.trim()) addRecipient(live);
      } catch {
        // legacy / user borrado
      }
    }

    let fromOverride: string | undefined;
    try {
      const tid = c.tenantId;
      if (tid) {
        const cfg = await this.tenantConfigService.findByTenantId(
          tid instanceof Types.ObjectId ? tid : new Types.ObjectId(String(tid)),
        );
        const list = Array.isArray(cfg?.correosNotificacion)
          ? cfg.correosNotificacion
          : [];
        for (const e of list) {
          if (typeof e === 'string' && e.trim()) addRecipient(e);
        }
        const remitente = cfg?.emailRemitente?.trim();
        if (remitente) fromOverride = remitente;
      }
    } catch (cfgErr) {
      this.logger.warn(
        `No se pudo cargar correosNotificacion para ${c.folio}: ${cfgErr}`,
      );
    }

    const recipients = [...to];
    if (recipients.length === 0) {
      this.logger.warn(
        `Notif interna omitida (${c.folio}): sin creador ni correosNotificacion`,
      );
      return;
    }

    const parts = [c.nombreEmpresa, c.nombreContacto]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    const solicitanteLabel = parts.length
      ? parts.join(' / ')
      : 'Sin solicitante';

    const notifTenantId = c.tenantId;
    if (!notifTenantId) {
      this.logger.warn(
        `Notif interna omitida (${c.folio}): cotización sin tenantId`,
      );
      return;
    }

    await this.emailService.sendInternalDecisionNotification({
      tenantId: notifTenantId,
      to: recipients,
      folio: String(c.folio || ''),
      decision,
      solicitanteLabel,
      fromOverride,
    });
  }

  private async toPublicDto(
    cotizacion: Cotizacion | CotizacionDocument,
    opts?: { alreadyResponded?: boolean },
  ): Promise<PublicCotizacionResponseDto> {
    const c = cotizacion as any;

    const includeImages = c.incluirImagenesPdf === true;

    // items es type:[Object] → populate('items.servicioId') no hidrata.
    // Lookup live por ids (AD-22) solo si el PDF pedirá imágenes.
    const imagenMetaById = new Map<
      string,
      { imagenUrl?: string; tipo?: string }
    >();
    if (includeImages && Array.isArray(c.items) && c.items.length) {
      try {
        const tid = c.tenantId;
        const tenantOid =
          tid instanceof Types.ObjectId
            ? tid
            : tid
              ? new Types.ObjectId(String(tid))
              : null;
        if (tenantOid) {
          const ids = c.items
            .map((it: any) => {
              const sid = it?.servicioId;
              if (sid == null) return '';
              if (typeof sid === 'object') {
                return String(sid._id ?? sid.id ?? '');
              }
              return String(sid);
            })
            .filter(Boolean);
          const rows = await this.serviciosService.findImagenMetaByIds(
            tenantOid,
            ids,
          );
          for (const row of rows) {
            imagenMetaById.set(String(row._id), {
              imagenUrl:
                typeof row.imagenUrl === 'string'
                  ? row.imagenUrl.trim() || undefined
                  : undefined,
              tipo: typeof row.tipo === 'string' ? row.tipo : undefined,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          `No se pudo resolver imagenUrl pública para ${c.folio}: ${err}`,
        );
      }
    }

    let branding: PublicCotizacionResponseDto['branding'];
    let bancarios: PublicCotizacionResponseDto['bancarios'];
    try {
      const tid = c.tenantId;
      if (tid) {
        const cfg = await this.tenantConfigService.findByTenantId(
          tid instanceof Types.ObjectId ? tid : new Types.ObjectId(String(tid)),
        );
        const b = cfg?.branding;
        const razon = b?.razonSocial?.trim();
        const logo = b?.logoUrl?.trim();
        if (razon || logo) {
          branding = {
            ...(razon ? { razonSocial: razon } : {}),
            ...(logo ? { logoUrl: logo } : {}),
          };
        }
        // Guest PDF sin JWT: bancarios solo si flag on + útiles.
        // Rellenar titular/domicilio/rfc/email desde branding como pdfHelper JWT.
        if (c.incluirDatosBancarios === true && hasBancariosUtiles(cfg?.bancarios)) {
          const raw = cfg!.bancarios || {};
          const titular =
            (typeof raw.titular === 'string' && raw.titular.trim()) ||
            razon ||
            undefined;
          const domicilio =
            (typeof raw.domicilio === 'string' && raw.domicilio.trim()) ||
            b?.domicilio?.trim() ||
            undefined;
          const rfc =
            (typeof raw.rfc === 'string' && raw.rfc.trim()) ||
            b?.rfc?.trim() ||
            undefined;
          const email =
            (typeof raw.email === 'string' && raw.email.trim()) ||
            b?.emailContacto?.trim() ||
            undefined;
          bancarios = {
            ...(raw.logoUrl ? { logoUrl: String(raw.logoUrl) } : {}),
            ...(titular ? { titular: String(titular) } : {}),
            ...(raw.banco ? { banco: String(raw.banco) } : {}),
            ...(raw.cuenta ? { cuenta: String(raw.cuenta) } : {}),
            ...(raw.clabe ? { clabe: String(raw.clabe) } : {}),
            ...(domicilio ? { domicilio: String(domicilio) } : {}),
            ...(rfc ? { rfc: String(rfc) } : {}),
            ...(email ? { email: String(email) } : {}),
          };
        }
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo cargar branding/bancarios públicos para ${c.folio}: ${err}`,
      );
    }

    const isOidLike = (v: unknown): boolean => {
      if (v instanceof Types.ObjectId) return true;
      if (!v || typeof v !== 'object') return false;
      const anyV = v as { _bsontype?: string; buffer?: unknown };
      return anyV._bsontype === 'ObjectId' || Buffer.isBuffer(anyV.buffer);
    };

    const items = Array.isArray(c.items)
      ? c.items.map((it: any) => {
          const sidVal = it.servicioId;
          const populated =
            sidVal && typeof sidVal === 'object' && !isOidLike(sidVal)
              ? sidVal
              : null;
          const sidRaw = populated
            ? populated._id ?? populated.id
            : sidVal;
          const servicioId =
            sidRaw != null && String(sidRaw).trim()
              ? String(sidRaw)
              : undefined;
          const meta = servicioId ? imagenMetaById.get(servicioId) : undefined;
          let tipoSnapshot: 'producto' | 'servicio' | undefined =
            it.tipoSnapshot === 'producto' || it.tipoSnapshot === 'servicio'
              ? (it.tipoSnapshot as 'producto' | 'servicio')
              : undefined;
          if (
            !tipoSnapshot &&
            (meta?.tipo === 'producto' || meta?.tipo === 'servicio')
          ) {
            tipoSnapshot = meta.tipo;
          } else if (
            !tipoSnapshot &&
            populated &&
            (populated.tipo === 'producto' || populated.tipo === 'servicio')
          ) {
            tipoSnapshot = populated.tipo;
          }
          const imagenUrl = includeImages
            ? meta?.imagenUrl ||
              (populated && typeof populated.imagenUrl === 'string'
                ? populated.imagenUrl.trim() || undefined
                : undefined)
            : undefined;

          return {
            nombre: String(it.nombreServicioSnapshot || 'Servicio'),
            ...(it.descripcionServicioSnapshot
              ? { descripcion: String(it.descripcionServicioSnapshot) }
              : {}),
            cantidad: Number(it.cantidad) || 0,
            precioUnitario: Number(it.precioUnitarioSnapshot) || 0,
            subtotal: Number(it.subtotal) || 0,
            ...(includeImages && servicioId ? { servicioId } : {}),
            ...(includeImages && tipoSnapshot ? { tipoSnapshot } : {}),
            ...(imagenUrl ? { imagenUrl } : {}),
          };
        })
      : [];
    const toIso = (d: unknown): string | undefined => {
      if (!d) return undefined;
      const date = d instanceof Date ? d : new Date(d as string);
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    };

    const now = new Date();
    let estadoPublico = String(c.estado || '');
    if (estadoPublico === 'vigente' && c.fechaVencimiento) {
      const fv =
        c.fechaVencimiento instanceof Date
          ? c.fechaVencimiento
          : new Date(c.fechaVencimiento as string);
      if (!Number.isNaN(fv.getTime()) && fv < now) {
        estadoPublico = 'vencida';
      }
    }

    const dto: PublicCotizacionResponseDto = {
      folio: String(c.folio || ''),
      estado: estadoPublico,
      total: Number(c.total) || 0,
      moneda: String(c.moneda || 'MXN'),
      fechaCreacion: toIso(c.fechaCreacion) || new Date(0).toISOString(),
      items,
    };
    const fvIso = toIso(c.fechaVencimiento);
    if (fvIso) dto.fechaVencimiento = fvIso;
    if (c.sinVigencia) dto.sinVigencia = true;

    const fa = toIso(c.fechaAceptacion);
    if (fa) dto.fechaAceptacion = fa;
    const fr = toIso(c.fechaRechazo);
    if (fr) dto.fechaRechazo = fr;
    if (c.nombreEmpresa) dto.nombreEmpresa = String(c.nombreEmpresa);
    if (c.nombreContacto) dto.nombreContacto = String(c.nombreContacto);
    if (c.telefonoContacto) dto.telefonoContacto = String(c.telefonoContacto);
    if (c.emailContacto) dto.emailContacto = String(c.emailContacto);
    if (c.cargoContacto) dto.cargoContacto = String(c.cargoContacto);

    // Flags PDF (fuente de verdad en Cotizacion; false/ausente → off en FE).
    if (typeof c.incluirDescripciones === 'boolean') {
      dto.incluirDescripciones = c.incluirDescripciones;
    }
    if (typeof c.incluirImagenesPdf === 'boolean') {
      dto.incluirImagenesPdf = c.incluirImagenesPdf;
    }
    if (typeof c.incluirDatosBancarios === 'boolean') {
      dto.incluirDatosBancarios = c.incluirDatosBancarios;
    }

    if (Array.isArray(c.plantillasSnapshot) && c.plantillasSnapshot.length) {
      const plantillas = c.plantillasSnapshot
        .map((p: any) => {
          const plantillaId = String(p.plantillaId || '').trim();
          if (!plantillaId) return null;
          return {
            plantillaId,
            nombreSnapshot: String(p.nombreSnapshot || ''),
            schemaVersion: Number(p.schemaVersion) || 1,
            secciones: Array.isArray(p.secciones) ? p.secciones : [],
          };
        })
        .filter(Boolean);
      if (plantillas.length) dto.plantillasSnapshot = plantillas;
    }

    if (branding) dto.branding = branding;
    if (bancarios) dto.bancarios = bancarios;
    if (opts?.alreadyResponded) dto.alreadyResponded = true;

    return dto;
  }
}

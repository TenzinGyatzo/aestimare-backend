import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isEmail } from 'class-validator';
import { Cotizacion } from '../schemas/cotizacion.schema';
import { TenantContextService } from '../../tenants/tenant-context.service';
import { TenantConfigService } from '../../tenants/tenant-config.service';
import { EmailsService } from '../../emails/emails.service';
import { UsersService } from '../../users/users.service';
import { TenantInactiveForOutboundError } from '../../emails/tenant-inactive-for-outbound.error';
import { assertStrictObjectIdOrNotFound } from '../../common/strict-object-id';
import {
  RecordatorioRecotizacion,
  RecordatorioRecotizacionDocument,
} from './schemas/recordatorio-recotizacion.schema';
import { UpsertRecordatorioDto } from './dto/upsert-recordatorio.dto';
import { RecetaRecordatorioDto } from './dto/receta-recordatorio.dto';
import { RecordatoriosDisparadosResponseDto } from './dto/recordatorio-disparado-item.dto';
import {
  formatRecetaResumen,
  resolveIdentidadDisparada,
} from './receta-resumen.util';
import {
  calcularFechaDisparoUtc,
  type RecetaInput,
} from './fecha-disparo.calc';
import { Cliente } from '../../clientes/schemas/cliente.schema';

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: number }).code === 11000
  );
}

@Injectable()
export class RecordatoriosService {
  private readonly logger = new Logger(RecordatoriosService.name);

  constructor(
    @InjectModel(RecordatorioRecotizacion.name)
    private readonly recordatorioModel: Model<RecordatorioRecotizacionDocument>,
    @InjectModel(Cotizacion.name)
    private readonly cotizacionModel: Model<Cotizacion>,
    @InjectModel(Cliente.name)
    private readonly clienteModel: Model<Cliente>,
    private readonly tenantContext: TenantContextService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly emailsService: EmailsService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * GET: documento del tenant para la COT, o NotFound si Ausente.
   * Shape: estado, receta, fechaDisparoUtc, everDisparado (Story 9.2 / AD-35+).
   */
  async findByCotizacion(cotizacionId: string): Promise<{
    estado: string;
    receta: RecordatorioRecotizacion['receta'];
    fechaDisparoUtc: Date;
    everDisparado: boolean;
  }> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const cotizacionOid = new Types.ObjectId(cotizacionId);

    const cotizacion = await this.cotizacionModel
      .findOne({ _id: cotizacionId, tenantId })
      .select('_id')
      .lean()
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(
        `Cotización con ID ${cotizacionId} no encontrada`,
      );
    }

    const doc = await this.recordatorioModel
      .findOne({ tenantId, cotizacionId: cotizacionOid })
      .select('estado receta fechaDisparoUtc everDisparado')
      .lean()
      .exec();
    if (!doc) {
      throw new NotFoundException(
        'No hay recordatorio para esta cotización',
      );
    }
    return {
      estado: doc.estado,
      receta: doc.receta,
      fechaDisparoUtc: doc.fechaDisparoUtc,
      everDisparado: doc.everDisparado === true,
    };
  }

  /**
   * PUT upsert: crea/edita receta → estado programado.
   * Rechaza si everDisparado o estado disparado|cerrado (FR15).
   * Escritura atómica + manejo E11000 en create concurrente.
   */
  async upsert(
    cotizacionId: string,
    dto: UpsertRecordatorioDto,
  ): Promise<RecordatorioRecotizacionDocument> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const cotizacionOid = new Types.ObjectId(cotizacionId);

    const cotizacion = await this.cotizacionModel
      .findOne({ _id: cotizacionId, tenantId })
      .select('_id fechaCreacion')
      .lean()
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(
        `Cotización con ID ${cotizacionId} no encontrada`,
      );
    }

    const zonaHoraria = await this.resolveZonaHoraria(tenantId);
    const calc = calcularFechaDisparoUtc({
      receta: this.toRecetaInput(dto.receta),
      zonaHoraria,
      fechaCreacion: (cotizacion as { fechaCreacion?: Date }).fechaCreacion,
    });
    if (calc.ok === false) {
      throw new BadRequestException(calc.message);
    }

    const recetaPersistida = this.toRecetaPersistida(
      dto.receta,
      calc.fechaDisparoUtc,
    );
    const update = {
      $set: {
        receta: recetaPersistida,
        fechaDisparoUtc: calc.fechaDisparoUtc,
        estado: 'programado' as const,
      },
    };
    const allowedFilter = {
      tenantId,
      cotizacionId: cotizacionOid,
      everDisparado: { $ne: true },
      estado: { $in: ['programado', 'cancelado'] },
    };

    const updated = await this.recordatorioModel
      .findOneAndUpdate(allowedFilter, update, { new: true })
      .exec();
    if (updated) {
      return updated;
    }

    const existing = await this.recordatorioModel
      .findOne({ tenantId, cotizacionId: cotizacionOid })
      .exec();
    if (existing) {
      this.assertPuedeReprogramar(existing);
      // Estado/flag permitían reprogramar pero el update no matcheó (carrera).
      throw new ConflictException(
        'No se pudo reprogramar el recordatorio; reintenta',
      );
    }

    try {
      const created = new this.recordatorioModel({
        tenantId,
        cotizacionId: cotizacionOid,
        estado: 'programado',
        receta: recetaPersistida,
        fechaDisparoUtc: calc.fechaDisparoUtc,
        everDisparado: false,
      });
      return await created.save();
    } catch (err) {
      if (!isDuplicateKeyError(err)) {
        throw err;
      }
      // Carrera: otro PUT creó el doc — reintentar update atómico.
      const retried = await this.recordatorioModel
        .findOneAndUpdate(allowedFilter, update, { new: true })
        .exec();
      if (retried) {
        return retried;
      }
      const raced = await this.recordatorioModel
        .findOne({ tenantId, cotizacionId: cotizacionOid })
        .exec();
      if (raced) {
        this.assertPuedeReprogramar(raced);
      }
      throw new ConflictException(
        'Esta cotización ya tiene un aviso.',
      );
    }
  }

  /**
   * DELETE: programado → cancelado. Solo cancela si está programado.
   */
  async cancelar(
    cotizacionId: string,
  ): Promise<RecordatorioRecotizacionDocument> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const cotizacionOid = new Types.ObjectId(cotizacionId);

    const cotizacion = await this.cotizacionModel
      .findOne({ _id: cotizacionId, tenantId })
      .select('_id')
      .lean()
      .exec();
    if (!cotizacion) {
      throw new NotFoundException(
        `Cotización con ID ${cotizacionId} no encontrada`,
      );
    }

    const cancelled = await this.recordatorioModel
      .findOneAndUpdate(
        { tenantId, cotizacionId: cotizacionOid, estado: 'programado' },
        { $set: { estado: 'cancelado' } },
        { new: true },
      )
      .exec();
    if (cancelled) {
      return cancelled;
    }

    const existing = await this.recordatorioModel
      .findOne({ tenantId, cotizacionId: cotizacionOid })
      .exec();
    if (!existing) {
      throw new NotFoundException(
        'No hay un aviso programado en esta cotización',
      );
    }
    throw new BadRequestException(
      'Solo se puede quitar un aviso que todavía no ha salido.',
    );
  }

  /** Doc raw del tenant para la COT, o null si ausente (Story 11.1). */
  async findRawByCotizacion(
    cotizacionId: string,
  ): Promise<RecordatorioRecotizacionDocument | null> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    return this.recordatorioModel
      .findOne({ tenantId, cotizacionId: new Types.ObjectId(cotizacionId) })
      .exec();
  }

  /**
   * Story 11.1 / AD-34 — Repetir cancela origen programado|disparado → cancelado.
   * No-op si ausente o ya cancelado|cerrado.
   */
  async cancelarPorRepetir(cotizacionId: string): Promise<boolean> {
    assertStrictObjectIdOrNotFound(cotizacionId, 'Cotización');
    const tenantId = this.tenantContext.getTenantId();
    const cotizacionOid = new Types.ObjectId(cotizacionId);

    const cancelled = await this.recordatorioModel
      .findOneAndUpdate(
        {
          tenantId,
          cotizacionId: cotizacionOid,
          estado: { $in: ['programado', 'disparado'] },
        },
        { $set: { estado: 'cancelado' } },
        { new: true },
      )
      .exec();
    return !!cancelled;
  }

  /**
   * Story 11.1 — valida receta de rearme antes de crear la COT (AC3 / AD-34).
   * Usa fechaCreacion de la COT nueva como ancla de aniversario (AD-29).
   */
  async assertRecetaRearmeValida(
    receta: RecetaRecordatorioDto,
    fechaCreacion: Date,
  ): Promise<void> {
    const tenantId = this.tenantContext.getTenantId();
    const zonaHoraria = await this.resolveZonaHoraria(tenantId);
    const calc = calcularFechaDisparoUtc({
      receta: this.toRecetaInput(receta),
      zonaHoraria,
      fechaCreacion,
    });
    if (calc.ok === false) {
      throw new BadRequestException(calc.message);
    }
  }

  /**
   * Story 11.1 — programar recordatorio en COT nueva (reutiliza upsert + fechaCreacion nueva).
   */
  async programarEnCotizacionNueva(
    cotizacionId: string,
    receta: RecetaRecordatorioDto,
  ): Promise<RecordatorioRecotizacionDocument> {
    return this.upsert(cotizacionId, { receta });
  }

  /**
   * Story 11.1 — resuelve receta para rearmar: body explícito o copia desfase origen.
   */
  async resolveRecetaRearme(
    cotizacionFuenteId: string,
    recetaRecordatorio?: RecetaRecordatorioDto,
  ): Promise<RecetaRecordatorioDto> {
    if (recetaRecordatorio) {
      return recetaRecordatorio;
    }

    const origin = await this.findRawByCotizacion(cotizacionFuenteId);
    if (!origin) {
      throw new BadRequestException(
        'No hay recordatorio en la cotización origen para rearmar',
      );
    }

    const { familia, preset } = origin.receta;
    if (familia === 'fecha_exacta') {
      throw new BadRequestException(
        'rearmar con fecha exacta requiere recetaRecordatorio en el body',
      );
    }
    if (!preset) {
      throw new BadRequestException('Receta origen inválida para rearmar');
    }
    return { familia, preset };
  }

  /**
   * GET disparados — bandeja tenant (Story 10.2 / AD-35, AD-37).
   * Proyección canónica para Dashboard y listado (10.3).
   */
  async listDisparados(): Promise<RecordatoriosDisparadosResponseDto> {
    const tenantId = this.tenantContext.getTenantId();
    const docs = await this.recordatorioModel
      .find({ tenantId, estado: 'disparado' })
      .sort({ fechaDisparoUtc: -1 })
      .lean()
      .exec();

    if (docs.length === 0) {
      return { items: [] };
    }

    const cotizacionIds = docs.map((d) => d.cotizacionId);
    const cotizaciones = await this.cotizacionModel
      .find({ _id: { $in: cotizacionIds }, tenantId })
      .select('folio clienteId nombreContacto')
      .lean()
      .exec();

    const cotById = new Map(
      cotizaciones.map((c) => [String(c._id), c]),
    );

    const clienteIds = cotizaciones
      .map((c) => c.clienteId)
      .filter((id): id is Types.ObjectId => !!id);
    const clientes =
      clienteIds.length > 0
        ? await this.clienteModel
            .find({ _id: { $in: clienteIds }, tenantId })
            .select('empresa')
            .lean()
            .exec()
        : [];
    const clienteById = new Map(
      clientes.map((c) => [String(c._id), c]),
    );

    const zonaHoraria = await this.resolveZonaHoraria(tenantId);

    const items = docs.map((doc) => {
      const cot = cotById.get(String(doc.cotizacionId));
      const cliente =
        cot?.clienteId != null
          ? clienteById.get(String(cot.clienteId))
          : undefined;
      return {
        recordatorioId: String(doc._id),
        cotizacionId: String(doc.cotizacionId),
        folio: typeof cot?.folio === 'string' ? cot.folio : '',
        identidad: resolveIdentidadDisparada(
          cliente?.empresa,
          cot?.nombreContacto,
        ),
        fechaDisparo: doc.fechaDisparoUtc,
        recetaResumen: formatRecetaResumen(
          doc.receta,
          doc.fechaDisparoUtc,
          zonaHoraria,
        ),
      };
    });

    return { items };
  }

  /**
   * POST cerrar — disparado → cerrado (Story 10.2 / FR8).
   * Transición atómica; sale del listado de disparados.
   */
  async cerrar(recordatorioId: string): Promise<{ estado: string }> {
    assertStrictObjectIdOrNotFound(recordatorioId, 'Recordatorio');
    const tenantId = this.tenantContext.getTenantId();

    const closed = await this.recordatorioModel
      .findOneAndUpdate(
        { _id: recordatorioId, tenantId, estado: 'disparado' },
        { $set: { estado: 'cerrado' } },
        { new: true },
      )
      .exec();

    if (closed) {
      return { estado: closed.estado };
    }

    const existing = await this.recordatorioModel
      .findOne({ _id: recordatorioId, tenantId })
      .select('estado')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException(
        `Recordatorio con ID ${recordatorioId} no encontrado`,
      );
    }
    throw new BadRequestException(
      'Solo se puede marcar como atendido un aviso que ya te llegó.',
    );
  }

  /**
   * Cron horario: programado → disparado + correo interno (Story 10.1 / AD-31–33).
   * Sin TenantContext ALS — tenantId explícito por documento.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleCronDispararRecordatorios(): Promise<void> {
    const now = new Date();
    let candidatos = 0;
    let disparados = 0;

    const cursor = this.recordatorioModel
      .find({
        estado: 'programado',
        fechaDisparoUtc: { $lte: now },
      })
      .cursor();

    for await (const doc of cursor) {
      candidatos++;
      const ok = await this.procesarDisparoRecordatorio(doc);
      if (ok) {
        disparados++;
      }
    }

    this.logger.log(
      `Cron recordatorios: ${candidatos} candidato(s), ${disparados} disparado(s)`,
    );
  }

  /** Invocable desde tests sin esperar el reloj del cron. */
  async procesarDisparoRecordatorio(
    recordatorio: RecordatorioRecotizacionDocument,
  ): Promise<boolean> {
    const now = new Date();
    const updated = await this.recordatorioModel
      .findOneAndUpdate(
        {
          _id: recordatorio._id,
          estado: 'programado',
          fechaDisparoUtc: { $lte: now },
        },
        { $set: { estado: 'disparado', everDisparado: true } },
        { new: true },
      )
      .exec();

    if (!updated) {
      return false;
    }

    try {
      await this.enviarCorreoDisparo(updated);
    } catch (err) {
      this.logger.error(
        `Correo disparo falló (recordatorio ${updated._id}, tenant ${updated.tenantId}): ${this.formatCronError(err)}`,
      );
    }
    return true;
  }

  private async enviarCorreoDisparo(
    recordatorio: RecordatorioRecotizacionDocument,
  ): Promise<void> {
    const cotizacion = await this.cotizacionModel
      .findOne({
        _id: recordatorio.cotizacionId,
        tenantId: recordatorio.tenantId,
      })
      .select('folio creadoPorEmail creadoPorUserId tenantId')
      .lean()
      .exec();

    const folio =
      cotizacion && typeof cotizacion.folio === 'string'
        ? cotizacion.folio.trim()
        : '';
    if (!folio) {
      this.logger.error(
        `Correo disparo omitido (recordatorio ${recordatorio._id}): cotización sin folio`,
      );
      return;
    }

    const { recipients, fromOverride } =
      await this.resolveDisparoRecipients(cotizacion);
    if (recipients.length === 0) {
      this.logger.warn(
        `Correo disparo omitido (${folio}): sin creador ni correosNotificacion`,
      );
      return;
    }

    await this.emailsService.sendReminderRecotizacionDisparo({
      tenantId: recordatorio.tenantId,
      to: recipients,
      folio,
      fromOverride,
    });

    this.logger.log(
      `Correo disparo enviado (${folio}, recordatorio ${recordatorio._id}, tenant ${recordatorio.tenantId})`,
    );
  }

  /**
   * Destinatarios internos — patrón notifyRespuestaMagicLink (Story 6.13).
   * Prohibido emailsPara/emailsCc de la COT (AD-33).
   */
  private async resolveDisparoRecipients(cotizacion: {
    creadoPorEmail?: string;
    creadoPorUserId?: Types.ObjectId;
    tenantId?: Types.ObjectId;
    folio?: string;
  }): Promise<{ recipients: string[]; fromOverride?: string }> {
    const to = new Set<string>();
    const addRecipient = (raw: string) => {
      const email = raw.trim().toLowerCase();
      if (email && isEmail(email)) {
        to.add(email);
      }
    };

    const snapEmail =
      typeof cotizacion.creadoPorEmail === 'string'
        ? cotizacion.creadoPorEmail
        : '';
    if (snapEmail.trim()) {
      addRecipient(snapEmail);
    }

    if (to.size === 0 && cotizacion.creadoPorUserId) {
      try {
        const user = await this.usersService.findById(
          String(cotizacion.creadoPorUserId),
        );
        const live =
          typeof (user as { email?: string })?.email === 'string'
            ? String((user as { email?: string }).email)
            : '';
        if (live.trim()) {
          addRecipient(live);
        }
      } catch {
        // legacy / user borrado
      }
    }

    let fromOverride: string | undefined;
    try {
      const tid = cotizacion.tenantId;
      if (tid) {
        const cfg = await this.tenantConfigService.findByTenantId(
          tid instanceof Types.ObjectId ? tid : new Types.ObjectId(String(tid)),
        );
        const list = Array.isArray(cfg?.correosNotificacion)
          ? cfg.correosNotificacion
          : [];
        for (const e of list) {
          if (typeof e === 'string' && e.trim()) {
            addRecipient(e);
          }
        }
        const remitente = cfg?.emailRemitente?.trim();
        if (remitente) {
          fromOverride = remitente;
        }
      }
    } catch (cfgErr) {
      const folioLabel = cotizacion.folio ?? 'sin-folio';
      this.logger.warn(
        `No se pudo cargar correosNotificacion para ${folioLabel}: ${cfgErr}`,
      );
    }

    return { recipients: [...to], fromOverride };
  }

  private formatCronError(err: unknown): string {
    if (err instanceof TenantInactiveForOutboundError) {
      return err.message;
    }
    if (err instanceof Error) {
      return err.message;
    }
    return String(err);
  }

  private assertPuedeReprogramar(doc: RecordatorioRecotizacionDocument): void {
    if (doc.everDisparado === true) {
      throw new ConflictException(
        'Ya te avisamos de esta cotización. No se puede programar otro aviso aquí.',
      );
    }
    if (doc.estado === 'disparado' || doc.estado === 'cerrado') {
      throw new ConflictException(
        'Este aviso ya no se puede cambiar. Lo encuentras en Pendientes de recotizar o ya lo marcaste como atendido.',
      );
    }
    if (doc.estado !== 'programado' && doc.estado !== 'cancelado') {
      throw new BadRequestException(
        'No se puede guardar este aviso en su estado actual.',
      );
    }
  }

  private async resolveZonaHoraria(
    tenantId: Types.ObjectId,
  ): Promise<string | undefined> {
    const cfg = await this.tenantConfigService.findByTenantId(tenantId);
    return cfg?.zonaHoraria;
  }

  private toRecetaInput(dto: RecetaRecordatorioDto): RecetaInput {
    return {
      familia: dto.familia,
      preset: dto.preset,
      fechaExacta: dto.fechaExacta,
    };
  }

  private toRecetaPersistida(
    dto: RecetaRecordatorioDto,
    fechaDisparoUtc: Date,
  ): {
    familia: RecetaRecordatorioDto['familia'];
    preset?: string;
    fechaExacta?: Date;
  } {
    if (dto.familia === 'fecha_exacta') {
      return {
        familia: dto.familia,
        fechaExacta: fechaDisparoUtc,
      };
    }
    return {
      familia: dto.familia,
      preset: dto.preset,
    };
  }
}

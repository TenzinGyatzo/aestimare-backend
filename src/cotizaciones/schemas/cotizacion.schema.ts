import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import type { SeccionPlantillaV1 } from '../../plantillas/schemas/plantilla.schema';
import {
  TipoItem,
  TIPO_ITEM_VALUES,
} from '../../servicios/enums/tipo-item.enum';

export type CotizacionDocument = Cotizacion & Document;

export class ItemCotizacion {
  @Prop({ type: Types.ObjectId, ref: 'Servicio', required: true })
  servicioId: Types.ObjectId;

  @Prop({ required: true })
  nombreServicioSnapshot: string;

  @Prop()
  descripcionServicioSnapshot?: string;

  @Prop({ required: true, min: 0 })
  precioUnitarioSnapshot: number;

  @Prop({ required: true, min: 1 })
  cantidad: number;

  @Prop({ required: true, min: 0 })
  subtotal: number;

  /** AD-22 / Story 6.4 — escrito solo por módulo cotizaciones desde Servicio. */
  @Prop({ required: true, enum: TIPO_ITEM_VALUES })
  tipoSnapshot: TipoItem;

  /** AD-22 — omitir si el catálogo no tiene código (no persistir ""). */
  @Prop()
  codigoSnapshot?: string;
}

/** Nota interna visible solo para usuarios AMES (no PDF / no vista pública). */
export class NotaInternaCotizacion {
  @Prop({ required: true, maxlength: 2000 })
  texto: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  autorUserId: Types.ObjectId;

  @Prop({ required: true })
  autorNombre: string;

  @Prop({ required: true, default: () => new Date() })
  createdAt: Date;

  @Prop({ required: false })
  updatedAt?: Date;
}

/** Snapshot de plantilla embebido (Story 6.5 / AD-6). Orden del array = orden PDF tras cuerpo. */
export class PlantillaSnapshot {
  @Prop({ type: Types.ObjectId, ref: 'Plantilla', required: true })
  plantillaId: Types.ObjectId;

  @Prop({ required: true })
  nombreSnapshot: string;

  @Prop({ required: true, default: 1 })
  schemaVersion: number;

  @Prop({ type: [Object], required: true, default: [] })
  secciones: SeccionPlantillaV1[];
}

@Schema({ timestamps: true })
export class Cotizacion {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, index: true })
  folio: string;

  @Prop({ type: Types.ObjectId, ref: 'Cliente', required: false })
  clienteId?: Types.ObjectId;

  @Prop()
  nombreEmpresa?: string;

  @Prop()
  nombreContacto?: string;

  @Prop()
  telefonoContacto?: string;

  @Prop({ required: false })
  emailContacto?: string;

  /** Snapshot del cargo del solicitante CRM (Story 6.16 — PDF). */
  @Prop({ required: false })
  cargoContacto?: string;

  /** Destinatarios Para (Story 6.6). Orden = chips. */
  @Prop({ type: [String], default: [] })
  emailsPara?: string[];

  /** Destinatarios CC (Story 6.6). Orden = chips. */
  @Prop({ type: [String], default: [] })
  emailsCc?: string[];

  @Prop({ type: [Object], required: true })
  items: ItemCotizacion[];

  @Prop({ required: true, min: 0 })
  total: number;

  @Prop({ default: 'MXN' })
  moneda: string;

  @Prop({ required: true })
  fechaCreacion: Date;

  /** Ausente/null cuando `sinVigencia` (Story 6.15). */
  @Prop({ required: false, type: Date })
  fechaVencimiento?: Date;

  /** Story 6.15 — cotización sin fecha de vencimiento (cron no la marca vencida). */
  @Prop({ default: false })
  sinVigencia?: boolean;

  @Prop({
    type: String,
    enum: ['vigente', 'vencida', 'aceptada', 'rechazada', 'cancelada'],
    default: 'vigente',
  })
  estado: string;

  @Prop()
  fechaAceptacion?: Date;

  @Prop()
  fechaRechazo?: Date;

  @Prop()
  fechaEstadoVigente?: Date;

  @Prop()
  fechaEstadoVencida?: Date;

  @Prop()
  fechaEstadoAceptada?: Date;

  @Prop()
  fechaEstadoRechazada?: Date;

  @Prop()
  fechaEstadoCancelada?: Date;

  @Prop()
  pdfUrl?: string;

  @Prop({ index: true, unique: true, sparse: true })
  magicToken?: string;

  @Prop()
  magicTokenExpiresAt?: Date;

  /**
   * Origen del último cambio de estado (Story 6.9 write / 6.10 UI).
   * magic_link | usuario | cron
   */
  @Prop({
    type: String,
    enum: ['magic_link', 'usuario', 'cron'],
    required: false,
  })
  estadoOrigen?: string;

  @Prop()
  estadoOrigenAt?: Date;

  /** Actor AMES del último cambio manual (Story 6.10). Ausente en magic_link/cron. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  estadoCambiadoPorUserId?: Types.ObjectId;

  /** Snapshot de nombre al momento del cambio (microcopy “Marcado por {nombre}”). */
  @Prop({ required: false })
  estadoCambiadoPorNombre?: string;

  /** Usuario AMES que creó la cotización (create/repetir). Story 6.13 / FR-37. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  creadoPorUserId?: Types.ObjectId;

  /** Snapshot de email del creador al momento del alta (notif interna si el user cambia). */
  @Prop({ required: false })
  creadoPorEmail?: string;

  /**
   * Sin default mongoose: ausente ≠ false (fallback create/repetir = tenant ?? true).
   * El service siempre escribe boolean explícito al crear.
   */
  @Prop({ type: Boolean, required: false })
  incluirDatosBancarios?: boolean;

  /** Si false, el PDF omite la columna de descripción. */
  @Prop({ type: Boolean, required: false })
  incluirDescripciones?: boolean;

  /** Si true, el PDF puede incluir imágenes de producto. */
  @Prop({ type: Boolean, required: false })
  incluirImagenesPdf?: boolean;

  /**
   * Sin default mongoose: ausente ≠ false (lectura = IVA activo).
   * El service escribe boolean explícito al crear y al repetir.
   * Solo false apaga el desglose de IVA al 16 %.
   */
  @Prop({ type: Boolean, required: false })
  agregarIva?: boolean;

  /** Plantillas aplicadas (deep copy). Vacío/omitido = sin páginas de plantilla. */
  @Prop({ type: [Object], default: [] })
  plantillasSnapshot?: PlantillaSnapshot[];

  /** Notas internas del equipo AMES. No se copian al repetir ni se exponen al cliente. */
  @Prop({ type: [Object], default: [] })
  notasInternas?: NotaInternaCotizacion[];
}

export const CotizacionSchema = SchemaFactory.createForClass(Cotizacion);

CotizacionSchema.index({ tenantId: 1, folio: 1 }, { unique: true });
CotizacionSchema.index({ tenantId: 1, fechaCreacion: -1 });
CotizacionSchema.index({ tenantId: 1, estado: 1 });
CotizacionSchema.index({ clienteId: 1 });
CotizacionSchema.index({ estado: 1 });
CotizacionSchema.index({ fechaCreacion: 1 });
CotizacionSchema.index({ fechaVencimiento: 1 });
CotizacionSchema.index({ 'items.servicioId': 1 });
CotizacionSchema.index({ estado: 1, fechaVencimiento: 1 });
CotizacionSchema.index({ magicToken: 1 }, { unique: true, sparse: true });

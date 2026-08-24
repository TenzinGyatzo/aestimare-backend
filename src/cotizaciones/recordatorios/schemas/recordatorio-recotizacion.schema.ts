import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  ESTADOS_RECORDATORIO,
  FAMILIAS_RECETA,
  type EstadoRecordatorio,
  type FamiliaReceta,
} from '../fecha-disparo.calc';

export type RecordatorioRecotizacionDocument = RecordatorioRecotizacion &
  Document;

/** Shape canónico de receta persistida (AD-28). */
@Schema({ _id: false })
export class RecetaRecordatorio {
  @Prop({ required: true, enum: FAMILIAS_RECETA })
  familia: FamiliaReceta;

  @Prop()
  preset?: string;

  /** Solo familia fecha_exacta — día elegido (Date UTC start-of-day derivado). */
  @Prop({ type: Date })
  fechaExacta?: Date;
}

export const RecetaRecordatorioSchema =
  SchemaFactory.createForClass(RecetaRecordatorio);

/**
 * Recordatorio opt-in de recotización (AD-27).
 * Máximo un doc por COT: unique (tenantId, cotizacionId).
 */
@Schema({ timestamps: true, collection: 'recordatorios_recotizacion' })
export class RecordatorioRecotizacion {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Cotizacion',
    required: true,
    index: true,
  })
  cotizacionId: Types.ObjectId;

  @Prop({
    required: true,
    enum: ESTADOS_RECORDATORIO,
    default: 'programado',
  })
  estado: EstadoRecordatorio;

  @Prop({ type: RecetaRecordatorioSchema, required: true })
  receta: RecetaRecordatorio;

  /**
   * Fecha de disparo derivada (UTC). Cliente no es fuente de verdad (AD-28).
   * Convención: start-of-calendar-day en Reloj del tenant → UTC.
   */
  @Prop({ type: Date, required: true })
  fechaDisparoUtc: Date;

  /**
   * true tras transición a disparado (Epic 10). En 9.1 bloquea PUT si true (FR15).
   */
  @Prop({ type: Boolean, default: false })
  everDisparado: boolean;
}

export const RecordatorioRecotizacionSchema = SchemaFactory.createForClass(
  RecordatorioRecotizacion,
);

RecordatorioRecotizacionSchema.index(
  { tenantId: 1, cotizacionId: 1 },
  { unique: true },
);
/** Índice cron (AD-31 / AD-32) — query programado + fechaDisparoUtc. */
RecordatorioRecotizacionSchema.index({ estado: 1, fechaDisparoUtc: 1 });

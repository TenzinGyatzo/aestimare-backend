import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit-action-type';

export type AuditEventDocument = AuditEvent & Document;

@Schema({ _id: false })
export class AuditActorSnapshot {
  @Prop()
  email?: string;

  @Prop()
  nombre?: string;

  @Prop()
  rol?: string;
}

@Schema({
  collection: 'audit_events',
  timestamps: false,
})
export class AuditEvent {
  /** Ausente en eventos de plataforma (login admin_sistema, email desconocido). */
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: false, index: true })
  tenantId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  actorId?: Types.ObjectId;

  @Prop({ type: AuditActorSnapshot, default: {} })
  actorSnapshot: AuditActorSnapshot;

  @Prop({ required: true, index: true })
  timestamp: Date;

  @Prop({
    required: true,
    enum: Object.values(AuditActionType),
    index: true,
  })
  actionType: string;

  @Prop({ required: true, enum: Object.values(AuditResourceType) })
  resourceType: string;

  @Prop()
  resourceId?: string;

  @Prop({ required: true, enum: Object.values(AuditResult) })
  result: string;

  @Prop({ type: Object })
  payload?: Record<string, unknown>;

  @Prop()
  ip?: string;

  @Prop()
  userAgent?: string;
}

export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);

AuditEventSchema.index({ tenantId: 1, timestamp: -1 });
AuditEventSchema.index({ tenantId: 1, actionType: 1, timestamp: -1 });
AuditEventSchema.index({ tenantId: 1, actorId: 1, timestamp: -1 });
AuditEventSchema.index({ timestamp: -1 });

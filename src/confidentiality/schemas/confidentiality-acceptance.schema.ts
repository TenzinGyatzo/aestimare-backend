import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConfidentialityAcceptanceDocument = ConfidentialityAcceptance &
  Document;

@Schema({
  collection: 'confidentiality_acceptances',
  timestamps: false,
})
export class ConfidentialityAcceptance {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: false, index: true })
  tenantId?: Types.ObjectId;

  @Prop({ required: true })
  acceptedAt: Date;

  @Prop()
  ip?: string;

  @Prop({ required: true })
  version: string;

  @Prop({ required: true })
  agreementText: string;

  @Prop({ required: true, default: 'UI' })
  source: string;
}

export const ConfidentialityAcceptanceSchema = SchemaFactory.createForClass(
  ConfidentialityAcceptance,
);

ConfidentialityAcceptanceSchema.index(
  { userId: 1, version: 1 },
  { unique: true },
);

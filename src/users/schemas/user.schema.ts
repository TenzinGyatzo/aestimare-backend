import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Roles } from '../../auth/enums/roles.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  email: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true })
  nombre: string;

  @Prop({ required: true, enum: Roles, default: Roles.ADMIN_SISTEMA })
  rol: string;

  /** Opcional: admin_sistema sin tenant fijo; operativo y admin_tenant tienen uno (AD-11). */
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: false, index: true })
  tenantId?: Types.ObjectId;

  @Prop({ default: true })
  activo: boolean;

  /** Generación de credenciales. Incrementa solo en suspensión (true→false). */
  @Prop({ type: Number, default: 0 })
  credentialsVersion: number;
}

export const UserSchema = SchemaFactory.createForClass(User);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type TenantConfigDocument = TenantConfig & Document;

@Schema({ _id: false })
export class TenantBranding {
  /** Path público relativo, p.ej. `/uploads/tenant-logos/{tenantId}.png` */
  @Prop()
  logoUrl?: string;

  @Prop()
  razonSocial?: string;

  @Prop()
  rfc?: string;

  @Prop()
  domicilio?: string;

  @Prop()
  telefono?: string;

  @Prop()
  emailContacto?: string;

  @Prop()
  sitioWeb?: string;
}

export const TenantBrandingSchema =
  SchemaFactory.createForClass(TenantBranding);

@Schema({ _id: false })
export class TenantBancarios {
  /** Path público, p.ej. `/uploads/tenant-bank-logos/{tenantId}.png` — ≠ branding.logoUrl */
  @Prop()
  logoUrl?: string;

  @Prop()
  titular?: string;

  @Prop()
  banco?: string;

  @Prop()
  cuenta?: string;

  @Prop()
  clabe?: string;

  @Prop()
  domicilio?: string;

  @Prop()
  rfc?: string;

  @Prop()
  email?: string;
}

export const TenantBancariosSchema =
  SchemaFactory.createForClass(TenantBancarios);

/**
 * Configuración por tenant.
 * Branding: 2.2. Remitente/notificaciones: 2.3. Vigencia/bancarios: 2.4. Logo banco: 2.5.
 */
@Schema({ timestamps: true, collection: 'tenant_configs' })
export class TenantConfig {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, unique: true })
  tenantId: Types.ObjectId;

  @Prop({ type: TenantBrandingSchema, default: () => ({}) })
  branding?: TenantBranding;

  /** From lógico de cotizaciones (≠ branding.emailContacto). */
  @Prop()
  emailRemitente?: string;

  /** Correos adicionales para notificaciones internas (FR-37/38 → Epic 6). */
  @Prop({ type: [String], default: [] })
  correosNotificacion?: string[];

  /** Cuenta Gmail SMTP auth (FR-55 / Story 3.2). ≠ emailRemitente / branding.emailContacto. */
  @Prop()
  emailUser?: string;

  /**
   * App password cifrada AES-256-GCM (base64 iv‖tag‖ciphertext).
   * Nunca plaintext; select:false + omitir en toResponse (AD-12 / NFR-8).
   */
  @Prop({ select: false })
  emailSecretEnc?: string;

  /** Días de vigencia default al crear cotización sin fecha explícita (1–365). */
  @Prop({ default: 30 })
  vigenciaDefaultDias?: number;

  /** Contenido de página bancaria PDF (toggle por cotización, no global). */
  @Prop({ type: TenantBancariosSchema, default: () => ({}) })
  bancarios?: TenantBancarios;

  /**
   * Defaults opcionales de display al crear cotización nueva sin elegir explícito
   * (ausente ≠ false: el cotizador aplica `tenantDefault ?? true`).
   */
  @Prop({ type: Boolean, required: false, default: undefined })
  defaultIncluirDatosBancarios?: boolean | null;

  @Prop({ type: Boolean, required: false, default: undefined })
  defaultIncluirDescripciones?: boolean | null;

  @Prop({ type: Boolean, required: false, default: undefined })
  defaultIncluirImagenesPdf?: boolean | null;

  @Prop({ type: Boolean, required: false, default: undefined })
  defaultUsarVigencia?: boolean | null;

  /**
   * Zona IANA del Reloj del tenant (AD-30 / Story 9.1).
   * Ausente → backfill / fallback de servicio: America/Mexico_City.
   */
  @Prop()
  zonaHoraria?: string;
}

export const TenantConfigSchema = SchemaFactory.createForClass(TenantConfig);

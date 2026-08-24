import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TenantBrandingDto {
  @ApiPropertyOptional()
  logoUrl?: string;

  @ApiPropertyOptional()
  razonSocial?: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  domicilio?: string;

  @ApiPropertyOptional()
  telefono?: string;

  @ApiPropertyOptional()
  emailContacto?: string;

  @ApiPropertyOptional()
  sitioWeb?: string;
}

export class TenantBancariosDto {
  @ApiPropertyOptional({
    description: 'Logo del banco (Story 2.5); distinto de branding.logoUrl',
  })
  logoUrl?: string;

  @ApiPropertyOptional()
  titular?: string;

  @ApiPropertyOptional()
  banco?: string;

  @ApiPropertyOptional()
  cuenta?: string;

  @ApiPropertyOptional()
  clabe?: string;

  @ApiPropertyOptional()
  domicilio?: string;

  @ApiPropertyOptional()
  rfc?: string;

  @ApiPropertyOptional()
  email?: string;
}

export class TenantConfigResponseDto {
  @ApiProperty()
  _id: string;

  @ApiProperty({ description: 'Tenant efectivo (AD-2 / X-Tenant-Id)' })
  tenantId: string;

  @ApiPropertyOptional({
    description:
      'Nombre del tenant efectivo (join liviano). Para label UI sin GET /tenants (AD-16).',
  })
  tenantNombre?: string;

  @ApiPropertyOptional({
    description:
      'Clave del tenant efectivo (join liviano). Para label UI sin GET /tenants (AD-16).',
  })
  tenantClave?: string;

  @ApiPropertyOptional({ type: TenantBrandingDto })
  branding?: TenantBrandingDto;

  @ApiPropertyOptional({
    description: 'Remitente From de cotizaciones (Story 2.3)',
  })
  emailRemitente?: string;

  @ApiPropertyOptional({
    description: 'Correos adicionales de notificación (puede ser [])',
    type: [String],
  })
  correosNotificacion?: string[];

  @ApiPropertyOptional({
    description: 'Cuenta Gmail SMTP configurada (FR-55). Nunca el secret.',
  })
  emailUser?: string;

  @ApiProperty({
    description:
      'true si hay app password cifrada (emailSecretEnc). UI: estado configurado / rotar.',
  })
  emailCredentialsConfigured: boolean;

  @ApiPropertyOptional({
    description: 'Días de vigencia default al crear cotización (Story 2.4)',
  })
  vigenciaDefaultDias?: number;

  @ApiPropertyOptional({
    type: TenantBancariosDto,
    description:
      'Contenido bancario para PDF (Story 2.4) + logoUrl del banco (Story 2.5)',
  })
  bancarios?: TenantBancariosDto;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir datos bancarios" al crear cotización nueva. Ausente = sin configurar (el cotizador usa true).',
  })
  defaultIncluirDatosBancarios?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir descripciones" al crear cotización nueva. Ausente = sin configurar (el cotizador usa true).',
  })
  defaultIncluirDescripciones?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir imágenes de producto en PDF" al crear cotización nueva. Ausente = sin configurar (el cotizador usa true).',
  })
  defaultIncluirImagenesPdf?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "usar vigencia" al crear cotización nueva. Ausente = sin configurar (el cotizador usa true → sinVigencia false).',
  })
  defaultUsarVigencia?: boolean | null;

  @ApiPropertyOptional({
    description:
      'Zona IANA del Reloj del tenant (AD-30). Ausente hasta backfill; service usa America/Mexico_City.',
    example: 'America/Mexico_City',
  })
  zonaHoraria?: string;

  @ApiPropertyOptional()
  createdAt?: string;

  @ApiPropertyOptional()
  updatedAt?: string;
}

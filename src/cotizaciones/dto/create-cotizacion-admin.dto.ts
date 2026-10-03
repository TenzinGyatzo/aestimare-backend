import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsMongoId,
  IsEmail,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  ValidateNested,
  IsOptional,
  IsString,
  IsDateString,
  IsBoolean,
  IsInt,
  IsIn,
  IsNumber,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { SeccionPlantillaDto } from '../../plantillas/dto/seccion-plantilla.dto';

function emptyToUndef({ value }: { value: unknown }) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length ? t : undefined;
}

/** Trim + lowercase + dedupe; null/omit → undefined (service trata como []). */
function normalizeEmailsDto({ value }: { value: unknown }) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return value;
  if (value.some((item) => typeof item !== 'string')) return value;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value as string[]) {
    const e = item.trim().toLowerCase();
    if (!e || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

/** '' / null → undefined so @Type(() => Number) does not coerce to 0. */
function emptyNumberToUndef({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return undefined;
  return value;
}

/** null → undefined; keep '' so buildItems can omit descripción. */
function nullDescToUndef({ value }: { value: unknown }) {
  if (value === null) return undefined;
  return value;
}

export class CreateItemCotizacionAdminDto {
  @ApiProperty({
    description: 'ID del servicio',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  servicioId: string;

  @ApiProperty({
    description: 'Cantidad del servicio',
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  cantidad: number;

  @ApiPropertyOptional({
    description:
      'Override de nombre para el snapshot de esta cotización (Story 6.4)',
    example: 'Examen médico modificado',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @ApiPropertyOptional({
    description:
      'Override de descripción para el snapshot. Si se envía string vacío, el ítem queda sin descripción.',
    example: 'Descripción ajustada para esta propuesta',
  })
  @IsOptional()
  @Transform(nullDescToUndef)
  @IsString()
  @MaxLength(2000)
  descripcion?: string;

  @ApiPropertyOptional({
    description:
      'Override de precio unitario (MXN) para el snapshot de esta cotización',
    example: 1500,
    minimum: 0,
  })
  @IsOptional()
  @Transform(emptyNumberToUndef)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  precioUnitario?: number;
}

/** Ítem de plantilla en create admin (Story 6.5). */
export class CreatePlantillaCotizacionDto {
  @ApiProperty({
    description: 'ID de la plantilla maestra (activa del tenant)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsMongoId()
  plantillaId: string;

  @ApiPropertyOptional({
    description: 'Nombre para el snapshot (default = nombre de la maestra)',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  @MaxLength(200)
  nombre?: string;

  @ApiPropertyOptional({
    description:
      'Secciones personalizadas (snapshot). Si se omite, BE copia la maestra activa.',
    type: [SeccionPlantillaDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SeccionPlantillaDto)
  secciones?: SeccionPlantillaDto[];
}

/**
 * Create flexible (Story 6.2 / FR-20–21): identidad CRM/guest opcional.
 * FE principal: POST /cotizaciones/admin
 */
export class CreateCotizacionAdminDto {
  @ApiPropertyOptional({
    description: 'ID del cliente CRM (opcional)',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsMongoId()
  clienteId?: string;

  @ApiPropertyOptional({
    description: 'Nombre de la empresa (guest o display)',
    example: 'Empresa ABC S.A. de C.V.',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  nombreEmpresa?: string;

  @ApiPropertyOptional({
    description:
      'Nombre del solicitante (snapshot). Obligatorio solo si se designa solicitante (p. ej. con correo/teléfono)',
    example: 'Juan Pérez',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  nombreContacto?: string;

  @ApiPropertyOptional({
    description: 'Correo electrónico del contacto',
    example: 'contacto@empresa.com',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsEmail()
  emailContacto?: string;

  @ApiPropertyOptional({
    description: 'Teléfono del contacto',
    example: '+52 662 123 4567',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  telefonoContacto?: string;

  @ApiPropertyOptional({
    description:
      'Cargo del solicitante (snapshot CRM). Story 6.16 — PDF fila Contacto/Cargo',
    example: 'Gerente de Compras',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsString()
  cargoContacto?: string;

  @ApiProperty({
    description: 'Items de la cotización',
    type: [CreateItemCotizacionAdminDto],
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateItemCotizacionAdminDto)
  items: CreateItemCotizacionAdminDto[];

  @ApiPropertyOptional({
    description: 'Moneda de la cotización (solo MXN)',
    example: 'MXN',
    default: 'MXN',
  })
  @IsOptional()
  @Transform(emptyToUndef)
  @IsIn(['MXN'])
  moneda?: string;

  @ApiPropertyOptional({
    description:
      'Fecha de vencimiento (ISO). No enviar si sinVigencia=true (BE responde 400).',
    example: '2024-12-31T23:59:59.000Z',
  })
  @ValidateIf((o: CreateCotizacionAdminDto) => o.sinVigencia !== true)
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional({
    description:
      'Si true, la cotización no tiene vigencia (no cron a vencida; PDF Vencimiento —). Mutuamente excluyente con fechaVencimiento. Omitido → `!(tenant.defaultUsarVigencia ?? true)`. Story 6.15',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  sinVigencia?: boolean;

  @ApiPropertyOptional({
    description:
      'Indica si se debe enviar un correo electrónico con la cotización al cliente',
    example: true,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  enviarEmail?: boolean;

  @ApiPropertyOptional({
    description:
      'Destinatarios Para (orden = chips). Vacío/omitido = ninguno. Story 6.6',
    type: [String],
    example: ['contacto@empresa.com'],
  })
  @IsOptional()
  @Transform(normalizeEmailsDto)
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true, message: 'Cada correo en Para debe ser válido' })
  emailsPara?: string[];

  @ApiPropertyOptional({
    description:
      'Destinatarios CC (orden = chips). Vacío/omitido = ninguno. Story 6.6',
    type: [String],
    example: ['cc@empresa.com'],
  })
  @IsOptional()
  @Transform(normalizeEmailsDto)
  @IsArray()
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true, message: 'Cada correo en CC debe ser válido' })
  emailsCc?: string[];

  @ApiPropertyOptional({
    description:
      'Incluir datos bancarios. Omitido → preferencia tenant `defaultIncluirDatosBancarios` ?? true. La indisponibilidad de bancarios no fuerza false al persistir.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  incluirDatosBancarios?: boolean;

  @ApiPropertyOptional({
    description:
      'Incluir descripciones. Omitido → preferencia tenant `defaultIncluirDescripciones` ?? true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  incluirDescripciones?: boolean;

  @ApiPropertyOptional({
    description:
      'Incluir imágenes de producto en el PDF. Omitido → preferencia tenant `defaultIncluirImagenesPdf` ?? true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  incluirImagenesPdf?: boolean;

  @ApiPropertyOptional({
    description:
      'Desglosar IVA al 16 %. Boolean explícito del body gana; omitido → default del tenant `defaultAgregarIva` ?? true. Cualquier otro tipo → 400.',
    example: true,
  })
  @Transform(({ obj, key, value }) =>
    key && obj && Object.prototype.hasOwnProperty.call(obj, key)
      ? (obj as Record<string, unknown>)[key]
      : value,
  )
  @ValidateIf((_, v) => v !== undefined)
  @IsBoolean()
  agregarIva?: boolean;

  @ApiPropertyOptional({
    description:
      'Plantillas a aplicar (orden = páginas tras el cuerpo). Vacío/omitido = ninguna. Story 6.5',
    type: [CreatePlantillaCotizacionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique((o: CreatePlantillaCotizacionDto) => o.plantillaId)
  @ValidateNested({ each: true })
  @Type(() => CreatePlantillaCotizacionDto)
  plantillas?: CreatePlantillaCotizacionDto[];
}

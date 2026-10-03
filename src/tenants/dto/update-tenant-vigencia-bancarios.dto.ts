import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Trim; `null` → '' para permitir limpiar el campo en PATCH. */
function nullOrTrim({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return value === null ? '' : value;
  }
  if (typeof value !== 'string') return value;
  return value.trim();
}

export class UpdateTenantBancariosDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @MaxLength(200)
  titular?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @MaxLength(120)
  banco?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @MaxLength(40)
  cuenta?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @MaxLength(20)
  clabe?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @IsString()
  @MaxLength(500)
  domicilio?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null) return '';
    if (typeof value !== 'string') return value;
    return value.trim().toUpperCase();
  })
  @IsString()
  @MaxLength(20)
  rfc?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(nullOrTrim)
  @ValidateIf((_, v) => v !== undefined && v !== null && v !== '')
  @IsEmail({}, { message: 'bancarios.email debe ser un correo válido' })
  @MaxLength(120)
  email?: string | null;
}

export class UpdateTenantVigenciaBancariosDto {
  @ApiPropertyOptional({
    description: 'Días de vigencia default (1–365). Omitido = no tocar.',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'vigenciaDefaultDias debe ser un entero' })
  @Min(1)
  @Max(365)
  vigenciaDefaultDias?: number;

  @ApiPropertyOptional({
    type: UpdateTenantBancariosDto,
    description:
      'Datos bancarios parciales. String vacío/null limpia subcampo. Omitido = no tocar.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateTenantBancariosDto)
  bancarios?: UpdateTenantBancariosDto | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir datos bancarios" al crear cotización nueva. true/false configura; null limpia (vuelve a sin configurar → cotizador usa true); omitido = no tocar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'defaultIncluirDatosBancarios debe ser boolean o null' })
  defaultIncluirDatosBancarios?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir descripciones" al crear cotización nueva. true/false configura; null limpia (sin configurar → cotizador usa true); omitido = no tocar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'defaultIncluirDescripciones debe ser boolean o null' })
  defaultIncluirDescripciones?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "incluir imágenes de producto en PDF" al crear cotización nueva. true/false configura; null limpia (sin configurar → cotizador usa true); omitido = no tocar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'defaultIncluirImagenesPdf debe ser boolean o null' })
  defaultIncluirImagenesPdf?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "usar vigencia" al crear cotización nueva. true/false configura; null limpia (sin configurar → cotizador usa true → sinVigencia false); omitido = no tocar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'defaultUsarVigencia debe ser boolean o null' })
  defaultUsarVigencia?: boolean | null;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Default "Agregar IVA" al crear cotización nueva. true/false configura; null limpia (sin configurar → cotizador usa true); omitido = no tocar.',
  })
  @IsOptional()
  @IsBoolean({ message: 'defaultAgregarIva debe ser boolean o null' })
  defaultAgregarIva?: boolean | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { parseOptionalQueryBoolean } from '../../common/parse-optional-query-boolean';
import { RecetaRecordatorioDto } from '../recordatorios/dto/receta-recordatorio.dto';

export const MODOS_PRECIOS_REPETIR = ['originales', 'actualizados'] as const;
export type ModoPreciosRepetir = (typeof MODOS_PRECIOS_REPETIR)[number];

export class SustitucionServicioDto {
  @ApiProperty({ description: 'servicioId del ítem fuente a reemplazar' })
  @IsMongoId()
  fromServicioId: string;

  @ApiProperty({ description: 'servicioId activo del catálogo (mismo tenant)' })
  @IsMongoId()
  toServicioId: string;
}

/** Body para repetir cotización (Story 6.12 / FR-35 / FR-36). */
export class RepetirCotizacionDto {
  @ApiProperty({
    enum: MODOS_PRECIOS_REPETIR,
    description:
      'originales = snapshot de la fuente; actualizados = catálogo vigente',
  })
  @IsString()
  @IsIn([...MODOS_PRECIOS_REPETIR])
  modoPrecios: ModoPreciosRepetir;

  @ApiPropertyOptional({
    type: [String],
    description: 'servicioId de ítems a excluir (tras warning o elección)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsMongoId({ each: true })
  omitirServicioIds?: string[];

  @ApiPropertyOptional({
    type: [SustitucionServicioDto],
    description:
      'Reemplazos de servicio (cantidad se conserva del ítem origen)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SustitucionServicioDto)
  sustituciones?: SustitucionServicioDto[];

  @ApiPropertyOptional({
    description:
      'Si se omite, vigencia recalculada con vigenciaDefaultDias del tenant. No enviar si sinVigencia=true (BE responde 400).',
    example: '2030-12-31T23:59:59.000Z',
  })
  @ValidateIf((o: RepetirCotizacionDto) => o.sinVigencia !== true)
  @IsOptional()
  @IsDateString()
  fechaVencimiento?: string;

  @ApiPropertyOptional({
    description:
      'Si true, clona/crea sin fecha de vencimiento. Si se omite, hereda de la fuente. Mutuamente excluyente con fechaVencimiento. Story 6.15',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  sinVigencia?: boolean;

  @ApiPropertyOptional({
    description:
      'Si true, tras crear la nueva cancela la fuente vía cambiarEstadoManual (provenance usuario). Default false. Si la fuente ya está cancelada, no-op.',
    example: false,
  })
  @IsOptional()
  @Transform(parseOptionalQueryBoolean)
  @IsBoolean()
  cancelarOriginal?: boolean;

  @ApiPropertyOptional({
    description:
      'Story 11.1 / AD-34: si true, crea recordatorio programado en la COT nueva (Toque FE en 11.2)',
    example: false,
  })
  @IsOptional()
  @Transform(parseOptionalQueryBoolean)
  @IsBoolean()
  rearmarRecordatorio?: boolean;

  @ApiPropertyOptional({
    type: RecetaRecordatorioDto,
    description:
      'Obligatorio si rearmarRecordatorio=true y familia fecha_exacta. Opcional en desfase (copia origen).',
  })
  @ValidateIf((o: RepetirCotizacionDto) => o.rearmarRecordatorio === true)
  @IsOptional()
  @ValidateNested()
  @Type(() => RecetaRecordatorioDto)
  recetaRecordatorio?: RecetaRecordatorioDto;
}

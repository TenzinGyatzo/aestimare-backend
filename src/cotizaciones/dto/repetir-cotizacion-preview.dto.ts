import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { SeccionPlantillaV1 } from '../../plantillas/schemas/plantilla.schema';

export class RepetirPreviewItemDto {
  @ApiProperty()
  servicioId: string;

  @ApiProperty()
  cantidad: number;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional()
  descripcion?: string;

  @ApiPropertyOptional()
  precioUnitario?: number;
}

export class RepetirPreviewPlantillaDto {
  @ApiProperty()
  plantillaId: string;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  secciones?: SeccionPlantillaV1[];
}

/** Payload wizard-ready sin persistir (Story 6.12 ext — repetir → cotizador). */
export class RepetirCotizacionPreviewDto {
  @ApiProperty({ type: [RepetirPreviewItemDto] })
  items: RepetirPreviewItemDto[];

  @ApiPropertyOptional()
  clienteId?: string;

  @ApiPropertyOptional()
  nombreEmpresa?: string;

  @ApiPropertyOptional()
  nombreContacto?: string;

  @ApiPropertyOptional()
  emailContacto?: string;

  @ApiPropertyOptional()
  telefonoContacto?: string;

  @ApiPropertyOptional()
  cargoContacto?: string;

  @ApiProperty({ type: [String] })
  emailsPara: string[];

  @ApiProperty({ type: [String] })
  emailsCc: string[];

  @ApiProperty()
  sinVigencia: boolean;

  @ApiProperty()
  incluirDatosBancarios: boolean;

  @ApiProperty()
  incluirDescripciones: boolean;

  /** Story 8.2 / AD-26 */
  @ApiProperty()
  incluirImagenesPdf: boolean;

  /** Desglose IVA 16 %. Fuente sin campo → true. */
  @ApiProperty()
  agregarIva: boolean;

  @ApiProperty({ type: [RepetirPreviewPlantillaDto] })
  plantillas: RepetirPreviewPlantillaDto[];

  @ApiProperty({ example: 'MXN' })
  moneda: 'MXN';
}

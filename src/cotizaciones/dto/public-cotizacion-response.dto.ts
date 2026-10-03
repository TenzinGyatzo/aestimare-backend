import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicCotizacionItemDto {
  @ApiProperty()
  nombre: string;

  @ApiPropertyOptional()
  descripcion?: string;

  @ApiProperty()
  cantidad: number;

  @ApiProperty()
  precioUnitario: number;

  @ApiProperty()
  subtotal: number;

  /** Id de catálogo (para mapa de imágenes PDF). */
  @ApiPropertyOptional()
  servicioId?: string;

  /** AD-22 — discriminador de línea; gate de imágenes PDF. */
  @ApiPropertyOptional({ enum: ['servicio', 'producto'] })
  tipoSnapshot?: 'servicio' | 'producto';

  /**
   * Proyección live desde Servicio al leer (AD-22). No persistido en ItemCotizacion.
   */
  @ApiPropertyOptional()
  imagenUrl?: string;
}

export class PublicBrandingDto {
  @ApiPropertyOptional()
  razonSocial?: string;

  @ApiPropertyOptional()
  logoUrl?: string;
}

/** Misma forma que tenant bancarios; solo si incluirDatosBancarios + útiles. */
export class PublicBancariosDto {
  @ApiPropertyOptional()
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

export class PublicPlantillaSnapshotDto {
  @ApiProperty()
  plantillaId: string;

  @ApiProperty()
  nombreSnapshot: string;

  @ApiProperty()
  schemaVersion: number;

  @ApiProperty({ type: [Object] })
  secciones: unknown[];
}

/** Respuesta acotada para superficie pública (Story 6.9). Sin token/tenant. */
export class PublicCotizacionResponseDto {
  @ApiProperty()
  folio: string;

  @ApiProperty({
    enum: ['vigente', 'vencida', 'aceptada', 'rechazada', 'cancelada'],
  })
  estado: string;

  @ApiProperty()
  total: number;

  @ApiProperty({ example: 'MXN' })
  moneda: string;

  @ApiProperty()
  fechaCreacion: string;

  @ApiPropertyOptional({
    description: 'ISO fecha vencimiento; omitido si sinVigencia',
  })
  fechaVencimiento?: string;

  @ApiPropertyOptional({ description: 'Cotización sin vigencia (Story 6.15)' })
  sinVigencia?: boolean;

  @ApiPropertyOptional()
  fechaAceptacion?: string;

  @ApiPropertyOptional()
  fechaRechazo?: string;

  @ApiPropertyOptional()
  nombreEmpresa?: string;

  @ApiPropertyOptional()
  nombreContacto?: string;

  @ApiPropertyOptional()
  telefonoContacto?: string;

  @ApiPropertyOptional({
    description:
      'Correo del solicitante (snapshot). Story 6.16 — PDF guest celda Correo',
  })
  emailContacto?: string;

  @ApiPropertyOptional({
    description: 'Cargo del solicitante (snapshot). Story 6.16',
  })
  cargoContacto?: string;

  @ApiPropertyOptional({
    description: 'Flag PDF — descripciones de línea (AD-26)',
  })
  incluirDescripciones?: boolean;

  @ApiPropertyOptional({
    description: 'Flag PDF — imágenes de producto (AD-26)',
  })
  incluirImagenesPdf?: boolean;

  @ApiPropertyOptional({
    description: 'Flag PDF — página de datos bancarios (AD-26)',
  })
  incluirDatosBancarios?: boolean;

  @ApiProperty({
    description:
      'Desglosar IVA al 16 %. Ausente en el documento se normaliza a true; solo false lo apaga.',
    example: true,
  })
  agregarIva: boolean;

  @ApiPropertyOptional({
    type: [PublicPlantillaSnapshotDto],
    description: 'Snapshots de plantillas para páginas PDF tras el cuerpo',
  })
  plantillasSnapshot?: PublicPlantillaSnapshotDto[];

  @ApiProperty({ type: [PublicCotizacionItemDto] })
  items: PublicCotizacionItemDto[];

  @ApiPropertyOptional({ type: PublicBrandingDto })
  branding?: PublicBrandingDto;

  @ApiPropertyOptional({
    type: PublicBancariosDto,
    description:
      'Solo si incluirDatosBancarios y hay datos bancarios útiles (guest PDF sin JWT)',
  })
  bancarios?: PublicBancariosDto;

  /** true si el PATCH fue no-op (ya en ese estado terminal). */
  @ApiPropertyOptional()
  alreadyResponded?: boolean;
}

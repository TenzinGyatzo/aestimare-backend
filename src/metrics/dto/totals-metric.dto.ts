import { ApiProperty } from '@nestjs/swagger';

/** Bucket de desglose tipado (líneas de cotizaciones aceptadas). Story 7.1 SaaS. */
export class TipoBucketDto {
  @ApiProperty({
    description: 'Suma de subtotales de línea (fallback precio×cantidad)',
    example: 50000,
  })
  ingresosTotales: number;

  @ApiProperty({
    description: 'Suma de cantidades de línea',
    example: 12,
  })
  vecesContratado: number;
}

/**
 * Desglose FR63 / AD-22 — solo `items.tipoSnapshot`.
 * Legacy sin campo → `sinTipo` (no live-on-read de catálogo).
 */
export class DesglosePorTipoDto {
  @ApiProperty({ type: TipoBucketDto })
  producto: TipoBucketDto;

  @ApiProperty({ type: TipoBucketDto })
  servicio: TipoBucketDto;

  @ApiProperty({ type: TipoBucketDto })
  sinTipo: TipoBucketDto;
}

export class ClienteSolicitanteDto {
  @ApiProperty({
    description: 'ID del cliente',
    example: '507f1f77bcf86cd799439011',
  })
  clienteId: string;

  @ApiProperty({
    description: 'Nombre de la empresa',
    example: 'Empresa ABC S.A. de C.V.',
    required: false,
  })
  empresa?: string;

  @ApiProperty({
    description: 'RFC de la empresa',
    example: 'ABC123456789',
  })
  rfc: string;

  @ApiProperty({
    description: 'Total de cotizaciones',
    example: 10,
  })
  totalCotizaciones: number;
}

export class ServicioSolicitadoDto {
  @ApiProperty({
    description: 'ID del servicio',
    example: '507f1f77bcf86cd799439011',
  })
  servicioId: string;

  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'Servicio de Consultoría',
  })
  nombreServicio: string;

  @ApiProperty({
    description: 'Número de veces contratado (desde cotizaciones aceptadas)',
    example: 25,
  })
  vecesSolicitado: number;
}

export class ServicioRentableDto {
  @ApiProperty({
    description: 'ID del servicio',
    example: '507f1f77bcf86cd799439011',
  })
  servicioId: string;

  @ApiProperty({
    description: 'Nombre del servicio',
    example: 'Servicio de Consultoría',
  })
  nombreServicio: string;

  @ApiProperty({
    description: 'Ingresos totales generados por el servicio',
    example: 150000.0,
  })
  ingresosTotales: number;
}

export class TotalsMetricDto {
  @ApiProperty({
    description: 'Cliente con más cotizaciones',
    type: ClienteSolicitanteDto,
    required: false,
  })
  mayorSolicitante?: ClienteSolicitanteDto;

  @ApiProperty({
    description: 'Cliente más activo del mes actual',
    type: ClienteSolicitanteDto,
    required: false,
  })
  clienteMasActivoMes?: ClienteSolicitanteDto;

  @ApiProperty({
    description: 'Servicio más contratado',
    type: ServicioSolicitadoDto,
    required: false,
  })
  servicioMasSolicitado?: ServicioSolicitadoDto;

  @ApiProperty({
    description: 'Servicio más rentable (por ingresos)',
    type: ServicioRentableDto,
    required: false,
  })
  servicioMasRentable?: ServicioRentableDto;

  @ApiProperty({
    description: 'Número de cotizaciones creadas hoy',
    example: 5,
  })
  cotizacionesHoy: number;

  @ApiProperty({
    description: 'Número de cotizaciones creadas este mes',
    example: 45,
  })
  cotizacionesMes: number;

  @ApiProperty({
    description: 'Número de cotizaciones creadas este año',
    example: 250,
  })
  cotizacionesAnio: number;

  @ApiProperty({
    description:
      'Número total de cotizaciones en el alcance del filtro (= cotizacionesEmitidas; excluye canceladas)',
    example: 500,
  })
  cotizacionesTotales: number;

  /** Alias de emitidas = count del match de periodo sin canceladas. */
  @ApiProperty({
    description:
      'Cotizaciones emitidas en el alcance del filtro (= cotizacionesTotales; excluye canceladas)',
    example: 500,
  })
  cotizacionesEmitidas: number;

  @ApiProperty({
    description: 'Cotizaciones en estado aceptada (mismo match de periodo)',
    example: 175,
  })
  cotizacionesAceptadas: number;

  @ApiProperty({
    description: 'Cotizaciones en estado rechazada (mismo match de periodo)',
    example: 40,
  })
  cotizacionesRechazadas: number;

  @ApiProperty({
    description:
      'Cotizaciones en estado cancelada (count dedicado; no entran en emitidas ni en tasaConversion)',
    example: 5,
  })
  cotizacionesCanceladas: number;

  @ApiProperty({
    description:
      'Tasa de conversión = aceptadas / emitidas (0 si emitidas = 0; emitidas ya excluye canceladas)',
    example: 0.35,
  })
  tasaConversion: number;

  @ApiProperty({
    description: 'Ingresos totales de cotizaciones aceptadas',
    example: 1500000.0,
  })
  ingresosTotales: number;

  /**
   * AD-22 / Story 7.1 tipado SaaS — desglose por línea (`items.tipoSnapshot`).
   * `ingresosTotales` del card sigue siendo suma de `cotizacion.total` (documento);
   * los buckets suman subtotales de línea (pueden diferir en docs raros).
   * Legacy sin campo → `sinTipo` (nunca fallback live a catálogo).
   */
  @ApiProperty({
    description:
      'Desglose de ingresos/cantidades de líneas en aceptadas por tipoSnapshot',
    type: DesglosePorTipoDto,
  })
  desglosePorTipo: DesglosePorTipoDto;
}

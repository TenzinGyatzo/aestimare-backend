import { ApiProperty } from '@nestjs/swagger';

export class ClienteListItemDto {
  @ApiProperty({ example: '66f0c1a2b3d4e5f678901234' })
  _id: string;

  @ApiProperty({ example: 'Acme Industrial' })
  empresa: string;

  @ApiProperty({ example: 'Acme Industrial S.A. de C.V.', required: false })
  razonSocial?: string;

  @ApiProperty({ example: 'ABC010101AB1', required: false })
  rfc?: string;

  @ApiProperty({ example: true })
  activo: boolean;

  @ApiProperty({
    example: 3,
    description: 'Contactos activos (activo ≠ false) del cliente',
  })
  totalContactos: number;

  @ApiProperty({
    example: 4,
    description: 'Cotizaciones del cliente excluyendo canceladas',
  })
  totalCotizaciones: number;
}

export class PaginatedClientesResponseDto {
  @ApiProperty({
    description: 'Lista de clientes de la página, con conteos',
    type: [ClienteListItemDto],
  })
  data: ClienteListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;

  @ApiProperty({ example: 3 })
  totalPages: number;
}

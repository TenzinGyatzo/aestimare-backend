import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Fila canónica de recordatorio disparado (AD-35 / FR7). */
export class RecordatorioDisparadoItemDto {
  @ApiProperty({
    description: 'ID del recordatorio (para POST cerrar)',
    example: '507f1f77bcf86cd799439011',
  })
  recordatorioId: string;

  @ApiProperty({
    description: 'ID de la cotización asociada',
    example: '507f1f77bcf86cd799439012',
  })
  cotizacionId: string;

  @ApiProperty({ description: 'Folio de la cotización', example: 'COT-2026-001' })
  folio: string;

  @ApiPropertyOptional({
    description:
      'Identidad CRM (empresa) o contacto; null si ausente (AD-37 — FE muestra «—»)',
    example: 'Acme Corp',
    nullable: true,
  })
  identidad: string | null;

  @ApiProperty({
    description: 'Fecha de disparo (UTC persistida)',
    example: '2026-08-24T06:00:00.000Z',
  })
  fechaDisparo: Date;

  @ApiProperty({
    description: 'Resumen legible de la receta',
    example: '3 meses',
  })
  recetaResumen: string;

  @ApiPropertyOptional({
    description: 'Nombre del contacto snapshot de la cotización',
    example: 'Luis Zavala',
    nullable: true,
  })
  nombreContacto: string | null;

  @ApiPropertyOptional({
    description: 'Teléfono del contacto snapshot',
    example: '6681234567',
    nullable: true,
  })
  telefonoContacto: string | null;

  @ApiPropertyOptional({
    description: 'Correo del contacto snapshot',
    example: 'luis@aitsa.mx',
    nullable: true,
  })
  emailContacto: string | null;

  @ApiPropertyOptional({
    description: 'Fecha de creación de la cotización original',
    nullable: true,
  })
  fechaCreacion: Date | null;
}

export class RecordatoriosDisparadosResponseDto {
  @ApiProperty({ type: [RecordatorioDisparadoItemDto] })
  items: RecordatorioDisparadoItemDto[];
}

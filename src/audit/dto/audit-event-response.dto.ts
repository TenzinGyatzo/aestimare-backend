import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuditActorSnapshotDto {
  @ApiPropertyOptional()
  email?: string;

  @ApiPropertyOptional()
  nombre?: string;

  @ApiPropertyOptional()
  rol?: string;
}

export class AuditEventResponseDto {
  @ApiProperty()
  _id: string;

  @ApiPropertyOptional()
  tenantId?: string;

  @ApiPropertyOptional()
  actorId?: string;

  @ApiProperty({ type: AuditActorSnapshotDto })
  actorSnapshot: AuditActorSnapshotDto;

  @ApiProperty()
  timestamp: string;

  @ApiProperty()
  actionType: string;

  @ApiProperty()
  resourceType: string;

  @ApiPropertyOptional()
  resourceId?: string;

  @ApiProperty()
  result: string;

  @ApiPropertyOptional()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional()
  ip?: string;

  @ApiPropertyOptional()
  userAgent?: string;
}

export class PaginatedAuditEventsResponseDto {
  @ApiProperty({ type: [AuditEventResponseDto] })
  data: AuditEventResponseDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  limit: number;

  @ApiProperty()
  totalPages: number;
}

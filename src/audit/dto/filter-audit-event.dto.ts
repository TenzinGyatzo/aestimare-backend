import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { parseOptionalQueryBoolean } from '../../common/parse-optional-query-boolean';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit-action-type';

export class FilterAuditEventDto {
  @ApiPropertyOptional({ description: 'ISO 8601 inclusive' })
  @IsOptional()
  @IsDateString()
  fechaDesde?: string;

  @ApiPropertyOptional({ description: 'ISO 8601 inclusive' })
  @IsOptional()
  @IsDateString()
  fechaHasta?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  actorId?: string;

  @ApiPropertyOptional({ enum: AuditActionType })
  @IsOptional()
  @IsEnum(AuditActionType)
  actionType?: AuditActionType;

  @ApiPropertyOptional({ enum: AuditResourceType })
  @IsOptional()
  @IsEnum(AuditResourceType)
  resourceType?: AuditResourceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ enum: AuditResult })
  @IsOptional()
  @IsEnum(AuditResult)
  result?: AuditResult;

  @ApiPropertyOptional({
    description:
      'admin_sistema: incluir eventos sin tenant (login plataforma, bootstrap). Ignorado para admin_tenant.',
  })
  @IsOptional()
  @Transform(parseOptionalQueryBoolean)
  @IsBoolean()
  includePlatform?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

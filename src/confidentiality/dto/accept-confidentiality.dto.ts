import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AcceptConfidentialityDto {
  @ApiPropertyOptional({
    description: 'Versión mostrada en el modal; si no coincide con la vigente, 409',
    example: 'v1',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  version?: string;
}

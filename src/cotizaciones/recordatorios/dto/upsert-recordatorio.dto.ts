import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsObject, ValidateNested } from 'class-validator';
import { RecetaRecordatorioDto } from './receta-recordatorio.dto';

/** Body PUT /cotizaciones/:id/recordatorio (AD-35). */
export class UpsertRecordatorioDto {
  @ApiProperty({ type: RecetaRecordatorioDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RecetaRecordatorioDto)
  receta: RecetaRecordatorioDto;
}

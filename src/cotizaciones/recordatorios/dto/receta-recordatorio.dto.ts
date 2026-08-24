import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsIn,
  IsString,
  Matches,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import {
  FAMILIAS_RECETA,
  PRESETS_RELATIVO_ANIVERSARIO,
  PRESETS_RELATIVO_HOY,
  type FamiliaReceta,
} from '../fecha-disparo.calc';

@ValidatorConstraint({ name: 'presetMatchesFamilia', async: false })
class PresetMatchesFamiliaConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    const familia = (args.object as RecetaRecordatorioDto).familia;
    if (familia === 'relativo_hoy') {
      return (PRESETS_RELATIVO_HOY as readonly string[]).includes(value);
    }
    if (familia === 'relativo_aniversario') {
      return (PRESETS_RELATIVO_ANIVERSARIO as readonly string[]).includes(
        value,
      );
    }
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    const familia = (args.object as RecetaRecordatorioDto).familia;
    return `preset inválido para familia ${familia}`;
  }
}

/** Receta canónica en body (AD-28). Sin fechaDisparoUtc. */
export class RecetaRecordatorioDto {
  @ApiProperty({
    enum: FAMILIAS_RECETA,
    description: 'Familia de momento del recordatorio',
  })
  @IsString()
  @IsIn([...FAMILIAS_RECETA])
  familia: FamiliaReceta;

  @ApiPropertyOptional({
    description:
      'Obligatorio para relativo_hoy / relativo_aniversario. Prohibido en fecha_exacta. Debe pertenecer a la familia.',
  })
  @ValidateIf((o: RecetaRecordatorioDto) => o.familia !== 'fecha_exacta')
  @IsString()
  @Validate(PresetMatchesFamiliaConstraint)
  preset?: string;

  @ApiPropertyOptional({
    description:
      'Solo fecha_exacta. Date-only ISO (YYYY-MM-DD) interpretado en Reloj del tenant.',
    example: '2026-09-01',
  })
  @ValidateIf((o: RecetaRecordatorioDto) => o.familia === 'fecha_exacta')
  @IsDefined({ message: 'fechaExacta requerida para fecha_exacta' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fechaExacta debe ser date-only YYYY-MM-DD',
  })
  fechaExacta?: string;
}

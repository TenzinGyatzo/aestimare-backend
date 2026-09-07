import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsEmail,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsMongoId,
  ValidateIf,
} from 'class-validator';
import { Roles } from '../../auth/enums/roles.enum';
import {
  IsUserPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../password-policy';

export class UpdateUserDto {
  @ApiPropertyOptional({
    description: 'Correo electrónico del usuario',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Nueva contraseña del usuario',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== '')
  @IsString()
  @IsUserPassword()
  password?: string;

  @ApiPropertyOptional({
    description: 'Nombre completo del usuario',
  })
  @IsOptional()
  @IsString()
  nombre?: string;

  @ApiPropertyOptional({
    description: 'Rol del usuario',
    enum: Roles,
  })
  @IsOptional()
  @IsEnum(Roles)
  rol?: string;

  @ApiPropertyOptional({
    description:
      'Tenant asignado (obligatorio si el rol efectivo es operativo o admin_tenant)',
  })
  @IsOptional()
  @ValidateIf((o) => o.tenantId !== null && o.tenantId !== undefined)
  @IsMongoId()
  tenantId?: string | null;

  @ApiPropertyOptional({
    description: 'Indica si el usuario está activo',
  })
  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}

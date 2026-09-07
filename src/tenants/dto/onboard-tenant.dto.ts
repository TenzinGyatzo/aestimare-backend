import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  IsUserPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../../users/password-policy';

export class OnboardTenantInfoDto {
  @ApiProperty({ example: 'Demo SA' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre: string;

  @ApiProperty({
    example: 'demo-sa',
    description: 'Slug único lowercase [a-z0-9-]+ (se normaliza en service)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/, {
    message:
      'La clave del tenant debe ser un slug (letras, números y guiones)',
  })
  clave: string;
}

export class OnboardAdminDto {
  @ApiProperty({ example: 'Ana Admin' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  nombre: string;

  @ApiProperty({ example: 'ana@demo.test' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({
    example: 'secreto123',
    minLength: PASSWORD_MIN_LENGTH,
    maxLength: PASSWORD_MAX_LENGTH,
  })
  @IsString()
  @IsUserPassword()
  password: string;
}

export class OnboardTenantDto {
  @ApiProperty({ type: OnboardTenantInfoDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardTenantInfoDto)
  tenant: OnboardTenantInfoDto;

  @ApiProperty({ type: OnboardAdminDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => OnboardAdminDto)
  admin: OnboardAdminDto;
}

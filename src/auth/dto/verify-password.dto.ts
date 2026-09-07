import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyPasswordDto {
  @ApiProperty({
    description: 'Contraseña del usuario autenticado',
    example: 'password123',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

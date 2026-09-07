import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { IsUserPassword } from '../../users/password-policy';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'El email debe ser válido' })
  @IsNotEmpty({ message: 'El email es requerido' })
  email: string;

  @IsString({ message: 'El token debe ser una cadena de texto' })
  @IsNotEmpty({ message: 'El token es requerido' })
  token: string;

  @IsString({ message: 'La nueva contraseña debe ser una cadena de texto' })
  @IsUserPassword()
  newPassword: string;
}

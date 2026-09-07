import { validateSync } from 'class-validator';
import { LoginDto } from '../auth/dto/login.dto';
import { RegisterDto } from '../auth/dto/register.dto';
import { ResetPasswordDto } from '../auth/dto/reset-password.dto';
import { VerifyPasswordDto } from '../auth/dto/verify-password.dto';
import { OnboardAdminDto } from '../tenants/dto/onboard-tenant.dto';
import { Roles } from '../auth/enums/roles.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  evaluateUserPassword,
  PASSWORD_MAX_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
} from './password-policy';

const EXACT_8 = 'letra123';
const EXACT_200 = `a1${'x'.repeat(198)}`;

const VALID = [
  'secreto123',
  'Secreto123',
  'Aestimare-2026!',
  'mi clave 2026',
  '  ab12cd  ',
  'contraseña1',
  EXACT_8,
  EXACT_200,
];

const INVALID_CANONICAL = [
  'abc123',
  'abcdefgh',
  '12345678',
  '        ',
];

function assign<T extends object>(cls: new () => T, data: Record<string, unknown>): T {
  return Object.assign(new cls(), data);
}

function passwordErrors(dto: object, property = 'password'): string[] {
  return validateSync(dto)
    .filter((e) => e.property === property)
    .flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('evaluateUserPassword', () => {
  it.each(VALID)('acepta %s', (password) => {
    expect(evaluateUserPassword(password)).toBeNull();
  });

  it.each(INVALID_CANONICAL)('rechaza %s con mensaje canónico', (password) => {
    expect(evaluateUserPassword(password)).toBe(PASSWORD_POLICY_MESSAGE);
  });

  it('acepta exactamente 8 y 200 caracteres', () => {
    expect(EXACT_8.length).toBe(8);
    expect(EXACT_200.length).toBe(200);
    expect(evaluateUserPassword(EXACT_8)).toBeNull();
    expect(evaluateUserPassword(EXACT_200)).toBeNull();
  });

  it('rechaza más de 200 caracteres', () => {
    const tooLong = `a1${'x'.repeat(199)}`;
    expect(tooLong.length).toBe(201);
    expect(evaluateUserPassword(tooLong)).toBe(PASSWORD_MAX_MESSAGE);
  });

  it('rechaza no-string', () => {
    expect(evaluateUserPassword(null)).toBe(PASSWORD_POLICY_MESSAGE);
    expect(evaluateUserPassword(undefined)).toBe(PASSWORD_POLICY_MESSAGE);
  });
});

describe('DTOs de escritura usan IsUserPassword', () => {
  const baseUser = {
    email: 'op@ames.test',
    nombre: 'Op',
    rol: Roles.OPERATIVO,
  };

  it('CreateUserDto / RegisterDto / OnboardAdminDto / ResetPasswordDto aceptan válida', () => {
    expect(
      validateSync(assign(CreateUserDto, { ...baseUser, password: 'secreto123' })),
    ).toHaveLength(0);
    expect(
      validateSync(assign(RegisterDto, { ...baseUser, password: 'secreto123' })),
    ).toHaveLength(0);
    expect(
      validateSync(
        assign(OnboardAdminDto, {
          nombre: 'Ana',
          email: 'ana@demo.test',
          password: 'secreto123',
        }),
      ),
    ).toHaveLength(0);
    expect(
      validateSync(
        assign(ResetPasswordDto, {
          email: 'op@ames.test',
          token: 'tok',
          newPassword: 'secreto123',
        }),
      ),
    ).toHaveLength(0);
  });

  it('rechazan 8 letras (reset ya no es solo min 8)', () => {
    expect(
      passwordErrors(assign(CreateUserDto, { ...baseUser, password: 'abcdefgh' })),
    ).toContain(PASSWORD_POLICY_MESSAGE);
    expect(
      passwordErrors(assign(RegisterDto, { ...baseUser, password: 'abcdefgh' })),
    ).toContain(PASSWORD_POLICY_MESSAGE);
    expect(
      passwordErrors(
        assign(OnboardAdminDto, {
          nombre: 'Ana',
          email: 'ana@demo.test',
          password: 'abcdefgh',
        }),
      ),
    ).toContain(PASSWORD_POLICY_MESSAGE);
    expect(
      passwordErrors(
        assign(ResetPasswordDto, {
          email: 'op@ames.test',
          token: 'tok',
          newPassword: 'abcdefgh',
        }),
        'newPassword',
      ),
    ).toContain(PASSWORD_POLICY_MESSAGE);
    expect(
      passwordErrors(assign(UpdateUserDto, { password: 'abcdefgh' })),
    ).toContain(PASSWORD_POLICY_MESSAGE);
  });

  it('UpdateUserDto sin password o "" es válido; válida pasa; 201 falla', () => {
    expect(validateSync(assign(UpdateUserDto, { nombre: 'Nuevo' }))).toHaveLength(
      0,
    );
    expect(validateSync(assign(UpdateUserDto, { password: '' }))).toHaveLength(0);
    expect(
      validateSync(assign(UpdateUserDto, { password: 'secreto123' })),
    ).toHaveLength(0);
    expect(
      passwordErrors(
        assign(UpdateUserDto, { password: `a1${'x'.repeat(199)}` }),
      ),
    ).toContain(PASSWORD_MAX_MESSAGE);
  });
});

describe('DTOs de lectura no aplican la política', () => {
  it('LoginDto y VerifyPasswordDto aceptan password legacy corta', () => {
    expect(
      validateSync(assign(LoginDto, { email: 'a@a.test', password: 'abc123' })),
    ).toHaveLength(0);
    expect(
      validateSync(assign(VerifyPasswordDto, { password: 'abc123' })),
    ).toHaveLength(0);
  });
});

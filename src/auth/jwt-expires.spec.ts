import { JwtService } from '@nestjs/jwt';
import {
  JWT_DEFAULT_EXPIRES_IN,
  resolveJwtExpiresIn,
} from './jwt-expires';

const EIGHT_HOURS_S = 8 * 60 * 60;

describe('resolveJwtExpiresIn', () => {
  it('vacío o ausente → 8h', () => {
    expect(resolveJwtExpiresIn(undefined)).toBe(JWT_DEFAULT_EXPIRES_IN);
    expect(resolveJwtExpiresIn(null)).toBe('8h');
    expect(resolveJwtExpiresIn('')).toBe('8h');
    expect(resolveJwtExpiresIn('   ')).toBe('8h');
  });

  it('valor de env gana sobre el default', () => {
    expect(resolveJwtExpiresIn('3600s')).toBe('3600s');
    expect(resolveJwtExpiresIn('12h')).toBe('12h');
  });
});

describe('JWT default lifetime', () => {
  const jwtService = new JwtService({
    secret: 'test-secret-at-least-16',
    signOptions: { expiresIn: resolveJwtExpiresIn() },
  });

  it('el JWT firmado con el default dura 8 horas', () => {
    const token = jwtService.sign({ sub: 'u1' });
    const decoded = jwtService.decode(token) as {
      iat: number;
      exp: number;
    };

    expect(decoded.exp - decoded.iat).toBe(EIGHT_HOURS_S);
  });

  it('un JWT con exp pasado es rechazado', () => {
    const verifier = new JwtService({
      secret: 'test-secret-at-least-16',
    });
    const expired = verifier.sign({ sub: 'u1' }, { expiresIn: -1 });

    expect(() => verifier.verify(expired)).toThrow();
  });
});

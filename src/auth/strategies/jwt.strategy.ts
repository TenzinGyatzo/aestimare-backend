import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

function normalizeTenantId(value: unknown): string {
  if (value == null || value === '') {
    return '';
  }
  return String(value);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error(
        'JWT_SECRET no está configurado. Por favor, configura JWT_SECRET en tu archivo .env',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: {
    sub?: unknown;
    rol?: unknown;
    tenantId?: unknown;
    credentialsVersion?: unknown;
  }) {
    const sub = payload?.sub != null ? String(payload.sub) : '';
    if (!sub) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findAuthPrincipal(sub);
    if (!user || user.activo !== true) {
      throw new UnauthorizedException();
    }

    const tokenVersion = payload.credentialsVersion ?? 0;
    const currentVersion = user.credentialsVersion ?? 0;
    if (tokenVersion !== currentVersion) {
      throw new UnauthorizedException();
    }

    if (payload.rol !== user.rol) {
      throw new UnauthorizedException();
    }

    if (
      normalizeTenantId(payload.tenantId) !==
      normalizeTenantId(user.tenantId)
    ) {
      throw new UnauthorizedException();
    }

    return {
      _id: user._id,
      email: user.email,
      rol: user.rol,
      tipoUsuario: user.rol,
      tenantId: user.tenantId,
    };
  }
}

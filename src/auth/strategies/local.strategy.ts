import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { clientMetaFromRequest } from '../../audit/audit-client-meta';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authService: AuthService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true,
    });
  }

  async validate(
    req: { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } },
    email: string,
    password: string,
  ): Promise<any> {
    const user = await this.authService.validateUser(
      email,
      password,
      clientMetaFromRequest(req),
    );
    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }
    return user;
  }
}

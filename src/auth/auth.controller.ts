import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  Req,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { Roles } from './enums/roles.enum';
import { PasswordResetService } from './password-reset.service';
import { RequestPasswordResetDto } from './dto/request-password-reset.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AuditService } from '../audit/audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit/audit-action-type';
import { clientMetaFromRequest } from '../audit/audit-client-meta';
import { SkipConfidentiality } from '../confidentiality/skip-confidentiality.decorator';

@ApiTags('auth')
@Controller('auth')
@SkipConfidentiality()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly passwordResetService: PasswordResetService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Bootstrap: registrar el primer administrador de sistema',
    description:
      'Solo cuando aún no hay usuarios (count=0). Tras el bootstrap, use POST /api/users (Story 1.6).',
  })
  @ApiResponse({
    status: 201,
    description: 'Usuario creado exitosamente',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Datos inválidos' })
  @ApiResponse({ status: 409, description: 'El email ya está registrado' })
  @ApiResponse({
    status: 403,
    description: 'Ya existen usuarios; use POST /api/users',
  })
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    const userCount = await this.usersService.count();

    if (userCount === 0) {
      const user = await this.usersService.create({
        email: registerDto.email,
        password: registerDto.password,
        nombre: registerDto.nombre,
        rol: Roles.ADMIN_SISTEMA,
      });
      const meta = clientMetaFromRequest(req);
      await this.auditService?.record({
        actorId: String((user as { _id?: unknown })._id ?? ''),
        actorSnapshot: {
          email: user.email,
          nombre: user.nombre,
          rol: user.rol,
        },
        actionType: AuditActionType.AUTH_BOOTSTRAP_REGISTER,
        resourceType: AuditResourceType.USER,
        resourceId: String((user as { _id?: unknown })._id ?? ''),
        result: AuditResult.SUCCESS,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.usersService.sanitize(user);
    }

    throw new ForbiddenException(
      'Ya existen usuarios. Use POST /api/users (administrador de sistema autenticado).',
    );
  }

  @Post('login')
  @UseGuards(LocalAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica un usuario y devuelve un token JWT',
  })
  @ApiResponse({
    status: 200,
    description: 'Login exitoso',
    schema: {
      type: 'object',
      properties: {
        access_token: {
          type: 'string',
          example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
        user: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            email: { type: 'string' },
            nombre: { type: 'string' },
            rol: { type: 'string' },
            activo: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 401, description: 'Credenciales inválidas' })
  async login(
    @Body() loginDto: LoginDto,
    @CurrentUser() user: any,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    return this.authService.login(user, clientMetaFromRequest(req));
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener perfil del usuario autenticado',
    description: 'Devuelve los datos del usuario autenticado',
  })
  @ApiResponse({
    status: 200,
    description: 'Perfil del usuario',
    type: UserResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getProfile(@CurrentUser() user: any) {
    const fullUser = await this.usersService.findById(user._id);
    const { passwordHash, ...result } = fullUser.toObject();
    return result;
  }

  @Post('password-reset/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Solicitar restablecimiento de contraseña',
    description:
      'Envía un email con un enlace para restablecer la contraseña. Siempre retorna éxito para evitar enumeración de usuarios.',
  })
  @ApiResponse({
    status: 200,
    description: 'Si el email existe, se enviará un correo de recuperación',
  })
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    await this.passwordResetService.createResetTokenForAdmin(
      dto.email,
      clientMetaFromRequest(req),
    );
    return {
      message:
        'Si el email existe en nuestro sistema, recibirás un correo con instrucciones para restablecer tu contraseña',
    };
  }

  @Post('password-reset/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validar token de restablecimiento',
    description: 'Verifica si un token de restablecimiento es válido',
  })
  @ApiResponse({
    status: 200,
    description: 'Token validado',
    schema: { type: 'object', properties: { valid: { type: 'boolean' } } },
  })
  async validateResetToken(@Body() dto: ValidateResetTokenDto) {
    const valid = await this.passwordResetService.validateToken(
      dto.email,
      dto.token,
    );
    return { valid };
  }

  @Post('password-reset/reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Restablecer contraseña',
    description: 'Restablece la contraseña usando un token válido',
  })
  @ApiResponse({ status: 200, description: 'Contraseña restablecida' })
  @ApiResponse({
    status: 400,
    description: 'Token inválido, expirado o ya utilizado',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: { ip?: string; headers?: Record<string, unknown> },
  ) {
    await this.passwordResetService.resetPasswordForAdmin(
      dto.email,
      dto.token,
      dto.newPassword,
      clientMetaFromRequest(req),
    );
    return { message: 'Contraseña restablecida exitosamente' };
  }
}

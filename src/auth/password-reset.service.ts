import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
  PasswordResetToken,
  PasswordResetTokenDocument,
} from './schemas/password-reset-token.schema';
import { EmailsService } from '../emails/emails.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit/audit-action-type';
import type { AuditClientMeta } from '../audit/audit-client-meta';

/** Discriminator interno de tokens reset (≠ rol JWT AMES). */
const RESET_USER_TYPE = 'admin';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectModel(PasswordResetToken.name)
    private passwordResetTokenModel: Model<PasswordResetTokenDocument>,
    private emailsService: EmailsService,
    private usersService: UsersService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  private generateToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Solicitud de reset AMES. Siempre resuelve void (anti-enumeración):
   * inexistente / inactivo / fallo SMTP/DB → sin excepción enumerable.
   * Los tokens previos solo se invalidan tras envío exitoso.
   */
  async createResetTokenForAdmin(
    email: string,
    meta?: AuditClientMeta,
  ): Promise<void> {
    try {
      const user = await this.usersService.findByEmail(email);

      if (!user) {
        this.logger.warn(
          `Password reset requested for non-existent email: ${email}`,
        );
        return;
      }

      if (!user.activo) {
        this.logger.warn(
          `Password reset requested for inactive user: ${email}`,
        );
        return;
      }

      const token = this.generateToken();
      const tokenHash = this.hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

      await this.passwordResetTokenModel.create({
        email,
        tokenHash,
        userType: RESET_USER_TYPE,
        expiresAt,
      });

      try {
        await this.emailsService.sendPasswordResetEmail(
          email,
          user.nombre,
          token,
        );
        // Solo tras entrega: invalidar tokens previos (conservar el nuevo).
        await this.passwordResetTokenModel
          .deleteMany({
            email,
            userType: RESET_USER_TYPE,
            tokenHash: { $ne: tokenHash },
          })
          .exec();
        this.logger.log(`Password reset email sent to: ${email}`);
        await this.auditPasswordReset(
          'requested',
          AuditResult.SUCCESS,
          user,
          email,
          meta,
        );
      } catch (error) {
        // No lanzar: un 400 aquí revelaría que el correo existe (FR-2).
        // Quitar el token nuevo para no dejar huérfanos ni quemar enlaces previos.
        await this.passwordResetTokenModel
          .deleteMany({ tokenHash })
          .exec()
          .catch((cleanupErr) =>
            this.logger.error(
              `Failed to cleanup unused reset token for ${email}:`,
              cleanupErr,
            ),
          );
        this.logger.error(
          `Failed to send password reset email to ${email}:`,
          error,
        );
        await this.auditPasswordReset(
          'requested',
          AuditResult.FAILURE,
          user,
          email,
          meta,
          { reason: 'email_send_failed' },
        );
      }
    } catch (error) {
      // DB/lookup failures must not become 500 enumerable for known emails.
      this.logger.error(
        `Password reset request failed (swallowed for anti-enumeration) for ${email}:`,
        error,
      );
    }
  }

  async validateToken(email: string, token: string): Promise<boolean> {
    const tokenHash = this.hashToken(token);

    const resetToken = await this.passwordResetTokenModel
      .findOne({
        email,
        tokenHash,
        userType: RESET_USER_TYPE,
        expiresAt: { $gte: new Date() },
        usedAt: { $exists: false },
      })
      .exec();

    return !!resetToken;
  }

  async resetPasswordForAdmin(
    email: string,
    token: string,
    newPassword: string,
    meta?: AuditClientMeta,
  ): Promise<void> {
    const tokenHash = this.hashToken(token);

    const resetToken = await this.passwordResetTokenModel
      .findOne({
        email,
        tokenHash,
        userType: RESET_USER_TYPE,
        expiresAt: { $gte: new Date() },
        usedAt: { $exists: false },
      })
      .exec();

    if (!resetToken) {
      await this.auditPasswordReset(
        'completed',
        AuditResult.FAILURE,
        null,
        email,
        meta,
        { reason: 'invalid_token' },
      );
      throw new BadRequestException('Token inválido, expirado o ya utilizado');
    }

    const user = await this.usersService.findByEmail(email);
    if (!user || !user.activo) {
      await this.auditPasswordReset(
        'completed',
        AuditResult.FAILURE,
        user,
        email,
        meta,
        { reason: 'invalid_token' },
      );
      throw new BadRequestException('Token inválido, expirado o ya utilizado');
    }

    await this.usersService.update(user._id.toString(), {
      password: newPassword,
    });

    resetToken.usedAt = new Date();
    await resetToken.save();

    this.logger.log(`Password reset successfully for: ${email}`);
    await this.auditPasswordReset(
      'completed',
      AuditResult.SUCCESS,
      user,
      email,
      meta,
    );
  }

  private async auditPasswordReset(
    kind: 'requested' | 'completed',
    result: AuditResult,
    user: { _id?: unknown; tenantId?: unknown; email?: string; nombre?: string; rol?: string } | null,
    email: string,
    meta?: AuditClientMeta,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService?.record({
      tenantId: user?.tenantId ? String(user.tenantId) : undefined,
      actorId: user?._id ? String(user._id) : undefined,
      actorSnapshot: {
        email: user?.email || email.trim().toLowerCase(),
        nombre: user?.nombre,
        rol: user?.rol,
      },
      actionType:
        kind === 'requested'
          ? AuditActionType.AUTH_PASSWORD_RESET_REQUESTED
          : AuditActionType.AUTH_PASSWORD_RESET_COMPLETED,
      resourceType: AuditResourceType.AUTH,
      resourceId: user?._id ? String(user._id) : undefined,
      result,
      payload,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
    });
  }
}

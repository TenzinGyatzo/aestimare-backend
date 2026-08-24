import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { Transporter } from 'nodemailer';
import { isEmail } from 'class-validator';
import { createTransporter } from './emails.config';
import { passwordResetTemplate } from './templates/password-reset.template';
import { quotationDecisionNotificationTemplate } from './templates/quotation-decision-notification.template';
import { reminderRecotizacionDisparoTemplate } from './templates/reminder-recotizacion-disparo.template';
import { TenantConfigService } from '../tenants/tenant-config.service';
import {
  decryptSecret,
  TenantSecretsKeyError,
} from '../tenants/tenant-secrets.crypto';
import { TenantEmailNotConfiguredError } from './tenant-email-not-configured.error';
import { TenantInactiveForOutboundError } from './tenant-inactive-for-outbound.error';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class EmailsService {
  private readonly logger = new Logger(EmailsService.name);
  /** Transporter plataforma (EMAIL_USER/PASS) — password reset. */
  private platformTransporter: Transporter | undefined;
  private emailFrom: string;
  private readonly smtpHost: string | undefined;
  private readonly smtpPort: number | undefined;

  constructor(
    private configService: ConfigService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly tenantsService: TenantsService,
  ) {
    this.smtpHost = this.configService.get<string>('EMAIL_HOST');
    this.smtpPort = this.configService.get<number>('EMAIL_PORT');
    const user = this.configService.get<string>('EMAIL_USER');
    const pass = this.configService.get<string>('EMAIL_PASS');
    this.emailFrom = this.configService.get<string>('EMAIL_FROM') || user;

    if (!this.smtpHost || !this.smtpPort || !user || !pass) {
      this.logger.warn(
        'Platform email configuration incomplete. Password-reset SMTP may fail; tenant outbound uses tenant creds + EMAIL_HOST/PORT.',
      );
    } else {
      this.platformTransporter = createTransporter(
        this.smtpHost,
        this.smtpPort,
        user,
        pass,
      );
      this.logger.log('Platform email transporter initialized successfully');
    }
  }

  private toObjectId(tenantId: Types.ObjectId | string): Types.ObjectId {
    if (tenantId instanceof Types.ObjectId) return tenantId;
    const raw = String(tenantId ?? '').trim();
    if (!/^[a-fA-F0-9]{24}$/.test(raw)) {
      throw new Error('tenantId inválido para envío SMTP');
    }
    return new Types.ObjectId(raw);
  }

  /** Log SMTP sin volcar auth/pass (NFR8 / Story 3.3). */
  private formatSmtpError(error: unknown): string {
    if (error instanceof TenantSecretsKeyError) return error.message;
    if (!error || typeof error !== 'object') return String(error);
    const e = error as {
      message?: string;
      code?: string;
      responseCode?: number;
      command?: string;
    };
    return (
      [e.message, e.code, e.responseCode != null ? `rc=${e.responseCode}` : null]
        .filter(Boolean)
        .join(' | ') || 'SMTP error'
    );
  }

  private sanitizeSubjectPart(value: string, max = 120): string {
    return String(value || '')
      .replace(/[\r\n\x00-\x1f\x7f]+/g, ' ')
      .trim()
      .slice(0, max);
  }

  private async assertTenantActiveForOutbound(
    tenantId: Types.ObjectId,
  ): Promise<void> {
    const tenant = await this.tenantsService.findById(String(tenantId));
    if (!tenant || !tenant.activo) {
      throw new TenantInactiveForOutboundError();
    }
  }

  private async createTenantTransporter(
    tenantId: Types.ObjectId | string,
  ): Promise<{ transporter: Transporter; emailUser: string }> {
    if (!this.smtpHost || !this.smtpPort) {
      throw new Error(
        'EMAIL_HOST/EMAIL_PORT de plataforma no configurados',
      );
    }
    const oid = this.toObjectId(tenantId);
    await this.assertTenantActiveForOutbound(oid);
    const auth = await this.tenantConfigService.getOutboundSmtpAuth(oid);
    if (!auth) {
      throw new TenantEmailNotConfiguredError();
    }
    let plainPass: string;
    try {
      plainPass = decryptSecret(auth.emailSecretEnc);
    } catch (err) {
      if (err instanceof TenantSecretsKeyError) throw err;
      throw new TenantSecretsKeyError(
        'No se pudo descifrar la credencial SMTP del tenant',
      );
    }
    if (!plainPass) {
      throw new TenantEmailNotConfiguredError();
    }
    return {
      transporter: createTransporter(
        this.smtpHost,
        this.smtpPort,
        auth.emailUser,
        plainPass,
      ),
      emailUser: auth.emailUser,
    };
  }

  /** From tenant: emailRemitente (override) o emailUser — nunca EMAIL_FROM plataforma. */
  private resolveTenantFrom(
    fromOverride: string | undefined,
    emailUser: string,
  ): string {
    const from = fromOverride?.trim() || emailUser?.trim();
    if (!from) {
      throw new Error(
        'Remitente del tenant no configurado (emailRemitente o emailUser)',
      );
    }
    return from;
  }

  private closeTransporter(transporter: Transporter | undefined): void {
    try {
      transporter?.close?.();
    } catch {
      // ignore close errors
    }
  }

  /**
   * Método privado para enviar emails
   * @param fromOverride Remitente tenant (Story 2.3); fallback EMAIL_FROM
   * @param cc Destinatarios CC opcionales (Story 6.6 puente)
   * @param transporter Override (tenant outbound); default = plataforma
   */
  private async sendEmail(
    to: string | string[],
    subject: string,
    html: string,
    bcc?: string,
    attachments?: any[],
    fromOverride?: string,
    cc?: string | string[],
    transporter?: Transporter,
  ): Promise<void> {
    const active = transporter ?? this.platformTransporter;
    if (!active) {
      throw new Error('Email transporter not initialized');
    }

    try {
      const mailOptions = {
        from: fromOverride?.trim() || this.emailFrom,
        to,
        subject,
        html,
        ...(bcc && { bcc }),
        ...(cc && (Array.isArray(cc) ? cc.length > 0 : !!cc) && { cc }),
        ...(attachments && { attachments }),
      };

      const info = await active.sendMail(mailOptions);
      const toLog = Array.isArray(to) ? to.join(', ') : to;
      this.logger.log(`Email sent to ${toLog}: ${info.messageId}`);
    } catch (error) {
      const toLog = Array.isArray(to) ? to.join(', ') : to;
      this.logger.error(
        `Failed to send email to ${toLog}: ${this.formatSmtpError(error)}`,
      );
      throw error;
    }
  }

  /**
   * Envía email con la cotización adjunta (SMTP auth = credenciales del tenant).
   * @param tenantId Tenant emisor (AD-12)
   * @param fromOverride Remitente del tenant (emailRemitente); si falta → EMAIL_FROM
   * @param cc Destinatarios CC (Story 6.6)
   * @param extras Branding/vigencia (Story 6.8)
   */
  async sendAdminQuotationEmail(
    tenantId: Types.ObjectId | string,
    email: string | string[],
    nombreContacto: string,
    folio: string,
    pdfBuffer: Buffer,
    magicToken?: string,
    fromOverride?: string,
    cc?: string[],
    extras?: { emisorNombre?: string; fechaVencimiento?: Date },
  ): Promise<void> {
    let magicLink: string | null = null;
    if (magicToken) {
      const frontendUrl = this.configService
        .get<string>('FRONTEND_URL')
        ?.trim();
      if (!frontendUrl) {
        this.logger.error(
          'FRONTEND_URL is not configured; cannot build magic link for quotation email',
        );
        throw new Error('FRONTEND_URL is not configured');
      }
      const base = frontendUrl.replace(/\/+$/, '');
      magicLink = `${base}/cotizacion-publica/${encodeURIComponent(magicToken)}`;
    }

    const safeNombre = this.escapeHtml(nombreContacto || 'Cliente');
    const safeFolio = this.escapeHtml(folio || '');
    const emisor =
      this.escapeHtml(extras?.emisorNombre?.trim() || '') || 'Aestimare';
    const vigenciaLabel = extras?.fechaVencimiento
      ? this.formatVigencia(extras.fechaVencimiento)
      : null;

    const html = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
        <h2 style="color: #111827; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">Hola, ${safeNombre}</h2>
        <p>Adjunto a este correo encontrarás la cotización <strong>${safeFolio}</strong> que solicitaste a <strong>${emisor}</strong>.</p>
        
        ${
          magicLink
            ? `
          <div style="margin: 30px 0; text-align: center;">
            <p style="margin-bottom: 15px; color: #4b5563;">Puedes ver los detalles y responder a esta cotización directamente haciendo clic en el siguiente botón:</p>
            <a href="${this.escapeHtml(magicLink)}" style="background-color: #3b82f6; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Responder Cotización</a>
            ${
              vigenciaLabel
                ? `<p style="margin-top: 10px; font-size: 12px; color: #9ca3af;">Este enlace es válido hasta el ${this.escapeHtml(vigenciaLabel)}.</p>`
                : ''
            }
          </div>
        `
            : ''
        }

        <p>Quedamos a tu disposición para cualquier duda o comentario.</p>
        <br>
        <div style="color: #6b7280; font-size: 14px;">
          <p>Atentamente,<br>
          <strong>Equipo de Ventas</strong><br>
          ${emisor}</p>
        </div>
      </div>
    `;

    const subjectEmisor = this.sanitizeSubjectPart(
      extras?.emisorNombre?.trim() || 'Aestimare',
    );
    const subjectFolio = this.sanitizeSubjectPart(folio || '');
    const { transporter: tenantTransporter, emailUser } =
      await this.createTenantTransporter(tenantId);
    const from = this.resolveTenantFrom(fromOverride, emailUser);
    try {
      await this.sendEmail(
        email,
        `Cotización ${subjectFolio} - ${subjectEmisor}`,
        html,
        this.emailFrom, // BCC copia global (≠ correosNotificacion FR-40)
        [
          {
            filename: `Cotizacion_${folio}.pdf`,
            content: pdfBuffer,
          },
        ],
        from,
        cc?.length ? cc : undefined,
        tenantTransporter,
      );
    } finally {
      this.closeTransporter(tenantTransporter);
    }
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private formatVigencia(date: Date): string {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    try {
      return d.toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return '';
    }
  }

  /**
   * Notificación interna accept/reject vía magic link (Story 6.13 / FR-37/38).
   * SMTP auth = credenciales del tenant de la cotización (Story 3.3).
   * Sin PDF ni magic link al cliente. Sin BCC EMAIL_FROM (≠ correosNotificacion).
   */
  async sendInternalDecisionNotification(params: {
    tenantId: Types.ObjectId | string;
    to: string[];
    folio: string;
    decision: 'aceptada' | 'rechazada';
    solicitanteLabel: string;
    fromOverride?: string;
  }): Promise<void> {
    const to = (params.to || [])
      .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
      .filter((e) => e && isEmail(e));
    if (to.length === 0) {
      throw new Error(
        'sendInternalDecisionNotification requiere al menos un destinatario',
      );
    }
    const safeFolio = this.escapeHtml(params.folio || '');
    const decisionLabel =
      params.decision === 'aceptada' ? 'aceptada' : 'rechazada';
    const safeDecision = this.escapeHtml(decisionLabel);
    const safeSolicitante = this.escapeHtml(
      params.solicitanteLabel?.trim() || 'Sin solicitante',
    );
    const html = quotationDecisionNotificationTemplate({
      folio: safeFolio,
      decisionLabel: safeDecision,
      solicitanteLabel: safeSolicitante,
    });
    const subjectFolio = this.sanitizeSubjectPart(params.folio || '');
    const { transporter: tenantTransporter, emailUser } =
      await this.createTenantTransporter(params.tenantId);
    const from = this.resolveTenantFrom(params.fromOverride, emailUser);
    try {
      await this.sendEmail(
        to,
        `Cotización ${subjectFolio} ${decisionLabel}`,
        html,
        undefined,
        undefined,
        from,
        undefined,
        tenantTransporter,
      );
    } finally {
      this.closeTransporter(tenantTransporter);
    }
  }

  /**
   * Aviso interno de recordatorio disparado (Story 10.1 / AD-33).
   * SMTP auth = credenciales del tenant. Sin emailsPara/emailsCc de la COT.
   */
  async sendReminderRecotizacionDisparo(params: {
    tenantId: Types.ObjectId | string;
    to: string[];
    folio: string;
    fromOverride?: string;
  }): Promise<void> {
    const to = (params.to || [])
      .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
      .filter((e) => e && isEmail(e));
    if (to.length === 0) {
      throw new Error(
        'sendReminderRecotizacionDisparo requiere al menos un destinatario',
      );
    }

    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    if (!frontendUrl) {
      this.logger.error(
        'FRONTEND_URL is not configured; cannot send reminder recotización email',
      );
      throw new Error('FRONTEND_URL is not configured');
    }

    const dashboardUrl = `${frontendUrl.replace(/\/+$/, '')}/admin#recordatorios-disparados`;
    const safeFolio = this.escapeHtml(params.folio || '');
    const safeDashboardUrl = this.escapeHtml(dashboardUrl);
    const html = reminderRecotizacionDisparoTemplate({
      folio: safeFolio,
      dashboardUrl: safeDashboardUrl,
    });
    const subjectFolio = this.sanitizeSubjectPart(params.folio || '');
    const subject = `Recordatorio de recotización · ${subjectFolio}`;

    const { transporter: tenantTransporter, emailUser } =
      await this.createTenantTransporter(params.tenantId);
    const from = this.resolveTenantFrom(params.fromOverride, emailUser);
    try {
      await this.sendEmail(
        to,
        subject,
        html,
        undefined,
        undefined,
        from,
        undefined,
        tenantTransporter,
      );
    } finally {
      this.closeTransporter(tenantTransporter);
    }
  }

  /**
   * Envía email de restablecimiento de contraseña (SMTP plataforma / EMAIL_* globales).
   */
  async sendPasswordResetEmail(
    email: string,
    nombre: string,
    token: string,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL')?.trim();
    if (!frontendUrl) {
      this.logger.error(
        'FRONTEND_URL is not configured; cannot send password reset email',
      );
      throw new Error('FRONTEND_URL is not configured');
    }

    const base = frontendUrl.replace(/\/+$/, '');
    const resetUrl = `${base}/admin/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;

    const html = passwordResetTemplate(
      this.escapeHtml(nombre || ''),
      this.escapeHtml(resetUrl),
    );

    await this.sendEmail(
      email,
      'Restablecer Contraseña - Aestimare',
      html,
      this.emailFrom,
    );
  }
}

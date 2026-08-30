import { Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { EmailsService } from './emails.service';
import { passwordResetTemplate } from './templates/password-reset.template';
import { quotationDecisionNotificationTemplate } from './templates/quotation-decision-notification.template';
import { reminderRecotizacionDisparoTemplate } from './templates/reminder-recotizacion-disparo.template';
import { TenantConfigService } from '../tenants/tenant-config.service';
import { TenantsService } from '../tenants/tenants.service';
import {
  encryptSecret,
  decryptSecret,
  resolveTenantSecretsKey,
  TenantSecretsKeyError,
} from '../tenants/tenant-secrets.crypto';
import { TenantEmailNotConfiguredError } from './tenant-email-not-configured.error';
import { TenantInactiveForOutboundError } from './tenant-inactive-for-outbound.error';
import * as emailsConfig from './emails.config';

const HEX_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TENANT_ID = new Types.ObjectId();

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    FRONTEND_URL: 'http://localhost:5173/',
    EMAIL_HOST: 'smtp.example.com',
    EMAIL_PORT: 587,
    EMAIL_USER: 'u',
    EMAIL_PASS: 'p',
    EMAIL_FROM: 'from@ames.test',
  };
  return {
    get: jest.fn((key: string) =>
      key in overrides ? overrides[key] : defaults[key],
    ),
  } as unknown as ConfigService;
}

function makeTenantConfig(
  auth: { emailUser: string; emailSecretEnc: string } | null = null,
): TenantConfigService {
  return {
    getOutboundSmtpAuth: jest.fn().mockResolvedValue(auth),
  } as unknown as TenantConfigService;
}

function makeTenantsService(
  tenant: { activo: boolean } | null = { activo: true },
): TenantsService {
  return {
    findById: jest.fn().mockResolvedValue(tenant),
  } as unknown as TenantsService;
}

function defaultAuth() {
  process.env.TENANT_SECRETS_KEY = HEX_KEY;
  return {
    emailUser: 'smtp@tenant.test',
    emailSecretEnc: encryptSecret('app-password-secret'),
  };
}

function makeService(
  configOverrides: Record<string, unknown> = {},
  auth: { emailUser: string; emailSecretEnc: string } | null = defaultAuth(),
  tenants: TenantsService = makeTenantsService(),
) {
  process.env.TENANT_SECRETS_KEY = HEX_KEY;
  return new EmailsService(
    makeConfig(configOverrides),
    makeTenantConfig(auth),
    tenants,
  );
}

describe('EmailsService.sendPasswordResetEmail', () => {
  it('construye URL con /admin/reset-password (path plataforma, sin getOutbound)', async () => {
    const tenantConfig = makeTenantConfig(null);
    const service = new EmailsService(
      makeConfig(),
      tenantConfig,
      makeTenantsService(),
    );
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendPasswordResetEmail('u@ames.test', 'User', 'tok123');

    expect(tenantConfig.getOutboundSmtpAuth).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledWith(
      'u@ames.test',
      'Restablecer Contraseña - Aestimare',
      expect.stringContaining(
        'http://localhost:5173/admin/reset-password?token=tok123&amp;email=u%40ames.test',
      ),
    );
    expect(sendEmail.mock.calls[0]).toHaveLength(3);
    const [, subject, html] = sendEmail.mock.calls[0];
    expect(subject).not.toContain('AMES');
    expect(subject).not.toContain('Cotizador AMES');
    expect(html).toContain('cuenta Aestimare');
    expect(html).not.toContain('cuenta AMES');
  });

  it('escapa nombre en HTML del reset (XSS correo)', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendPasswordResetEmail(
      'u@ames.test',
      `<img src=x onerror=alert(1)>`,
      'tok123',
    );

    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('sin FRONTEND_URL lanza error', async () => {
    const service = makeService({ FRONTEND_URL: undefined });

    await expect(
      service.sendPasswordResetEmail('u@ames.test', 'User', 'tok'),
    ).rejects.toThrow(/FRONTEND_URL/);
  });

  it('sendMail: to usuario, from EMAIL_FROM, sin bcc, con enlace de reset', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'mid-reset' });
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail,
      close: jest.fn(),
    } as any);
    const service = new EmailsService(
      makeConfig(),
      makeTenantConfig(null),
      makeTenantsService(),
    );

    try {
      await service.sendPasswordResetEmail('u@ames.test', 'User', 'tok123');

      expect(sendMail).toHaveBeenCalledTimes(1);
      const mailOptions = sendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe('u@ames.test');
      expect(mailOptions.from).toBe('from@ames.test');
      expect(mailOptions).not.toHaveProperty('bcc');
      expect(mailOptions.html).toContain(
        'http://localhost:5173/admin/reset-password?token=tok123&amp;email=u%40ames.test',
      );
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe('passwordResetTemplate', () => {
  it('usa wording Aestimare de producto', () => {
    const html = passwordResetTemplate('Ana', 'http://x/admin/reset-password');
    expect(html).toContain('cuenta Aestimare');
    expect(html).toContain('Aestimare. Todos los derechos reservados');
    expect(html).not.toContain('cuenta AMES');
    expect(html).not.toContain('Cotizador AMES');
    expect(html).not.toContain('cuenta de Administrador');
  });
});

describe('EmailsService.sendAdminQuotationEmail (Story 6.8 + 3.3)', () => {
  const pdf = Buffer.from('%PDF-1.4');

  afterEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
    jest.restoreAllMocks();
  });

  it('escapa nombreContacto en HTML (XSS correo)', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      `<img src=x onerror=alert(1)>`,
      'COT-2026-0001',
      pdf,
      'abc123',
      undefined,
      undefined,
      { emisorNombre: 'AMES Test', fechaVencimiento: new Date('2026-12-31') },
    );

    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
  });

  it('usa emisor/vigencia reales sin literales MOC/30 días', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-2026-0001',
      pdf,
      'tok',
      undefined,
      undefined,
      {
        emisorNombre: 'Clínica Demo SA',
        fechaVencimiento: new Date('2026-12-31T12:00:00.000Z'),
      },
    );

    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('Clínica Demo SA');
    expect(html).not.toContain('Médica Ocupacional Caborca');
    expect(html).not.toContain('30 días');
    expect(html).toMatch(/válido hasta el /);
  });

  it('sin emisorNombre usa fallback Aestimare (no AMES)', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-2026-0001',
      pdf,
    );

    const [, , html] = sendEmail.mock.calls[0];
    const subject = sendEmail.mock.calls[0][1] as string;
    expect(subject).toBe('Cotización COT-2026-0001 - Aestimare');
    expect(subject).not.toMatch(/\bAMES\b/);
    expect(html).toContain('Aestimare');
    expect(html).not.toMatch(/solicitaste a <strong>AMES<\/strong>/);
  });

  it('arma magic link normalizado y falla sin FRONTEND_URL', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-1',
      pdf,
      'deadbeef',
    );

    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('http://localhost:5173/cotizacion-publica/deadbeef');
    expect(html).not.toContain('undefined/cotizacion-publica');
    expect(html).not.toContain('//cotizacion-publica');

    const broken = makeService({ FRONTEND_URL: undefined });
    await expect(
      broken.sendAdminQuotationEmail(
        TENANT_ID,
        'a@x.com',
        'Ana',
        'COT-1',
        pdf,
        'tok',
      ),
    ).rejects.toThrow(/FRONTEND_URL/);
  });

  it('pasa fromOverride al sendEmail y usa transporter tenant', async () => {
    const close = jest.fn();
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({ messageId: 'x' }),
      close,
    } as any);
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      ['a@x.com'],
      'Ana',
      'COT-1',
      pdf,
      undefined,
      'remitente@tenant.test',
      ['cc@x.com'],
    );

    expect(sendEmail).toHaveBeenCalledWith(
      ['a@x.com'],
      expect.stringContaining('COT-1'),
      expect.any(String),
      'from@ames.test',
      expect.arrayContaining([
        expect.objectContaining({ filename: 'Cotizacion_COT-1.pdf' }),
      ]),
      'remitente@tenant.test',
      ['cc@x.com'],
      expect.anything(), // tenant transporter
    );
    expect(close).toHaveBeenCalled();
  });

  it('sin fromOverride usa emailUser del tenant (no EMAIL_FROM)', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-1',
      pdf,
    );

    expect(sendEmail.mock.calls[0][5]).toBe('smtp@tenant.test');
    expect(sendEmail.mock.calls[0][5]).not.toBe('from@ames.test');
  });

  it('sanitiza CR/LF en subject de cotización', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-1\r\nBcc: evil@x.com',
      pdf,
      undefined,
      undefined,
      undefined,
      { emisorNombre: 'Acme\nInc' },
    );

    expect(sendEmail.mock.calls[0][1]).toBe('Cotización COT-1 Bcc: evil@x.com - Acme Inc');
  });

  it('tenantId malformado falla antes de SMTP', async () => {
    const sendMail = jest.fn();
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail,
      close: jest.fn(),
    } as any);
    const service = makeService();
    await expect(
      service.sendAdminQuotationEmail(
        'not-an-objectid',
        'a@x.com',
        'Ana',
        'COT-1',
        pdf,
      ),
    ).rejects.toThrow(/tenantId inválido/);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sin credenciales tenant no llama sendMail', async () => {
    const sendMail = jest.fn();
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail,
    } as any);
    const service = makeService({}, null);

    await expect(
      service.sendAdminQuotationEmail(
        TENANT_ID,
        'a@x.com',
        'Ana',
        'COT-1',
        pdf,
      ),
    ).rejects.toBeInstanceOf(TenantEmailNotConfiguredError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('tenant inactivo bloquea outbound (AD-14)', async () => {
    const sendMail = jest.fn();
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail,
      close: jest.fn(),
    } as any);
    const service = makeService(
      {},
      defaultAuth(),
      makeTenantsService({ activo: false }),
    );

    await expect(
      service.sendAdminQuotationEmail(
        TENANT_ID,
        'a@x.com',
        'Ana',
        'COT-1',
        pdf,
      ),
    ).rejects.toBeInstanceOf(TenantInactiveForOutboundError);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('autentica SMTP con emailUser + pass descifrado del tenant', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'mid-1' });
    const createSpy = jest
      .spyOn(emailsConfig, 'createTransporter')
      .mockReturnValue({ sendMail } as any);
    const auth = defaultAuth();
    const service = makeService({}, auth);

    await service.sendAdminQuotationEmail(
      TENANT_ID,
      'a@x.com',
      'Ana',
      'COT-1',
      pdf,
    );

    // Primer createTransporter = platform boot; último = tenant send
    const tenantCall = createSpy.mock.calls[createSpy.mock.calls.length - 1];
    expect(tenantCall[0]).toBe('smtp.example.com');
    expect(tenantCall[1]).toBe(587);
    expect(tenantCall[2]).toBe('smtp@tenant.test');
    expect(tenantCall[3]).toBe('app-password-secret');
    expect(tenantCall[3]).not.toBe(auth.emailSecretEnc);
    expect(sendMail).toHaveBeenCalled();
  });

  it('formatVigencia omite Invalid Date', () => {
    const service = makeService();
    const label = (service as any).formatVigencia(new Date('nope'));
    expect(label).toBe('');
  });

  it('log de fallo SMTP no incluye plaintext del pass', async () => {
    const sendMail = jest.fn().mockRejectedValue({
      message: 'Invalid login',
      code: 'EAUTH',
      responseCode: 535,
      auth: { user: 'smtp@tenant.test', pass: 'app-password-secret' },
    });
    jest.spyOn(emailsConfig, 'createTransporter').mockReturnValue({
      sendMail,
    } as any);
    const service = makeService();
    const errorSpy = jest.spyOn((service as any).logger, 'error');

    await expect(
      service.sendAdminQuotationEmail(
        TENANT_ID,
        'a@x.com',
        'Ana',
        'COT-1',
        pdf,
      ),
    ).rejects.toBeTruthy();

    const logged = errorSpy.mock.calls.map((c) => String(c[0])).join(' ');
    expect(logged).toContain('Invalid login');
    expect(logged).not.toContain('app-password-secret');
  });
});

describe('EmailsService.sendInternalDecisionNotification (Story 6.13 + 3.3)', () => {
  afterEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
    jest.restoreAllMocks();
  });

  it('escapa folio/solicitante y usa fromOverride sin BCC; pide auth del tenantId', async () => {
    const tenantConfig = makeTenantConfig(defaultAuth());
    const service = new EmailsService(
      makeConfig(),
      tenantConfig,
      makeTenantsService(),
    );
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendInternalDecisionNotification({
      tenantId: TENANT_ID,
      to: ['a@ames.test', 'b@ames.test'],
      folio: 'COT<script>',
      decision: 'aceptada',
      solicitanteLabel: '<Acme>',
      fromOverride: 'remitente@tenant.test',
    });

    expect(tenantConfig.getOutboundSmtpAuth).toHaveBeenCalledWith(TENANT_ID);
    expect(sendEmail).toHaveBeenCalledWith(
      ['a@ames.test', 'b@ames.test'],
      'Cotización COT<script> aceptada',
      expect.any(String),
      undefined,
      undefined,
      'remitente@tenant.test',
      undefined,
      expect.anything(),
    );
    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('COT&lt;script&gt;');
    expect(html).toContain('&lt;Acme&gt;');
    expect(html).toContain('aceptada');
    expect(html).not.toContain('<script>');
  });

  it('sanitiza CR/LF en subject y filtra emails inválidos', async () => {
    const service = makeService();
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendInternalDecisionNotification({
      tenantId: TENANT_ID,
      to: ['ok@ames.test', 'no-es-email', ''],
      folio: 'COT-1\r\nBcc: evil@x.com',
      decision: 'rechazada',
      solicitanteLabel: 'X',
    });

    expect(sendEmail).toHaveBeenCalledWith(
      ['ok@ames.test'],
      'Cotización COT-1 Bcc: evil@x.com rechazada',
      expect.any(String),
      undefined,
      undefined,
      expect.any(String),
      undefined,
      expect.anything(),
    );
  });

  it('sin destinatarios lanza (antes de auth)', async () => {
    const tenantConfig = makeTenantConfig(defaultAuth());
    const service = new EmailsService(
      makeConfig(),
      tenantConfig,
      makeTenantsService(),
    );
    await expect(
      service.sendInternalDecisionNotification({
        tenantId: TENANT_ID,
        to: [],
        folio: 'COT-1',
        decision: 'rechazada',
        solicitanteLabel: 'X',
      }),
    ).rejects.toThrow(/destinatario/);
    expect(tenantConfig.getOutboundSmtpAuth).not.toHaveBeenCalled();
  });
});

describe('EmailsService.sendReminderRecotizacionDisparo (Story 10.1)', () => {
  afterEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
    jest.restoreAllMocks();
  });

  it('asunto, enlace dashboard y copy único; pide auth del tenant', async () => {
    const tenantConfig = makeTenantConfig(defaultAuth());
    const service = new EmailsService(
      makeConfig(),
      tenantConfig,
      makeTenantsService(),
    );
    const sendEmail = jest
      .spyOn(service as any, 'sendEmail')
      .mockResolvedValue(undefined);

    await service.sendReminderRecotizacionDisparo({
      tenantId: TENANT_ID,
      to: ['a@ames.test'],
      folio: 'COT-42',
      cotizacionId: '507f1f77bcf86cd799439012',
      nombreCliente: 'AITSA',
      nombreContacto: 'Luis Zavala',
      telefonoContacto: '6681234567',
      emailContacto: 'luis@aitsa.mx',
      fechaCreacion: new Date('2026-08-07T18:00:00.000Z'),
      fromOverride: 'remitente@tenant.test',
    });

    expect(tenantConfig.getOutboundSmtpAuth).toHaveBeenCalledWith(TENANT_ID);
    expect(sendEmail).toHaveBeenCalledWith(
      ['a@ames.test'],
      'Es momento de contactar a AITSA · COT-42',
      expect.any(String),
      undefined,
      undefined,
      'remitente@tenant.test',
      undefined,
      expect.anything(),
    );
    const html = sendEmail.mock.calls[0][2] as string;
    expect(html).toContain('COT-42');
    expect(html).toContain('AITSA');
    expect(html).toContain('Luis Zavala');
    expect(html).toContain('Ver seguimiento en Aestimare');
    expect(html).toContain('Volver a cotizar');
    expect(html).toContain('http://localhost:5173/admin#recordatorios-disparados');
    expect(html).toContain(
      'http://localhost:5173/admin/cotizaciones/507f1f77bcf86cd799439012?volverACotizar=1',
    );
    expect(html).not.toContain('recotizar');
    expect(html).not.toContain('recordatorios disparados');
    expect(html).not.toContain('correo interno');
  });

  it('tenant inactivo rechaza envío', async () => {
    const service = makeService(
      {},
      defaultAuth(),
      makeTenantsService({ activo: false }),
    );
    await expect(
      service.sendReminderRecotizacionDisparo({
        tenantId: TENANT_ID,
        to: ['a@ames.test'],
        folio: 'COT-1',
        cotizacionId: 'id-1',
        nombreCliente: 'Acme',
      }),
    ).rejects.toBeInstanceOf(TenantInactiveForOutboundError);
  });

  it('sin destinatarios lanza (antes de auth)', async () => {
    const tenantConfig = makeTenantConfig(defaultAuth());
    const service = new EmailsService(
      makeConfig(),
      tenantConfig,
      makeTenantsService(),
    );
    await expect(
      service.sendReminderRecotizacionDisparo({
        tenantId: TENANT_ID,
        to: [],
        folio: 'COT-1',
        cotizacionId: 'id-1',
        nombreCliente: 'Acme',
      }),
    ).rejects.toThrow(/destinatario/);
    expect(tenantConfig.getOutboundSmtpAuth).not.toHaveBeenCalled();
  });

  it('FRONTEND_URL ausente lanza', async () => {
    const service = makeService({ FRONTEND_URL: '' });
    await expect(
      service.sendReminderRecotizacionDisparo({
        tenantId: TENANT_ID,
        to: ['a@ames.test'],
        folio: 'COT-1',
        cotizacionId: 'id-1',
        nombreCliente: 'Acme',
      }),
    ).rejects.toThrow(/FRONTEND_URL/);
  });
});

describe('reminderRecotizacionDisparoTemplate', () => {
  it('incluye folio, cliente y CTAs', () => {
    const html = reminderRecotizacionDisparoTemplate({
      folio: 'COT-99',
      nombreCliente: 'AITSA',
      dashboardUrl: 'https://app.test/admin#recordatorios-disparados',
      detalleUrl: 'https://app.test/admin/cotizaciones/abc?volverACotizar=1',
      nombreContacto: 'Luis',
    });
    expect(html).toContain('COT-99');
    expect(html).toContain('AITSA');
    expect(html).toContain('Ver seguimiento en Aestimare');
    expect(html).toContain('Volver a cotizar');
    expect(html).toContain('únicamente para tu equipo');
    expect(html).not.toContain('recotizar');
  });
});

describe('quotationDecisionNotificationTemplate', () => {
  it('incluye folio y decisión', () => {
    const html = quotationDecisionNotificationTemplate({
      folio: 'COT-1',
      decisionLabel: 'rechazada',
      solicitanteLabel: 'Acme / Ana',
    });
    expect(html).toContain('COT-1');
    expect(html).toContain('rechazada');
    expect(html).toContain('Acme / Ana');
  });
});

describe('decryptSecret auth failures (Story 3.3)', () => {
  afterEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
  });

  it('tag/clave incorrecta → TenantSecretsKeyError (no Error crudo)', () => {
    process.env.TENANT_SECRETS_KEY = HEX_KEY;
    const blob = encryptSecret('secret');
    const otherKey = resolveTenantSecretsKey(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    );
    expect(() => decryptSecret(blob, otherKey)).toThrow(TenantSecretsKeyError);
  });
});

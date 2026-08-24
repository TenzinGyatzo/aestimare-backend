import { Types } from 'mongoose';
import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';

describe('TenantConfigService (Stories 2.1–2.5 + 3.2)', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();
  const HEX_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  const store = new Map<string, any>();

  function makeDoc(
    tid: Types.ObjectId,
    branding: Record<string, unknown> = {},
  ) {
    return {
      _id: new Types.ObjectId(),
      tenantId: tid,
      branding: { ...branding },
      bancarios: {},
      vigenciaDefaultDias: 30,
      correosNotificacion: [],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      toObject() {
        return {
          ...this,
          branding: { ...this.branding },
          bancarios: { ...(this.bancarios || {}) },
        };
      },
    };
  }

  function chainable(exec: () => Promise<any>) {
    const q: { select: (fields: string) => typeof q; exec: typeof exec } = {
      select: () => q,
      exec,
    };
    return q;
  }

  const tenantConfigModel = {
    findOne: jest.fn((q: { tenantId: Types.ObjectId }) =>
      chainable(async () => store.get(String(q.tenantId)) || null),
    ),
    findOneAndUpdate: jest.fn(
      (filter: { tenantId: Types.ObjectId }, update: any, _opts: unknown) =>
        chainable(async () => {
          const key = String(filter.tenantId);
          let doc = store.get(key);
          if (!doc) {
            const insert = update?.$setOnInsert || {
              tenantId: filter.tenantId,
            };
            doc = makeDoc(filter.tenantId, insert.branding || {});
            if (insert.vigenciaDefaultDias != null) {
              doc.vigenciaDefaultDias = insert.vigenciaDefaultDias;
            }
            if (insert.bancarios) doc.bancarios = { ...insert.bancarios };
            if (insert.correosNotificacion) {
              doc.correosNotificacion = [...insert.correosNotificacion];
            }
            store.set(key, doc);
          }
          if (update?.$set) {
            for (const [path, val] of Object.entries(update.$set)) {
              if (path.startsWith('branding.')) {
                const field = path.slice('branding.'.length);
                doc.branding = doc.branding || {};
                doc.branding[field] = val;
              } else if (path.startsWith('bancarios.')) {
                const field = path.slice('bancarios.'.length);
                doc.bancarios = doc.bancarios || {};
                doc.bancarios[field] = val;
              } else {
                doc[path] = val;
              }
            }
          }
          if (update?.$unset) {
            for (const path of Object.keys(update.$unset)) {
              if (path.startsWith('branding.')) {
                const field = path.slice('branding.'.length);
                if (doc.branding) delete doc.branding[field];
              } else if (path.startsWith('bancarios.')) {
                const field = path.slice('bancarios.'.length);
                if (doc.bancarios) delete doc.bancarios[field];
              } else {
                delete doc[path];
              }
            }
          }
          return doc;
        }),
    ),
  };

  const tenantContext = {
    getTenantId: jest.fn(() => tenantId),
  };

  const tenantStore = new Map<string, { nombre?: string; clave?: string }>();

  function tenantChainable(exec: () => Promise<any>) {
    const q: {
      select: (fields: string) => typeof q;
      lean: () => typeof q;
      exec: typeof exec;
    } = {
      select: () => q,
      lean: () => q,
      exec,
    };
    return q;
  }

  const tenantModel = {
    findById: jest.fn((id: Types.ObjectId | string) =>
      tenantChainable(async () => tenantStore.get(String(id)) || null),
    ),
  };

  let service: TenantConfigService;

  beforeEach(() => {
    store.clear();
    tenantStore.clear();
    jest.clearAllMocks();
    process.env.TENANT_SECRETS_KEY = HEX_KEY;
    service = new TenantConfigService(
      tenantConfigModel as any,
      tenantModel as any,
      tenantContext as any,
    );
  });

  afterEach(() => {
    delete process.env.TENANT_SECRETS_KEY;
  });

  it('findOrCreateForTenant crea shell vía upsert si no existe', async () => {
    const doc = await service.findOrCreateForTenant(tenantId);
    expect(doc.tenantId).toEqual(tenantId);
    expect(tenantConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
      { tenantId },
      {
        $setOnInsert: {
          tenantId,
          branding: {},
          correosNotificacion: [],
          vigenciaDefaultDias: 30,
          bancarios: {},
        },
      },
      { upsert: true, new: true },
    );
  });

  it('findOrCreateForTenant es idempotente (segundo call no duplica)', async () => {
    await service.findOrCreateForTenant(tenantId);
    await service.findOrCreateForTenant(tenantId);
    expect(store.size).toBe(1);
    expect(tenantConfigModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('getForRequest usa tenant del contexto (AD-2)', async () => {
    const doc = await service.getForRequest();
    expect(tenantContext.getTenantId).toHaveBeenCalled();
    expect(doc.tenantId).toEqual(tenantId);
  });

  it('findOrCreate scoped por tenantId (no mezcla tenants)', async () => {
    const a = await service.findOrCreateForTenant(tenantId);
    const b = await service.findOrCreateForTenant(otherTenantId);
    expect(String(a.tenantId)).not.toEqual(String(b.tenantId));
    expect(store.size).toBe(2);
  });

  it('toResponse serializa ids, fechas ISO y branding', () => {
    const doc = makeDoc(tenantId, {
      razonSocial: 'AMES QRO',
      logoUrl: '/uploads/tenant-logos/x.png',
    }) as any;
    const res = service.toResponse(doc);
    expect(res._id).toBe(String(doc._id));
    expect(res.tenantId).toBe(String(tenantId));
    expect(res.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(res.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(res.branding?.razonSocial).toBe('AMES QRO');
    expect(res.branding?.logoUrl).toBe('/uploads/tenant-logos/x.png');
  });

  it('findOrCreate recupera doc tras E11000 de carrera', async () => {
    const existing = makeDoc(tenantId);
    store.set(String(tenantId), existing);
    tenantConfigModel.findOneAndUpdate.mockReturnValueOnce(
      chainable(async () => {
        const err: any = new Error('E11000 duplicate');
        err.code = 11000;
        throw err;
      }),
    );

    const doc = await service.findOrCreateForTenant(tenantId);
    expect(doc).toBe(existing);
  });

  it('updateBranding aplica $set solo en tenant del contexto', async () => {
    await service.findOrCreateForTenant(tenantId);
    const updated = await service.updateBranding({
      razonSocial: 'AMES Los Mochis',
      rfc: 'aaa010101aaa',
    });
    expect(updated.branding.razonSocial).toBe('AMES Los Mochis');
    expect(updated.branding.rfc).toBe('aaa010101aaa');
    expect(tenantContext.getTenantId).toHaveBeenCalled();
  });

  it('updateBranding con string vacío limpia campo ($unset)', async () => {
    store.set(
      String(tenantId),
      makeDoc(tenantId, { razonSocial: 'Temp', telefono: '123' }),
    );
    const updated = await service.updateBranding({ razonSocial: '' });
    expect(updated.branding.razonSocial).toBeUndefined();
    expect(updated.branding.telefono).toBe('123');
  });

  it('updateBranding con null limpia campo ($unset)', async () => {
    store.set(
      String(tenantId),
      makeDoc(tenantId, { emailContacto: 'a@b.com' }),
    );
    const updated = await service.updateBranding({
      emailContacto: null as any,
    });
    expect(updated.branding.emailContacto).toBeUndefined();
  });

  it('saveLogo rechaza mime inválido', async () => {
    await expect(
      service.saveLogo({
        buffer: Buffer.from('x'),
        size: 10,
        mimetype: 'application/pdf',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saveLogo acepta image/jpg (alias) y mime con parámetros', async () => {
    // Evitar escribir en disco real: mock interno vía spy de write
    const writeSpy = jest
      .spyOn(require('fs'), 'writeFileSync')
      .mockImplementation(() => undefined);
    const existsSpy = jest
      .spyOn(require('fs'), 'existsSync')
      .mockReturnValue(false);
    const mkdirSpy = jest
      .spyOn(require('fs'), 'mkdirSync')
      .mockImplementation(() => undefined as any);

    try {
      await service.findOrCreateForTenant(tenantId);
      const updated = await service.saveLogo({
        buffer: Buffer.from('fake'),
        size: 4,
        mimetype: 'Image/JPG; charset=binary',
      } as any);
      expect(updated.branding.logoUrl).toMatch(/\.jpg$/);
      expect(writeSpy).toHaveBeenCalled();
    } finally {
      writeSpy.mockRestore();
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    }
  });

  it('saveLogo rechaza archivo vacío', async () => {
    await expect(
      service.saveLogo({
        buffer: Buffer.alloc(0),
        size: 0,
        mimetype: 'image/png',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('saveBankLogo setea bancarios.logoUrl sin pisar branding.logoUrl', async () => {
    const writeSpy = jest
      .spyOn(require('fs'), 'writeFileSync')
      .mockImplementation(() => undefined);
    const existsSpy = jest
      .spyOn(require('fs'), 'existsSync')
      .mockReturnValue(false);
    const mkdirSpy = jest
      .spyOn(require('fs'), 'mkdirSync')
      .mockImplementation(() => undefined as any);

    try {
      const existing = makeDoc(tenantId, {
        logoUrl: '/uploads/tenant-logos/brand.png',
      });
      store.set(String(tenantId), existing);
      const updated = await service.saveBankLogo({
        buffer: Buffer.from('fake'),
        size: 4,
        mimetype: 'image/png',
      } as any);
      expect(updated.bancarios?.logoUrl).toMatch(
        /\/uploads\/tenant-bank-logos\//,
      );
      expect(updated.branding?.logoUrl).toBe('/uploads/tenant-logos/brand.png');
      const resp = service.toResponse(updated as any);
      expect(resp.bancarios?.logoUrl).toMatch(/tenant-bank-logos/);
      expect(resp.branding?.logoUrl).toBe('/uploads/tenant-logos/brand.png');
    } finally {
      writeSpy.mockRestore();
      existsSpy.mockRestore();
      mkdirSpy.mockRestore();
    }
  });

  it('updateVigenciaBancarios con bancarios null limpia disco de logo banco', async () => {
    const doc = makeDoc(tenantId);
    doc.bancarios = {
      logoUrl: '/uploads/tenant-bank-logos/x.png',
      banco: 'BBVA',
    };
    store.set(String(tenantId), doc);
    const existsSpy = jest
      .spyOn(require('fs'), 'existsSync')
      .mockReturnValue(true);
    const unlinkSpy = jest
      .spyOn(require('fs'), 'unlinkSync')
      .mockImplementation(() => undefined);
    try {
      const updated = await service.updateVigenciaBancarios({
        bancarios: null as any,
      });
      expect(updated.bancarios).toBeUndefined();
      expect(unlinkSpy).toHaveBeenCalled();
    } finally {
      existsSpy.mockRestore();
      unlinkSpy.mockRestore();
    }
  });

  it('saveBankLogo rechaza mime inválido', async () => {
    await expect(
      service.saveBankLogo({
        buffer: Buffer.from('x'),
        size: 10,
        mimetype: 'text/plain',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clearBankLogo limpia bancarios.logoUrl', async () => {
    const doc = makeDoc(tenantId);
    doc.bancarios = {
      logoUrl: '/uploads/tenant-bank-logos/x.png',
      banco: 'BBVA',
    };
    store.set(String(tenantId), doc);
    const existsSpy = jest
      .spyOn(require('fs'), 'existsSync')
      .mockReturnValue(false);
    try {
      const updated = await service.clearBankLogo();
      expect(updated.bancarios?.logoUrl).toBeUndefined();
      expect(updated.bancarios?.banco).toBe('BBVA');
    } finally {
      existsSpy.mockRestore();
    }
  });

  it('updateVigenciaBancarios no borra logoUrl al guardar textos', async () => {
    const doc = makeDoc(tenantId);
    doc.bancarios = {
      logoUrl: '/uploads/tenant-bank-logos/x.png',
      banco: 'Old',
    };
    store.set(String(tenantId), doc);
    const updated = await service.updateVigenciaBancarios({
      bancarios: { banco: 'Nuevo' },
    });
    expect(updated.bancarios?.banco).toBe('Nuevo');
    expect(updated.bancarios?.logoUrl).toBe('/uploads/tenant-bank-logos/x.png');
  });

  it('updateEmailConfig guarda remitente y lista scoped al tenant', async () => {
    await service.findOrCreateForTenant(tenantId);
    const updated = await service.updateEmailConfig({
      emailRemitente: 'qro@ames.example',
      correosNotificacion: [
        'a@ames.example',
        'A@ames.example',
        'b@ames.example',
      ],
    });
    expect(updated.emailRemitente).toBe('qro@ames.example');
    expect(updated.correosNotificacion).toEqual([
      'a@ames.example',
      'b@ames.example',
    ]);
  });
  it('updateEmailConfig acepta lista vacía', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      correosNotificacion: ['x@y.com'],
    });
    const updated = await service.updateEmailConfig({
      correosNotificacion: [],
    });
    expect(updated.correosNotificacion).toEqual([]);
  });

  it('updateEmailConfig con emailRemitente vacío hace $unset', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailRemitente: 'old@ames.example',
    });
    const updated = await service.updateEmailConfig({ emailRemitente: '' });
    expect(updated.emailRemitente).toBeUndefined();
  });

  it('updateEmailConfig null en lista persiste []', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      correosNotificacion: ['x@y.com'],
    });
    const updated = await service.updateEmailConfig({
      correosNotificacion: null as any,
    });
    expect(updated.correosNotificacion).toEqual([]);
  });

  it('updateEmailConfig rechaza ítems no-string', async () => {
    await expect(
      service.updateEmailConfig({
        correosNotificacion: ['a@b.com', 123 as any],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('toResponse incluye emailRemitente y correosNotificacion []', () => {
    const doc = {
      ...makeDoc(tenantId),
      emailRemitente: 'from@ames.example',
    } as any;
    const res = service.toResponse(doc);
    expect(res.emailRemitente).toBe('from@ames.example');
    expect(res.correosNotificacion).toEqual([]);
    expect(res.emailCredentialsConfigured).toBe(false);
    expect((res as any).emailSecretEnc).toBeUndefined();
  });

  it('updateEmailConfig cifra emailPass y no filtra secret en toResponse', async () => {
    await service.findOrCreateForTenant(tenantId);
    const updated = await service.updateEmailConfig({
      emailUser: 'smtp@tenant.example',
      emailPass: 'app-password-16ch',
      emailRemitente: 'from@tenant.example',
    });
    expect(updated.emailUser).toBe('smtp@tenant.example');
    expect(updated.emailSecretEnc).toBeTruthy();
    expect(updated.emailSecretEnc).not.toContain('app-password-16ch');
    expect(updated.emailRemitente).toBe('from@tenant.example');
    const res = service.toResponse(updated as any);
    expect(res.emailUser).toBe('smtp@tenant.example');
    expect(res.emailCredentialsConfigured).toBe(true);
    expect((res as any).emailSecretEnc).toBeUndefined();
    expect((res as any).emailPass).toBeUndefined();
  });

  it('updateEmailConfig rota solo emailPass con emailUser existente', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'old-blob',
    });
    const updated = await service.updateEmailConfig({
      emailPass: 'new-app-password',
    });
    expect(updated.emailUser).toBe('smtp@tenant.example');
    expect(updated.emailSecretEnc).toBeTruthy();
    expect(updated.emailSecretEnc).not.toBe('old-blob');
    expect(updated.emailSecretEnc).not.toContain('new-app-password');
  });

  it('updateEmailConfig exige emailUser en primera config con pass', async () => {
    await service.findOrCreateForTenant(tenantId);
    await expect(
      service.updateEmailConfig({ emailPass: 'solo-pass' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateEmailConfig exige emailPass al cambiar emailUser con secret', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'old-blob',
    });
    await expect(
      service.updateEmailConfig({ emailUser: 'otra@tenant.example' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateEmailConfig permite mismo emailUser sin pass', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'old-blob',
    });
    const updated = await service.updateEmailConfig({
      emailUser: 'smtp@tenant.example',
      emailRemitente: 'from@tenant.example',
    });
    expect(updated.emailUser).toBe('smtp@tenant.example');
    expect(updated.emailSecretEnc).toBe('old-blob');
    expect(updated.emailRemitente).toBe('from@tenant.example');
  });

  it('updateEmailConfig rechaza emailPass solo espacios', async () => {
    await service.findOrCreateForTenant(tenantId);
    await expect(
      service.updateEmailConfig({
        emailUser: 'smtp@tenant.example',
        emailPass: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateEmailConfig rechaza limpiar emailUser junto con emailPass', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'old-blob',
    });
    await expect(
      service.updateEmailConfig({ emailUser: '', emailPass: 'new-pass' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('getOutboundSmtpAuth retorna user+secretEnc o null', async () => {
    expect(await service.getOutboundSmtpAuth(tenantId)).toBeNull();
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'blob-enc',
    });
    await expect(service.getOutboundSmtpAuth(tenantId)).resolves.toEqual({
      emailUser: 'smtp@tenant.example',
      emailSecretEnc: 'blob-enc',
    });
  });

  it('updateEmailConfig mapea TenantSecretsKeyError a 500', async () => {
    const prev = process.env.TENANT_SECRETS_KEY;
    delete process.env.TENANT_SECRETS_KEY;
    await service.findOrCreateForTenant(tenantId);
    try {
      await expect(
        service.updateEmailConfig({
          emailUser: 'smtp@tenant.example',
          emailPass: 'app-password-16ch',
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    } finally {
      if (prev !== undefined) process.env.TENANT_SECRETS_KEY = prev;
      else delete process.env.TENANT_SECRETS_KEY;
    }
  });

  it('updateVigenciaBancarios guarda días y bancarios scoped', async () => {
    await service.findOrCreateForTenant(tenantId);
    const updated = await service.updateVigenciaBancarios({
      vigenciaDefaultDias: 45,
      bancarios: {
        titular: 'AMES QRO',
        banco: 'BBVA',
        cuenta: '123',
        clabe: '012345678901234567',
      },
    });
    expect(updated.vigenciaDefaultDias).toBe(45);
    expect(updated.bancarios.banco).toBe('BBVA');
    expect(updated.bancarios.clabe).toBe('012345678901234567');
  });

  it('updateVigenciaBancarios acepta bancarios vacíos (limpia campos)', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      bancarios: { banco: 'BBVA', cuenta: '1' },
      vigenciaDefaultDias: 30,
    });
    const updated = await service.updateVigenciaBancarios({
      bancarios: { banco: '', cuenta: '' },
    });
    expect(updated.bancarios.banco).toBeUndefined();
    expect(updated.bancarios.cuenta).toBeUndefined();
  });

  it('updateVigenciaBancarios con bancarios null limpia el subdocumento', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      bancarios: { banco: 'BBVA', cuenta: '1', clabe: '012' },
      vigenciaDefaultDias: 30,
    });
    const updated = await service.updateVigenciaBancarios({
      bancarios: null as any,
    });
    expect(updated.bancarios).toBeUndefined();
  });

  it('toResponse incluye vigenciaDefaultDias y bancarios', () => {
    const doc = {
      ...makeDoc(tenantId),
      vigenciaDefaultDias: 60,
      bancarios: { banco: 'Banorte', clabe: '111' },
    } as any;
    const res = service.toResponse(doc);
    expect(res.vigenciaDefaultDias).toBe(60);
    expect(res.bancarios?.banco).toBe('Banorte');
    expect(res.bancarios?.clabe).toBe('111');
  });

  it('updateVigenciaBancarios setea defaults de cotización nueva (true/false)', async () => {
    await service.findOrCreateForTenant(tenantId);
    const updated = await service.updateVigenciaBancarios({
      defaultIncluirDatosBancarios: true,
      defaultIncluirDescripciones: false,
      defaultIncluirImagenesPdf: true,
      defaultUsarVigencia: false,
    } as any);
    expect(updated.defaultIncluirDatosBancarios).toBe(true);
    expect(updated.defaultIncluirDescripciones).toBe(false);
    expect(updated.defaultIncluirImagenesPdf).toBe(true);
    expect(updated.defaultUsarVigencia).toBe(false);
  });

  it('updateVigenciaBancarios con null ausenta los defaults (vuelve a "sin configurar")', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      defaultIncluirDatosBancarios: true,
      defaultIncluirDescripciones: false,
      defaultIncluirImagenesPdf: true,
      defaultUsarVigencia: false,
    });
    const updated = await service.updateVigenciaBancarios({
      defaultIncluirDatosBancarios: null,
      defaultIncluirDescripciones: null,
      defaultIncluirImagenesPdf: null,
      defaultUsarVigencia: null,
    } as any);
    expect(updated.defaultIncluirDatosBancarios).toBeUndefined();
    expect(updated.defaultIncluirDescripciones).toBeUndefined();
    expect(updated.defaultIncluirImagenesPdf).toBeUndefined();
    expect(updated.defaultUsarVigencia).toBeUndefined();
  });

  it('updateVigenciaBancarios omitido no toca los defaults existentes', async () => {
    store.set(String(tenantId), {
      ...makeDoc(tenantId),
      defaultIncluirDatosBancarios: true,
      defaultUsarVigencia: false,
    });
    const updated = await service.updateVigenciaBancarios({
      vigenciaDefaultDias: 45,
    });
    expect(updated.defaultIncluirDatosBancarios).toBe(true);
    expect(updated.defaultUsarVigencia).toBe(false);
    expect(updated.vigenciaDefaultDias).toBe(45);
  });

  it('toResponse omite defaults de cotización cuando no están configurados (ausencia ≠ false)', () => {
    const doc = makeDoc(tenantId) as any;
    const res = service.toResponse(doc);
    expect(res.defaultIncluirDatosBancarios).toBeUndefined();
    expect(res.defaultIncluirDescripciones).toBeUndefined();
    expect(res.defaultIncluirImagenesPdf).toBeUndefined();
    expect(res.defaultUsarVigencia).toBeUndefined();
  });

  it('toResponse incluye defaults de cotización true/false explícitos', () => {
    const doc = {
      ...makeDoc(tenantId),
      defaultIncluirDatosBancarios: false,
      defaultIncluirDescripciones: true,
      defaultIncluirImagenesPdf: false,
      defaultUsarVigencia: true,
    } as any;
    const res = service.toResponse(doc);
    expect(res.defaultIncluirDatosBancarios).toBe(false);
    expect(res.defaultIncluirDescripciones).toBe(true);
    expect(res.defaultIncluirImagenesPdf).toBe(false);
    expect(res.defaultUsarVigencia).toBe(true);
  });

  it('toResponse incluye zonaHoraria IANA (Story 9.1 / AD-30)', () => {
    const doc = {
      ...makeDoc(tenantId),
      zonaHoraria: ' America/Mexico_City ',
    } as any;
    const res = service.toResponse(doc);
    expect(res.zonaHoraria).toBe('America/Mexico_City');
    expect(
      service.toResponse(makeDoc(tenantId) as any).zonaHoraria,
    ).toBeUndefined();
  });

  it('toResponseAsync incluye tenantNombre y tenantClave del Tenant efectivo', async () => {
    tenantStore.set(String(tenantId), {
      nombre: 'AMES Querétaro',
      clave: 'qro',
    });
    const doc = makeDoc(tenantId) as any;
    const res = await service.toResponseAsync(doc);
    expect(res.tenantNombre).toBe('AMES Querétaro');
    expect(res.tenantClave).toBe('qro');
    expect(tenantModel.findById).toHaveBeenCalledWith(tenantId);
  });

  it('toResponseAsync omite identidad si el Tenant no existe (sin throw)', async () => {
    const doc = makeDoc(tenantId) as any;
    const res = await service.toResponseAsync(doc);
    expect(res.tenantNombre).toBeUndefined();
    expect(res.tenantClave).toBeUndefined();
    expect(res.tenantId).toBe(String(tenantId));
  });

  it('toResponseAsync omite identidad si el lookup falla (sin throw)', async () => {
    tenantModel.findById.mockReturnValueOnce(
      tenantChainable(async () => {
        throw new Error('db down');
      }),
    );
    const doc = makeDoc(tenantId) as any;
    const res = await service.toResponseAsync(doc);
    expect(res.tenantId).toBe(String(tenantId));
    expect(res.tenantNombre).toBeUndefined();
    expect(res.tenantClave).toBeUndefined();
  });

  it('toResponseAsync incluye identidad parcial (solo nombre o solo clave)', async () => {
    tenantStore.set(String(tenantId), { nombre: 'Solo Nombre' });
    const withNombre = await service.toResponseAsync(makeDoc(tenantId) as any);
    expect(withNombre.tenantNombre).toBe('Solo Nombre');
    expect(withNombre.tenantClave).toBeUndefined();

    tenantStore.set(String(tenantId), { clave: 'solo-clave' });
    const withClave = await service.toResponseAsync(makeDoc(tenantId) as any);
    expect(withClave.tenantNombre).toBeUndefined();
    expect(withClave.tenantClave).toBe('solo-clave');
  });
});

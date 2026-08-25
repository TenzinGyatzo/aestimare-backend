import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { RecordatoriosService } from './recordatorios.service';
import { TenantContextService } from '../../tenants/tenant-context.service';
import { TenantConfigService } from '../../tenants/tenant-config.service';
import { EmailsService } from '../../emails/emails.service';
import { UsersService } from '../../users/users.service';
import { TenantInactiveForOutboundError } from '../../emails/tenant-inactive-for-outbound.error';

describe('RecordatoriosService (Story 9.1)', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();

  const recordatorioModel: any = jest.fn().mockImplementation((data: any) => {
    const doc = {
      ...data,
      _id: new Types.ObjectId(),
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    return doc;
  });
  recordatorioModel.findOne = jest.fn();
  recordatorioModel.findOneAndUpdate = jest.fn();

  const cotizacionModel: any = { findOne: jest.fn(), find: jest.fn() };
  const clienteModel: any = { find: jest.fn() };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;

  const tenantConfigService = {
    findByTenantId: jest.fn().mockResolvedValue({
      zonaHoraria: 'America/Mexico_City',
      correosNotificacion: ['notify@tenant.test'],
      emailRemitente: 'remitente@tenant.test',
    }),
  } as unknown as TenantConfigService;

  const emailsService = {
    sendReminderRecotizacionDisparo: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailsService;

  const usersService = {
    findById: jest.fn(),
  } as unknown as UsersService;

  const service = new RecordatoriosService(
    recordatorioModel,
    cotizacionModel,
    clienteModel,
    tenantContext,
    tenantConfigService,
    emailsService,
    usersService,
  );

  function cotChain(doc: any) {
    return {
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(doc),
        }),
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    (tenantConfigService.findByTenantId as jest.Mock).mockResolvedValue({
      zonaHoraria: 'America/Mexico_City',
      correosNotificacion: ['notify@tenant.test'],
      emailRemitente: 'remitente@tenant.test',
    });
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        _id: cotizacionId,
        fechaCreacion: new Date('2026-01-15T12:00:00.000Z'),
      }),
    );
    // Default: no doc updatable → path create
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
  });

  it('PUT crea recordatorio programado con fechaDisparoUtc derivada', async () => {
    const doc = await service.upsert(String(cotizacionId), {
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
    });

    expect(doc.estado).toBe('programado');
    expect(doc.everDisparado).toBe(false);
    expect(doc.receta.familia).toBe('relativo_hoy');
    expect(doc.receta.preset).toBe('1_mes');
    expect(doc.fechaDisparoUtc).toBeInstanceOf(Date);
    expect(doc.fechaDisparoUtc.getTime()).toBeGreaterThan(Date.now());
    expect(recordatorioModel).toHaveBeenCalled();
  });

  it('PUT actualiza atómicamente si ya existe programado/cancelado', async () => {
    const updated = {
      estado: 'programado',
      everDisparado: false,
      receta: { familia: 'relativo_hoy', preset: '6_meses' },
      fechaDisparoUtc: new Date('2030-06-01T06:00:00.000Z'),
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const doc = await service.upsert(String(cotizacionId), {
      receta: { familia: 'relativo_hoy', preset: '6_meses' },
    });

    expect(doc).toBe(updated);
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        everDisparado: { $ne: true },
        estado: { $in: ['programado', 'cancelado'] },
      }),
      expect.objectContaining({
        $set: expect.objectContaining({
          estado: 'programado',
          receta: expect.objectContaining({ preset: '6_meses' }),
        }),
      }),
      { new: true },
    );
    expect(recordatorioModel).not.toHaveBeenCalled();
  });

  it('PUT rechaza fecha_exacta en pasado', async () => {
    await expect(
      service.upsert(String(cotizacionId), {
        receta: { familia: 'fecha_exacta', fechaExacta: '2020-01-01' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT rechaza aniversario no futuro', async () => {
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        _id: cotizacionId,
        fechaCreacion: new Date(Date.now() - 340 * 24 * 60 * 60 * 1000),
      }),
    );

    await expect(
      service.upsert(String(cotizacionId), {
        receta: {
          familia: 'relativo_aniversario',
          preset: '2_meses_antes',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('PUT rechaza cuando everDisparado=true', async () => {
    const existing = {
      estado: 'cancelado',
      everDisparado: true,
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
      fechaDisparoUtc: new Date(),
    };
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(existing),
    });

    await expect(
      service.upsert(String(cotizacionId), {
        receta: { familia: 'relativo_hoy', preset: '3_meses' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('PUT rechaza estado disparado', async () => {
    const existing = {
      estado: 'disparado',
      everDisparado: false,
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
      fechaDisparoUtc: new Date(),
    };
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(existing),
    });

    await expect(
      service.upsert(String(cotizacionId), {
        receta: { familia: 'relativo_hoy', preset: '1_ano' },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('PUT create: E11000 → reintenta update atómico', async () => {
    const createdDoc = {
      save: jest.fn().mockRejectedValue({ code: 11000 }),
    };
    recordatorioModel.mockImplementationOnce(() => createdDoc);

    const retried = {
      estado: 'programado',
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
      fechaDisparoUtc: new Date('2030-01-01T06:00:00.000Z'),
    };
    recordatorioModel.findOneAndUpdate
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(null),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue(retried),
      });

    const doc = await service.upsert(String(cotizacionId), {
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
    });

    expect(doc).toBe(retried);
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('DELETE programado → cancelado (atómico)', async () => {
    const cancelled = {
      estado: 'cancelado',
      everDisparado: false,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(cancelled),
    });

    const doc = await service.cancelar(String(cotizacionId));
    expect(doc.estado).toBe('cancelado');
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 'programado' }),
      { $set: { estado: 'cancelado' } },
      { new: true },
    );
  });

  it('DELETE sin doc → NotFound', async () => {
    await expect(service.cancelar(String(cotizacionId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('DELETE no-programado → BadRequest', async () => {
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ estado: 'cancelado' }),
    });

    await expect(service.cancelar(String(cotizacionId))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404 si COT no pertenece al tenant', async () => {
    cotizacionModel.findOne.mockReturnValue(cotChain(null));
    await expect(
      service.upsert(String(cotizacionId), {
        receta: { familia: 'relativo_hoy', preset: '1_mes' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET ausente → NotFound', async () => {
    recordatorioModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    });
    await expect(
      service.findByCotizacion(String(cotizacionId)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET programado → shape canónico', async () => {
    const existing = {
      estado: 'programado',
      everDisparado: false,
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
      fechaDisparoUtc: new Date('2030-01-01T06:00:00.000Z'),
      __v: 0,
      tenantId,
    };
    recordatorioModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      }),
    });

    const doc = await service.findByCotizacion(String(cotizacionId));
    expect(doc).toEqual({
      estado: 'programado',
      receta: { familia: 'relativo_hoy', preset: '1_mes' },
      fechaDisparoUtc: existing.fechaDisparoUtc,
      everDisparado: false,
    });
  });

  it('GET cancelado !everDisparado → 200 doc', async () => {
    const existing = {
      estado: 'cancelado',
      everDisparado: false,
      receta: { familia: 'relativo_hoy', preset: '3_meses' },
      fechaDisparoUtc: new Date('2030-03-01T06:00:00.000Z'),
    };
    recordatorioModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(existing),
        }),
      }),
    });

    const doc = await service.findByCotizacion(String(cotizacionId));
    expect(doc.estado).toBe('cancelado');
    expect(doc.everDisparado).toBe(false);
  });
});

describe('RecordatoriosService repetir hooks (Story 11.1)', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();

  const recordatorioModel: any = {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const cotizacionModel: any = { findOne: jest.fn(), find: jest.fn() };
  const clienteModel: any = { find: jest.fn() };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;

  const tenantConfigService = {
    findByTenantId: jest.fn().mockResolvedValue({
      zonaHoraria: 'America/Mexico_City',
    }),
  } as unknown as TenantConfigService;

  const recordatorioModelWithCreate: any = jest.fn().mockImplementation((data: any) => {
    const doc = {
      ...data,
      _id: new Types.ObjectId(),
      save: jest.fn().mockImplementation(async function (this: any) {
        return this;
      }),
    };
    return doc;
  });
  recordatorioModelWithCreate.findOne = recordatorioModel.findOne;
  recordatorioModelWithCreate.findOneAndUpdate = recordatorioModel.findOneAndUpdate;

  function cotChain(doc: any) {
    return {
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(doc),
        }),
      }),
    };
  }

  const service = new RecordatoriosService(
    recordatorioModelWithCreate,
    cotizacionModel,
    clienteModel,
    tenantContext,
    tenantConfigService,
    { sendReminderRecotizacionDisparo: jest.fn() } as unknown as EmailsService,
    { findById: jest.fn() } as unknown as UsersService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
    (tenantConfigService.findByTenantId as jest.Mock).mockResolvedValue({
      zonaHoraria: 'America/Mexico_City',
    });
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
  });

  it('cancelarPorRepetir: programado → cancelado', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ estado: 'cancelado' }),
    });
    const ok = await service.cancelarPorRepetir(String(cotizacionId));
    expect(ok).toBe(true);
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        estado: { $in: ['programado', 'disparado'] },
      }),
      { $set: { estado: 'cancelado' } },
      { new: true },
    );
  });

  it('cancelarPorRepetir: disparado → cancelado', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ estado: 'cancelado' }),
    });
    const ok = await service.cancelarPorRepetir(String(cotizacionId));
    expect(ok).toBe(true);
  });

  it('cancelarPorRepetir: ausente → no-op false', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    const ok = await service.cancelarPorRepetir(String(cotizacionId));
    expect(ok).toBe(false);
  });

  it('resolveRecetaRearme: copia desfase origen', async () => {
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        receta: { familia: 'relativo_hoy', preset: '3_meses' },
      }),
    });
    const receta = await service.resolveRecetaRearme(String(cotizacionId));
    expect(receta).toEqual({ familia: 'relativo_hoy', preset: '3_meses' });
  });

  it('resolveRecetaRearme: fecha_exacta origen sin body → BadRequest', async () => {
    recordatorioModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        receta: { familia: 'fecha_exacta', fechaExacta: new Date() },
      }),
    });
    await expect(
      service.resolveRecetaRearme(String(cotizacionId)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolveRecetaRearme: usa body explícito', async () => {
    const receta = await service.resolveRecetaRearme(String(cotizacionId), {
      familia: 'relativo_aniversario',
      preset: '1_mes_antes',
    });
    expect(receta.preset).toBe('1_mes_antes');
    expect(recordatorioModel.findOne).not.toHaveBeenCalled();
  });

  it('assertRecetaRearmeValida: rechaza fecha_exacta sin fechaExacta', async () => {
    await expect(
      service.assertRecetaRearmeValida(
        { familia: 'fecha_exacta' },
        new Date('2026-01-15T12:00:00.000Z'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('programarEnCotizacionNueva: aniversario ancla a fechaCreacion de la COT', async () => {
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        _id: cotizacionId,
        fechaCreacion: new Date('2026-03-01T12:00:00.000Z'),
      }),
    );
    const docMar = await service.programarEnCotizacionNueva(
      String(cotizacionId),
      { familia: 'relativo_aniversario', preset: '1_mes_antes' },
    );

    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        _id: cotizacionId,
        fechaCreacion: new Date('2026-08-01T12:00:00.000Z'),
      }),
    );
    const docAgo = await service.programarEnCotizacionNueva(
      String(cotizacionId),
      { familia: 'relativo_aniversario', preset: '1_mes_antes' },
    );

    expect(docMar.fechaDisparoUtc).toBeInstanceOf(Date);
    expect(docAgo.fechaDisparoUtc).toBeInstanceOf(Date);
    expect(docMar.fechaDisparoUtc.getTime()).not.toBe(
      docAgo.fechaDisparoUtc.getTime(),
    );
  });
});

describe('RecordatoriosService cron disparo (Story 10.1)', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();
  const recordatorioId = new Types.ObjectId();

  const recordatorioModel: any = {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const cotizacionModel: any = { findOne: jest.fn(), find: jest.fn() };
  const clienteModel: any = { find: jest.fn() };

  const tenantContext = {
    getTenantId: jest.fn(),
  } as unknown as TenantContextService;

  const tenantConfigService = {
    findByTenantId: jest.fn().mockResolvedValue({
      correosNotificacion: ['notify@tenant.test'],
      emailRemitente: 'remitente@tenant.test',
    }),
  } as unknown as TenantConfigService;

  const emailsService = {
    sendReminderRecotizacionDisparo: jest.fn().mockResolvedValue(undefined),
  } as unknown as EmailsService;

  const usersService = {
    findById: jest.fn(),
  } as unknown as UsersService;

  const service = new RecordatoriosService(
    recordatorioModel,
    cotizacionModel,
    clienteModel,
    tenantContext,
    tenantConfigService,
    emailsService,
    usersService,
  );

  function cotChain(doc: any) {
    return {
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(doc),
        }),
      }),
    };
  }

  const pendingDoc = {
    _id: recordatorioId,
    tenantId,
    cotizacionId,
    estado: 'programado',
    fechaDisparoUtc: new Date('2020-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        folio: 'COT-100',
        creadoPorEmail: 'creator@tenant.test',
        creadoPorUserId: new Types.ObjectId(),
        tenantId,
      }),
    );
  });

  it('procesarDisparoRecordatorio: transición atómica → disparado + everDisparado + email', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(true);
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: recordatorioId,
        estado: 'programado',
        fechaDisparoUtc: expect.objectContaining({ $lte: expect.any(Date) }),
      }),
      { $set: { estado: 'disparado', everDisparado: true } },
      { new: true },
    );
    expect(emailsService.sendReminderRecotizacionDisparo).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        to: expect.arrayContaining([
          'creator@tenant.test',
          'notify@tenant.test',
        ]),
        folio: 'COT-100',
        cotizacionId: String(cotizacionId),
        nombreCliente: 'este cliente',
        fromOverride: 'remitente@tenant.test',
      }),
    );
  });

  it('procesarDisparoRecordatorio: no-match → sin email', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(false);
    expect(emailsService.sendReminderRecotizacionDisparo).not.toHaveBeenCalled();
  });

  it('procesarDisparoRecordatorio: fallo SMTP no revierte disparado', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    (emailsService.sendReminderRecotizacionDisparo as jest.Mock).mockRejectedValue(
      new Error('SMTP down'),
    );

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(true);
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalled();
    expect(emailsService.sendReminderRecotizacionDisparo).toHaveBeenCalled();
  });

  it('procesarDisparoRecordatorio: tenant inactivo → disparado persiste, sin throw', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    (emailsService.sendReminderRecotizacionDisparo as jest.Mock).mockRejectedValue(
      new TenantInactiveForOutboundError(),
    );

    await expect(
      service.procesarDisparoRecordatorio(pendingDoc as any),
    ).resolves.toBe(true);
  });

  it('procesarDisparoRecordatorio: sin destinatarios → warn, sin email', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        folio: 'COT-200',
        tenantId,
      }),
    );
    (tenantConfigService.findByTenantId as jest.Mock).mockResolvedValue({
      correosNotificacion: [],
    });

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(true);
    expect(emailsService.sendReminderRecotizacionDisparo).not.toHaveBeenCalled();
  });

  it('procesarDisparoRecordatorio: cotización ausente → disparado persiste, sin email', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    cotizacionModel.findOne.mockReturnValue(cotChain(null));

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(true);
    expect(emailsService.sendReminderRecotizacionDisparo).not.toHaveBeenCalled();
  });

  it('procesarDisparoRecordatorio: cotización sin folio → disparado persiste, sin email', async () => {
    const updated = {
      ...pendingDoc,
      estado: 'disparado',
      everDisparado: true,
    };
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(updated),
    });
    cotizacionModel.findOne.mockReturnValue(
      cotChain({
        folio: '   ',
        creadoPorEmail: 'creator@tenant.test',
        tenantId,
      }),
    );

    const ok = await service.procesarDisparoRecordatorio(pendingDoc as any);

    expect(ok).toBe(true);
    expect(emailsService.sendReminderRecotizacionDisparo).not.toHaveBeenCalled();
  });

  it('handleCronDispararRecordatorios recorre cursor y procesa candidatos', async () => {
    recordatorioModel.find.mockReturnValue({
      cursor: jest.fn().mockReturnValue(
        (async function* () {
          yield pendingDoc;
        })(),
      ),
    });
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({
        ...pendingDoc,
        estado: 'disparado',
        everDisparado: true,
      }),
    });

    await service.handleCronDispararRecordatorios();

    expect(recordatorioModel.find).toHaveBeenCalledWith({
      estado: 'programado',
      fechaDisparoUtc: { $lte: expect.any(Date) },
    });
    expect(emailsService.sendReminderRecotizacionDisparo).toHaveBeenCalled();
  });

  it('handleCronDispararRecordatorios: carrera (no-match) → sin email', async () => {
    recordatorioModel.find.mockReturnValue({
      cursor: jest.fn().mockReturnValue(
        (async function* () {
          yield pendingDoc;
        })(),
      ),
    });
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });

    await service.handleCronDispararRecordatorios();

    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalled();
    expect(emailsService.sendReminderRecotizacionDisparo).not.toHaveBeenCalled();
  });
});

describe('RecordatoriosService disparados + cerrar (Story 10.2)', () => {
  const tenantId = new Types.ObjectId();
  const cotizacionId = new Types.ObjectId();
  const recordatorioId = new Types.ObjectId();
  const clienteId = new Types.ObjectId();

  const recordatorioModel: any = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
  };
  const cotizacionModel: any = { findOne: jest.fn(), find: jest.fn() };
  const clienteModel: any = { find: jest.fn() };

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue(tenantId),
  } as unknown as TenantContextService;

  const tenantConfigService = {
    findByTenantId: jest.fn(),
  } as unknown as TenantConfigService;

  const emailsService = {} as unknown as EmailsService;
  const usersService = {} as unknown as UsersService;

  const service = new RecordatoriosService(
    recordatorioModel,
    cotizacionModel,
    clienteModel,
    tenantContext,
    tenantConfigService,
    emailsService,
    usersService,
  );

  function findChain(docs: any[]) {
    return {
      sort: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(docs),
        }),
      }),
    };
  }

  function cotFindChain(docs: any[]) {
    return {
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(docs),
        }),
      }),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (tenantContext.getTenantId as jest.Mock).mockReturnValue(tenantId);
  });

  it('listDisparados: proyección canónica con identidad CRM', async () => {
    const fechaDisparoUtc = new Date('2026-08-24T06:00:00.000Z');
    recordatorioModel.find.mockReturnValue(
      findChain([
        {
          _id: recordatorioId,
          cotizacionId,
          estado: 'disparado',
          fechaDisparoUtc,
          receta: { familia: 'relativo_hoy', preset: '3_meses' },
        },
      ]),
    );
    cotizacionModel.find.mockReturnValue(
      cotFindChain([
        {
          _id: cotizacionId,
          folio: 'COT-300',
          clienteId,
          nombreContacto: 'Ana',
        },
      ]),
    );
    clienteModel.find.mockReturnValue(
      cotFindChain([{ _id: clienteId, empresa: 'Acme Corp' }]),
    );

    const res = await service.listDisparados();

    expect(recordatorioModel.find).toHaveBeenCalledWith({
      tenantId,
      estado: 'disparado',
    });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual({
      recordatorioId: String(recordatorioId),
      cotizacionId: String(cotizacionId),
      folio: 'COT-300',
      identidad: 'Acme Corp',
      fechaDisparo: fechaDisparoUtc,
      recetaResumen: '3 meses',
      nombreContacto: 'Ana',
      telefonoContacto: null,
      emailContacto: null,
      fechaCreacion: null,
    });
  });

  it('listDisparados: identidad null sin cliente ni contacto (AD-37)', async () => {
    recordatorioModel.find.mockReturnValue(
      findChain([
        {
          _id: recordatorioId,
          cotizacionId,
          fechaDisparoUtc: new Date(),
          receta: { familia: 'relativo_hoy', preset: '1_mes' },
        },
      ]),
    );
    cotizacionModel.find.mockReturnValue(
      cotFindChain([{ _id: cotizacionId, folio: 'COT-400' }]),
    );
    clienteModel.find.mockReturnValue(cotFindChain([]));

    const res = await service.listDisparados();

    expect(res.items[0].identidad).toBeNull();
    expect(res.items[0].recetaResumen).toBe('1 mes');
  });

  it('listDisparados: recetaResumen fecha_exacta con TZ del tenant (AD-30)', async () => {
    const fechaDisparoUtc = new Date('2030-06-16T14:00:00.000Z');
    (tenantConfigService.findByTenantId as jest.Mock).mockResolvedValue({
      zonaHoraria: 'America/Los_Angeles',
    });
    recordatorioModel.find.mockReturnValue(
      findChain([
        {
          _id: recordatorioId,
          cotizacionId,
          fechaDisparoUtc,
          receta: { familia: 'fecha_exacta', fechaExacta: fechaDisparoUtc },
        },
      ]),
    );
    cotizacionModel.find.mockReturnValue(
      cotFindChain([{ _id: cotizacionId, folio: 'COT-600' }]),
    );
    clienteModel.find.mockReturnValue(cotFindChain([]));

    const res = await service.listDisparados();

    expect(tenantConfigService.findByTenantId).toHaveBeenCalledWith(tenantId);
    expect(res.items[0].recetaResumen).toMatch(/16.*2030|2030.*16/i);
  });

  it('listDisparados: fallback contacto sin cliente CRM', async () => {
    recordatorioModel.find.mockReturnValue(
      findChain([
        {
          _id: recordatorioId,
          cotizacionId,
          fechaDisparoUtc: new Date(),
          receta: { familia: 'relativo_hoy', preset: '6_meses' },
        },
      ]),
    );
    cotizacionModel.find.mockReturnValue(
      cotFindChain([
        {
          _id: cotizacionId,
          folio: 'COT-500',
          nombreContacto: 'Pedro Guest',
        },
      ]),
    );
    clienteModel.find.mockReturnValue(cotFindChain([]));

    const res = await service.listDisparados();

    expect(res.items[0].identidad).toBe('Pedro Guest');
  });

  it('listDisparados: vacío si no hay disparados', async () => {
    recordatorioModel.find.mockReturnValue(findChain([]));

    const res = await service.listDisparados();

    expect(res.items).toEqual([]);
    expect(cotizacionModel.find).not.toHaveBeenCalled();
  });

  it('cerrar: disparado → cerrado atómico', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ estado: 'cerrado' }),
    });

    const res = await service.cerrar(String(recordatorioId));

    expect(res).toEqual({ estado: 'cerrado' });
    expect(recordatorioModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: String(recordatorioId), tenantId, estado: 'disparado' },
      { $set: { estado: 'cerrado' } },
      { new: true },
    );
  });

  it('cerrar: no disparado → BadRequest', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    recordatorioModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue({ estado: 'programado' }),
        }),
      }),
    });

    await expect(service.cerrar(String(recordatorioId))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('cerrar: no encontrado → NotFound', async () => {
    recordatorioModel.findOneAndUpdate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(null),
    });
    recordatorioModel.findOne.mockReturnValue({
      select: () => ({
        lean: () => ({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    });

    await expect(service.cerrar(String(recordatorioId))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

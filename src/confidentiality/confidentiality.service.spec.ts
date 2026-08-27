import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuditActionType, AuditResourceType } from '../audit/audit-action-type';
import {
  CURRENT_AGREEMENT_FOOTER,
  CURRENT_AGREEMENT_TEXT,
  CURRENT_AGREEMENT_VERSION,
} from './agreement';
import { ConfidentialityService } from './confidentiality.service';

describe('ConfidentialityService', () => {
  const userId = new Types.ObjectId();
  const userIdStr = String(userId);

  const exec = jest.fn();
  const lean = jest.fn();
  const findOne = jest.fn();
  const create = jest.fn();
  const auditRecord = jest.fn();

  let service: ConfidentialityService;

  beforeEach(() => {
    jest.clearAllMocks();
    exec.mockResolvedValue(null);
    lean.mockReturnValue({ exec });
    findOne.mockReturnValue({ exec, lean });
    create.mockResolvedValue({
      userId,
      version: CURRENT_AGREEMENT_VERSION,
      agreementText: CURRENT_AGREEMENT_TEXT,
      source: 'UI',
      acceptedAt: new Date(),
    });
    auditRecord.mockResolvedValue(undefined);
    service = new ConfidentialityService(
      { findOne, create } as any,
      { record: auditRecord } as any,
    );
  });

  it('status pendiente incluye texto y footer de la versión vigente', async () => {
    const status = await service.getStatus(userIdStr);
    expect(status).toEqual({
      required: true,
      accepted: false,
      currentVersion: CURRENT_AGREEMENT_VERSION,
      agreementText: CURRENT_AGREEMENT_TEXT,
      footerConsent: CURRENT_AGREEMENT_FOOTER,
    });
    expect(findOne).toHaveBeenCalledWith({
      userId: expect.any(Types.ObjectId),
      version: CURRENT_AGREEMENT_VERSION,
    });
  });

  it('status aceptado no reenvía el texto largo', async () => {
    exec.mockResolvedValue({ userId, version: CURRENT_AGREEMENT_VERSION });
    const status = await service.getStatus(userIdStr);
    expect(status).toEqual({
      required: true,
      accepted: true,
      currentVersion: CURRENT_AGREEMENT_VERSION,
    });
    expect(status.agreementText).toBeUndefined();
  });

  it('accept nuevo persiste snapshot y emite audit', async () => {
    const created = await service.accept(
      { _id: userIdStr, email: 'op@ames.test', rol: 'operativo' },
      '203.0.113.9',
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        version: CURRENT_AGREEMENT_VERSION,
        agreementText: CURRENT_AGREEMENT_TEXT,
        source: 'UI',
        ip: '203.0.113.9',
      }),
    );
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: AuditActionType.CONFIDENTIALITY_ACCEPTED,
        resourceType: AuditResourceType.CONFIDENTIALITY,
        actorId: userIdStr,
        ip: '203.0.113.9',
        payload: { version: CURRENT_AGREEMENT_VERSION },
      }),
    );
    expect(created.version).toBe(CURRENT_AGREEMENT_VERSION);
  });

  it('accept idempotente devuelve el existente sin segundo doc ni audit', async () => {
    const existing = {
      userId,
      version: CURRENT_AGREEMENT_VERSION,
      source: 'UI',
    };
    exec.mockResolvedValue(existing);
    const result = await service.accept({ _id: userIdStr });
    expect(result).toBe(existing);
    expect(create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('accept concurrente (duplicate-key) no duplica ni audita', async () => {
    const raced = {
      userId,
      version: CURRENT_AGREEMENT_VERSION,
      source: 'UI',
    };
    exec
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    create.mockRejectedValueOnce({ code: 11000 });
    const result = await service.accept({ _id: userIdStr });
    expect(result).toBe(raced);
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('accept con versión distinta a la vigente → 409', async () => {
    await expect(
      service.accept({ _id: userIdStr }, undefined, 'v0'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });

  it('accept con userId inválido → 400', async () => {
    await expect(service.accept({ _id: 'no-oid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('tras accept, el gate en cache no exige reconsulta inmediata', async () => {
    await service.accept({ _id: userIdStr });
    findOne.mockClear();
    await expect(service.hasAcceptedCurrent(userIdStr)).resolves.toBe(true);
    expect(findOne).not.toHaveBeenCalled();
  });
});

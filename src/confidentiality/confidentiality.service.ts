import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from '../audit/audit-action-type';
import {
  actorSnapshotFromUser,
  type AuditActor,
} from '../audit/audit-client-meta';
import { isStrictObjectId } from '../common/strict-object-id';
import {
  CURRENT_AGREEMENT_FOOTER,
  CURRENT_AGREEMENT_TEXT,
  CURRENT_AGREEMENT_VERSION,
} from './agreement';
import {
  ConfidentialityAcceptance,
  ConfidentialityAcceptanceDocument,
} from './schemas/confidentiality-acceptance.schema';

const CACHE_TTL_MS = 30_000;

export type ConfidentialityStatus = {
  required: boolean;
  accepted: boolean;
  currentVersion: string;
  agreementText?: string;
  footerConsent?: string;
};

export type ConfidentialityActor = AuditActor & {
  tenantId?: string;
};

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: number }).code === 11000
  );
}

function toObjectId(id?: string | null): Types.ObjectId | undefined {
  if (!id || !isStrictObjectId(id)) return undefined;
  return new Types.ObjectId(id);
}

@Injectable()
export class ConfidentialityService {
  private readonly cache = new Map<
    string,
    { accepted: boolean; expiresAt: number }
  >();

  constructor(
    @InjectModel(ConfidentialityAcceptance.name)
    private readonly model: Model<ConfidentialityAcceptanceDocument>,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  getCurrentVersion(): string {
    return CURRENT_AGREEMENT_VERSION;
  }

  invalidateCache(userId: string): void {
    this.cache.delete(userId);
  }

  async hasAcceptedCurrent(userId: string): Promise<boolean> {
    const cached = this.cache.get(userId);
    if (cached && cached.accepted && cached.expiresAt > Date.now()) {
      return true;
    }

    const userOid = toObjectId(userId);
    if (!userOid) {
      this.invalidateCache(userId);
      return false;
    }

    const doc = await this.model
      .findOne({ userId: userOid, version: CURRENT_AGREEMENT_VERSION })
      .lean()
      .exec();
    const accepted = !!doc;
    if (accepted) {
      this.setCache(userId, true);
    } else {
      this.invalidateCache(userId);
    }
    return accepted;
  }

  async getStatus(userId: string): Promise<ConfidentialityStatus> {
    const accepted = await this.hasAcceptedCurrent(userId);
    if (accepted) {
      return {
        required: true,
        accepted: true,
        currentVersion: CURRENT_AGREEMENT_VERSION,
      };
    }
    return {
      required: true,
      accepted: false,
      currentVersion: CURRENT_AGREEMENT_VERSION,
      agreementText: CURRENT_AGREEMENT_TEXT,
      footerConsent: CURRENT_AGREEMENT_FOOTER,
    };
  }

  async accept(
    actor: ConfidentialityActor,
    ip?: string,
    versionSeen?: string,
  ): Promise<ConfidentialityAcceptance> {
    const userId = String(actor._id ?? '');
    const userOid = toObjectId(userId);
    if (!userOid) {
      throw new BadRequestException(
        'Usuario inválido para aceptar el acuerdo',
      );
    }

    if (versionSeen && versionSeen !== CURRENT_AGREEMENT_VERSION) {
      throw new ConflictException({
        statusCode: 409,
        message: 'La versión del acuerdo cambió; recargue e intente de nuevo',
        code: 'CONFIDENTIALITY_AGREEMENT_VERSION_MISMATCH',
      });
    }

    const existing = await this.model
      .findOne({ userId: userOid, version: CURRENT_AGREEMENT_VERSION })
      .exec();
    if (existing) {
      this.setCache(userId, true);
      return existing;
    }

    const tenantOid = toObjectId(actor.tenantId);
    const payload: Record<string, unknown> = {
      userId: userOid,
      acceptedAt: new Date(),
      version: CURRENT_AGREEMENT_VERSION,
      agreementText: CURRENT_AGREEMENT_TEXT,
      source: 'UI',
    };
    if (tenantOid) payload.tenantId = tenantOid;
    if (ip) payload.ip = ip;

    try {
      const created = await this.model.create(payload);
      await this.auditService?.record({
        tenantId: actor.tenantId,
        actorId: userId,
        actorSnapshot: actorSnapshotFromUser(actor),
        actionType: AuditActionType.CONFIDENTIALITY_ACCEPTED,
        resourceType: AuditResourceType.CONFIDENTIALITY,
        resourceId: userId,
        result: AuditResult.SUCCESS,
        payload: { version: CURRENT_AGREEMENT_VERSION },
        ip,
      });
      this.setCache(userId, true);
      return created;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        const raced = await this.model
          .findOne({ userId: userOid, version: CURRENT_AGREEMENT_VERSION })
          .exec();
        if (raced) {
          this.setCache(userId, true);
          return raced;
        }
      }
      throw err;
    }
  }

  private setCache(userId: string, accepted: boolean): void {
    this.cache.set(userId, {
      accepted,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
  }
}

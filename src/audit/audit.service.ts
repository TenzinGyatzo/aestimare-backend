import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Roles } from '../auth/enums/roles.enum';
import { isStrictObjectId } from '../common/strict-object-id';
import {
  AuditActionType,
  AuditResourceType,
  AuditResult,
} from './audit-action-type';
import { sanitizeAuditPayload } from './audit-sanitize';
import { FilterAuditEventDto } from './dto/filter-audit-event.dto';
import {
  AuditEventResponseDto,
  PaginatedAuditEventsResponseDto,
} from './dto/audit-event-response.dto';
import { AuditEvent, AuditEventDocument } from './schemas/audit-event.schema';

export type RecordAuditEventInput = {
  tenantId?: string | null;
  actorId?: string | null;
  actorSnapshot?: { email?: string; nombre?: string; rol?: string };
  actionType: AuditActionType;
  resourceType: AuditResourceType;
  resourceId?: string;
  result?: AuditResult;
  payload?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
};

export type AuditQueryActor = {
  rol: string;
  tenantId?: string | null;
  supportTenantId?: string | null;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditEvent.name)
    private readonly auditEventModel: Model<AuditEventDocument>,
  ) {}

  /**
   * Inserta un evento. Nunca lanza: un fallo de persistencia no debe
   * abortar login ni mutaciones de negocio.
   */
  async record(input: RecordAuditEventInput): Promise<void> {
    try {
      const doc: Record<string, unknown> = {
        timestamp: new Date(),
        actionType: input.actionType,
        resourceType: input.resourceType,
        result: input.result ?? AuditResult.SUCCESS,
        actorSnapshot: input.actorSnapshot ?? {},
      };

      const tenantOid = this.toObjectId(input.tenantId);
      if (tenantOid) doc.tenantId = tenantOid;

      const actorOid = this.toObjectId(input.actorId);
      if (actorOid) doc.actorId = actorOid;

      if (input.resourceId) doc.resourceId = String(input.resourceId);
      const payload = sanitizeAuditPayload(input.payload);
      if (payload && Object.keys(payload).length > 0) {
        doc.payload = payload;
      }
      if (input.ip) doc.ip = input.ip;
      if (input.userAgent) doc.userAgent = input.userAgent;

      await this.auditEventModel.create(doc);
    } catch (err) {
      this.logger.error(
        `No se pudo persistir evento de auditoría ${input.actionType}`,
        err instanceof Error ? err.stack : err,
      );
    }
  }

  async findForActor(
    actor: AuditQueryActor,
    filters: FilterAuditEventDto,
  ): Promise<PaginatedAuditEventsResponseDto> {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const query = this.buildScopedQuery(actor, filters);

    const [docs, total] = await Promise.all([
      this.auditEventModel
        .find(query)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.auditEventModel.countDocuments(query).exec(),
    ]);

    return {
      data: docs.map((d) => this.toResponse(d)),
      total,
      page,
      limit,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    };
  }

  buildScopedQuery(
    actor: AuditQueryActor,
    filters: FilterAuditEventDto,
  ): FilterQuery<AuditEventDocument> {
    const query: FilterQuery<AuditEventDocument> = {};

    if (actor.rol === Roles.ADMIN_TENANT) {
      const tid = actor.tenantId ? String(actor.tenantId) : '';
      if (!tid || !isStrictObjectId(tid)) {
        throw new ForbiddenException(
          'Usuario admin_tenant sin tenant asignado',
        );
      }
      query.tenantId = new Types.ObjectId(tid);
    } else if (actor.rol === Roles.ADMIN_SISTEMA) {
      const support = actor.supportTenantId
        ? String(actor.supportTenantId)
        : '';
      if (support) {
        if (!isStrictObjectId(support)) {
          throw new ForbiddenException('X-Tenant-Id inválido');
        }
        const tenantOid = new Types.ObjectId(support);
        if (filters.includePlatform) {
          query.$or = [
            { tenantId: tenantOid },
            { tenantId: { $exists: false } },
            { tenantId: null },
          ];
        } else {
          query.tenantId = tenantOid;
        }
      }
      // Sin header: visión de plataforma (todos los eventos).
    } else {
      throw new ForbiddenException(
        'No autorizado para consultar auditoría',
      );
    }

    if (filters.fechaDesde || filters.fechaHasta) {
      const range: { $gte?: Date; $lte?: Date } = {};
      if (filters.fechaDesde) {
        range.$gte = this.parseDateBound(filters.fechaDesde, false);
      }
      if (filters.fechaHasta) {
        range.$lte = this.parseDateBound(filters.fechaHasta, true);
      }
      query.timestamp = range;
    }

    if (filters.actorId) {
      if (!isStrictObjectId(filters.actorId)) {
        query.actorId = new Types.ObjectId('000000000000000000000000');
      } else {
        query.actorId = new Types.ObjectId(filters.actorId);
      }
    }

    if (filters.actionType) query.actionType = filters.actionType;
    if (filters.resourceType) query.resourceType = filters.resourceType;
    if (filters.resourceId) query.resourceId = filters.resourceId;
    if (filters.result) query.result = filters.result;

    return query;
  }

  private parseDateBound(value: string, endOfDay: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(
        endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`,
      );
    }
    return new Date(value);
  }

  private toObjectId(value?: string | null): Types.ObjectId | undefined {
    if (!value) return undefined;
    const raw = String(value);
    if (!isStrictObjectId(raw)) return undefined;
    return new Types.ObjectId(raw);
  }

  private toResponse(doc: Record<string, unknown>): AuditEventResponseDto {
    const timestamp = doc.timestamp instanceof Date
      ? doc.timestamp.toISOString()
      : String(doc.timestamp ?? '');
    const snapshot = (doc.actorSnapshot ?? {}) as {
      email?: string;
      nombre?: string;
      rol?: string;
    };
    return {
      _id: String(doc._id),
      tenantId: doc.tenantId ? String(doc.tenantId) : undefined,
      actorId: doc.actorId ? String(doc.actorId) : undefined,
      actorSnapshot: {
        email: snapshot.email,
        nombre: snapshot.nombre,
        rol: snapshot.rol,
      },
      timestamp,
      actionType: String(doc.actionType),
      resourceType: String(doc.resourceType),
      resourceId: doc.resourceId ? String(doc.resourceId) : undefined,
      result: String(doc.result),
      payload: (doc.payload as Record<string, unknown> | undefined) ?? undefined,
      ip: doc.ip ? String(doc.ip) : undefined,
      userAgent: doc.userAgent ? String(doc.userAgent) : undefined,
    };
  }
}

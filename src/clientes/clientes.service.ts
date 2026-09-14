import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cliente, ClienteDocument } from './schemas/cliente.schema';
import { Contacto, ContactoDocument } from './schemas/contacto.schema';
import {
  Cotizacion,
  CotizacionDocument,
} from '../cotizaciones/schemas/cotizacion.schema';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { FilterClienteDto } from './dto/filter-cliente.dto';
import {
  ClienteListItemDto,
  PaginatedClientesResponseDto,
} from './dto/paginated-clientes-response.dto';
import { TenantContextService } from '../tenants/tenant-context.service';
import { assertStrictObjectIdOrNotFound } from '../common/strict-object-id';

type CountGroup = { _id?: unknown; n?: number };

@Injectable()
export class ClientesService {
  constructor(
    @InjectModel(Cliente.name) private clienteModel: Model<ClienteDocument>,
    private tenantContext: TenantContextService,
    @InjectModel(Contacto.name) private contactoModel: Model<ContactoDocument>,
    @InjectModel(Cotizacion.name)
    private cotizacionModel: Model<CotizacionDocument>,
  ) {}

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      ((err as { code?: number | string }).code === 11000 ||
        (err as { code?: number | string }).code === 'E11000')
    );
  }

  private escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private normalizeRfc(rfc: string | null | undefined): string | undefined {
    if (rfc === undefined) return undefined;
    if (rfc === null || rfc === '') return undefined;
    const t = rfc.trim().toUpperCase();
    return t || undefined;
  }

  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | undefined {
    if (value === undefined) return undefined;
    if (value === null || value === '') return undefined;
    const t = typeof value === 'string' ? value.trim() : '';
    return t || undefined;
  }

  async create(createClienteDto: CreateClienteDto): Promise<Cliente> {
    const empresa = (createClienteDto.empresa || '').trim();
    if (!empresa) {
      throw new BadRequestException(
        'Debe proporcionar el nombre de la empresa',
      );
    }

    const tenantId = this.tenantContext.getTenantId();
    const rfc = this.normalizeRfc(createClienteDto.rfc);
    const razonSocial = this.normalizeOptionalText(
      createClienteDto.razonSocial,
    );

    try {
      const cliente = new this.clienteModel({
        tenantId,
        empresa,
        ...(razonSocial ? { razonSocial } : {}),
        ...(rfc ? { rfc } : {}),
        activo: true,
      });
      return await cliente.save();
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException(
          'Ya existe un cliente con ese RFC en esta administración',
        );
      }
      throw new BadRequestException('Error al crear el cliente');
    }
  }

  async findAll(
    filters?: FilterClienteDto,
  ): Promise<PaginatedClientesResponseDto> {
    const tenantId = this.tenantContext.getTenantId();
    const page = filters?.page && filters.page > 0 ? filters.page : 1;
    const limit =
      filters?.limit && filters.limit > 0 ? Math.min(filters.limit, 100) : 20;

    const matchConditions: Record<string, unknown> = { tenantId };

    // Omitido / true → activos (incl. legacy sin campo). false → solo inactivos.
    if (filters?.activo === undefined || filters.activo === true) {
      matchConditions.activo = { $ne: false };
    } else {
      matchConditions.activo = false;
    }

    if (filters?.empresa?.trim()) {
      matchConditions.empresa = {
        $regex: this.escapeRegex(filters.empresa.trim()),
        $options: 'i',
      };
    }

    if (filters?.razonSocial?.trim()) {
      matchConditions.razonSocial = {
        $regex: this.escapeRegex(filters.razonSocial.trim()),
        $options: 'i',
      };
    }

    if (filters?.rfc?.trim()) {
      matchConditions.rfc = {
        $regex: this.escapeRegex(filters.rfc.trim()),
        $options: 'i',
      };
    }

    const [docs, total] = await Promise.all([
      this.clienteModel
        .find(matchConditions)
        .sort({ empresa: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.clienteModel.countDocuments(matchConditions).exec(),
    ]);

    return {
      data: (await this.attachPageCounts(tenantId, docs)) as ClienteListItemDto[],
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit) || 1),
    };
  }

  private countsByClienteId(groups: CountGroup[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of groups) {
      if (g?._id == null) continue;
      map.set(String(g._id), Number(g.n) || 0);
    }
    return map;
  }

  private toPlainCliente(doc: unknown): Record<string, unknown> {
    if (
      doc &&
      typeof doc === 'object' &&
      'toObject' in doc &&
      typeof (doc as { toObject: () => Record<string, unknown> }).toObject ===
        'function'
    ) {
      return (doc as { toObject: () => Record<string, unknown> }).toObject();
    }
    return { ...(doc as Record<string, unknown>) };
  }

  /** Conteos solo de la página: contactos activos + cotizaciones no canceladas. */
  private async attachPageCounts(
    tenantId: unknown,
    docs: unknown[],
  ): Promise<unknown[]> {
    if (docs.length === 0) return [];

    const pageIds = docs
      .map((d) => (d as { _id?: unknown })._id)
      .filter((id) => id != null);
    if (pageIds.length === 0) {
      return docs.map((doc) => ({
        ...this.toPlainCliente(doc),
        totalContactos: 0,
        totalCotizaciones: 0,
      }));
    }

    const [contactoGroups, cotizGroups] = await Promise.all([
      this.contactoModel.aggregate<CountGroup>([
        {
          $match: {
            tenantId,
            clienteId: { $in: pageIds },
            activo: { $ne: false },
          },
        },
        { $group: { _id: '$clienteId', n: { $sum: 1 } } },
      ]),
      this.cotizacionModel.aggregate<CountGroup>([
        {
          $match: {
            tenantId,
            clienteId: { $in: pageIds },
            estado: { $ne: 'cancelada' },
          },
        },
        { $group: { _id: '$clienteId', n: { $sum: 1 } } },
      ]),
    ]);

    const contactos = this.countsByClienteId(contactoGroups);
    const cotizaciones = this.countsByClienteId(cotizGroups);

    return docs.map((doc) => {
      const obj = this.toPlainCliente(doc);
      const id = String(obj._id ?? '');
      return {
        ...obj,
        totalContactos: contactos.get(id) ?? 0,
        totalCotizaciones: cotizaciones.get(id) ?? 0,
      };
    });
  }

  /** Story 7.3 — dashboard Totales.clientes */
  async countActive(): Promise<number> {
    const tenantId = this.tenantContext.getTenantId();
    return this.clienteModel
      .countDocuments({ tenantId, activo: { $ne: false } })
      .exec();
  }

  async findOne(id: string): Promise<Cliente> {
    assertStrictObjectIdOrNotFound(id, 'Cliente');
    const tenantId = this.tenantContext.getTenantId();
    const cliente = await this.clienteModel
      .findOne({ _id: id, tenantId })
      .exec();
    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }
    return cliente;
  }

  async update(
    id: string,
    updateClienteDto: UpdateClienteDto,
  ): Promise<Cliente> {
    assertStrictObjectIdOrNotFound(id, 'Cliente');
    const tenantId = this.tenantContext.getTenantId();

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, 1> = {};

    if (updateClienteDto.empresa !== undefined) {
      const empresa = (updateClienteDto.empresa || '').trim();
      if (!empresa) {
        throw new BadRequestException(
          'Debe proporcionar el nombre de la empresa',
        );
      }
      $set.empresa = empresa;
    }

    if (updateClienteDto.razonSocial !== undefined) {
      const razonSocial = this.normalizeOptionalText(
        updateClienteDto.razonSocial,
      );
      if (razonSocial) {
        $set.razonSocial = razonSocial;
      } else {
        $unset.razonSocial = 1;
      }
    }

    if (updateClienteDto.rfc !== undefined) {
      const rfc = this.normalizeRfc(updateClienteDto.rfc);
      if (rfc) {
        $set.rfc = rfc;
      } else {
        $unset.rfc = 1;
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      return this.findOne(id);
    }

    const update: Record<string, unknown> = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;

    try {
      const cliente = await this.clienteModel
        .findOneAndUpdate({ _id: id, tenantId }, update, { new: true })
        .exec();
      if (!cliente) {
        throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
      }
      return cliente;
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof ConflictException
      ) {
        throw err;
      }
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException(
          'Ya existe un cliente con ese RFC en esta administración',
        );
      }
      throw new BadRequestException('Error al actualizar el cliente');
    }
  }

  async toggleActivo(id: string): Promise<Cliente> {
    const cliente = await this.findOne(id);
    (cliente as ClienteDocument).activo = !(cliente as ClienteDocument).activo;
    try {
      return await (cliente as ClienteDocument).save();
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException(
          'Ya existe un cliente con ese RFC en esta administración',
        );
      }
      throw new BadRequestException('Error al cambiar el estado del cliente');
    }
  }

  async remove(id: string): Promise<Cliente> {
    assertStrictObjectIdOrNotFound(id, 'Cliente');
    const tenantId = this.tenantContext.getTenantId();
    const cliente = await this.clienteModel
      .findOneAndUpdate(
        { _id: id, tenantId },
        { $set: { activo: false } },
        { new: true },
      )
      .exec();
    if (!cliente) {
      throw new NotFoundException(`Cliente con ID ${id} no encontrado`);
    }
    return cliente;
  }
}

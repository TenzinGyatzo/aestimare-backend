import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  OnModuleInit,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { FilterUserDto } from './dto/filter-user.dto';
import { Roles } from '../auth/enums/roles.enum';
import { TenantsService } from '../tenants/tenants.service';
import {
  assertStrictObjectIdOrNotFound,
  isStrictObjectId,
} from '../common/strict-object-id';

/** Principal mínimo para revalidar JWT (sin passwordHash). */
export type AuthPrincipal = {
  _id: Types.ObjectId;
  email: string;
  rol: string;
  tenantId?: Types.ObjectId;
  activo: boolean;
  credentialsVersion?: number;
};

/** Actor de gestión de usuarios (Story 2.3). Ausente = callers internos de confianza. */
export type UsersActor = {
  rol: string;
  tenantId?: string | null;
  /** Tenant de soporte (X-Tenant-Id) para admin_sistema. */
  supportTenantId?: string | null;
};

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @Inject(forwardRef(() => TenantsService))
    private readonly tenantsService: TenantsService,
  ) {}

  /** One-shot: legacy rol `admin` → `admin_sistema` (Story 1.3). */
  async onModuleInit() {
    const result = await this.userModel
      .updateMany({ rol: 'admin' }, { $set: { rol: Roles.ADMIN_SISTEMA } })
      .exec();
    if (result.modifiedCount > 0) {
      this.logger.log(
        `Migrated ${result.modifiedCount} user(s) rol admin → admin_sistema`,
      );
    }
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private escapeRegex(term: string): string {
    return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      ((err as { code?: number | string }).code === 11000 ||
        (err as { code?: number | string }).code === 'E11000')
    );
  }

  private toResponse(user: UserDocument) {
    const obj = user.toObject();
    const { passwordHash: _, ...rest } = obj as any;
    return rest;
  }

  /** Impide dejar el sistema sin ningún admin_sistema activo. */
  private async assertNotRemovingLastActiveAdmin(
    current: UserDocument,
    opts: { nextRol?: string; nextActivo?: boolean },
  ): Promise<void> {
    if (current.rol !== Roles.ADMIN_SISTEMA || !current.activo) {
      return;
    }
    const demoting =
      opts.nextRol !== undefined && opts.nextRol !== Roles.ADMIN_SISTEMA;
    const deactivating = opts.nextActivo === false;
    if (!demoting && !deactivating) {
      return;
    }
    const activeAdmins = await this.userModel
      .countDocuments({ rol: Roles.ADMIN_SISTEMA, activo: true })
      .exec();
    if (activeAdmins <= 1) {
      throw new BadRequestException(
        'No se puede desactivar ni degradar el último administrador de sistema activo',
      );
    }
  }

  /** Impide dejar un tenant sin ningún admin_tenant activo. */
  private async assertNotRemovingLastActiveAdminTenant(
    current: UserDocument,
    opts: { nextRol?: string; nextActivo?: boolean },
  ): Promise<void> {
    if (current.rol !== Roles.ADMIN_TENANT || !current.activo) {
      return;
    }
    const demoting =
      opts.nextRol !== undefined && opts.nextRol !== Roles.ADMIN_TENANT;
    const deactivating = opts.nextActivo === false;
    if (!demoting && !deactivating) {
      return;
    }
    if (!current.tenantId) {
      return;
    }
    const activeAdmins = await this.userModel
      .countDocuments({
        rol: Roles.ADMIN_TENANT,
        tenantId: current.tenantId,
        activo: true,
      })
      .exec();
    if (activeAdmins <= 1) {
      throw new BadRequestException(
        'No se puede desactivar ni degradar el último administrador de la administración activo',
      );
    }
  }

  /**
   * Frontera de credenciales por suspensión.
   * true→false: incrementa. false→true con versión 0/ausente: pasa a 1.
   * false→true con versión ≥1: no toca. undefined = sin cambio.
   */
  private nextCredentialsVersionOnActivoChange(
    current: { activo?: boolean; credentialsVersion?: number },
    nextActivo: boolean,
  ): number | undefined {
    const wasActive = current.activo !== false;
    const currentVersion = current.credentialsVersion ?? 0;
    if (wasActive && nextActivo === false) {
      return currentVersion + 1;
    }
    if (!wasActive && nextActivo === true && currentVersion === 0) {
      return 1;
    }
    return undefined;
  }

  /** Valida AD-11: operativo|admin_tenant ↔ 1 tenant activo; admin_sistema sin tenant fijo. */
  private async resolveTenantForRole(
    rol: string,
    tenantId?: string | null,
  ): Promise<Types.ObjectId | undefined> {
    if (rol === Roles.ADMIN_SISTEMA) {
      if (tenantId) {
        throw new BadRequestException(
          'El administrador de sistema no puede tener tenant fijo',
        );
      }
      return undefined;
    }

    if (rol === Roles.OPERATIVO || rol === Roles.ADMIN_TENANT) {
      if (!tenantId) {
        throw new BadRequestException(
          rol === Roles.ADMIN_TENANT
            ? 'El usuario admin_tenant requiere exactamente un tenantId'
            : 'El usuario operativo requiere exactamente un tenantId',
        );
      }
      const tenant = await this.tenantsService.findById(tenantId);
      if (!tenant || !tenant.activo) {
        throw new BadRequestException('Tenant no encontrado o inactivo');
      }
      return tenant._id as Types.ObjectId;
    }

    throw new BadRequestException('Rol no válido');
  }

  private assertAssignableRole(actor: UsersActor, rol: string): void {
    if (actor.rol === Roles.ADMIN_TENANT) {
      if (rol === Roles.ADMIN_SISTEMA) {
        throw new ForbiddenException(
          'No puede asignar el rol de administrador de sistema',
        );
      }
      if (rol !== Roles.OPERATIVO && rol !== Roles.ADMIN_TENANT) {
        throw new BadRequestException('Rol no válido');
      }
    }
  }

  /** Tenant anclado al crear según actor (AD-2 / AD-11 / Story 2.3). */
  private resolveCreateTenantIdForActor(
    actor: UsersActor,
    dto: CreateUserDto,
  ): string | undefined {
    if (actor.rol === Roles.ADMIN_TENANT) {
      if (!actor.tenantId) {
        throw new ForbiddenException('Usuario admin_tenant sin tenant asignado');
      }
      const forced = String(actor.tenantId);
      if (dto.tenantId && dto.tenantId !== forced) {
        throw new ForbiddenException('No puede asignar una administración ajena');
      }
      return forced;
    }

    if (actor.rol === Roles.ADMIN_SISTEMA) {
      if (dto.rol === Roles.ADMIN_SISTEMA) {
        return undefined;
      }
      const support = actor.supportTenantId;
      if (!support) {
        throw new BadRequestException(
          'Seleccione una administración (X-Tenant-Id) para crear usuarios del tenant',
        );
      }
      if (dto.tenantId && dto.tenantId !== support) {
        throw new ForbiddenException(
          'No puede asignar una administración distinta a la activa',
        );
      }
      return support;
    }

    throw new ForbiddenException('No autorizado para gestionar usuarios');
  }

  private assertCanManage(actor: UsersActor, target: UserDocument): void {
    if (actor.rol === Roles.ADMIN_TENANT) {
      if (!actor.tenantId) {
        throw new ForbiddenException('Usuario admin_tenant sin tenant asignado');
      }
      if (target.rol === Roles.ADMIN_SISTEMA) {
        throw new NotFoundException(
          `Usuario con ID ${String(target._id)} no encontrado`,
        );
      }
      if (
        !target.tenantId ||
        String(target.tenantId) !== String(actor.tenantId)
      ) {
        throw new NotFoundException(
          `Usuario con ID ${String(target._id)} no encontrado`,
        );
      }
      return;
    }

    if (actor.rol === Roles.ADMIN_SISTEMA) {
      if (target.rol === Roles.ADMIN_SISTEMA) {
        return;
      }
      if (!actor.supportTenantId) {
        throw new BadRequestException(
          'Seleccione una administración (X-Tenant-Id) para gestionar usuarios del tenant',
        );
      }
      if (
        !target.tenantId ||
        String(target.tenantId) !== String(actor.supportTenantId)
      ) {
        throw new NotFoundException(
          `Usuario con ID ${String(target._id)} no encontrado`,
        );
      }
      return;
    }

    throw new ForbiddenException('No autorizado para gestionar usuarios');
  }

  async create(
    createUserDto: CreateUserDto,
    actor?: UsersActor,
  ): Promise<UserDocument> {
    const email = this.normalizeEmail(createUserDto.email);
    const rol = createUserDto.rol;
    if (!rol) {
      throw new BadRequestException('El rol es obligatorio');
    }

    const nombre = createUserDto.nombre.trim();
    if (!nombre) {
      throw new BadRequestException('El nombre es obligatorio');
    }

    if (actor) {
      this.assertAssignableRole(actor, rol);
    }

    const existingUser = await this.userModel.findOne({ email }).exec();
    if (existingUser) {
      throw new ConflictException('El email ya está registrado');
    }

    const tenantIdForRole = actor
      ? this.resolveCreateTenantIdForActor(actor, createUserDto)
      : createUserDto.tenantId;

    const tenantObjectId = await this.resolveTenantForRole(rol, tenantIdForRole);

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(createUserDto.password, saltRounds);

    const user = new this.userModel({
      email,
      passwordHash,
      nombre,
      rol,
      ...(tenantObjectId ? { tenantId: tenantObjectId } : {}),
      activo: true,
    });

    try {
      return await user.save();
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('El email ya está registrado');
      }
      throw err;
    }
  }

  async findAll(
    filters?: FilterUserDto,
    actor?: UsersActor,
  ): Promise<User[]> {
    const query: Record<string, unknown> = {};

    if (filters?.activo !== undefined) {
      query.activo = filters.activo;
    } else {
      query.activo = true;
    }

    if (filters?.rol) {
      query.rol = filters.rol;
    }

    if (filters?.search?.trim()) {
      const term = this.escapeRegex(filters.search.trim());
      query.$or = [
        { nombre: { $regex: term, $options: 'i' } },
        { email: { $regex: term.toLowerCase(), $options: 'i' } },
      ];
    }

    if (actor?.rol === Roles.ADMIN_TENANT) {
      if (!actor.tenantId || !isStrictObjectId(String(actor.tenantId))) {
        throw new ForbiddenException('Usuario admin_tenant sin tenant asignado');
      }
      query.tenantId = new Types.ObjectId(String(actor.tenantId));
    } else if (actor?.rol === Roles.ADMIN_SISTEMA) {
      if (!actor.supportTenantId) {
        // Sin administración activa: no devolver catálogo global (AC4 / banner 2.2).
        return [];
      }
      if (!isStrictObjectId(String(actor.supportTenantId))) {
        throw new BadRequestException('X-Tenant-Id inválido');
      }
      const supportOid = new Types.ObjectId(String(actor.supportTenantId));
      // Tenant activo + peers plataforma (sin tenant fijo); no mezclar otros tenants.
      const scopeOr = [
        { tenantId: supportOid },
        { rol: Roles.ADMIN_SISTEMA, tenantId: { $exists: false } },
        { rol: Roles.ADMIN_SISTEMA, tenantId: null },
      ];
      if (query.$or) {
        const searchOr = query.$or;
        delete query.$or;
        query.$and = [{ $or: scopeOr }, { $or: searchOr }];
      } else {
        query.$or = scopeOr;
      }
    }

    return await this.userModel
      .find(query)
      .sort({ nombre: 1 })
      .select('-passwordHash')
      .exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({ email: this.normalizeEmail(email) })
      .exec();
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return await this.userModel
      .findOne({ email: this.normalizeEmail(email) })
      .select('+passwordHash')
      .exec();
  }

  async findById(id: string): Promise<UserDocument> {
    assertStrictObjectIdOrNotFound(id, 'Usuario');
    const user = await this.userModel.findById(id).exec();
    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }
    return user;
  }

  /**
   * Lookup para JwtStrategy. Id inválido o ausente → null (nunca 404).
   */
  async findAuthPrincipal(id: string): Promise<AuthPrincipal | null> {
    if (!isStrictObjectId(id)) {
      return null;
    }
    return this.userModel
      .findById(id)
      .select('_id email rol tenantId activo credentialsVersion')
      .lean<AuthPrincipal>()
      .exec();
  }

  /** findById + scoping de gestión (Story 2.3). */
  async findManagedById(id: string, actor: UsersActor): Promise<UserDocument> {
    const user = await this.findById(id);
    this.assertCanManage(actor, user);
    return user;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    actor?: UsersActor,
  ): Promise<UserDocument> {
    assertStrictObjectIdOrNotFound(id, 'Usuario');
    const current = await this.findById(id);

    if (actor) {
      this.assertCanManage(actor, current);
    }

    const nextRol = updateUserDto.rol ?? current.rol;
    if (actor && updateUserDto.rol !== undefined) {
      this.assertAssignableRole(actor, updateUserDto.rol);
    }

    await this.assertNotRemovingLastActiveAdmin(current, {
      nextRol: updateUserDto.rol,
      nextActivo: updateUserDto.activo,
    });
    await this.assertNotRemovingLastActiveAdminTenant(current, {
      nextRol: updateUserDto.rol,
      nextActivo: updateUserDto.activo,
    });

    const tenantProvided = Object.prototype.hasOwnProperty.call(
      updateUserDto,
      'tenantId',
    );
    let nextTenantRaw = tenantProvided
      ? updateUserDto.tenantId
      : current.tenantId
        ? String(current.tenantId)
        : undefined;

    // Actor ancla tenant: admin_tenant siempre el suyo; sistema con soporte fuerza el activo.
    if (actor?.rol === Roles.ADMIN_TENANT) {
      if (!actor.tenantId) {
        throw new ForbiddenException('Usuario admin_tenant sin tenant asignado');
      }
      if (
        tenantProvided &&
        updateUserDto.tenantId != null &&
        String(updateUserDto.tenantId) !== String(actor.tenantId)
      ) {
        throw new ForbiddenException('No puede asignar una administración ajena');
      }
      nextTenantRaw = String(actor.tenantId);
    } else if (
      actor?.rol === Roles.ADMIN_SISTEMA &&
      nextRol !== Roles.ADMIN_SISTEMA
    ) {
      if (!actor.supportTenantId) {
        throw new BadRequestException(
          'Seleccione una administración (X-Tenant-Id) para gestionar usuarios del tenant',
        );
      }
      if (
        tenantProvided &&
        updateUserDto.tenantId != null &&
        String(updateUserDto.tenantId) !== String(actor.supportTenantId)
      ) {
        throw new ForbiddenException(
          'No puede asignar una administración distinta a la activa',
        );
      }
      nextTenantRaw = String(actor.supportTenantId);
    }

    // Al pasar a admin_sistema, limpiar tenant aunque no venga en body.
    let resolvedTenant: Types.ObjectId | undefined | null;
    if (nextRol === Roles.ADMIN_SISTEMA) {
      await this.resolveTenantForRole(
        nextRol,
        tenantProvided ? updateUserDto.tenantId : null,
      );
      resolvedTenant = null; // $unset
    } else {
      resolvedTenant = await this.resolveTenantForRole(
        nextRol,
        nextTenantRaw === null ? undefined : nextTenantRaw,
      );
    }

    const setData: Record<string, unknown> = {};

    if (updateUserDto.nombre !== undefined) {
      const nombre = updateUserDto.nombre.trim();
      if (!nombre) {
        throw new BadRequestException('El nombre es obligatorio');
      }
      setData.nombre = nombre;
    }
    if (updateUserDto.rol !== undefined) {
      setData.rol = updateUserDto.rol;
    }
    if (updateUserDto.activo !== undefined) {
      setData.activo = updateUserDto.activo;
      const nextVersion = this.nextCredentialsVersionOnActivoChange(
        current,
        updateUserDto.activo,
      );
      if (nextVersion !== undefined) {
        setData.credentialsVersion = nextVersion;
      }
    }

    if (updateUserDto.password) {
      const saltRounds = 10;
      setData.passwordHash = await bcrypt.hash(
        updateUserDto.password,
        saltRounds,
      );
    }

    if (updateUserDto.email) {
      const email = this.normalizeEmail(updateUserDto.email);
      const existingUser = await this.userModel
        .findOne({ email, _id: { $ne: id } })
        .exec();
      if (existingUser) {
        throw new ConflictException('El email ya está registrado');
      }
      setData.email = email;
    }

    if (resolvedTenant === null) {
      // admin_sistema: sin tenant fijo
    } else if (resolvedTenant) {
      setData.tenantId = resolvedTenant;
    }

    const mongoUpdate: Record<string, unknown> = {};
    if (Object.keys(setData).length > 0) {
      mongoUpdate.$set = setData;
    }
    if (resolvedTenant === null) {
      mongoUpdate.$unset = { tenantId: 1 };
    }

    if (Object.keys(mongoUpdate).length === 0) {
      return current;
    }

    let updatedUser: UserDocument | null;
    try {
      updatedUser = await this.userModel
        .findByIdAndUpdate(id, mongoUpdate, { new: true })
        .exec();
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new ConflictException('El email ya está registrado');
      }
      throw err;
    }

    if (!updatedUser) {
      throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    }

    return updatedUser;
  }

  async softDelete(id: string, actor?: UsersActor): Promise<UserDocument> {
    assertStrictObjectIdOrNotFound(id, 'Usuario');
    const user = await this.findById(id);
    if (actor) {
      this.assertCanManage(actor, user);
    }
    await this.assertNotRemovingLastActiveAdmin(user, { nextActivo: false });
    await this.assertNotRemovingLastActiveAdminTenant(user, {
      nextActivo: false,
    });
    if (user.activo !== false) {
      user.credentialsVersion = (user.credentialsVersion ?? 0) + 1;
    }
    user.activo = false;
    return await user.save();
  }

  async count(): Promise<number> {
    return await this.userModel.countDocuments().exec();
  }

  /**
   * Story 7.3 — operativos activos del tenant (excluye admin_sistema).
   */
  async countOperativosByTenant(tenantId: Types.ObjectId): Promise<number> {
    return this.userModel
      .countDocuments({
        rol: Roles.OPERATIVO,
        tenantId,
        activo: { $ne: false },
      })
      .exec();
  }

  /** Helper para controllers: documento sin passwordHash. */
  sanitize(user: UserDocument) {
    return this.toResponse(user);
  }
}

/** Catálogo mínimo de eventos de auditoría de seguridad. */
export enum AuditActionType {
  AUTH_LOGIN_SUCCESS = 'auth.login.success',
  AUTH_LOGIN_FAILURE = 'auth.login.failure',
  AUTH_PASSWORD_RESET_REQUESTED = 'auth.password_reset.requested',
  AUTH_PASSWORD_RESET_COMPLETED = 'auth.password_reset.completed',
  AUTH_BOOTSTRAP_REGISTER = 'auth.bootstrap.register',
  USER_CREATED = 'user.created',
  USER_ROLE_CHANGED = 'user.role.changed',
  USER_ACTIVATED = 'user.activated',
  USER_SUSPENDED = 'user.suspended',
  USER_PASSWORD_CHANGED = 'user.password.changed',
  USER_DELETED = 'user.deleted',
  TENANT_ONBOARDED = 'tenant.onboarded',
  TENANT_ACTIVATED = 'tenant.activated',
  TENANT_SUSPENDED = 'tenant.suspended',
  TENANT_CONFIG_BRANDING_UPDATED = 'tenant_config.branding.updated',
  TENANT_CONFIG_EMAIL_UPDATED = 'tenant_config.email.updated',
  TENANT_CONFIG_VIGENCIA_BANCARIOS_UPDATED = 'tenant_config.vigencia_bancarios.updated',
  TENANT_CONFIG_LOGO_UPDATED = 'tenant_config.logo.updated',
  TENANT_CONFIG_LOGO_DELETED = 'tenant_config.logo.deleted',
  TENANT_CONFIG_BANK_LOGO_UPDATED = 'tenant_config.bank_logo.updated',
  TENANT_CONFIG_BANK_LOGO_DELETED = 'tenant_config.bank_logo.deleted',
}

export enum AuditResourceType {
  AUTH = 'auth',
  USER = 'user',
  TENANT = 'tenant',
  TENANT_CONFIG = 'tenant_config',
}

export enum AuditResult {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

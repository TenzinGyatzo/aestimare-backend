# Backfill Reloj del tenant — `zonaHoraria` (Story 9.1 / AD-30)

Script **one-shot** que setea `America/Mexico_City` en `tenant_configs` donde `zonaHoraria` falta o está vacío.

**No** corre en `onModuleInit` ni en onboard.

## Requisitos

- Variable `MONGODB_URI` (mismo `backend/.env` que la app)

## Comando

```bash
cd backend
npm run migrate:tenant-timezone
```

## Idempotencia

Re-ejecutar es seguro: solo actualiza docs sin zona (o con string vacío). No pisa una IANA ya configurada.

## Verificación

En Mongo:

```js
db.tenant_configs.countDocuments({
  $or: [
    { zonaHoraria: { $exists: false } },
    { zonaHoraria: null },
    { zonaHoraria: '' },
  ],
});
// → 0

db.tenant_configs.find({}, { zonaHoraria: 1, tenantId: 1 }).limit(5);
```

## Notas

- El service de recordatorios usa fallback `America/Mexico_City` si el campo aún falta (defensa en profundidad).
- Selector UI de TZ en Config queda **fuera de scope** de esta story.

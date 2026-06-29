# API Reference v3 — Adopción, reconciliación y snapshot (Plan 09)

> **Guía para el equipo de frontend.** Addendum de [`api-reference.md`](api-reference.md).
> Documenta los **5 endpoints nuevos** del Plan 09 que cierran la brecha entre *lo que existe
> en el servidor real* y *lo que gestiona el gateway*, más el comportamiento enriquecido de
> `apply`/`rollback` (una sola llamada lleva a la última versión) y el campo `reviewed` para la
> aprobación de baselines de snapshot.
>
> Convenciones (base URL `/api/v1`, envelope `ApiResponse[T]`, auth por cookie de sesión,
> códigos de error, paginación) idénticas a las del documento original (§3).

**Versión de la API:** `v1` · 🔌 = lee/toca el servidor de BD destino · 🔒 = requiere sesión admin

---

## Capacidades

1. **Reconciliar** (`GET /servers/{id}/reconcile`) — ver qué está gestionado (`managed`), qué
   existe pero no está gestionado (`unmanaged`, adoptable) y qué quedó huérfano (`orphan`).
2. **Adoptar BD** (`POST /managed-databases/adopt`) — registrar una BD existente sin recrearla
   (`origin=adopted`).
3. **Adoptar usuario** (`POST /server-users/adopt`) — registrar un usuario existente sin password
   (`has_password=false`).
4. **Snapshot** (`GET /servers/{id}/databases/{db}/snapshot`) — estructura DDL completa en orden de
   dependencia (`StructureDump`); nunca datos.
5. **Blueprint baseline desde snapshot** (`POST /database-models/from-snapshot`) — crea un blueprint
   cuyo `0001` es el snapshot; nace `reviewed=false` y no se puede aplicar hasta aprobarlo.

## Apply/rollback en una sola llamada (§7-bis)

- `POST /managed-databases/{id}/migrations/apply` **sin `version`** aplica todas las pendientes
  hasta la **última**; con `?version=000X` aplica `actual+1…X`. Forward-only (no baja). `?dry_run=true`
  devuelve el plan. Respuesta `MigrationApplyOut` con `from_version`, `to_version`, `target_version`,
  `applied_count`, `no_op`, `failed`, `quarantined`, `dry_run`, `pending_versions`, `results`.
- `POST /managed-databases/{id}/migrations/rollback?confirm_version=000A[&target_version=000B]`
  revierte secuencialmente hasta `target_version` en una llamada. Respuesta `MigrationRollbackOut`
  con `from_version`, `to_version`, `target_version`, `reverted_count`, `reverted_versions`, `no_op`,
  `failed`, `quarantined`, `results`. `409` si falta `down_sql` en el camino.

## Versiones de un blueprint (§7-ter)

- `GET /database-models/{id}/migrations` (paginado, sin SQL) para el select.
- `GET /database-models/{id}/migrations/{version}` detalle con SQL + `translated` + `reviewed`,
  `is_baseline`, `source_engine`, `has_non_portable`.
- `POST` crea (con `version` **opcional** → autoasignada secuencial).
- `PATCH` confirma `down_sql` / overrides / `reviewed:true` (aprobar baseline).
- `DELETE` solo si la versión nunca se aplicó (si no, `409`).
- `GET /managed-databases/{id}/migrations/status` versión actual + pendientes de una BD.

## Aprobación de baseline (R1)

Un baseline de snapshot (`is_baseline:true`) nace `reviewed:false` y `apply`/`apply-all` responden
`409` hasta que un admin haga `PATCH …/migrations/0001 {"reviewed": true}`.

## Cross-engine guard

Si un baseline de snapshot es `has_non_portable=true` con `source_engine=mysql` y se intenta aplicar
a otro motor → `422`. La UI debe deshabilitar "Aplicar" cuando el motor destino ≠ `source_engine`.

## Tipos nuevos (referencia rápida)

```jsonc
// ReconcileResult
{ "server_id": 42, "databases": [ReconcileDatabaseItem], "users": [ReconcileUserItem] }
// ReconcileDatabaseItem
{ "name": "legacy_crm", "state": "managed|unmanaged|orphan",
  "managed_id": 7|null, "owner_id": 3|null, "status": "active|pending|error|archived|null" }
// ReconcileUserItem
{ "username": "app_ro", "host": "%"|null, "state": "managed|unmanaged|orphan", "managed_id": 4|null }
// StructureDump
{ "database": "legacy_crm", "source_engine": "mysql|mariadb|postgresql",
  "has_non_portable": true, "statements": [DumpStatement] }
// DumpStatement
{ "object_type": "table|view|materialized_view|routine|trigger|sequence|type|extension|index|event",
  "name": "clientes", "ddl": "CREATE TABLE …" }
// ManagedDatabaseOut gana: { "origin": "provisioned|adopted" }
// ModelMigrationOut (detalle) gana:
{ "source_engine": "mysql|null", "is_baseline": true, "has_non_portable": true, "reviewed": true }
// FromSnapshotOut
{ "model": DatabaseModelOut, "baseline_version": "0001", "source_engine": "mysql",
  "has_non_portable": true, "object_counts": {"table": 6}, "statements_captured": 9 }
// MigrationApplyOut
{ "managed_database_id": 11, "from_version": "0002", "to_version": "0005", "target_version": null,
  "applied_count": 3, "no_op": false, "failed": false, "quarantined": false, "dry_run": false,
  "pending_versions": ["0003","0004","0005"], "results": [MigrationResultOut] }
// MigrationRollbackOut
{ "managed_database_id": 11, "from_version": "0010", "to_version": "0007", "target_version": "0007",
  "reverted_count": 3, "no_op": false, "failed": false, "quarantined": false,
  "reverted_versions": ["0010","0009","0008"], "results": [MigrationResultOut] }
```

> El texto completo de esta guía (problema, escenarios, flujos, ejemplos curl e interpretación
> visual por capacidad) fue provisto por el equipo de backend; este archivo es el resumen
> operativo que el frontend usa como contrato. Plan 09 no cambia el comportamiento de los listados
> existentes: añade el puente entre el motor real y el inventario. Todo es deliberado, auditado y
> no destructivo.

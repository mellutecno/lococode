import { DEFAULT_PERMISSIONS } from "./permissions.js";

export function publicEntity(entity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    label: entity.label ?? entity.name,
    schema: entity.jsonSchema,
    permissions: { ...DEFAULT_PERMISSIONS, ...(entity.permissions || {}) },
    metadata: entity.metadata || {},
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

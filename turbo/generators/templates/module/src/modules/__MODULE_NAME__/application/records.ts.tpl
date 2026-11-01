import { normalizeName, type __MODULE_PASCAL__Repository } from '../domain/entity.js';
export function create__MODULE_PASCAL__(repository: __MODULE_PASCAL__Repository) {
  return (input: { name: string }) => repository.create({ name: normalizeName(input.name) });
}
export function list__MODULE_PASCAL__(repository: __MODULE_PASCAL__Repository) {
  return () => repository.list();
}

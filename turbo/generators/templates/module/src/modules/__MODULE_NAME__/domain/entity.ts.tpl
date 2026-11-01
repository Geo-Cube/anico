export interface __MODULE_PASCAL__Record {
  id: string;
  name: string;
}
export interface __MODULE_PASCAL__Repository {
  create(input: { name: string }): Promise<__MODULE_PASCAL__Record>;
  list(): Promise<__MODULE_PASCAL__Record[]>;
}
export function normalizeName(name: string) {
  const normalized = name.trim();
  if (normalized.length < 1 || normalized.length > 120) throw new Error('Name must have 1–120 characters');
  return normalized;
}

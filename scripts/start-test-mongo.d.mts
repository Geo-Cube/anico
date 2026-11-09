export function startTestMongo<T extends { start(): Promise<void> }>(
  server: T,
): Promise<T>;

export function getHealth() {
  return { status: 'ok' as const, service: '__SERVICE_NAME__' };
}
export function getReadiness(dependency: { isReady(): boolean }) {
  return dependency.isReady() ? getHealth() : undefined;
}

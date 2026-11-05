export function getHealth() {
  return { status: 'ok' as const, service: 'breeder-service' };
}

export function getReadiness(dependency: { isReady(): boolean }) {
  return dependency.isReady() ? getHealth() : undefined;
}

export interface LocalBackend {
  name: string;
  port: number;
}
export function discoverLocalBackends(
  root: string,
  selected?: string,
): LocalBackend[];
export function createApiProxy(
  services: LocalBackend[],
  selected?: string,
  options?: { alias?: boolean },
): Record<
  string,
  {
    target: string;
    changeOrigin: boolean;
    rewrite(path: string): string;
  }
>;

export interface Health {
  status: 'ok';
  service: string;
}

export interface Readiness {
  isReady(): boolean;
}

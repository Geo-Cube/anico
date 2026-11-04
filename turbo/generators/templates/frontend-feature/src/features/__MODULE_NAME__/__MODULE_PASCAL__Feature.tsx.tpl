import type { ReactNode } from 'react';

export interface __MODULE_PASCAL__FeatureProps {
  title?: string;
  children?: ReactNode;
}

export function __MODULE_PASCAL__Feature({ title = '__MODULE_NAME__', children }: __MODULE_PASCAL__FeatureProps) {
  return <section className="rounded-xl border border-border bg-card p-6">
    <h2 className="text-lg font-semibold text-brand">{title}</h2>
    <div className="mt-2 text-sm text-muted-foreground">
      {children ?? <p>Obsah funkce __MODULE_NAME__.</p>}
    </div>
  </section>;
}

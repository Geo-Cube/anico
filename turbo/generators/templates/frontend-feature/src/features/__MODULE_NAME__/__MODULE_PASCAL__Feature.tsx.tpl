import type { ReactNode } from 'react';
import styles from './__MODULE_PASCAL__Feature.module.css';

export interface __MODULE_PASCAL__FeatureProps {
  title?: string;
  children?: ReactNode;
}

export function __MODULE_PASCAL__Feature({ title = '__MODULE_NAME__', children }: __MODULE_PASCAL__FeatureProps) {
  return <section className={styles.feature}>
    <h2>{title}</h2>
    {children ?? <p>Obsah funkce __MODULE_NAME__.</p>}
  </section>;
}

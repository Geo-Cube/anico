import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';
import { Card } from './card';
import { eyebrowClassName } from './page-header';

export const thClassName = cn('px-4 py-3 text-left', eyebrowClassName);
export const tdClassName = 'px-4 py-3';
export const rowClassName = 'border-b border-border last:border-b-0';

/**
 * Card with a horizontally scrollable table. `columns` are the header labels
 * (use `<span className="sr-only">…</span>` for action columns); rows come as
 * children, `empty` is shown instead when there are none.
 */
export function DataTable({
  columns,
  minWidthClassName,
  empty,
  children,
}: {
  columns: ReactNode[];
  /** e.g. `min-w-[720px]` */
  minWidthClassName: string;
  empty: ReactNode | null;
  children: ReactNode;
}) {
  return (
    <Card className="overflow-x-auto">
      <table className={cn('w-full text-sm', minWidthClassName)}>
        <thead className="border-b border-border bg-muted/50">
          <tr>
            {columns.map((column, index) => (
              <th key={index} scope="col" className={thClassName}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty !== null ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-10 text-center text-muted-foreground"
              >
                {empty}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </Card>
  );
}

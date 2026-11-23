import { Fragment, type ReactNode } from 'react';
import { Link, type To } from 'react-router';

export type BreadcrumbItem = { label: ReactNode; to?: To };

/** Path to the current page; the last item is the page itself. */
export function Breadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      aria-label="Drobečková navigace"
      className="text-sm text-muted-foreground"
    >
      {items.map(({ label, to }, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 && (
              <span aria-hidden="true" className="px-1.5">
                /
              </span>
            )}
            {to !== undefined && !last ? (
              <Link to={to} className="hover:text-foreground hover:underline">
                {label}
              </Link>
            ) : (
              <span {...(last ? { 'aria-current': 'page' as const } : {})}>
                {label}
              </span>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

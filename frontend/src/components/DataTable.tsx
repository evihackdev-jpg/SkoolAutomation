import type { ReactNode } from 'react';
import { cn } from '../utils/format';

export interface DataColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  emptyMessage: string;
}

/* Dense table with subtle row separators; horizontal scroll on narrow screens. */
export function DataTable<T>({ columns, rows, getRowKey, emptyMessage }: DataTableProps<T>) {
  return (
    // Scroll horizontally only when the table cannot fit; on desktop, let row menus overflow the card.
    <div className="overflow-x-auto rounded-card border border-line bg-card lg:overflow-visible">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] font-medium uppercase tracking-wide text-ink-muted">
            {columns.map((column) => (
              <th key={column.key} scope="col" className={cn('px-4 py-3 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-sm text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={getRowKey(row)} className="border-b border-line/70 transition-colors last:border-b-0 hover:bg-elevated/60">
              {columns.map((column) => (
                <td key={column.key} className={cn('px-4 py-3 align-middle text-sm text-ink-secondary', column.className)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

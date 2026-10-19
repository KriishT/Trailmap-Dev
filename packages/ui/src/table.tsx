import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx";

export function Table({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className={cx("tbl", className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
export const Th = (p: ThHTMLAttributes<HTMLTableCellElement>) => <th scope="col" {...p} />;
export const Td = (p: TdHTMLAttributes<HTMLTableCellElement>) => <td {...p} />;
export const Tr = ({ selected, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) => (
  <tr className={selected ? "is-selected" : undefined} {...rest} />
);

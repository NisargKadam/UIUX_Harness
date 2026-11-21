import type { ReactNode } from "react";
import { cx } from "./cx";

export interface TableColumn<Row> {
  /** Key into the row object. */
  key: keyof Row & string;
  header: string;
  align?: "start" | "end" | "center";
  /** CSS width, e.g. "30%" or "120px". */
  width?: string;
  /** Custom cell renderer. Defaults to the raw value. */
  render?: (row: Row) => ReactNode;
}

export interface TableProps<Row> {
  columns: Array<TableColumn<Row>>;
  rows: Row[];
  /** Stable key for each row. */
  getRowKey: (row: Row) => string;
  /** Row height: comfortable (default) or compact for dense data. */
  density?: "comfortable" | "compact";
  /** Shown instead of the body when rows is empty. */
  emptyState?: ReactNode;
  /** Accessible caption describing the table. */
  caption: string;
  /** Makes rows clickable. */
  onRowClick?: (row: Row) => void;
}

/**
 * Tabular data with optional custom cells, density and an empty state.
 * @category Data display
 * @example
 * <Table caption="Team members" rows={members} getRowKey={(m) => m.id}
 *   columns={[{ key: "name", header: "Name" }, { key: "role", header: "Role" }]} />
 */
export function Table<Row extends object>({ columns, rows, getRowKey, density = "comfortable", emptyState, caption, onRowClick }: TableProps<Row>) {
  return (
    <div className="ds-table-wrap">
      <table className={cx("ds-table", `ds-table--${density}`, onRowClick && "ds-table--interactive")}>
        <caption className="ds-table__caption">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "start" }} scope="col">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="ds-table__empty">
                {emptyState ?? "Nothing here yet."}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? "start" }}>
                    {c.render ? c.render(row) : String(row[c.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

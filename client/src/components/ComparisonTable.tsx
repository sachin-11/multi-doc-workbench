import type { ComparisonTable as ComparisonTableType } from '@mdw/shared';

export interface ComparisonTableProps {
  table: ComparisonTableType;
  documentNames: ReadonlyMap<string, string>;
}

/** Rows are fields, columns are documents. Inconsistent rows are highlighted and also labelled "No". */
export function ComparisonTable({ table, documentNames }: ComparisonTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table comparison-table">
        <caption>Values compared across documents (AI interpretation)</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            {table.columns.map((id) => (
              <th scope="col" key={id}>
                {documentNames.get(id) ?? 'Unknown document'}
              </th>
            ))}
            <th scope="col">Consistent</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.field} className={row.consistent ? undefined : 'row-inconsistent'}>
              <th scope="row">{row.field}</th>
              {table.columns.map((id) => {
                const value = row.values[id] ?? null;
                return <td key={id}>{value === null || value === '' ? <span aria-label="not stated">—</span> : value}</td>;
              })}
              <td>{row.consistent ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

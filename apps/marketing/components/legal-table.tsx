/**
 * A table for the legal pages. On a phone each row becomes a small card, each
 * cell labelled with its column, so nothing is cut off or scrolls sideways.
 */
export function LegalTable({
  label,
  head,
  rows,
}: {
  label: string;
  head: readonly string[];
  rows: readonly (readonly string[])[];
}): React.JSX.Element {
  return (
    <table className="legal-table" aria-label={label}>
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, i) => (
              <td key={i} data-label={head[i]}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

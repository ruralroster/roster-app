import React from 'react';
import { Download } from 'lucide-react';
import { buildCsv, downloadTextFile } from './icsExport';

// A small "Export CSV" button for the audit-table reports (Case Mix,
// Fairness, Rule Violations) — builds the CSV client-side from whatever
// rows/columns the caller already has on screen, so it exports exactly
// what's currently shown (already-computed rates, current sort, etc.),
// not a separate server round-trip.
export default function ExportCsvButton({ filename, columns, rows }) {
  const handleExport = () => {
    downloadTextFile(filename, 'text/csv', buildCsv(columns, rows));
  };

  return (
    <button
      onClick={handleExport}
      disabled={rows.length === 0}
      className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed text-gray-700 text-xs font-medium rounded-lg transition flex items-center gap-1.5"
    >
      <Download size={14} />
      Export CSV
    </button>
  );
}

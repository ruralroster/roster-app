import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Loader, ArrowUp, ArrowDown } from 'lucide-react';
import { getFairnessReport } from './supabaseClient';
import { formatFte, computeFairnessStatus, FAIRNESS_STYLES } from './availabilityUtils';
import ExportCsvButton from './ExportCsvButton';

// A column is { key, label, count(row), ratio(row) }: weekends, all on
// call, then each on-call type. ratio null = can't do it, or theirs alone.
const columnsFor = (dutyTypes) => [
  { key: 'weekend', label: 'Weekend Shifts', count: r => r.weekend_shifts, ratio: r => r.weekend_fairness_ratio },
  { key: 'oncall', label: 'All On Call', count: r => r.oncall_shifts, ratio: r => r.oncall_fairness_ratio },
  ...dutyTypes.map(dt => ({
    key: `duty:${dt.key}`, label: dt.label, count: r => r.by_duty[dt.key]?.count || 0, ratio: r => r.by_duty[dt.key]?.ratio ?? null,
  })),
];

const fmtRatio = (ratio) => (ratio === null ? '' : ratio >= 99 ? 'no share yet' : ratio.toFixed(2));

const RatioCell = ({ ratio, count }) => {
  if (ratio === null) {
    return <td className="px-3 py-2 border border-gray-300 text-gray-400" title="Can't do it, or theirs alone">{count || '—'}</td>;
  }
  const status = computeFairnessStatus(ratio);
  const style = FAIRNESS_STYLES[status];
  return (
    <td className="px-3 py-2 border border-gray-300">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
        <span className="text-gray-900">{count}</span>
        <span className={`text-xs ${style.text}`}>({fmtRatio(ratio)}x fair share)</span>
      </div>
    </td>
  );
};

export default function FairnessReport({ departmentId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [dutyTypes, setDutyTypes] = useState([]);
  const [astBenchmark, setAstBenchmark] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('weekend'); // a column key
  const [sortDir, setSortDir] = useState('desc'); // worst-first by default

  useEffect(() => {
    const load = async () => {
      if (!departmentId) return;
      setLoading(true);
      try {
        const { data, dutyTypes: types, astBenchmark: benchmark, error: err } = await getFairnessReport(departmentId);
        if (err) throw err;
        setRows(data);
        setDutyTypes(types);
        setAstBenchmark(benchmark);
        setError(null);
      } catch (err) {
        setError(`Failed to load fairness report: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [departmentId, refreshKey]);

  const columns = useMemo(() => columnsFor(dutyTypes), [dutyTypes]);
  const csvColumns = useMemo(() => [
    { header: 'Staff Name', value: r => r.staff_name },
    { header: 'FTE', value: r => formatFte(r.fte) },
    { header: 'FTE after solo work', value: r => formatFte(r.effective_fte) },
    { header: 'AST time (shifts done / share)', value: r => (r.ast_time ? `${r.ast_time.done} / ${Math.round(r.ast_time.quota)}` : '') },
    ...columns.flatMap(c => [
      { header: c.label, value: c.count },
      { header: `${c.label} Fairness Ratio`, value: r => fmtRatio(c.ratio(r)) },
    ]),
  ], [columns]);

  const sortedRows = useMemo(() => {
    const col = columns.find(c => c.key === sortBy) || columns[0];
    // Rows with no ratio (can't do it) always go last.
    const val = r => col.ratio(r) ?? (sortDir === 'asc' ? Infinity : -Infinity);
    return [...rows].sort((a, b) => (sortDir === 'asc' ? val(a) - val(b) : val(b) - val(a)));
  }, [rows, columns, sortBy, sortDir]);

  const toggleSort = (column) => {
    if (sortBy === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  if (loading) return <div className="text-center py-4"><Loader size={20} className="animate-spin mx-auto" /></div>;

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Each person's weekend shifts and on call over the last 12 months, against their fair share. 1.00x is exactly fair; above 1.25x they're carrying more than their share, below 0.75x less.
        Fair shares are by FTE, less any work only that person can do (a solo endoscopy list, say). Weekends are shared by everyone; each on-call type by the people who can do it; All On Call across the hospital.
        {astBenchmark && ` AST time for a specialty anyone can cover (ED for an ED AST) is ${Math.round(astBenchmark.share * 100)}% of their shifts, matching ${astBenchmark.name}, the least service-bound specialty.`}
      </p>

      {rows.length > 0 && (
        <div className="flex justify-end mb-2">
          <ExportCsvButton filename="fairness_report.csv" columns={csvColumns} rows={sortedRows} />
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {rows.length === 0 && !error && (
        <p className="text-sm text-gray-500">No shift data available yet.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Staff Name</th>
                <th className="text-right px-3 py-2 border border-gray-300 font-semibold">FTE</th>
                {columns.map(c => (
                  <th key={c.key} className="text-left px-3 py-2 border border-gray-300 font-semibold">
                    <button onClick={() => toggleSort(c.key)} className="flex items-center gap-1 hover:text-blue-700" title={`Sort by ${c.label}`}>
                      {c.label}
                      {sortBy === c.key && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => (
                <tr key={row.staff_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border border-gray-300 font-medium">
                    {row.staff_name}
                    {row.ast_time && (
                      <span className="block text-[11px] font-normal text-gray-500" title="Shifts in their specialty, against their AST share of their shifts">
                        AST time {row.ast_time.done} of {Math.round(row.ast_time.quota)} shifts
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 border border-gray-300 text-right text-gray-600" title="FTE, and in brackets after work only they can do">
                    {formatFte(row.fte)}{row.effective_fte < row.fte - 0.005 && <span className="text-gray-400"> ({formatFte(row.effective_fte)})</span>}
                  </td>
                  {columns.map(c => <RatioCell key={c.key} ratio={c.ratio(row)} count={c.count(row)} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4">
        {Object.entries(FAIRNESS_STYLES).map(([key, style]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${style.dot}`} />
            <span className="text-xs text-gray-600">{style.label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

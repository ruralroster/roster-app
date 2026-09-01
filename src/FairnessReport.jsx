import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Loader, ArrowUp, ArrowDown } from 'lucide-react';
import { getFairnessReport } from './supabaseClient';
import { formatFte, computeFairnessStatus, FAIRNESS_STYLES } from './availabilityUtils';
import ExportCsvButton from './ExportCsvButton';

const CSV_COLUMNS = [
  { header: 'Staff Name', value: r => r.staff_name },
  { header: 'FTE', value: r => formatFte(r.fte) },
  { header: 'Weekend Shifts', value: r => r.weekend_shifts },
  { header: 'Weekend Fairness Ratio', value: r => r.weekend_fairness_ratio.toFixed(2) },
  { header: 'On-Call Duties', value: r => r.oncall_shifts },
  { header: 'On-Call Fairness Ratio', value: r => r.oncall_fairness_ratio.toFixed(2) },
];

const RatioCell = ({ ratio, count }) => {
  const status = computeFairnessStatus(ratio);
  const style = FAIRNESS_STYLES[status];
  return (
    <td className="px-3 py-2 border border-gray-300">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${style.dot}`} />
        <span className="text-gray-900">{count}</span>
        <span className={`text-xs ${style.text}`}>({ratio.toFixed(2)}x fair share)</span>
      </div>
    </td>
  );
};

export default function FairnessReport({ departmentId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortBy, setSortBy] = useState('weekend'); // 'weekend' | 'oncall'
  const [sortDir, setSortDir] = useState('desc'); // worst-first by default

  useEffect(() => {
    const load = async () => {
      if (!departmentId) return;
      setLoading(true);
      try {
        const { data, error: err } = await getFairnessReport(departmentId);
        if (err) throw err;
        setRows(data);
        setError(null);
      } catch (err) {
        setError(`Failed to load fairness report: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [departmentId, refreshKey]);

  const sortedRows = useMemo(() => {
    const key = sortBy === 'weekend' ? 'weekend_fairness_ratio' : 'oncall_fairness_ratio';
    return [...rows].sort((a, b) => (sortDir === 'asc' ? a[key] - b[key] : b[key] - a[key]));
  }, [rows, sortBy, sortDir]);

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
        Each person's share of weekend shifts and on-call duty over the last 12 months, compared to their fair share based on FTE.
        1.00x means exactly proportional; well above 1.25x means they're carrying more than their share.
      </p>

      {rows.length > 0 && (
        <div className="flex justify-end mb-2">
          <ExportCsvButton filename="fairness_report.csv" columns={CSV_COLUMNS} rows={sortedRows} />
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
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">
                  <button onClick={() => toggleSort('weekend')} className="flex items-center gap-1 hover:text-blue-700" title="Sort by weekend fairness">
                    Weekend Shifts
                    {sortBy === 'weekend' && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">
                  <button onClick={() => toggleSort('oncall')} className="flex items-center gap-1 hover:text-blue-700" title="Sort by on-call fairness">
                    On-Call Duties
                    {sortBy === 'oncall' && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => (
                <tr key={row.staff_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border border-gray-300 font-medium">{row.staff_name}</td>
                  <td className="px-3 py-2 border border-gray-300 text-right text-gray-600">{formatFte(row.fte)}</td>
                  <RatioCell ratio={row.weekend_fairness_ratio} count={row.weekend_shifts} />
                  <RatioCell ratio={row.oncall_fairness_ratio} count={row.oncall_shifts} />
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

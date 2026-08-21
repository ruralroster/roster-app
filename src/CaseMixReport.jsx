import React, { useState, useEffect, useMemo } from 'react';
import { AlertCircle, Loader, ArrowUp, ArrowDown } from 'lucide-react';
import { getCaseMixReport } from './supabaseClient';

export default function CaseMixReport({ departmentId, refreshKey }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // exposure rate sort direction

  useEffect(() => {
    const load = async () => {
      if (!departmentId) return;
      setLoading(true);
      try {
        const { data, error: err } = await getCaseMixReport(departmentId);
        if (err) throw err;
        setRows(data);
        setError(null);
      } catch (err) {
        setError(`Failed to load case mix report: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [departmentId, refreshKey]);

  const groupedByActivity = useMemo(() => {
    const groups = new Map();
    rows.forEach(row => {
      if (!groups.has(row.activity_id)) {
        groups.set(row.activity_id, { activity_name: row.activity_name, rows: [] });
      }
      groups.get(row.activity_id).rows.push(row);
    });

    const groupList = Array.from(groups.values());
    groupList.forEach(group => {
      group.rows.sort((a, b) => {
        const diff = a.exposure_rate - b.exposure_rate;
        return sortDir === 'asc' ? diff : -diff;
      });
    });
    groupList.sort((a, b) => a.activity_name.localeCompare(b.activity_name));

    return groupList;
  }, [rows, sortDir]);

  const toggleSort = () => setSortDir(sortDir === 'asc' ? 'desc' : 'asc');

  if (loading) return <div className="text-center py-4"><Loader size={20} className="animate-spin mx-auto" /></div>;

  return (
    <>
      <p className="text-xs text-gray-600 mb-4">
        Activity exposure rate per staff member over the last 12 months. Lower exposure means less experience with that activity.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {groupedByActivity.length === 0 && !error && (
        <p className="text-sm text-gray-500">No case mix data available yet.</p>
      )}

      {groupedByActivity.map(group => (
        <div key={group.activity_name} className="mb-6 last:mb-0">
          <h3 className="text-sm font-bold text-gray-900 mb-2">{group.activity_name}</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Staff Name</th>
                  <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Activity</th>
                  <th className="text-right px-3 py-2 border border-gray-300 font-semibold">
                    <button
                      onClick={toggleSort}
                      className="flex items-center gap-1 ml-auto hover:text-blue-700"
                      title="Sort by exposure rate"
                    >
                      Exposure Rate (%)
                      {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </button>
                  </th>
                  <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Last Worked Date</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr key={`${row.staff_id}-${row.activity_id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border border-gray-300 font-medium">{row.staff_name}</td>
                    <td className="px-3 py-2 border border-gray-300 text-gray-600">{row.activity_name}</td>
                    <td className="px-3 py-2 border border-gray-300 text-right">{row.exposure_rate.toFixed(1)}%</td>
                    <td className="px-3 py-2 border border-gray-300 text-gray-600">
                      {row.last_worked_date || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </>
  );
}

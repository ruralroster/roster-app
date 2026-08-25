import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { AlertCircle, Loader, Download } from 'lucide-react';
import { fetchRosterExportWeek } from './supabaseClient';
import { generateRosterWorkbook } from './rosterExcelExport';
import { toLocalDateStr } from './dateUtils';

function mondayOnOrBefore(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

// Officer-facing tool for downloading one or more consecutive weeks of the
// department's live roster as an Excel file — the reverse of
// RosterExcelImportTab. See fetchRosterExportWeek (supabaseClient.js) and
// generateRosterWorkbook (rosterExcelExport.js) for what it does and does
// not try to reproduce from the original source file.
export default function RosterExcelExportTab({ departmentId, staffList, locations, activities, leaveTypes }) {
  const [startDate, setStartDate] = useState(() => toLocalDateStr(mondayOnOrBefore(new Date())));
  const [weekCount, setWeekCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const firstMonday = mondayOnOrBefore(startDate);
      const weeksData = [];
      for (let i = 0; i < weekCount; i++) {
        const weekStart = new Date(firstMonday);
        weekStart.setDate(weekStart.getDate() + i * 7);
        const { data, error: fetchError } = await fetchRosterExportWeek(
          departmentId, weekStart, { staffList, locations, activities, leaveTypes }
        );
        if (fetchError) throw fetchError;
        weeksData.push(data);
      }
      const workbook = generateRosterWorkbook(weeksData);
      const filename = weekCount === 1
        ? `Roster ${weeksData[0].weekStart.replace(/\//g, '-')}.xlsx`
        : `Roster ${weeksData[0].weekStart.replace(/\//g, '-')} to ${weeksData[weeksData.length - 1].weekEnd.replace(/\//g, '-')}.xlsx`;
      XLSX.writeFile(workbook, filename);
    } catch (err) {
      setError(`Export failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-sm text-gray-600 mb-4">
        Downloads the SMO/Consultant, Registrar/RMO and Intern sections of the live roster as an Excel file, one sheet per week — a plain, readable recreation rather than a copy of the original file's exact layout or shorthand codes.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg flex gap-2 items-start">
          <AlertCircle size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Start date (any day of the first week)</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 uppercase mb-2">Number of weeks</label>
          <input
            type="number"
            min={1}
            max={12}
            value={weekCount}
            onChange={(e) => setWeekCount(Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)))}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <button
        onClick={handleDownload}
        disabled={loading}
        className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg transition text-sm flex items-center justify-center gap-2"
      >
        {loading ? <Loader size={16} className="animate-spin" /> : <Download size={16} />}
        Download
      </button>
    </div>
  );
}

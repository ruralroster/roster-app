import React, { useState, useEffect } from 'react';
import { Loader, X } from 'lucide-react';
import { getShiftPatternRules, addShiftPatternRule, updateShiftPatternRule, deleteShiftPatternRule, deleteAllShiftPatternRules } from './supabaseClient';

const ACTION_STYLES = {
  ALLOW: 'bg-green-100 text-green-900',
  BLOCK: 'bg-red-100 text-red-900',
  WARN: 'bg-yellow-100 text-yellow-900',
};

const EMPTY_FORM = {
  shift1: '', shift2: '', shift3: '', shift4: '', shift5: '', shift6: '', shift7: '',
  action: 'WARN', description: '',
};

// Rules are always fixed to the same 7-day window (6 days before → ... →
// yesterday → the shift being assigned today) — see the header comment on
// validateShiftAssignment() in supabaseClient.js.
function describePattern(rule, shifts) {
  const shiftName = (id) => (id ? shifts.find(s => s.shift_id === id)?.name || '(deleted shift)' : 'Any Shift');
  return [rule.shift_1_id, rule.shift_2_id, rule.shift_3_id, rule.shift_4_id, rule.shift_5_id, rule.shift_6_id, rule.shift_7_id]
    .map(shiftName).join(' → ');
}

export default function ShiftPatternRulesUI({ departmentId, shifts }) {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error: e } = await getShiftPatternRules(departmentId);
      if (e) throw e;
      setRules(data);
    } catch (err) {
      setError(`Failed to load shift pattern rules: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (departmentId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departmentId]);

  const sortedShifts = [...shifts].filter(s => s.active !== false).sort((a, b) => a.name.localeCompare(b.name));

  const openAddModal = () => {
    setEditingRuleId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = (rule) => {
    setEditingRuleId(rule.rule_id);
    setForm({
      shift1: rule.shift_1_id || '',
      shift2: rule.shift_2_id || '',
      shift3: rule.shift_3_id || '',
      shift4: rule.shift_4_id || '',
      shift5: rule.shift_5_id || '',
      shift6: rule.shift_6_id || '',
      shift7: rule.shift_7_id || '',
      action: rule.rule_action,
      description: rule.description || '',
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const shiftIds = [
        form.shift1 || null, form.shift2 || null, form.shift3 || null, form.shift4 || null,
        form.shift5 || null, form.shift6 || null, form.shift7 || null,
      ];
      const { error: e } = editingRuleId
        ? await updateShiftPatternRule(editingRuleId, shiftIds, form.action, form.description.trim())
        : await addShiftPatternRule(departmentId, shiftIds, form.action, form.description.trim());
      if (e) throw e;
      setShowModal(false);
      await load();
    } catch (err) {
      setError(`Failed to save rule: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ruleId) => {
    if (!window.confirm('Delete this shift pattern rule?')) return;
    setError(null);
    try {
      const { error: e } = await deleteShiftPatternRule(ruleId);
      if (e) throw e;
      setRules(rules.filter(r => r.rule_id !== ruleId));
    } catch (err) {
      setError(`Failed to delete rule: ${err.message}`);
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(`Delete all ${rules.length} shift pattern rules for this department? This can't be undone — you'll be starting from a blank rule set.`)) return;
    setError(null);
    try {
      const { error: e } = await deleteAllShiftPatternRules(departmentId);
      if (e) throw e;
      setRules([]);
    } catch (err) {
      setError(`Failed to clear rules: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Loader size={20} className="animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 border border-red-300 rounded-lg text-sm text-red-700">{error}</div>}
      <p className="text-xs text-gray-600 mb-4">
        Each rule checks a fixed 7-day window: 6 days before the assignment date → ... → yesterday → the shift being
        assigned today. Leave a position as "Any Shift" to ignore it.
      </p>

      <div className="mb-4 flex gap-2">
        <button
          onClick={openAddModal}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition text-sm"
        >
          Add New Rule
        </button>
        {rules.length > 0 && (
          <button
            onClick={handleDeleteAll}
            className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded-lg transition text-sm"
          >
            Clear All Rules
          </button>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-sm text-gray-500">No shift pattern rules configured.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Pattern</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Action</th>
                <th className="text-left px-3 py-2 border border-gray-300 font-semibold">Description</th>
                <th className="px-3 py-2 border border-gray-300"></th>
              </tr>
            </thead>
            <tbody>
              {rules.map(rule => (
                <tr key={rule.rule_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 border border-gray-300 font-mono text-xs whitespace-nowrap">{describePattern(rule, shifts)}</td>
                  <td className="px-3 py-2 border border-gray-300">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ACTION_STYLES[rule.rule_action]}`}>{rule.rule_action}</span>
                  </td>
                  <td className="px-3 py-2 border border-gray-300 text-gray-700">{rule.description}</td>
                  <td className="px-3 py-2 border border-gray-300 whitespace-nowrap">
                    <button
                      onClick={() => openEditModal(rule)}
                      className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-900 font-medium rounded text-xs transition mr-2"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(rule.rule_id)}
                      className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-900 font-medium rounded text-xs transition"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <h2 className="text-xl font-bold text-gray-900">{editingRuleId ? 'Edit Rule' : 'Add New Rule'}</h2>
              <button onClick={() => setShowModal(false)} className="p-1 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 mb-4">
              {[1, 2, 3, 4, 5, 6, 7].map(n => (
                <div key={n}>
                  <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
                    Shift {n}{n === 1 ? '' : ' (optional)'}
                  </label>
                  <select
                    value={form[`shift${n}`]}
                    onChange={(e) => setForm({ ...form, [`shift${n}`]: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Any Shift</option>
                    {sortedShifts.map(s => (
                      <option key={s.shift_id} value={s.shift_id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              ))}

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Description</label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="e.g. After 2 nights need 2 days off"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">Action</label>
                <div className="flex gap-3">
                  {['ALLOW', 'BLOCK', 'WARN'].map(action => (
                    <label key={action} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="radio"
                        name="rule_action"
                        checked={form.action === action}
                        onChange={() => setForm({ ...form, action })}
                      />
                      {action}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-medium py-2 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                disabled={saving}
                onClick={handleSave}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

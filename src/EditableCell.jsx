import { useState, useEffect, useRef } from 'react';

// Click-to-edit text cell: shows plain text until clicked, then an input
// that saves on blur/Enter (only if the value actually changed). Pass
// `listId` to back it with a <datalist> for type-ahead suggestions — typing
// still allows any free-text value, the list is just suggestions.
export default function EditableCell({ value, placeholder, disabled, onSave, listId }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value || '');
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== (value || '')) onSave(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        list={listId}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') { setDraft(value || ''); setEditing(false); }
        }}
        disabled={disabled}
        className="w-full px-2 py-1 border border-blue-400 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={disabled}
      title="Click to edit"
      className="w-full text-left px-2 py-1 text-sm text-gray-700 rounded hover:bg-blue-50 disabled:opacity-50 truncate"
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
    </button>
  );
}

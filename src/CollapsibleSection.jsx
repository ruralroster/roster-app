import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export default function CollapsibleSection({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-lg shadow-sm mb-6 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-gray-50 transition"
      >
        <h2 className="text-lg font-bold text-gray-900">{title}</h2>
        {open ? <ChevronDown size={20} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={20} className="text-gray-500 flex-shrink-0" />}
      </button>
      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}

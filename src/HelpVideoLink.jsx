import React from 'react';
import { PlayCircle } from 'lucide-react';
import { HELP_VIDEOS } from './helpVideos';

// A "Watch" link to a short help video, opening in a new tab.
export default function HelpVideoLink({ id, label = 'Watch the video', className = '' }) {
  const url = HELP_VIDEOS[id];
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800 ${className}`}
    >
      <PlayCircle size={16} /> {label}
    </a>
  );
}

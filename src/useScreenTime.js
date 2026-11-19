import { useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

// Times how long a screen is actively used, for the business case
// (migrations/2026-11-19c_business_case.sql, Reports > Business case).
// Every TICK the screen counts as used if the page is in front and there's
// been a key, click, tap or scroll in the last IDLE; what's built up is
// sent every SEND, and when the page is hidden or the screen changes.
// Failing to send is never shown: it's a measure, not a feature.
const TICK_MS = 15 * 1000;
const IDLE_MS = 2 * 60 * 1000;
const SEND_MS = 60 * 1000;

export function screenCounts(now, lastActive, visible) {
  return visible && now - lastActive <= IDLE_MS;
}

export default function useScreenTime(departmentId, screen) {
  const lastActive = useRef(Date.now());
  const pending = useRef(0);

  useEffect(() => {
    if (!departmentId || !screen) return undefined;
    lastActive.current = Date.now();
    const touch = () => { lastActive.current = Date.now(); };
    const events = ['keydown', 'pointerdown', 'scroll', 'wheel', 'touchstart'];
    events.forEach(e => window.addEventListener(e, touch, { passive: true, capture: true }));

    const send = () => {
      const seconds = Math.round(pending.current / 1000);
      if (seconds <= 0) return;
      pending.current = 0;
      supabase.rpc('log_screen_time', { p_department_id: departmentId, p_screen: screen, p_seconds: seconds }).then(() => {}, () => {});
    };
    const tick = setInterval(() => {
      if (screenCounts(Date.now(), lastActive.current, document.visibilityState === 'visible')) pending.current += TICK_MS;
    }, TICK_MS);
    const flush = setInterval(send, SEND_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') send(); };
    document.addEventListener('visibilitychange', onHide);

    return () => {
      clearInterval(tick);
      clearInterval(flush);
      document.removeEventListener('visibilitychange', onHide);
      events.forEach(e => window.removeEventListener(e, touch, { capture: true }));
      send();
    };
  }, [departmentId, screen]);
}

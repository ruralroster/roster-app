import React, { useState, useEffect } from 'react';
import { Bell, BellOff, Mail } from 'lucide-react';
import { savePushSubscription, deletePushSubscription, hasPushSubscription, sendTestNotification, getNotifyEmail, setNotifyEmail } from './supabaseClient';

// Settings → Notifications, for staff and officers alike — GitHub issue #1.
// Each person chooses email, phone or both. Email goes to the address on
// the staff record unless they untick it (staff.notify_email). Push is per
// device, so each phone/browser turns it on itself.
// Staff are told when a shift they can do is offered; officers are told
// when someone volunteers and (always by email) when someone calls in
// sick; whoever's on call gets sick calls by push (see
// supabase/functions/notify-volunteering).

const VAPID_PUBLIC_KEY = process.env.REACT_APP_VAPID_PUBLIC_KEY;

// The VAPID public key is base64url; pushManager.subscribe wants bytes.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(ch => ch.charCodeAt(0)));
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export default function NotificationSettings({ staffId, departmentId, email, isOfficer = false }) {
  // 'checking' | 'unsupported' | 'ios-install' | 'not-configured' | 'no-worker' | 'off' | 'on' | 'blocked'
  const [pushState, setPushState] = useState('checking');
  const [emailOn, setEmailOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getNotifyEmail(staffId).then(({ data }) => { if (!cancelled) setEmailOn(data); });
    return () => { cancelled = true; };
  }, [staffId]);

  const toggleEmail = async (on) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: saveError } = await setNotifyEmail(staffId, on);
    setBusy(false);
    if (saveError) {
      setError(`Couldn't change email notifications: ${saveError.message}`);
      return;
    }
    setEmailOn(on);
    setMessage(on ? 'Email notifications are on.' : 'Email notifications are off.');
  };

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      let state;
      if (!supported) state = isIos() ? 'ios-install' : 'unsupported';
      else if (!VAPID_PUBLIC_KEY) state = 'not-configured';
      else if (Notification.permission === 'denied') state = 'blocked';
      else {
        // Only registered in production builds (serviceWorkerRegistration.js).
        const registration = await navigator.serviceWorker.getRegistration();
        if (!registration) state = 'no-worker';
        else {
          const subscription = await registration.pushManager.getSubscription();
          const { data: saved } = subscription
            ? await hasPushSubscription(staffId, subscription.endpoint)
            : { data: false };
          state = saved && Notification.permission === 'granted' ? 'on' : 'off';
        }
      }
      if (!cancelled) setPushState(state);
    };
    check().catch(err => {
      console.error('Checking push notifications failed:', err);
      if (!cancelled) setPushState('unsupported');
    });
    return () => { cancelled = true; };
  }, [staffId]);

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushState(permission === 'denied' ? 'blocked' : 'off');
        return;
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setPushState('no-worker');
        return;
      }
      const subscription = (await registration.pushManager.getSubscription())
        || (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      const { error: saveError } = await savePushSubscription(staffId, departmentId, subscription.toJSON());
      if (saveError) throw saveError;
      setPushState('on');
      setMessage('Notifications are on for this device.');
    } catch (err) {
      setError(`Couldn't turn on notifications: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration && (await registration.pushManager.getSubscription());
      if (subscription) {
        const { error: deleteError } = await deletePushSubscription(staffId, subscription.endpoint);
        if (deleteError) throw deleteError;
      }
      setPushState('off');
      setMessage(`Phone notifications are off for this device.${emailOn && email ? ' You will still get emails.' : ''}`);
    } catch (err) {
      setError(`Couldn't turn off notifications: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data, error: testError } = await sendTestNotification(departmentId);
    setBusy(false);
    if (testError) {
      setError(`Test failed: ${testError.message}`);
      return;
    }
    const parts = [];
    if (data?.emailed) parts.push(`an email to ${email}`);
    if (data?.pushed) parts.push(`${data.pushed} phone notification${data.pushed === 1 ? '' : 's'}`);
    setMessage(parts.length > 0
      ? `Sent ${parts.join(' and ')}.`
      : 'Nothing was sent — turn on email or phone notifications above.');
  };

  const pushHelp = {
    'ios-install': 'On iPhone, phone notifications only work once Rstar is on your Home Screen: tap Share → Add to Home Screen, then open Roster from there and come back here.',
    unsupported: "This browser can't show phone notifications.",
    'not-configured': "Phone notifications aren't set up for this app yet.",
    'no-worker': 'Phone notifications only work in the installed app, not this preview.',
    blocked: "Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.",
  }[pushState];

  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900">Notifications</h3>
      <p className="text-sm text-gray-600">
        {isOfficer
          ? "You're told when someone volunteers for a shift you've offered, and when a shift you can do is offered. Sick calls are always emailed to you."
          : "You're told when a shift you can do is offered for volunteering, on a day you've marked yourself available."}
        {' '}If someone calls in sick while you're on call, it comes to every device you've turned phone notifications on for.
      </p>

      {email ? (
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={emailOn}
            onChange={e => toggleEmail(e.target.checked)}
            disabled={busy}
            className="h-4 w-4"
          />
          <Mail size={16} className="text-gray-500" />
          <span>Email me at <span className="font-medium text-gray-900">{email}</span></span>
        </label>
      ) : (
        <p className="text-sm text-gray-600">
          There is no email address on your staff record, so you won't get emails. Ask an officer to add one.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {pushState === 'off' && (
          <button
            onClick={turnOn}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg text-sm transition"
          >
            <Bell size={16} /> Turn on phone notifications for this device
          </button>
        )}
        {pushState === 'on' && (
          <>
            <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
              <Bell size={16} /> Phone notifications on for this device
            </span>
            <button
              onClick={turnOff}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 font-medium rounded-lg text-sm transition"
            >
              <BellOff size={14} /> Turn off
            </button>
          </>
        )}
        <button
          onClick={sendTest}
          disabled={busy}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-800 font-medium rounded-lg text-sm transition"
        >
          Send me a test
        </button>
      </div>

      {pushHelp && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{pushHelp}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

import { BookOpen } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';

// Settings -> Walkthrough. A plain-English tour of every staff-facing
// screen, for people who are new or just haven't found a feature yet.
// Keep this in sync with staffRosterView.jsx when a staff-facing feature
// changes — it's the only place this app explains itself.
export default function StaffWalkthrough() {
  return (
    <div>
      <div className="bg-white rounded-lg shadow-sm p-6 mb-6 flex items-start gap-3">
        <BookOpen size={22} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-gray-900 mb-1">How this app works</p>
          <p className="text-sm text-gray-600">
            Tap a section below to expand it. This covers everything in the bottom bar — Day, Week, Phone Book, Variation and Settings — plus Search, Coffee and Export.
          </p>
        </div>
      </div>

      <CollapsibleSection title="Day — today's roster" defaultOpen>
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li>Shows one date at a time. Use the arrows next to the date to move a day at a time, or the small date field underneath to jump straight to any date.</li>
          <li><span className="font-semibold">On-Call</span> — who's covering each on-call role that day. Yours is highlighted with a "You" tag.</li>
          <li><span className="font-semibold">My allocations for today</span> — a quick list of your own assignments. Tap one to see who else is rostered at that same location for that session.</li>
          <li><span className="font-semibold">Morning / Afternoon / Night</span> — the whole department's roster for that session, grouped by location. Your own rows are highlighted in blue. Tap a section header to expand or collapse it.</li>
          <li>Tap any colleague's name, anywhere in the app, to open their details — their phone number (if they've added one) and a star button to pin them to your Week tab. This popup is the same one everywhere, so starring works from Day, Phone Book or Search — not just here.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Week — your week, and starred colleagues">
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li>One card per day showing everything you're rostered for that week. Use the arrows, or the date field, to move week to week. Phone Book shares this same week — moving one moves the other.</li>
          <li><span className="font-semibold">Starred Colleagues</span> — star someone from their detail popup and they'll show up here, up to 10 people. Tap a colleague's name to expand their own week underneath yours.</li>
          <li><span className="font-semibold">Crossover</span> — tap the purple Crossover button next to a starred colleague to compare your weeks side by side. Each day is marked <span className="font-semibold text-green-700">Work</span> if you're both rostered on, or <span className="font-semibold text-gray-600">Off</span> if neither of you has a shift that day — handy for planning something together. Note "Off" just means no rostered shift, not confirmed leave. Use the arrows inside the Crossover popup to check other weeks; it moves independently of the Week tab's own navigation.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Phone Book — on-call roster & contact numbers">
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li>Grouped by on-call role, one section per role, for the selected week — move week to week with the arrows (shared with the Week tab, see above).</li>
          <li>Tap a name to see their number and star them from the same popup used elsewhere.</li>
          <li>Below the roster, a <span className="font-semibold">Phone Book</span> section lists other numbers your officers have added (e.g. departments outside the roster) — tap one to call it directly.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Variation — pick up shifts & notify sick">
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li><span className="font-semibold">Available Shifts</span> lists unfilled shifts over the next 30 days that you're eligible for. Tap Volunteer to send a request — it needs an officer's approval, and you'll see "Request Sent" once it's in.</li>
          <li>A shift only shows up here if you've marked that date <span className="font-semibold">Available</span> in Settings → Availability — an open shift on a day you haven't set availability for won't appear, even though it's genuinely open.</li>
          <li><span className="font-semibold">Notify Sick</span> tells your officer you can't make today's shift. It's only enabled on a day you're actually rostered on. Once sent, you'll see whether it's pending, approved, or denied — a denial means you should get in touch with your officer directly. There's no push notification for a decision yet, so check back here rather than waiting for an alert.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Search, Coffee & Export — the bottom-bar shortcuts">
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li><span className="font-semibold">Search</span> finds any staff member by name — opens the same detail popup used everywhere else, so you can call or star them from there.</li>
          <li><span className="font-semibold">Coffee</span> shows everyone rostered today who's set a coffee preference (see Settings below), grouped into one order you can copy or text straight to your department's coffee place, if one's configured. Filter by Morning/Afternoon/Night with the checkboxes at the top. Untick someone's row to leave them off today's order, or use "Add someone not on the roster" at the bottom for a locum or visitor's coffee. Both stick for the rest of the day — anyone else who opens Coffee today sees the same adjusted list — but reset the next day.</li>
          <li><span className="font-semibold">Export</span> downloads a calendar file (.ics) of your assignments for the current real-world week, which you can import into your phone's calendar app. It's always this week, regardless of which week you're currently viewing on the Week tab — and if you've nothing on this week, you'll get a message instead of a download.</li>
        </ul>
      </CollapsibleSection>

      <CollapsibleSection title="Settings — your profile, availability & security">
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
          <li><span className="font-semibold">Profile</span> — your name and rank (set by an officer), plus your email and phone, which you can edit yourself (tap the value to edit it). Changing your email here also updates the address you sign in with, so double-check it before saving.</li>
          <li><span className="font-semibold">Activity Restrictions</span> — tick anything you're not able to do, so officers don't roster you onto it by mistake. This also filters which Available Shifts you're offered in Variation.</li>
          <li><span className="font-semibold">Coffee Preferences</span> — set your standing coffee and milk order once; it's used whenever the Coffee shortcut compiles an order for a day you're working, not something you re-enter each time. Espresso and Long Black are locked to no milk automatically.</li>
          <li><span className="font-semibold">Availability</span> — tap a date to cycle it: grey (not set) → green (available) → red (unavailable) → back to grey. Changes save immediately. If you haven't marked enough available days for your FTE, a banner here will tell you.</li>
          <li><span className="font-semibold">Security</span> — change your password any time, and optionally turn on two-factor authentication (a 6-digit code from an authenticator app) for extra protection at sign-in.</li>
        </ul>
      </CollapsibleSection>
    </div>
  );
}

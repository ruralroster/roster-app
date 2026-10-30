// Short single-feature decks for the help videos, one .pptx per video in
// videos/. Each is four slides:
//   1. Title: the app and audience ("Rstar for staff"), then the topic.
//   2. What it's for: the purpose, in plain words.
//   3. The steps (then the live demo); a video covering two features
//      (callbacks and overtime) has a second steps slide.
//   4. Need a hand?: where Help is in the app, and the contact address.
// Speaker notes are short prompts for recording, not a full script.
//
// layout 'side' videos are recorded with the slides on two-thirds of the
// screen and the app at phone size beside them; 'full' ones switch to the
// app full screen for the demo (calendar and Planner). The layout is noted
// on the title slide's notes.
//
// `node videos.js` builds them all; `node videos.js notify-sick` just one.
const fs = require('fs');
const { build, LAYOUTS, tb, X0, Y0, YMAX, GREY, INK, iconCircle, cw } = require('./build');

const CONTACT = 'ruralroster@gmail.com';

const RSTAR = { dark: '0F3D3E', primary: '0F766E', accent: 'F59E0B', light: 'E6F2F0', soft: 'A7D7CF' };

// The purpose, large, with an optional "who" list beside or below it.
LAYOUTS.purpose = async (pres, slide, s, P) => {
  const hasWho = s.who && s.who.length;
  const textW = hasWho ? 4.6 : cw();
  // Short bullets to talk to, or a paragraph.
  const body = s.bullets
    ? s.bullets.map(b => ({ text: b, options: { bullet: { indent: 22 }, breakLine: true } }))
    : s.text;
  slide.addText(body, tb({ x: X0, y: Y0, w: textW, h: YMAX - Y0, fontSize: s.bullets ? 24 : hasWho ? 18 : 22, color: INK, valign: 'top', paraSpaceAfter: s.bullets ? 18 : 8 }));
  if (!hasWho) return;
  const x = X0 + textW + 0.35, w = cw() - textW - 0.35;
  slide.addShape('roundRect', { x, y: Y0, w, h: YMAX - Y0, fill: { color: P.light }, line: { color: P.light }, rectRadius: 0.1 });
  const rowH = (YMAX - Y0 - 0.3) / s.who.length;
  for (const [i, it] of s.who.entries()) {
    const y = Y0 + 0.15 + i * rowH;
    await iconCircle(slide, it.icon, x + 0.2, y + 0.05, 0.5, P.primary, 'FFFFFF');
    slide.addText(it.h, tb({ x: x + 0.85, y, w: w - 1.0, h: 0.32, fontSize: 15, bold: true, color: INK }));
    slide.addText(it.t, tb({ x: x + 0.85, y: y + 0.32, w: w - 1.0, h: rowH - 0.35, fontSize: 13, color: GREY, valign: 'top' }));
  }
};

// Where Help is (beside its screenshot), and how to get in touch.
LAYOUTS.help = async (pres, slide, s, P) => {
  const w = cw();
  slide.addText(s.where, tb({ x: X0, y: Y0, w, h: 1.4, fontSize: 20, color: INK, valign: 'top' }));
  slide.addShape('roundRect', { x: X0, y: Y0 + 1.6, w, h: 1.9, fill: { color: P.dark }, line: { color: P.dark }, rectRadius: 0.1 });
  await iconCircle(slide, 'MdMailOutline', X0 + 0.25, Y0 + 1.85, 0.6, P.accent, 'FFFFFF');
  slide.addText([
    { text: "Any problems, or anything you'd like changed or added? Don't hesitate to get in touch:", options: { breakLine: true } },
    { text: CONTACT, options: { bold: true, color: P.accent } },
  ], tb({ x: X0 + 1.05, y: Y0 + 1.75, w: w - 1.3, h: 1.6, fontSize: 16, color: 'FFFFFF', valign: 'middle' }));
};

const STAFF_HELP = {
  shot: 'r_help',
  where: 'Help is always in the app: tap Settings, then Walkthrough, for a tour of every screen.',
  notes: "If you get stuck, Settings, then Walkthrough, has the lot. And if anything's not working, or there's something you'd like the app to do, email us at ruralroster@gmail.com.",
};
const OFFICER_HELP = {
  shot: 'o_help',
  where: 'Help is in the top right: the Walkthrough, the full How-To Guide, and a one-page Features summary.',
  notes: "The Help button, top right, has the walkthrough and the full how-to guide. Anything not working, or anything you'd like added, email us at ruralroster@gmail.com.",
};

const VIDEOS = [
  {
    id: 'notify-sick',
    audience: 'staff',
    layout: 'side',
    topic: "Calling in sick",
    sub: 'The Notify Sick button',
    purpose: {
      bullets: ['Feeling a bit dodgy?', 'Less than 12 hours before your shift?', 'Need to make sure everyone knows?'],
      who: [
        { icon: 'MdPhoneInTalk', h: 'ED on call now', t: 'Phone notification straight away, and again at 07:30' },
        { icon: 'MdAlarm', h: '08:00 ED consultant', t: 'That day: phone notification at 07:30' },
        { icon: 'MdMailOutline', h: 'Rostering officers', t: 'Emailed straight away, to fix the roster and your pay' },
      ],
      notes: "The Notify Sick button tells everyone who needs to know that you can't make your shift, in one go. You can use it from 12 hours before a rostered shift (8pm for an 8am start). Anything further ahead is leave, so talk to your officer.\n\nThe ED on call hears straight away and again at 07:30; the 08:00 ED consultant that day hears at 07:30; and your rostering officers get an email so they can sort the roster and your pay.",
    },
    steps: [
      { h: 'Open Variation', t: 'Notify Sick is just under My Variations' },
      { h: 'Tap Notify Sick', t: 'It only works within 12 hours of a rostered shift' },
      { h: 'Tick the shift', t: 'Tick each one you’ll miss' },
      { h: 'Check the message', t: 'Edit it if you like; see who’s told' },
      { h: 'Send, then confirm', t: 'Your officer approves it; the result shows here' },
    ],
    stepsShot: 'r_sick',
    stepsNotes: "Variation, then Notify Sick, just under My Variations. Tick the shift you'll miss. Here's the message, which you can change, and the list of who's told and how. Send, confirm, done. It shows as pending until your officer approves it.",
  },
  {
    id: 'notifications-test',
    audience: 'staff',
    layout: 'side',
    topic: 'Phone notifications',
    sub: 'Turning them on, and Send me a test',
    purpose: {
      bullets: ["Want to know when something needs you?", "Shifts to pick up, sick calls, meetings?", "Not sure your phone's set up?"],
      notes: "Rstar can tell you things on your phone: a shift you could pick up, a sick call while you're on call, a meeting starting. Emails always come. Phone notifications are your choice, one device at a time, and Send me a test checks they're working.\n\nRstar can buzz your phone when something needs you: a shift you could pick up, a sick call while you're on call, a meeting about to start. Email's always on; phone notifications you turn on yourself, on each phone or tablet. Then send yourself a test to be sure.",
    },
    steps: [
      { h: 'iPhone: open Rstar from your Home Screen', t: "Notifications only work from the installed app, not Safari" },
      { h: 'Settings, then Notifications', t: 'Turn on phone notifications for this device' },
      { h: 'Allow them', t: 'Your phone asks once. Tap Allow' },
      { h: 'Tap Send me a test', t: 'A notification should arrive within a few seconds' },
    ],
    stepsShot: 'r_notifications',
    stepsNotes: "On an iPhone, open Rstar from the Home Screen icon, not Safari. Settings, Notifications, turn them on. The phone asks once: Allow. Now Send me a test, and there it is. If nothing comes, check the phone's own notification settings for Rstar.",
  },
  {
    id: 'tap-a-name',
    audience: 'staff',
    layout: 'side',
    topic: 'Finding people',
    sub: 'Tap any name for their details',
    purpose: {
      bullets: ["Need to reach a colleague?", "Don't have their number?", "Want it in two taps?"],
      notes: "Every name in Rstar is a shortcut to that person: their phone, email and coffee order. Numbers are tap to call and emails tap to email, so you can reach a colleague in two taps without hunting for their number.\n\nAny name you see in Rstar, on Day, Week, on call, wherever, is a shortcut to that person. Their phone number is tap to call, their email tap to email. No hunting through your contacts.",
    },
    steps: [
      { h: 'Tap a name', t: 'On Day view, on call, or anywhere else it appears' },
      { h: 'Tap the number to call', t: 'Your phone dials straight away' },
      { h: 'Tap the email to write', t: 'Your mail app opens with it filled in' },
      { h: 'Tap the star', t: 'Keeps them handy on Week view (up to 10)' },
    ],
    stepsShot: 'r_phonebook',
    stepsNotes: "Here's Day view. Tap a name, and up comes their card. Tap the number and the phone dials. Tap the email and your mail app opens, addressed. And the star at the top keeps them on your Week view; more on that in the starring video.",
  },
  {
    id: 'callback-overtime',
    audience: 'staff',
    layout: 'side',
    topic: 'Callbacks and overtime',
    sub: 'Timing them for your pay variation',
    purpose: {
      bullets: ['Called in while on call?', 'Shift running over?', 'Need it for your variation?'],
      notes: "When you're called in while on call, or your shift runs over, Rstar times it for you and keeps the record for your pay variation. The timer runs on the server, so it keeps going if you close the app. Afterwards it tells you the earliest you should be back, for 10 hours' rest.",
    },
    steps: [
      { h: 'Open Variation while on call', t: 'A green Callback button per on-call slot' },
      { h: 'Tap Callback when you go in', t: 'Date and slot are filled in; the timer starts' },
      { h: 'Tap Call Complete when done', t: 'Under 15 minutes, choose whether to record it' },
      { h: 'Note the patient if you like', t: 'Saved to your phone only, never in the app' },
      { h: 'Check the fatigue notice', t: '10 hours after you finish; tell your officer' },
    ],
    stepsTitle: 'Callbacks',
    stepsShot: 'r_callback',
    stepsNotes: "On call, open Variation: there's the green Callback button. Tap it as you head in. When you're done, Call Complete. Short calls ask whether to record them. You can save a patient detail to your own phone; the app never keeps it. Then the fatigue notice: the earliest you should be back.",
    more: {
      title: 'Overtime',
      shot: 'r_overtime',
      steps: [
        { h: 'Open Variation near the end of your shift', t: 'A blue Overtime button, from 30 min before to 4 h after' },
        { h: 'Tapped before the end?', t: 'It starts by itself when your shift ends' },
        { h: 'Tapped after?', t: "It asks if you've been on since the shift ended" },
        { h: 'Tap Overtime Complete', t: 'Then the same as a callback' },
      ],
      notes: "Overtime's the same idea. Near the end of your shift, a blue Overtime button appears. Tap it before you finish and it starts itself at the shift end. Forgot until later? Tap it anyway and it asks whether you've been on since the shift ended. Overtime Complete when you're done, and the rest is just like a callback: short ones ask first, then the fatigue notice. Both end up in My Variations for your form.",
    },
  },
  {
    id: 'planner-lay-out-a-week',
    audience: 'officers',
    layout: 'full',
    topic: 'Laying out a week',
    sub: 'The Planner, step 1',
    purpose: {
      bullets: ["A new week to plan?", "Same jobs most weeks?", "Want to see what needs filling?"],
      notes: "Laying out puts the week's jobs on the days they run, before anyone is booked. Each job brings its hours and the places it needs filling, so the week shows what's required at a glance. Do it once and save it as a template; after that it's one tap a week.\n\nBefore you book anyone, you lay out the week: which jobs run on which days. Each job brings its own hours and places, so you can see at a glance what needs filling. Build it once, save it as a template, and next time it's one tap.",
    },
    steps: [
      { h: 'Planner, then 1 · Lay out jobs', t: 'Go to the week with the arrows or the date box' },
      { h: 'Tap a job in the palette', t: 'A + appears on every day' },
      { h: 'Tap + on each day it runs', t: 'Then pick the next job. × on a card removes it' },
      { h: 'Check the places', t: '0/2 means none of two places filled yet' },
      { h: 'Save week as template', t: 'Next time: choose it from Template… and tap Apply' },
    ],
    stepsNotes: "Full screen now. Planner, step one, lay out jobs. Pick ED Day from the palette, and pluses appear on every day: Monday, Tuesday, through Friday. Now the next job. Each card shows its hours and places, nought of two filled. Happy with it? Save week as template, give it a name. Next week, pick it from the list and Apply.",
  },
];

function deck(v) {
  const officers = v.audience === 'officers';
  const help = officers ? OFFICER_HELP : STAFF_HELP;
  const setup = v.layout === 'full'
    ? 'Recording: slides for the intro, then the app FULL SCREEN for the demo, then back to the slides for the recap and Help.'
    : 'Recording: slides on two-thirds of the screen, the app at phone size beside them.';
  return {
    name: `Rstar for ${v.audience}: ${v.topic}`,
    footer: `Rstar for ${v.audience} · ${v.topic}`,
    palette: RSTAR,
    slides: [
      { type: 'title', title: `Rstar for ${v.audience}`, sub: `${v.topic}: ${v.sub}`,
        notes: `${setup}\n\nIn this short video: ${v.topic.toLowerCase()}, ${v.sub.charAt(0).toLowerCase()}${v.sub.slice(1)}.` },
      { type: 'purpose', title: "What it's for", ...v.purpose },
      { type: 'steps', title: v.stepsTitle || 'How to do it', items: v.steps, icon: 'MdTouchApp', shot: v.stepsShot, notes: v.stepsNotes },
      // A second feature in the same video gets its own steps slide.
      ...(v.more ? [{ type: 'steps', title: v.more.title, items: v.more.steps, icon: 'MdTouchApp', shot: v.more.shot, notes: v.more.notes }] : []),
      { type: 'help', title: 'Need a hand?', shot: help.shot, where: help.where, notes: help.notes },
    ],
  };
}

(async () => {
  const only = process.argv.slice(2);
  fs.mkdirSync('videos', { recursive: true });
  for (const [i, v] of VIDEOS.entries()) {
    if (only.length && !only.includes(v.id)) continue;
    const n = String(i + 1).padStart(2, '0');
    await build(deck(v), `videos/${n}-${v.audience}-${v.id}.pptx`);
  }
})().catch(e => { console.error(e); process.exit(1); });

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
const sharp = require('sharp');
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

// A desktop screenshot large on the left, numbered points beside it: the
// officer decks, whose screens are wide.
LAYOUTS.wide = async (pres, slide, s, P) => {
  const file = `shots/${s.wideShot}.png`;
  const { width, height } = await sharp(file).metadata();
  const pad = 0.07, w = 5.7, h = Math.min(w * height / width, YMAX - Y0);
  const iw = h * width / height;
  slide.addShape('roundRect', { x: X0 - pad, y: Y0 - pad, w: iw + 2 * pad, h: h + 2 * pad, fill: { color: '1F2937' }, line: { color: '1F2937' }, rectRadius: 0.08 });
  const buf = await sharp(file).resize({ width: Math.min(width, 1600) }).png().toBuffer();
  slide.addImage({ data: 'image/png;base64,' + buf.toString('base64'), x: X0, y: Y0, w: iw, h, altText: 'Screenshot of the app' });
  const x = X0 + w + 0.35, tw = cw() - w - 0.35;
  const rowH = (YMAX - Y0) / s.items.length;
  for (const [i, it] of s.items.entries()) {
    const y = Y0 + i * rowH;
    slide.addShape('ellipse', { x, y: y + 0.02, w: 0.36, h: 0.36, fill: { color: P.primary }, line: { color: P.primary } });
    slide.addText(String(i + 1), tb({ x, y: y + 0.02, w: 0.36, h: 0.36, fontSize: 13, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' }));
    slide.addText(it.h, tb({ x: x + 0.5, y, w: tw - 0.5, h: 0.4, fontSize: 14, bold: true, color: INK, valign: 'top' }));
    slide.addText(it.t, tb({ x: x + 0.5, y: y + 0.4, w: tw - 0.5, h: rowH - 0.45, fontSize: 12, color: GREY, valign: 'top' }));
  }
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
      bullets: [
        "Sets out each day's jobs before anyone is allocated",
        'Each job brings its hours and required places',
        'Unfilled places are visible at a glance',
        'A standard week, saved once, is applied in one step',
      ],
      notes: "Laying out is the first of the Planner's two steps. It puts the week's jobs on the days they run, before anyone is allocated. Each job carries its hours and the places it needs filled, so the week shows its requirements at a glance. A standard week only needs laying out once: saved as a template, it can be applied to any week in one step.",
    },
    slides: [
      { title: 'Opening the Planner', wideShot: 'o_blank', items: [
        { h: '1 · Lay out jobs', t: 'Top right of the Planner tab' },
        { h: 'Choose the week', t: 'Arrows or the date box; + shows up to 4 weeks' },
        { h: 'The palette', t: "The department's jobs, grouped by area" },
        { h: 'On-call slots', t: 'Listed under each day, filled separately' },
      ], notes: "Open the Planner tab and make sure step one, Lay out jobs, is selected. Move to the week you're planning with the arrows or the date box; the plus beside 1 week shows up to four at once. Across the top is the palette: every job in the department, grouped by area. Under each day are the on-call slots, which are filled separately." },
      { title: 'Placing the jobs', wideShot: 'o_pick', items: [
        { h: 'Select a job', t: 'It is outlined in the palette' },
        { h: 'Select + on each day', t: 'A + appears on every day; use it where the job runs' },
        { h: 'Move to the next job', t: 'Select another job and repeat' },
        { h: 'Finish or correct', t: 'Select the job again to stop; × removes a card' },
      ], notes: "Select a job in the palette. A plus appears on every day; select it on each day the job runs, here Monday to Friday. Then move on to the next job and repeat. Selecting the job again stops placing it, and the cross on any card removes it." },
      { title: 'Reading the laid-out week', wideShot: 'o_layout', items: [
        { h: 'One card per job', t: 'Its name and hours' },
        { h: 'Places filled', t: '0/2 in red until every place is filled' },
        { h: 'Each empty place', t: 'Shown by grade, ready for step 2' },
        { h: 'Offer from the card', t: 'Offer senior or any grade if it cannot be filled locally' },
      ], notes: "Each job is now a card on its day, showing its hours and how many of its places are filled: nought of two, in red, until they all are. The dashed lines are the empty places, by grade, ready for step two. If a place can't be filled from your own staff, it can be offered straight from the card, to seniors or to any grade." },
      { title: 'Saving it as a template', wideShot: 'o_template', items: [
        { h: 'Lay out a standard week', t: 'Once, on the Planner' },
        { h: 'Save week as template', t: 'Give it a name, such as Standard Week' },
        { h: 'Any later week', t: 'Choose it from Template…, then Apply' },
        { h: 'Manage templates', t: 'Rostering Tools lists and renames them' },
      ], notes: "Once a standard week is laid out, save it: Save week as template, and give it a name. For any later week, choose it from the Template list and select Apply, and the whole week is laid out in one step. Rostering Tools lists them and lets you rename them." },
    ],
  },
  // ---- Staff (side by side) ----
  {
    id: 'day-and-week',
    audience: 'staff',
    layout: 'side',
    topic: 'Your roster',
    sub: 'Day and Week view',
    purpose: {
      bullets: ['Where am I today?', "Who's on call?", "What's my week look like?"],
      notes: "Day shows today: where you are, who's on call, and who else is working each session. Week shows Monday to Sunday at a glance. Both jump to any date, so you can check next month as easily as today.",
    },
    steps: [
      { h: 'Day opens on today', t: 'Arrows or the date box move to any day' },
      { h: 'On-call at the top', t: "Who's on each on-call slot today" },
      { h: 'Your allocation', t: 'Tap its arrow to see who else is there' },
      { h: 'Morning, Afternoon, Night', t: 'Tap a session to see who else is working' },
    ],
    stepsTitle: 'Day',
    stepsShot: 'r_day',
    stepsNotes: "Day opens on today. Use the arrows, or the date box, to move to any day. On-call is at the top: who's on each slot today. Then your own allocation; tap its arrow to see who else is at your location that session. Below that, Morning, Afternoon and Night open up to show everyone else working.",
    more: {
      title: 'Week',
      shot: 'r_week',
      steps: [
        { h: 'Tap Week', t: 'Monday to Sunday, one card per day' },
        { h: 'Each day', t: 'Your shift and activity, with its hours' },
        { h: 'Any week', t: 'Arrows or the date box' },
        { h: 'Starred colleagues', t: 'Shown at the top; see the starring video' },
      ],
      notes: "Week shows Monday to Sunday, one card per day, with your shift, activity and hours. Arrows or the date box take you to any week. Colleagues you've starred appear at the top; that's in its own video.",
    },
  },
  {
    id: 'phone-book',
    audience: 'staff',
    layout: 'side',
    topic: 'The Phone Book',
    sub: "On call, and the numbers you need",
    purpose: {
      bullets: ["Who's on call tonight?", 'Need their number?', 'Need an outside line fast?'],
      notes: "The Phone Book has the week's on-call roster, by slot, and the other numbers your department uses: the nearest tertiary ED, the on-site lines and so on. Every number is tap to call.",
    },
    steps: [
      { h: 'Tap Phone Book', t: "This week's on-call roster, by slot" },
      { h: 'Tap a slot', t: "See who's on each day" },
      { h: 'Tap a name', t: 'Their card: tap to call or email' },
      { h: 'Phone Book, below', t: 'Other useful numbers, tap to call' },
    ],
    stepsShot: 'r_phonebook',
    stepsNotes: "Phone Book, in the bottom bar. At the top is this week's on-call roster, one slot at a time: tap one to see who's on each day, and tap a name for their card, where the number calls and the email writes. Underneath, the Phone Book section has the other numbers your officers have added, all tap to call. The arrows move to other weeks.",
  },
  {
    id: 'coffee-preferences',
    audience: 'staff',
    layout: 'side',
    topic: 'Coffee',
    sub: 'Setting your usual order',
    purpose: {
      bullets: ['Same coffee most days?', 'Want it on the order without asking?', 'Not a coffee drinker?'],
      notes: "Set your usual order once and it's on the morning coffee list every day you're working. No Coffee is an option too, so nobody chases you for an order.",
    },
    steps: [
      { h: 'Settings, then Coffee Preferences', t: 'Your Coffee Order' },
      { h: 'Choose the coffee', t: 'Or No Coffee' },
      { h: 'Choose the milk', t: 'Espresso and long black are black' },
      { h: 'Xtra shot?', t: 'Tick it. Every change saves straight away' },
    ],
    stepsShot: 'r_coffeeprefs',
    stepsNotes: "Settings, Coffee Preferences. Pick your coffee, then your milk, and tick Xtra shot if you like. There's no save button: it's saved as you change it. Not a coffee drinker? Choose No Coffee, and you won't show up as needing an order.",
  },
  {
    id: 'coffee-order',
    audience: 'staff',
    layout: 'side',
    topic: 'Coffee',
    sub: "Sending today's order",
    purpose: {
      bullets: ['Coffee run this morning?', "Who's having what?", 'Someone missing an order?'],
      notes: "The Coffee button gathers everyone's usual order for the session, totals it, and writes the text to the coffee place for you. At 9:00 the ED late consultant is emailed the morning's order too.",
    },
    steps: [
      { h: 'Tap Coffee', t: 'A red number: someone still needs an order' },
      { h: 'Check the summary', t: "Everyone's order, totalled" },
      { h: 'Needs a coffee order', t: 'Pick one, then Add to coffee list' },
      { h: 'Untick, or add a visitor', t: 'Changes are shared, for today only' },
      { h: 'Text the order', t: 'Pick up 10:25 or Delivery 10:30' },
    ],
    stepsShot: 'r_coffee',
    stepsNotes: "Tap Coffee. A red number on it means someone working this morning has no order yet. The summary at the top totals everyone's coffee. Under Needs a coffee order, pick one for them and Add to coffee list; it's for today only. Untick anyone not having one, or add a locum or visitor at the bottom. Everyone sees the same list. Then Text order, choose pick up or delivery, and your messages app opens with it written.",
  },
  {
    id: 'availability',
    audience: 'staff',
    layout: 'side',
    topic: 'Availability',
    sub: "Marking the days you can't work",
    purpose: {
      bullets: ['Away next week?', 'Working somewhere else?', 'Only want shifts you can do?'],
      notes: "Your availability is what the roster and the shift offers check. You start out available every day, so you only mark the days you can't work. Officers won't book you, and you won't be offered shifts, on those days.",
    },
    steps: [
      { h: 'Settings, then Availability', t: 'Four weeks at a time; arrows for more' },
      { h: 'Tap a day to change it', t: 'Grey, green, red, dark grey, and round again' },
      { h: 'Red: unavailable', t: 'Leave or a day off; DR Roster can still offer you shifts' },
      { h: 'Dark grey: working elsewhere', t: 'DR Roster offers you nothing' },
    ],
    stepsShot: 'r_availability',
    stepsNotes: "Settings, Availability. Each tap moves a day on: green is available, red unavailable, dark grey working elsewhere, then back to grey. Red and dark grey both keep you off the roster here. The difference is for DR Roster: on a red day you can still be offered district shifts, on a dark grey day you can't. It saves as you tap.",
  },
  {
    id: 'activity-restrictions',
    audience: 'staff',
    layout: 'side',
    topic: 'Activity restrictions',
    sub: "Opting out of what you can't do",
    purpose: {
      bullets: ["Something you can't do?", "Don't want to be offered it?", 'Changed your mind?'],
      notes: "Activity Restrictions let you opt out of activities you can't or won't do. You won't be offered those shifts, and officers are warned if they book you onto one. Advanced skills are different: your officer sets those.",
    },
    steps: [
      { h: 'Settings, then Activity Restrictions', t: 'Every activity in your department' },
      { h: "Tick I can't do…", t: 'It saves straight away' },
      { h: 'Untick to undo', t: 'Any time' },
      { h: "Missing a shift you'd expect?", t: 'It may need a skill: ask your officer' },
    ],
    stepsShot: 'r_restrictions',
    stepsNotes: "Settings, Activity Restrictions. Tick anything you can't do; it saves as you tick, and untick to undo. You won't be offered those shifts. If you're not seeing a shift you'd expect, it may need an advanced skill, which your officer sets, so ask them.",
  },
  {
    id: 'two-factor',
    audience: 'staff',
    layout: 'side',
    topic: 'Two-factor sign-in',
    sub: 'An extra code when you sign in',
    purpose: {
      bullets: ['Want your account extra safe?', 'Have an authenticator app?', "It's optional"],
      notes: "Two-factor adds a six-digit code from an authenticator app, like Google Authenticator or Authy, to signing in. It's optional and off unless you turn it on. If you lose the phone with the app on it, get in touch and we'll reset it.",
    },
    steps: [
      { h: 'Settings, then Security', t: 'Two-Factor Authentication, below Password' },
      { h: 'Tap Turn on', t: 'A QR code appears' },
      { h: 'Scan it', t: 'In your authenticator app, or type the key' },
      { h: 'Enter the 6-digit code', t: 'Then Verify & enable' },
    ],
    stepsShot: 'r_twofactor',
    stepsNotes: "Settings, Security. Under your password is Two-Factor Authentication: tap Turn on. Scan the QR code with your authenticator app, or type in the key below it. Enter the six-digit code it shows and tap Verify and enable. From the next sign-in, the app asks for a code after your password. Turn off is on the same screen. Lose your phone? Email us and we'll reset it.",
  },
  {
    id: 'export-calendar',
    audience: 'staff',
    layout: 'side',
    topic: 'Exporting your roster',
    sub: "Into your phone's calendar",
    purpose: {
      bullets: ['Want your shifts in your calendar?', 'On call too?', 'Months ahead?'],
      notes: "Export puts your shifts and on-call into your phone's own calendar, at the right times, up to 26 weeks ahead. Re-export when your roster changes.",
    },
    steps: [
      { h: 'Tap Export', t: 'Every upcoming week with something rostered' },
      { h: 'Choose the weeks', t: 'All ticked; untick any you don’t want' },
      { h: 'Tap Export', t: 'One calendar file, shifts and on-call' },
      { h: 'Open the file', t: 'Your phone adds it to your calendar' },
    ],
    stepsShot: 'r_export',
    stepsNotes: "Tap Export in the bottom bar. Every upcoming week that has something rostered for you is listed, up to 26 weeks ahead, all ticked. Untick any you don't want, then Export. You get one calendar file with your shifts and on-call; open it and your phone adds them to your calendar. If the roster changes, export again.",
  },
  {
    id: 'volunteer',
    audience: 'staff',
    layout: 'side',
    topic: 'Picking up a shift',
    sub: 'Volunteering, and withdrawing',
    purpose: {
      bullets: ['Want an extra shift?', 'Free when someone is needed?', 'Changed your mind?'],
      notes: "When officers need a shift covered, they offer it, and you see it if you're senior enough, hold any skill it needs, haven't opted out of it, and are available that day. You're emailed when one comes up. Volunteer, and your officer approves it.",
    },
    steps: [
      { h: 'Variation, then Available Shifts', t: 'A calendar of the next four weeks' },
      { h: 'Purple days', t: 'A shift to volunteer for. Amber: a swap' },
      { h: 'Tap a day, or List', t: 'Then Volunteer' },
      { h: 'Your officer approves', t: 'Until then, Withdraw request takes it back' },
    ],
    stepsShot: 'r_variation',
    stepsNotes: "Variation, then Available Shifts. Purple days have a shift you could volunteer for; amber ones are a colleague's swap, which has its own video. Tap a day, or List for everything, and Volunteer. Your officer approves it. Changed your mind before then? Withdraw request.",
  },

  // ---- Officers (desktop screenshots) ----
  {
    id: 'calendar-colours',
    audience: 'officers',
    layout: 'full',
    topic: 'The Calendar',
    sub: 'What the colours mean',
    purpose: {
      bullets: [
        'Four weeks of coverage at a glance',
        'Each day coloured by whether it is actually covered',
        'Gaps, offers and volunteers stand out',
        'Any day opens in Day view',
      ],
      notes: "The Calendar is the department's coverage at a glance: four weeks, each day coloured by whether it's actually covered, so unfilled work, open offers and waiting volunteers stand out without opening every day.",
    },
    slides: [
      { title: 'Reading the colours', wideShot: 'o_calendar', items: [
        { h: 'Green and grey', t: 'Fully covered; or nothing required' },
        { h: 'Red', t: 'A required job has nobody, and is not offered' },
        { h: 'Blue and purple', t: 'Offered; then a volunteer waiting' },
        { h: 'Orange, with letters', t: 'On-call short; letters name the slot' },
      ], notes: "Green is fully covered, grey means nothing's required. Red means a required job has nobody on it and hasn't been offered; red wins over everything else that day. Blue is offered, nobody yet; purple, a volunteer is waiting, with a hand and a count in the corner. Orange is on-call short, and the letters tell you which slot, here Obs." },
      { title: 'Opening a day', wideShot: 'o_day', items: [
        { h: 'Select any day', t: 'It opens in Day view' },
        { h: 'On-call at the top', t: 'Each slot, and who is on it' },
        { h: 'One card per job', t: 'Places filled of required, red when short' },
        { h: 'Back to the Calendar', t: 'Bottom bar; arrows move four weeks' },
      ], notes: "Select any day and it opens in Day view: the on-call slots at the top, then one card per job with its places, red when short. Fix it there, then come back to the Calendar from the bottom bar. The arrows move four weeks at a time." },
    ],
  },
  {
    id: 'offer-a-shift',
    audience: 'officers',
    layout: 'full',
    topic: 'Offering a shift',
    sub: 'Putting a gap out for volunteers',
    purpose: {
      bullets: [
        'Staff only see shifts you have offered',
        'Only eligible, available staff are told',
        'Mark a service disruption if the service closes',
        'Unfilled offers go to DR Roster after 72 hours',
      ],
      notes: "An empty place isn't offered on its own; you decide what goes out. When you offer it, only staff who are senior enough, hold any required skill, haven't opted out and are available that day see it, and they're emailed and notified straight away. If nobody local takes it, it goes to DR Roster after the site's keep-local time, 72 hours unless changed.",
    },
    slides: [
      { title: 'Finding the gap', wideShot: 'o_fill', items: [
        { h: 'A short job', t: 'Its count is red, e.g. 1/2' },
        { h: 'Offer senior', t: 'For an empty senior place' },
        { h: 'Offer any grade', t: 'For a junior or any-grade place' },
        { h: 'Nobody picked', t: 'The buttons show when the bar is clear' },
      ], notes: "On the Planner or Day view, a job that's short shows its count in red, here one of two. At the bottom of the card are the offer buttons: Offer senior for an empty senior place, Offer any grade for a junior one, which seniors can take too. They show when nobody is picked in the bar." },
      { title: 'Making the offer', wideShot: 'o_offer', items: [
        { h: 'Select the offer button', t: 'A confirmation appears' },
        { h: 'Service disruption', t: 'Tick it if the service closes when unfilled' },
        { h: 'Select Offer', t: 'Eligible staff are emailed and notified' },
        { h: 'Now reads Offered', t: 'And the Calendar day turns blue' },
      ], notes: "Select the button and confirm. Tick Service disruption if the service closes when nobody takes it, for example obstetrics going on bypass; staff see it marked, and it carries through to DR Roster. Select Offer. Eligible staff are emailed and notified at once, the button now reads Offered, and the day turns blue on the Calendar. Selecting Offered takes it back off." },
    ],
  },
  {
    id: 'volunteering-panel',
    audience: 'officers',
    layout: 'full',
    topic: 'The Volunteering panel',
    sub: 'Accepting volunteers, and offering in bulk',
    purpose: {
      bullets: [
        'Every offer and volunteer in one place',
        'Accept a volunteer without hunting for the day',
        'Unfilled places for the next 30 days, ready to offer',
      ],
      notes: "The Volunteering panel at the top of the Calendar gathers everything about offers: who's volunteered, what's still waiting, and what's unfilled and not yet offered over the next 30 days.",
    },
    slides: [
      { title: 'Volunteers waiting', wideShot: 'o_volunteering', items: [
        { h: 'Volunteers waiting', t: 'Each shift, and who has volunteered' },
        { h: 'Review', t: 'Opens the day; the card shows the volunteer count' },
        { h: 'Accept', t: 'Booked; the offer and other requests clear' },
        { h: 'Mark disruption, Remove', t: 'Change the flag, or withdraw the offer' },
      ], notes: "At the top of the Calendar, Volunteers waiting lists every shift with someone waiting, with their names. Review opens that day: the card's button shows the number of volunteers; select it, then Accept beside a volunteer. They're booked into the empty place, the offer and any other requests for it are cleared, and the day goes green once nothing else is missing. Mark disruption changes the service-disruption flag; Remove withdraws the offer, and any requests for it are dropped; you're asked first." },
      { title: 'Offering several at once', wideShot: 'o_unfilled', items: [
        { h: 'Offered, nobody yet', t: 'Every open offer from today, with Remove' },
        { h: 'Unfilled, not offered', t: 'Empty places over the next 30 days' },
        { h: 'Offer from the list', t: 'Offer Consultant or Offer Registrar' },
        { h: 'Open day', t: 'To fill it yourself instead' },
      ], notes: "Below that, Offered, nobody yet lists every open offer, each with Remove. Unfilled, not offered yet lists the empty places over the next 30 days, each with its own offer button, so several can go out without opening each day. Open day takes you there to fill it yourself." },
    ],
  },
  {
    id: 'planner-fill-places',
    audience: 'officers',
    layout: 'full',
    topic: 'Filling places',
    sub: 'The Planner, step 2',
    purpose: {
      bullets: [
        'Pick a person, then book them where they fit',
        'Those furthest under their share come first',
        'Each person is shown only places they can fill',
        'Best jobs numbered, to keep activities fair',
      ],
      notes: "Step two fills the laid-out week person by person. The list puts whoever most needs shifts first, each person is only offered places they can actually fill, and their jobs are numbered so that, over time, everyone does each activity in proportion to their FTE.",
    },
    slides: [
      { title: 'The people list', wideShot: 'o_fill', items: [
        { h: '2 · Fill places', t: 'People are listed along the bottom' },
        { h: 'Most in need first', t: 'Available, then furthest under their share' },
        { h: 'Days worked of target', t: 'e.g. 0/5; orange when over' },
        { h: 'Show filter', t: 'Everyone, Seniors, Juniors or one rank' },
      ], notes: "Select step two, Fill places. Everyone is listed along the bottom, most in need first: those available on the days shown, then whoever is furthest under their share for their FTE. Each name shows days worked against their target, orange once they're over. The Show filter narrows it to seniors, juniors or a single rank." },
      { title: 'Booking a person', wideShot: 'o_rank', items: [
        { h: 'Select a name', t: 'The places they can fill turn green' },
        { h: 'Numbers 1, 2, 3', t: '1 is the job they have done least' },
        { h: 'Select a place', t: 'They are booked there' },
        { h: '+ extra', t: 'Adds them on top of the places' },
      ], notes: "Select a name. The places they can fill turn green, and their jobs are numbered: number one, with the green border, is the activity they've done least compared with their fair share over the last twelve months. Select a place to book them. Plus extra adds someone on top of a job's places. Select their name again to stop." },
      { title: 'What stops a booking', wideShot: 'o_places', items: [
        { h: 'Grade', t: 'Senior places take only senior ranks' },
        { h: 'Skills', t: 'A place can need an advanced skill' },
        { h: 'Leave and clashes', t: 'Shown as Unavailable or Busy' },
        { h: 'Visitors', t: 'Select an amber place and type a name' },
      ], notes: "Nobody is offered a place they can't do. A senior place only takes ranks that don't need supervision; a junior place takes anyone. A place may need an advanced skill. Someone on leave, or already working overlapping hours, shows the reason and can't be booked. Admin never clashes. For a visiting surgeon or dentist, select an amber place and type their name." },
    ],
  },
  {
    id: 'jobs-and-places',
    audience: 'officers',
    layout: 'full',
    topic: 'Setting up a job',
    sub: 'Hours, location and the places it needs',
    purpose: {
      bullets: [
        'A job is a regular piece of work, e.g. ED Day',
        'It sets the location, activity and hours',
        'Its places say who it needs, as a minimum',
        'Set up once; used every week on the Planner',
      ],
      notes: "Jobs are the building blocks of the Planner: the regular pieces of work your department runs, like ED Day or Endoscopy. Each has a location, an activity and its hours, plus the places it needs filled. You set them up once.",
    },
    slides: [
      { title: 'Creating a job', wideShot: 'o_jobs', items: [
        { h: 'Settings → Jobs', t: 'Under Locations & Activities → Jobs (Planner)' },
        { h: 'Name it', t: 'Then its location and activity, as used on cards' },
        { h: 'The hours it runs', t: 'Then Add job' },
        { h: 'Existing cards?', t: 'Convert existing activities turns them into jobs' },
      ], notes: "Settings, Locations and Activities, then Jobs (Planner). Give the job a name, choose its location and activity, set the hours the service runs, and Add job. If the roster already has cards, Convert existing activities turns them into jobs without changing anyone's bookings." },
      { title: 'Adding its places', wideShot: 'o_places', items: [
        { h: 'Select Places', t: 'On the job; add each role it needs' },
        { h: 'Who can fill it', t: 'Staff, Visitor only, or Staff or visitor' },
        { h: 'Grade and skills', t: 'Any, Senior or Junior; any one skill ticked' },
        { h: 'How many', t: 'A minimum: more can always be added' },
      ], notes: "Select Places on the job. For each place give a role, such as Anaesthetist; who can fill it, staff, visitor only, or either; the grade; any advanced skill the person must hold, where any one of those ticked is enough; and how many. It's a minimum, not a cap. A job with no places is never shown as short." },
    ],
  },

  // ---- Staff (side by side): the rest of the staff list ----
  {
    id: 'invite-password',
    audience: 'staff',
    layout: 'side',
    topic: 'Getting started',
    sub: 'Accepting your invite',
    purpose: {
      bullets: ['Just been invited?', 'Need a password?', "Link not working?"],
      notes: "Your rostering officer invites you by email. The link in it signs you in once and asks you to choose a password; after that you sign in with your email and that password. If the email never arrives, or the link has stopped working, your officer can resend it or give you a one-time password.",
    },
    steps: [
      { h: 'Open the invite email', t: 'Tap the link in it' },
      { h: 'Set your password', t: 'At least 8 characters' },
      { h: 'Type it again', t: 'Then Save password' },
      { h: "You're in", t: 'From now on: your email and that password' },
      { h: 'No email?', t: 'Ask your officer to resend it' },
    ],
    stepsShot: 'r_setpassword',
    stepsNotes: "Open the invite email and tap the link. Rstar opens on Set your password: choose one, at least eight characters, type it again, and Save password. That's it, you're in. Next time, sign in with your email and that password. No email, check your junk folder, then ask your officer: they can resend it, or give you a one-time password, and you'll be asked to choose your own the first time you use it.",
  },
  {
    id: 'install-iphone',
    audience: 'staff',
    layout: 'side',
    topic: 'Installing Rstar',
    sub: 'On an iPhone',
    purpose: {
      bullets: ['Want Rstar on your Home Screen?', 'Want phone notifications?', 'No App Store?'],
      notes: "Rstar isn't in the App Store: it's a web app you add to your Home Screen from Safari. Once it's there it opens full screen like any other app, and it's the only way an iPhone will show Rstar's phone notifications.",
    },
    steps: [
      { h: 'Open Rstar in Safari', t: 'It has to be Safari' },
      { h: 'Tap Install App', t: 'It shows you how' },
      { h: 'Tap Share', t: 'The square with the arrow' },
      { h: 'Add to Home Screen', t: 'Then Add, top right' },
      { h: 'Open it from the icon', t: 'Sign in once more there' },
    ],
    stepsShot: 'r_installios',
    stepsNotes: "Open Rstar in Safari. Under Sign in there's Install App: tap it and it tells you what to do. Tap the Share button, the square with the arrow, scroll down to Add to Home Screen, then Add. Now open Rstar from the new icon, not Safari, and sign in. From here you can turn on phone notifications, which is its own short video.",
  },
  {
    id: 'install-android',
    audience: 'staff',
    layout: 'side',
    topic: 'Installing Rstar',
    sub: 'On an Android phone',
    purpose: {
      bullets: ['Want Rstar on your Home Screen?', 'Want phone notifications?', 'No Play Store?'],
      notes: "Rstar isn't in the Play Store: it's a web app Chrome installs for you. Installed, it opens full screen with its own icon, like any other app.",
    },
    steps: [
      { h: 'Open Rstar in Chrome', t: 'The link from your invite' },
      { h: 'Tap Install App', t: 'Under Sign in' },
      { h: 'Tap Install', t: "Chrome asks to confirm" },
      { h: 'No button?', t: 'Chrome menu ⋮, then Install app or Add to Home screen' },
      { h: 'Open it from the icon', t: 'Sign in once more there' },
    ],
    stepsShot: 'r_signin',
    stepsNotes: "Open Rstar in Chrome. Under Sign in there's an Install App button: tap it, and Chrome asks you to confirm, so tap Install. If you don't see the button, Chrome's three-dot menu has Install app, or Add to Home screen. Then open Rstar from its new icon and sign in.",
  },
  {
    id: 'star-crossover',
    audience: 'staff',
    layout: 'side',
    topic: 'Your roster',
    sub: 'Starring colleagues, and Crossover',
    purpose: {
      bullets: ['Want to see a friend’s week?', 'Working together on Thursday?', 'Both off this weekend?'],
      notes: "Star up to ten colleagues and they're pinned to the top of your Week view, where you can open their week. Crossover puts your week beside theirs: the days you're working together, and the days you're both off.",
    },
    steps: [
      { h: 'Tap their name', t: 'Anywhere, or search for them' },
      { h: 'Tap the star', t: 'Up to 10 people' },
      { h: 'Find them on Week', t: 'Under Starred Colleagues' },
      { h: 'Tap the star again', t: 'To unstar' },
    ],
    stepsTitle: 'Starring',
    stepsShot: 'r_person',
    stepsNotes: "Tap a colleague's name anywhere in the app, or search for them, and tap the star at the top of their card. You can star up to ten people. They're now at the top of your Week view, under Starred Colleagues. Tap the star again to unstar them.",
    more: {
      title: 'Crossover',
      shot: 'r_crossover',
      steps: [
        { h: 'Week, then the arrow', t: 'Their shifts this week' },
        { h: 'Tap Crossover', t: 'Your week against theirs' },
        { h: 'Green: working together', t: 'Grey: both off' },
        { h: 'Arrows', t: 'Any other week' },
      ],
      notes: "On Week, tap the arrow beside a starred name to see their shifts. Crossover compares their week with yours: green days you're both working, grey days you're both off. The arrows move week by week, handy for planning a weekend or a swap.",
    },
  },
  {
    id: 'search',
    audience: 'staff',
    layout: 'side',
    topic: 'Finding people',
    sub: 'Search for anyone',
    purpose: {
      bullets: ['Need someone’s number?', 'Not on today?', 'Only know their first name?'],
      notes: "Search finds anyone in your department, working today or not, by any part of their name. Their card has their phone and email, tap to call or write, and their usual coffee.",
    },
    steps: [
      { h: 'Tap the magnifying glass', t: 'Bottom right' },
      { h: 'Type part of a name', t: 'First or last name' },
      { h: 'Tap Search', t: 'Everyone who matches' },
      { h: 'Tap a name', t: 'Phone and email, tap to call or write' },
    ],
    stepsShot: 'r_search',
    stepsNotes: "The magnifying glass, bottom right. Type any part of a name, first or last, and Search. Everyone who matches is listed with their rank and number. Tap one for their card: the phone number calls, the email writes, and there's the star if you'd like them on your Week view.",
  },
  {
    id: 'profile',
    audience: 'staff',
    layout: 'side',
    topic: 'Your profile',
    sub: 'Your email and phone',
    purpose: {
      bullets: ['New mobile number?', 'Changed your email?', 'Rank or FTE wrong?'],
      notes: "Your profile is what colleagues see when they tap your name. You keep your email and phone up to date yourself; your name, rank and FTE are set by your rostering officer.",
    },
    steps: [
      { h: 'Settings, then Profile', t: 'Name, rank, FTE, email, phone' },
      { h: 'Tap your phone', t: 'Type the new number' },
      { h: 'Tap your email', t: "It's the one you sign in with, too" },
      { h: 'Tap away to save', t: 'Or press Enter' },
      { h: 'Rank or FTE wrong?', t: 'Ask your officer' },
    ],
    stepsShot: 'r_profile',
    stepsNotes: "Settings, Profile. Tap your phone number to change it, then tap away, or press Enter, and it's saved. Same for your email, but remember it's also the email you sign in with, so use the new one next time. Name, rank and FTE come from your officer: if one's wrong, let them know.",
  },
  {
    id: 'change-password',
    audience: 'staff',
    layout: 'side',
    topic: 'Your password',
    sub: 'Changing it, or resetting it',
    purpose: {
      bullets: ['Want a new password?', 'Forgotten it?', 'Signed in with a one-time password?'],
      notes: "You can change your password any time from Settings. If you've forgotten it, the sign-in screen emails you a link to set a new one.",
    },
    steps: [
      { h: 'Settings, then Security', t: 'Password is at the top' },
      { h: 'Type a new password', t: 'At least 8 characters' },
      { h: 'Type it again', t: 'Then Change password' },
      { h: 'Forgotten it?', t: 'Sign-in screen: your email, then Forgot password?' },
    ],
    stepsShot: 'r_security',
    stepsNotes: "Settings, Security. Type your new password, at least eight characters, then again to confirm, and Change password. Forgotten it? On the sign-in screen, type your email first, then tap Forgot password, and we'll email you a link to choose a new one.",
  },
  {
    id: 'patient-detail',
    audience: 'staff',
    layout: 'side',
    topic: 'Callbacks',
    sub: 'Saving a patient detail',
    purpose: {
      bullets: ['Which patient was that call for?', 'Need it for your notes?', 'Worried about privacy?'],
      notes: "After a callback you can note which patient it was for. It's saved only as a text file on your phone: Rstar never stores patient details, and your officer never sees them.",
    },
    steps: [
      { h: 'Tap Complete', t: 'When the call is over' },
      { h: 'Callback recorded', t: 'The times, and an optional patient' },
      { h: 'MRN, or a name', t: 'Whichever you have' },
      { h: 'Download to phone', t: 'A text file, on this phone only' },
      { h: 'Not needed?', t: 'Skip' },
    ],
    stepsShot: 'r_patient',
    stepsNotes: "When the call's over, tap Complete. Callback recorded shows the times, then asks, optionally, which patient it was for: an MRN, or a surname and first name. Download to phone saves a small text file with the call and the patient on your phone. Nothing about the patient goes to Rstar. If you don't need it, Skip.",
  },
  {
    id: 'my-variations',
    audience: 'staff',
    layout: 'side',
    topic: 'My Variations',
    sub: 'Checking, correcting and downloading',
    purpose: {
      bullets: ['Filling in your variation form?', 'Tapped Complete late?', 'Want a copy?'],
      notes: "Every callback and overtime you record is kept in My Variations, with its times and duration, ready for your payroll variation form. Correct a time if you need to, download them all, then delete them once they're submitted.",
    },
    steps: [
      { h: 'Variation, then My Variations', t: 'Every callback and overtime' },
      { h: 'Check the times', t: 'And the total' },
      { h: 'Pencil to correct a time', t: 'Shows as edited' },
      { h: 'Download', t: 'A spreadsheet file, for your form' },
      { h: 'Delete once submitted', t: 'One at a time, or Delete all' },
    ],
    stepsShot: 'r_myvariations_full',
    stepsNotes: "Variation, then My Variations. Each callback and overtime is listed with its start, finish and length, and the total is at the top. Tapped Complete late? The pencil lets you fix a time, and it's marked edited. Download gives you a spreadsheet file for your variation form. Once it's submitted, delete them, one at a time with the bin, or Delete all.",
  },
  {
    id: 'take-swap',
    audience: 'staff',
    layout: 'side',
    topic: 'Swaps',
    sub: "Taking a colleague's shift",
    purpose: {
      bullets: ["A colleague can't do a shift?", 'Happy to take it?', 'Want one of yours covered in return?'],
      notes: "When a colleague puts a shift up for swap, it shows amber in Available Shifts. You take it by giving them one of yours, on a day they said they could work, so neither of you ends up with more or fewer shifts. Your officer approves it. Swaps are for DR Roster doctors; if you're not one, you won't see them.",
    },
    steps: [
      { h: 'Variation, then Available Shifts', t: 'Amber days: a swap you could take' },
      { h: 'Tap the day, or List', t: "Their shift, and why" },
      { h: "Pick one of yours", t: "Only days they said they can work" },
      { h: 'Offer swap', t: 'Add a note if you like' },
      { h: 'Your officer approves', t: 'Until then, Withdraw offer' },
    ],
    stepsShot: 'r_takeswap',
    stepsNotes: "Variation, Available Shifts. Amber days have a colleague's shift up for swap. Tap the day, or List. You'll see whose shift it is, the hours, and their note. Under You'd give them in return, pick one of your shifts; only days they said they can work are listed. Offer swap, add a note for the officer if you like, and it goes to them to approve. Until then you can Withdraw offer. Purple days are shifts to volunteer for, which is the preferred way and has its own video.",
  },
  {
    id: 'swap-your-shift',
    audience: 'staff',
    layout: 'side',
    topic: 'Swaps',
    sub: 'Putting one of your shifts up for swap',
    purpose: {
      bullets: ["Can't do a shift?", 'Happy to work another day instead?', 'Too far ahead for Notify Sick?'],
      notes: "Swap a shift puts one of your rostered shifts on DR Roster's swap marketplace. Someone takes it by giving you one of theirs on a day you said you could work, and your officer approves it. You still work your shift unless a swap is approved. This is for DR Roster doctors.",
    },
    steps: [
      { h: 'Variation, then Swap a shift', t: 'At the bottom; tap to open' },
      { h: 'Offer for swap', t: 'Beside the shift' },
      { h: 'Tick days you could work', t: 'This pay fortnight; at least one' },
      { h: 'Other sites? A note?', t: 'Both optional' },
      { h: 'Offer for swap', t: 'You still work it unless a swap is approved' },
    ],
    stepsShot: 'r_swapform',
    stepsNotes: "Variation, then Swap a shift, at the bottom. Tap Offer for swap beside the shift you can't do. Tick the days or nights this pay fortnight you could work in return; greyed ones are when you're working or wouldn't get ten hours' rest. Tick other sites if you'd go elsewhere, add a note, and Offer for swap. You'll hear when someone offers and your officer decides; until then you still work it. Withdraw takes it back off.",
  },
  {
    id: 'meetings',
    audience: 'staff',
    layout: 'side',
    topic: 'Meetings',
    sub: 'Reminders, and joining remotely',
    purpose: {
      bullets: ['Teaching at lunchtime?', 'Working from another site?', 'Forgot it was on?'],
      notes: "Officers put meetings on the roster, like junior teaching or the department meeting, and choose who they're for. If one's for you, it's on your Day view with Join and Dial in buttons, and you get reminders.",
    },
    steps: [
      { h: 'Day: Meetings for you', t: "Only the ones you're invited to" },
      { h: 'Join', t: 'Opens the Teams or Zoom link' },
      { h: 'Dial in', t: 'Calls the number for you' },
      { h: 'Email that morning', t: '08:00, or 07:00 for an early meeting' },
      { h: 'Phone notification', t: 'Just before it starts, if notifications are on' },
    ],
    stepsShot: 'r_meeting',
    stepsNotes: "On your Day view, Meetings for you lists any meeting today that's for you: the time, the name and where. Join opens the Teams or Zoom link; Dial in rings the number. You'll also get an email that morning, at eight, or seven for a meeting before half past eight, and, if you've turned on phone notifications, a reminder just before it starts.",
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
      ...(v.slides ? v.slides.map(x => ({ type: 'wide', ...x })) : [{ type: 'steps', title: v.stepsTitle || 'How to do it', items: v.steps, icon: 'MdTouchApp', shot: v.stepsShot, notes: v.stepsNotes }]),
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

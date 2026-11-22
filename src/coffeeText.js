// The text to the coffee place, in ten wordings of the same message (the
// order, then pick up at 10:25 or delivery at 10:30, then thanks), one
// picked at random each time Text order is pressed, so it reads like a
// person wrote it rather than the same text every day.
export const COFFEE_TEXT_VARIANTS = [
  {
    opening: 'Good morning, the order for the hospital coffees is:',
    pickup: "I can pick it up at 10:25, but let me know if delivery is easier!",
    delivery: "If you can deliver it to the hospital today at 10:30 that'd be awesome. If not, let me know.",
    closing: ['Thanks!', 'Have a good day'],
  },
  {
    opening: "Morning! Here's today's coffee order from the hospital:",
    pickup: "I'll swing by to grab it at 10:25, unless delivering suits you better.",
    delivery: "Could you drop it up to the hospital at 10:30? Just let me know if that doesn't work today.",
    closing: ['Thanks so much!'],
  },
  {
    opening: 'Hi there, hospital coffees again today please:',
    pickup: "Happy to pick them up at 10:25. Let me know if you'd rather deliver.",
    delivery: "Would you be able to deliver to the hospital at 10:30? No worries if not, just let me know.",
    closing: ['Cheers!', 'Have a great day'],
  },
  {
    opening: 'Good morning! Coffee order for the hospital team:',
    pickup: "I'll come and collect at 10:25, if that's OK. Delivery's fine too if it's easier.",
    delivery: "Delivery to the hospital at 10:30 would be amazing. Let me know if that's a problem.",
    closing: ['Thank you!'],
  },
  {
    opening: "Hi! Here's what the hospital crew would like this morning:",
    pickup: "Pick up at 10:25 works for me, but let me know if you can deliver.",
    delivery: "If you could bring it over to the hospital for 10:30 that would be brilliant. Let me know if not.",
    closing: ['Thanks heaps!', 'Have a good one'],
  },
  {
    opening: "Morning, it's the hospital with today's coffee order:",
    pickup: "I'll be in to pick it up at 10:25. Shout if delivery suits you better.",
    delivery: "Any chance of a delivery to the hospital at 10:30 today? Let me know either way.",
    closing: ['Much appreciated!'],
  },
  {
    opening: 'Hello! The hospital coffee order for today is:',
    pickup: "I'll grab it at 10:25 if that's alright, or let me know if delivery's easier.",
    delivery: "Could you deliver it to the hospital at 10:30? If that's tricky today, just let me know.",
    closing: ['Thanks a lot!', 'Have a lovely day'],
  },
  {
    opening: "Good morning, here's the coffee order for the hospital:",
    pickup: 'Planning to pick up at 10:25. Let me know if delivering would work better for you.',
    delivery: "A 10:30 delivery to the hospital would be perfect, if that works. Let me know if not.",
    closing: ['Thank you so much!'],
  },
  {
    opening: 'Hi, hospital coffee run for today please:',
    pickup: "I'll pop in at 10:25 to collect. Happy for you to deliver instead if that's easier.",
    delivery: "If you can get it to the hospital by 10:30 that'd be great. Let me know if you can't.",
    closing: ['Cheers, thanks!'],
  },
  {
    opening: "Morning! Today's order for the hospital coffees:",
    pickup: "I'll be there at 10:25 to grab it. Let me know if you'd prefer to deliver.",
    delivery: "Would a delivery to the hospital at 10:30 be OK today? Let me know if not.",
    closing: ['Thanks!', 'Hope you have a good day'],
  },
];

// A random wording, never the same one as `previous` (an index), so two
// presses in a row read differently.
export function pickCoffeeTextVariant(previous = -1, random = Math.random) {
  const n = COFFEE_TEXT_VARIANTS.length;
  let i = Math.floor(random() * n);
  if (i === previous) i = (i + 1) % n;
  return i;
}

// The whole text: wording `variant`, the order lines, pick up or delivery.
export function coffeeTextMessage(variant, orderLines, handover) {
  const v = COFFEE_TEXT_VARIANTS[variant] || COFFEE_TEXT_VARIANTS[0];
  return [v.opening, '', ...orderLines, '', v[handover], '', ...v.closing].join('\n');
}

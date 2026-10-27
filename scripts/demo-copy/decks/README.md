# Feature decks

Screenshots of the demo (Wattle Creek Hospital / Demo District, all made-up
people) and the four recorded feature decks built from them:
`Rostar-for-staff`, `Rostar-for-officers`, `DR-Roster-for-doctors`,
`DR-Roster-for-officers` (.pptx, speaker notes are the spoken script).

## Refreshing after the apps change

The demo's dates age, so refresh the demo first.

1. In the Supabase SQL Editor (as postgres), run `../1b_demo_district_activity.sql`.
2. Here:
   ```
   npm install            # first time only
   npx playwright install chromium   # first time only
   npm run shots          # signs in as the demo logins, writes shots/*.png
   npm run sheets         # contact sheets (sheet1-3.jpg) to check the shots by eye
   npm run decks          # writes the four .pptx files here
   npm run fit            # flags text that may not fit its box
   ```
   `node shots.js d_day r_coffee` retakes only the named shots.

The demo logins come from `../.screenshot-logins` (never commit or share it).
`npm run shots` also offers two gaps and volunteers for one in the demo so the
Calendar and Variation screens have something to show; demo people have
notifications off, so nobody is emailed.

## Where things are

- `shots.js`: what to screenshot and how to get there in each app.
- `build.js`: slide layouts, slide content, and `SHOTS` (which screenshot goes on which slide).
- `variants.js`: the four decks (which slides each has) and the spoken notes.
- `apply_theme.js`: writes the colour theme into each deck.

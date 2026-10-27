// Contact sheets: shots/*.png tiled with their names, for checking.
const sharp = require('sharp'); const fs = require('fs');
(async () => {
  const names = fs.readdirSync('shots').filter(f => f.endsWith('.png')).sort();
  const groups = [names.filter(n => /^(r_|d_signin|d_cal|d_day|d_block)/.test(n)), names.filter(n => /^(d_p|d_my|d_find|d_list|d_across|do_)/.test(n)), names.filter(n => n.startsWith('o_'))];
  for (const [gi, g] of groups.entries()) {
    const laptop = g[0]?.startsWith('o_');
    const W = laptop ? 640 : 300, cols = laptop ? 2 : 6;
    const tiles = await Promise.all(g.map(async n => {
      const img = await sharp('shots/' + n).resize({ width: W }).toBuffer();
      const { height } = await sharp(img).metadata();
      const label = Buffer.from(`<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#111"/><text x="8" y="21" font-size="18" fill="#fff" font-family="sans-serif">${n}</text></svg>`);
      return sharp({ create: { width: W, height: height + 30, channels: 3, background: '#fff' } })
        .composite([{ input: label, top: 0, left: 0 }, { input: img, top: 30, left: 0 }]).png().toBuffer();
    }));
    const hs = await Promise.all(tiles.map(async t => (await sharp(t).metadata()).height));
    const rowH = Math.max(...hs), rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * (W + 10), height: rows * (rowH + 10), channels: 3, background: '#888' } })
      .composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * (W + 10), top: Math.floor(i / cols) * (rowH + 10) })))
      .jpeg({ quality: 80 }).toFile(`sheet${gi + 1}.jpg`);
    console.log(`sheet${gi + 1}.jpg`, g.join(' '));
  }
})();

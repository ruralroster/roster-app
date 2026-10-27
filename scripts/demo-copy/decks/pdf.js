// Prints HTML files to A4 PDFs: node pdf.js out-dir file.html ...
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const [outDir, ...files] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const file of files) {
    await page.goto(`file://${path.resolve(file)}`);
    const out = path.join(outDir, `${path.basename(file, '.html')}.pdf`);
    await page.pdf({ path: out, format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' }, printBackground: true });
    console.log('wrote', out);
  }
  await browser.close();
})();

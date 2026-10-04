/* eslint-disable */
/**
 * Generates the Elite Education brand image assets from the approved white logo.
 *
 *   node scripts/brand-assets.cjs            # regenerate everything
 *   node scripts/brand-assets.cjs --logos    # only logo-black.png
 *
 * Source: assets/images/logo-white.png (400x400, transparent, white artwork).
 * If an official logo-noir.png is supplied, place it at assets/images/logo-noir.png
 * and it will be copied to logo-black.png instead of recolouring the white artwork.
 *
 * Requires Playwright and Chromium (paths below match the development container;
 * override with PLAYWRIGHT_MODULE and CHROMIUM_PATH).
 */
const fs = require('fs');
const path = require('path');

const playwright = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const NOIR = '#0A0A0A';
const IMAGES = path.join(__dirname, '..', 'assets', 'images');
const WHITE = path.join(IMAGES, 'logo-white.png');
const NOIR_OFFICIAL = path.join(IMAGES, 'logo-noir.png');

// Each job: output file, canvas size, background (null = transparent), logo colour, and how to place it:
//   fit 'canvas' - the 400x400 source drawn at `scale` of the canvas (keeps the source's own clear space);
//   fit 'art'    - the visible artwork (alpha bounding box) scaled to `scale` of the canvas width;
//   fit 'mark'   - only the EE monogram (the artwork above the wordmark), for tiny sizes.
const JOBS = [
  { out: 'logo-black.png', size: 400, bg: null, color: NOIR, fit: 'canvas', scale: 1, logosOnly: true },
  { out: 'icon.png', size: 1024, bg: NOIR, color: '#FFFFFF', fit: 'art', scale: 0.68 },
  { out: 'splash-icon.png', size: 512, bg: null, color: '#FFFFFF', fit: 'art', scale: 0.92 },
  // Adaptive icon foreground and monochrome: artwork inside the central 66% safe zone.
  { out: 'android-icon-foreground.png', size: 512, bg: null, color: '#FFFFFF', fit: 'art', scale: 0.6 },
  { out: 'android-icon-background.png', size: 512, bg: NOIR, color: null, fit: 'art', scale: 0 },
  { out: 'android-icon-monochrome.png', size: 512, bg: null, color: NOIR, fit: 'art', scale: 0.6 },
  // Favicon: the monogram alone, so it stays legible at 16-32px.
  { out: 'favicon.png', size: 96, bg: NOIR, color: '#FFFFFF', fit: 'mark', scale: 0.62 },
];

async function main() {
  const logosOnly = process.argv.includes('--logos');
  const src = 'data:image/png;base64,' + fs.readFileSync(WHITE).toString('base64');
  const browser = await playwright.chromium.launch({ executablePath });
  const page = await browser.newPage();
  await page.setContent('<html><body></body></html>');
  for (const job of JOBS) {
    if (logosOnly && !job.logosOnly) continue;
    if (job.out === 'logo-black.png' && fs.existsSync(NOIR_OFFICIAL)) {
      fs.copyFileSync(NOIR_OFFICIAL, path.join(IMAGES, job.out));
      console.log('copied official logo-noir.png -> logo-black.png');
      continue;
    }
    const dataUrl = await page.evaluate(async ({ src, job }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const { size } = job;
      // Recolour the artwork on its own canvas (source-in keeps the alpha mask).
      const art = document.createElement('canvas');
      art.width = img.naturalWidth;
      art.height = img.naturalHeight;
      const actx = art.getContext('2d');
      actx.drawImage(img, 0, 0);
      if (job.color) {
        actx.globalCompositeOperation = 'source-in';
        actx.fillStyle = job.color;
        actx.fillRect(0, 0, art.width, art.height);
      }
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (job.bg) {
        ctx.fillStyle = job.bg;
        ctx.fillRect(0, 0, size, size);
      }
      if (job.color && job.scale > 0) {
        if (job.fit === 'canvas') {
          const w = size * job.scale;
          ctx.drawImage(art, (size - w) / 2, (size - w) / 2, w, w);
        } else {
          // Alpha bounding box of the artwork, and the rows it occupies.
          const { data, width: W, height: H } = actx.getImageData(0, 0, art.width, art.height);
          const rowHas = (y, x0 = 0, x1 = W) => {
            for (let x = x0; x < x1; x++) if (data[(y * W + x) * 4 + 3] > 16) return true;
            return false;
          };
          let top = 0;
          while (top < H && !rowHas(top)) top++;
          let bottom = H - 1;
          while (bottom > top && !rowHas(bottom)) bottom--;
          if (job.fit === 'mark') {
            // The monogram ends at the first fully empty row below the top.
            let y = top;
            while (y <= bottom && rowHas(y)) y++;
            bottom = y - 1;
          }
          let left = W;
          let right = 0;
          for (let y = top; y <= bottom; y++)
            for (let x = 0; x < W; x++)
              if (data[(y * W + x) * 4 + 3] > 16) {
                if (x < left) left = x;
                if (x > right) right = x;
              }
          const bw = right - left + 1;
          const bh = bottom - top + 1;
          const k = Math.min((size * job.scale) / bw, (size * job.scale) / bh);
          const w = bw * k;
          const h = bh * k;
          ctx.drawImage(art, left, top, bw, bh, (size - w) / 2, (size - h) / 2, w, h);
        }
      }
      return c.toDataURL('image/png');
    }, { src, job });
    fs.writeFileSync(path.join(IMAGES, job.out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', job.out, job.size + 'x' + job.size);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

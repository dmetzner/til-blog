// Generates the default Open Graph card (public/og.png, 1200×630) from an SVG.
// Run manually when the branding/tagline changes: `node scripts/gen-og.mjs`.
import sharp from "sharp";

const svg = `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="til" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2ee6e6"/><stop offset="1" stop-color="#b06bff"/>
    </linearGradient>
    <radialGradient id="g1" cx="12%" cy="6%" r="55%">
      <stop offset="0" stop-color="#2ee6e6" stop-opacity="0.20"/><stop offset="0.6" stop-color="#2ee6e6" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="g2" cx="92%" cy="96%" r="60%">
      <stop offset="0" stop-color="#b06bff" stop-opacity="0.20"/><stop offset="0.6" stop-color="#b06bff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="#070708"/>
  <rect width="1200" height="630" fill="url(#g1)"/>
  <rect width="1200" height="630" fill="url(#g2)"/>
  <text x="90" y="112" font-family="monospace" font-size="30" font-weight="700"><tspan fill="url(#til)">til</tspan><tspan fill="#e7e7ea"> · daniel metzner</tspan></text>
  <text x="84" y="305" font-family="sans-serif" font-size="124" font-weight="800" fill="#e7e7ea" letter-spacing="-3">Today I</text>
  <text x="84" y="430" font-family="sans-serif" font-size="124" font-weight="800" fill="#e7e7ea" letter-spacing="-3">Learned</text>
  <text x="90" y="516" font-family="sans-serif" font-size="33" fill="#c2c2cb">The small stuff that quietly makes you a better dev —</text>
  <text x="90" y="560" font-family="sans-serif" font-size="33" fill="#c2c2cb">one note at a time.</text>
  <text x="90" y="602" font-family="monospace" font-size="26" font-weight="500" fill="#2ee6e6">til.metzner.uk</text>
</svg>`;

await sharp(Buffer.from(svg)).png().toFile("public/og.png");
console.log("wrote public/og.png");

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Encode raw RGBA buffer into a valid PNG file
function createPng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None)
  const rowLength = width * 4;
  const scanlines = Buffer.alloc((rowLength + 1) * height);
  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (rowLength + 1);
    scanlines[scanlineOffset] = 0; // filter byte
    rgbaBuffer.copy(scanlines, scanlineOffset + 1, y * rowLength, (y + 1) * rowLength);
  }

  const compressedData = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = Buffer.alloc(4 + 4 + length + 4);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const crc = zlib.crc32(chunk.subarray(4, 8 + length));
  chunk.writeUInt32BE(crc, 8 + length);
  return chunk;
}

// Generate the SmartTank icon raster
function renderSmartTankIcon(size, isMaskable = false) {
  const buffer = Buffer.alloc(size * size * 4);

  // Center coordinate and radius
  const cx = size / 2;
  const cy = size / 2;

  // For maskable icons, we keep the logo inside the 80% safe zone (margin ~15%)
  const scale = isMaskable ? 0.72 : 0.88;
  const cornerRadius = isMaskable ? 0 : size * 0.22; // maskable has full-bleed background

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Distance from corners for rounded rectangle
      let inCard = true;
      if (!isMaskable) {
        let dx = 0;
        let dy = 0;
        if (x < cornerRadius) dx = cornerRadius - x;
        else if (x > size - cornerRadius) dx = x - (size - cornerRadius);
        if (y < cornerRadius) dy = cornerRadius - y;
        else if (y > size - cornerRadius) dy = y - (size - cornerRadius);

        if (dx > 0 && dy > 0 && Math.sqrt(dx * dx + dy * dy) > cornerRadius) {
          inCard = false;
        }
      }

      if (!inCard) {
        // Transparent
        buffer[idx] = 0;
        buffer[idx + 1] = 0;
        buffer[idx + 2] = 0;
        buffer[idx + 3] = 0;
        continue;
      }

      // Normalized coordinates (-1 to +1 relative to center, scaled)
      const nx = (x - cx) / (cx * scale);
      const ny = (y - cy) / (cy * scale);

      // Background Gradient (Deep navy #0f172a to sapphire #0284c7)
      const gradT = (x + y) / (size * 2);
      let r = Math.round(15 + gradT * (2 - 15));
      let g = Math.round(23 + gradT * (132 - 23));
      let b = Math.round(42 + gradT * (199 - 42));
      let a = 255;

      // Outer chamber subtle border if not maskable
      if (!isMaskable && (x === 0 || x === size - 1 || y === 0 || y === size - 1)) {
        r = 56; g = 189; b = 248; a = 80;
      }

      // Check if point is inside the water droplet shape
      // Droplet formula: tip at (0, -0.65), bulb centered at (0, 0.15) with radius 0.45
      const bulbCy = 0.15;
      const bulbRadius = 0.44;
      const distFromBulb = Math.sqrt(nx * nx + (ny - bulbCy) * (ny - bulbCy));

      // Triangular/tapered top from bulb to tip at (0, -0.68)
      const tipY = -0.68;
      const isTopCone = ny >= tipY && ny <= bulbCy && Math.abs(nx) <= (ny - tipY) * 0.58;
      const isInsideDroplet = distFromBulb <= bulbRadius || isTopCone;

      if (isInsideDroplet) {
        // Droplet Gradient: Cyan (#38bdf8) at top to Deep Ocean Blue (#0369a1) at bottom
        const dropT = Math.max(0, Math.min(1, (ny - tipY) / (bulbCy + bulbRadius - tipY)));
        r = Math.round(56 + dropT * (3 - 56));
        g = Math.round(189 + dropT * (105 - 189));
        b = Math.round(248 + dropT * (161 - 248));

        // Droplet Gloss highlight on left side
        if (nx < -0.06 && nx > -0.32 && ny > -0.35 && ny < 0.28) {
          const glossFactor = 0.35;
          r = Math.min(255, Math.round(r + 255 * glossFactor));
          g = Math.min(255, Math.round(g + 255 * glossFactor));
          b = Math.min(255, Math.round(b + 255 * glossFactor));
        }

        // Ripple line inside droplet
        const waveY = 0.18 + Math.sin(nx * 10) * 0.035;
        if (Math.abs(ny - waveY) < 0.02) {
          r = 224; g = 242; b = 254; // #e0f2fe
        }

        // Sediment layer at bottom of droplet (amber/red)
        if (ny > 0.38) {
          const sedT = (ny - 0.38) / (bulbCy + bulbRadius - 0.38);
          r = Math.round(245 + sedT * (239 - 245));
          g = Math.round(158 + sedT * (68 - 158));
          b = Math.round(11 + sedT * (68 - 11));
        }

        // Sensor safe limit guideline (yellow dashed marker)
        if (Math.abs(ny - 0.32) < 0.015 && Math.abs(Math.sin(nx * 30)) > 0.3) {
          r = 251; g = 191; b = 36; // #fbbf24
        }
      }

      // Telemetry pulse rings above droplet tip
      const ring1Dist = Math.abs(Math.sqrt(nx * nx + (ny - (tipY - 0.12)) * (ny - (tipY - 0.12))) - 0.12);
      if (ring1Dist < 0.018 && ny < tipY - 0.08) {
        r = 56; g = 189; b = 248;
      }
      const ring2Dist = Math.abs(Math.sqrt(nx * nx + (ny - (tipY - 0.12)) * (ny - (tipY - 0.12))) - 0.22);
      if (ring2Dist < 0.018 && ny < tipY - 0.12) {
        r = 56; g = 189; b = 248;
      }

      // Tank stand baseline
      if (ny > 0.72 && ny < 0.80 && Math.abs(nx) < 0.36) {
        r = 100; g = 116; b = 139; // slate-500
      }

      buffer[idx] = r;
      buffer[idx + 1] = g;
      buffer[idx + 2] = b;
      buffer[idx + 3] = a;
    }
  }

  return createPng(size, size, buffer);
}

// Write the required PWA icon suite
const cwd = process.cwd();

// 1. pwa-192x192.png (Standard 192px)
console.log('Generating pwa-192x192.png...');
fs.writeFileSync(path.join(cwd, 'pwa-192x192.png'), renderSmartTankIcon(192, false));

// 2. pwa-512x512.png (Standard 512px)
console.log('Generating pwa-512x512.png...');
fs.writeFileSync(path.join(cwd, 'pwa-512x512.png'), renderSmartTankIcon(512, false));

// 3. pwa-maskable-512x512.png (Maskable with 15% safe padding)
console.log('Generating pwa-maskable-512x512.png...');
fs.writeFileSync(path.join(cwd, 'pwa-maskable-512x512.png'), renderSmartTankIcon(512, true));

// 4. apple-touch-icon.png (180x180 PNG for iOS Safari)
console.log('Generating apple-touch-icon.png...');
fs.writeFileSync(path.join(cwd, 'apple-touch-icon.png'), renderSmartTankIcon(180, false));

// 5. favicon.ico (32x32 PNG wrapped as icon)
console.log('Generating favicon.ico...');
fs.writeFileSync(path.join(cwd, 'favicon.ico'), renderSmartTankIcon(32, false));

console.log('✅ All PWA Icons generated successfully!');

import sharp from 'sharp';
import { encode as encodeIco } from 'sharp-ico';
import archiver from 'archiver';
import { PassThrough } from 'stream';

// ─── Preset Definitions ────────────────────────────────────────────

export const ICON_PRESETS = {
  appIcon: {
    label: 'App Icon',
    sizes: [1024, 512, 256, 128, 64, 32, 16],
    nameTemplate: (size) => `app-icon-${size}.png`,
    labelTemplate: (size) => `App Icon ${size}x${size}`,
  },
  menuBar: {
    label: 'Menu Bar Icon',
    sizes: [
      { size: 16, suffix: '' },
      { size: 32, suffix: '@2x' },
    ],
    nameTemplate: (entry) => `menubar-${entry.size}${entry.suffix}.png`,
    labelTemplate: (entry) => `Menu Bar ${entry.size}x${entry.size}${entry.suffix}`,
  },
  favicon: {
    label: 'Favicon / Web Icons',
    pngSizes: [16, 32, 48, 180, 192, 512],
    icoSizes: [16, 32, 48],
    nameMap: {
      16: 'favicon-16x16.png',
      32: 'favicon-32x32.png',
      48: 'favicon-48x48.png',
      180: 'apple-touch-icon.png',
      192: 'icon-192x192.png',
      512: 'icon-512x512.png',
    },
    labelMap: {
      16: 'Favicon 16x16',
      32: 'Favicon 32x32',
      48: 'Favicon 48x48',
      180: 'Apple Touch Icon 180x180',
      192: 'PWA Icon 192x192',
      512: 'PWA Icon 512x512',
    },
  },
};

// ─── Prompt Enhancement ─────────────────────────────────────────────

const ICON_PROMPT_COMMON =
  'single object filling most of the canvas, clean minimal design, no text, no background clutter, vector-like sharp edges, square image with sharp square corners, no rounded corners';

const PRESET_PROMPT_HINTS = {
  appIcon:
    'modern app icon style, large symbol filling 80 percent of the frame, glossy subtle gradient, solid color background, perfectly square edges, no border, no rounded corners',
  menuBar:
    'simple monochrome symbol, large and bold filling the frame, minimal line art, template icon style, black on transparent background, square edges',
  favicon:
    'large bold symbol filling the frame, works at very small sizes, high contrast, bold shapes, square edges, no border, no rounded corners',
};

export function enhanceIconPrompt(prompt, preset) {
  const hint = PRESET_PROMPT_HINTS[preset] || PRESET_PROMPT_HINTS.appIcon;
  return `${prompt}, ${ICON_PROMPT_COMMON}, ${hint}`;
}

// ─── Color Helper ───────────────────────────────────────────────────

export function parseColor(hex) {
  if (!hex || hex === 'transparent') return { r: 0, g: 0, b: 0, alpha: 0 };
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b, alpha: 1 };
}

// ─── Sharp Pipelines ────────────────────────────────────────────────

/**
 * Auto-trim: remove uniform background, detect bg color, return trimmed buffer + bg color
 */
async function autoTrim(sourceBuffer) {
  // Sample the top-left pixel as background color
  const { data, info } = await sharp(sourceBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bgR = data[0], bgG = data[1], bgB = data[2];

  // Trim excess background
  const trimmed = await sharp(sourceBuffer)
    .trim({ threshold: 30 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: trimmed.data,
    width: trimmed.info.width,
    height: trimmed.info.height,
    bg: { r: bgR, g: bgG, b: bgB, alpha: 1 },
  };
}

/**
 * App Icon: auto-trim → resize content to fill → SVG rounded mask → PNG
 */
async function processAppIcon(sourceBuffer, targetSize, options = {}) {
  const cornerRadius = options.cornerRadius ?? 0.22;
  const contentFill = options.contentFill ?? 0.85; // content fills 85% of icon area

  // Auto-trim to find content bounds and bg color
  const trimResult = await autoTrim(sourceBuffer);
  const bg = trimResult.bg;

  // Content area = percentage of target size
  const contentSize = Math.round(targetSize * contentFill);
  const marginPx = Math.round((targetSize - contentSize) / 2);

  // Resize trimmed content to fill the content area
  let buf = await sharp(trimResult.buffer)
    .ensureAlpha()
    .resize(contentSize, contentSize, { fit: 'contain', position: 'center', background: bg })
    .toBuffer();

  // Extend to full target size with bg color
  buf = await sharp(buf)
    .extend({
      top: marginPx,
      bottom: targetSize - contentSize - marginPx,
      left: marginPx,
      right: targetSize - contentSize - marginPx,
      background: bg,
    })
    .toBuffer();

  // Apply rounded-corner mask via SVG composite
  const rx = Math.round(targetSize * cornerRadius);
  const maskSvg = Buffer.from(
    `<svg width="${targetSize}" height="${targetSize}">
      <rect x="0" y="0" width="${targetSize}" height="${targetSize}" rx="${rx}" ry="${rx}" fill="white"/>
    </svg>`
  );

  buf = await sharp(buf)
    .ensureAlpha()
    .composite([{ input: maskSvg, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return buf;
}

/**
 * Menu Bar Icon: resize → greyscale → padding → PNG
 */
async function processMenuBarIcon(sourceBuffer, targetSize, options = {}) {
  const padding = options.padding ?? 0;
  const bg = { r: 0, g: 0, b: 0, alpha: 0 };

  const paddingPx = Math.round(targetSize * padding);
  const innerSize = targetSize - paddingPx * 2;

  let buf = await sharp(sourceBuffer)
    .ensureAlpha()
    .resize(innerSize, innerSize, { fit: 'cover', position: 'center' })
    .greyscale()
    .toBuffer();

  buf = await sharp(buf)
    .extend({
      top: paddingPx,
      bottom: paddingPx,
      left: paddingPx,
      right: paddingPx,
      background: bg,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return buf;
}

/**
 * Web Icon: resize → padding → PNG
 */
async function processWebIcon(sourceBuffer, targetSize, options = {}) {
  const padding = options.padding ?? 0;
  const bg = parseColor(options.background);

  const paddingPx = Math.round(targetSize * padding);
  const innerSize = targetSize - paddingPx * 2;

  let buf = await sharp(sourceBuffer)
    .ensureAlpha()
    .resize(innerSize, innerSize, { fit: 'cover', position: 'center' })
    .toBuffer();

  buf = await sharp(buf)
    .extend({
      top: paddingPx,
      bottom: paddingPx,
      left: paddingPx,
      right: paddingPx,
      background: bg,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();

  return buf;
}

// ─── Orchestrator ───────────────────────────────────────────────────

export async function generateIconSet(imageBuffer, preset, options = {}) {
  const icons = [];

  if (preset === 'appIcon' || preset === 'all') {
    const def = ICON_PRESETS.appIcon;
    const results = await Promise.all(
      def.sizes.map(async (size) => {
        const buf = await processAppIcon(imageBuffer, size, options);
        return {
          name: def.nameTemplate(size),
          label: def.labelTemplate(size),
          width: size,
          height: size,
          format: 'png',
          buffer: buf,
        };
      })
    );
    icons.push(...results);
  }

  if (preset === 'menuBar' || preset === 'all') {
    const def = ICON_PRESETS.menuBar;
    const results = await Promise.all(
      def.sizes.map(async (entry) => {
        const buf = await processMenuBarIcon(imageBuffer, entry.size, options);
        return {
          name: def.nameTemplate(entry),
          label: def.labelTemplate(entry),
          width: entry.size,
          height: entry.size,
          format: 'png',
          buffer: buf,
        };
      })
    );
    icons.push(...results);
  }

  if (preset === 'favicon' || preset === 'all') {
    const def = ICON_PRESETS.favicon;

    // PNG variants
    const pngResults = await Promise.all(
      def.pngSizes.map(async (size) => {
        const buf = await processWebIcon(imageBuffer, size, options);
        return {
          name: def.nameMap[size],
          label: def.labelMap[size],
          width: size,
          height: size,
          format: 'png',
          buffer: buf,
        };
      })
    );
    icons.push(...pngResults);

    // ICO file (16, 32, 48)
    const icoBuffers = await Promise.all(
      def.icoSizes.map((size) => processWebIcon(imageBuffer, size, options))
    );
    const icoBuffer = await encodeIco(icoBuffers);
    icons.push({
      name: 'favicon.ico',
      label: 'Favicon ICO (16+32+48)',
      width: 48,
      height: 48,
      format: 'ico',
      buffer: Buffer.from(icoBuffer),
    });
  }

  return icons;
}

// ─── ZIP Packaging ──────────────────────────────────────────────────

export async function createIconZip(icons, preset) {
  return new Promise((resolve, reject) => {
    const passthrough = new PassThrough();
    const chunks = [];

    passthrough.on('data', (chunk) => chunks.push(chunk));
    passthrough.on('end', () => resolve(Buffer.concat(chunks)));
    passthrough.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(passthrough);

    // Group into folders by type
    for (const icon of icons) {
      let folder = '';
      if (icon.name.startsWith('app-icon')) folder = 'appIcon/';
      else if (icon.name.startsWith('menubar')) folder = 'menuBar/';
      else folder = 'favicon/';

      // For single preset, no subfolder needed
      if (preset !== 'all') folder = '';

      archive.append(icon.buffer, { name: `${folder}${icon.name}` });
    }

    archive.finalize();
  });
}

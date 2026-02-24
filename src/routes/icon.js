import { Router } from 'express';
import { generateImage } from '../services/image.js';
import {
  enhanceIconPrompt,
  generateIconSet,
  createIconZip,
  ICON_PRESETS,
} from '../services/icon.js';

const router = Router();

const VALID_PRESETS = ['appIcon', 'menuBar', 'favicon', 'all'];

router.post('/', async (req, res, next) => {
  try {
    const {
      prompt,
      preset,
      size = '1024x1024',
      steps = 4,
      guidance = 7.5,
      enhancePrompt: doEnhance = true,
      background = 'transparent',
      cornerRadius = 0.22,
      padding = 0,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required and must be a non-empty string',
      });
    }

    if (!preset || !VALID_PRESETS.includes(preset)) {
      return res.status(400).json({
        success: false,
        error: `preset is required and must be one of: ${VALID_PRESETS.join(', ')}`,
      });
    }

    // ── Generate AI image ───────────────────────────────────────

    // Use icon-specific prompt enhancement
    const finalPrompt = doEnhance
      ? enhanceIconPrompt(prompt, preset === 'all' ? 'appIcon' : preset)
      : prompt;

    const genResult = await generateImage(finalPrompt, {
      size,
      steps,
      guidance,
      enhancePrompt: false, // already enhanced above
    });

    // ── Process icon set ────────────────────────────────────────

    const icons = await generateIconSet(genResult.imageBuffer, preset, {
      background,
      cornerRadius,
      padding,
    });

    // ── Response ────────────────────────────────────────────────

    const format = req.query.format || 'base64';

    if (format === 'zip') {
      const zipBuffer = await createIconZip(icons, preset);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="icons-${preset}.zip"`);
      return res.send(zipBuffer);
    }

    // Default: base64 JSON
    const data = {
      prompt,
      enhancedPrompt: finalPrompt,
      preset,
      icons: icons.map(({ buffer, ...meta }) => ({
        ...meta,
        image: buffer.toString('base64'),
      })),
    };

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

export default router;

import { Router } from 'express';
import { generateBananaImage } from '../services/banana.js';
import { processImage } from '../services/image.js';
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
      quality = 85,
      outputFormat,
      resize = null,
    } = req.body;

    // Validate required field
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({
        success: false,
        error: 'prompt is required and must be a non-empty string',
      });
    }

    // Validate outputFormat (if specified)
    const validFormats = ['png', 'jpg', 'jpeg', 'webp'];
    if (outputFormat && !validFormats.includes(outputFormat.toLowerCase())) {
      return res.status(400).json({
        success: false,
        error: `outputFormat must be one of: ${validFormats.join(', ')}`,
      });
    }

    // Generate image via Gemini
    const genResult = await generateBananaImage(prompt);

    // Process image (format conversion, resize)
    const processed = await processImage(genResult.imageBuffer, {
      outputFormat,
      quality,
      resize,
    });

    // Determine response format
    const format = req.query.format || 'base64';

    if (format === 'binary') {
      res.set('Content-Type', processed.mimeType);
      res.set('Content-Disposition', `inline; filename="banana.${processed.format}"`);
      return res.send(processed.buffer);
    }

    // Default: base64 JSON response
    res.json({
      success: true,
      data: {
        image: processed.buffer.toString('base64'),
        format: processed.format,
        prompt,
        text: genResult.text || null,
        originalSize: processed.originalSize,
        optimizedSize: processed.optimizedSize,
        savings: processed.savings,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── Icon Generation via Gemini ─────────────────────────────────────

router.post('/generate/icon', async (req, res, next) => {
  try {
    const {
      prompt,
      preset,
      enhancePrompt: doEnhance = true,
      background = 'transparent',
      cornerRadius = 0.22,
      padding = 0,
      contentFill = 0.85,
    } = req.body;

    // Validate
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

    const iconOptions = { background, cornerRadius, padding, contentFill };
    let icons = [];
    const enhancedPrompts = {};

    if (preset === 'all') {
      const colorPrompt = doEnhance ? enhanceIconPrompt(prompt, 'appIcon') : prompt;
      const monoPrompt = doEnhance ? enhanceIconPrompt(prompt, 'menuBar') : prompt;
      enhancedPrompts.color = colorPrompt;
      enhancedPrompts.menuBar = monoPrompt;

      const [colorResult, monoResult] = await Promise.all([
        generateBananaImage(colorPrompt),
        generateBananaImage(monoPrompt),
      ]);

      const [appIcons, menuIcons, favIcons] = await Promise.all([
        generateIconSet(colorResult.imageBuffer, 'appIcon', iconOptions),
        generateIconSet(monoResult.imageBuffer, 'menuBar', iconOptions),
        generateIconSet(colorResult.imageBuffer, 'favicon', iconOptions),
      ]);
      icons = [...appIcons, ...menuIcons, ...favIcons];
    } else {
      const finalPrompt = doEnhance ? enhanceIconPrompt(prompt, preset) : prompt;
      enhancedPrompts[preset] = finalPrompt;

      const genResult = await generateBananaImage(finalPrompt);
      icons = await generateIconSet(genResult.imageBuffer, preset, iconOptions);
    }

    // Response
    const format = req.query.format || 'base64';

    if (format === 'zip') {
      const zipBuffer = await createIconZip(icons, preset);
      res.set('Content-Type', 'application/zip');
      res.set('Content-Disposition', `attachment; filename="icons-${preset}.zip"`);
      return res.send(zipBuffer);
    }

    res.json({
      success: true,
      data: {
        prompt,
        enhancedPrompts,
        preset,
        icons: icons.map(({ buffer, ...meta }) => ({
          ...meta,
          image: buffer.toString('base64'),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

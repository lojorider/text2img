import { Router } from 'express';
import { generateBananaImage } from '../services/banana.js';
import { processImage } from '../services/image.js';

const router = Router();

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

export default router;

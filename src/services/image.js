import fetch from 'node-fetch';
import sharp from 'sharp';

// Enhance prompts for restaurant/POS context
export function enhancePrompt(prompt, options = {}) {
  let enhanced = prompt;

  // Add quality modifiers
  enhanced += ', high quality, professional composition';

  // Add style context based on style hint
  const style = (options.style || '').toLowerCase();

  if (style === 'hero') {
    enhanced += ', professional stock photography style, natural lighting, vibrant colors';
  } else if (style === 'icon' || style === 'category') {
    enhanced += ', clean minimalist design, modern flat style, suitable for icons';
  } else if (style === 'food' || style === 'menu') {
    enhanced += ', appetizing food photography, professional restaurant menu style';
  } else if (style === 'pos' || style === 'tablet') {
    enhanced += ', modern technology, clean interface, professional business setting';
  } else if (style === 'staff' || style === 'waiter') {
    enhanced += ', professional restaurant service, friendly atmosphere';
  } else if (style === 'interior' || style === 'dining') {
    enhanced += ', modern restaurant interior design, welcoming ambiance';
  }

  // Add Thai/restaurant context if relevant
  if (prompt.toLowerCase().includes('thai') || prompt.toLowerCase().includes('restaurant')) {
    enhanced += ', Thai restaurant context, culturally appropriate, professional hospitality industry';
  }

  return enhanced;
}

// Generate image using Cloudflare Workers AI
export async function generateImage(prompt, options = {}) {
  const { CF_ACCOUNT_ID, CF_AI_TOKEN } = process.env;

  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) {
    throw new Error('Missing Cloudflare configuration: CF_ACCOUNT_ID and CF_AI_TOKEN required');
  }

  const enhancedPrompt = options.enhancePrompt !== false
    ? enhancePrompt(prompt, options)
    : prompt;

  // Parse size
  let width = 1024, height = 1024;
  if (options.size) {
    const [w, h] = options.size.split('x').map(Number);
    width = w || 1024;
    height = h || width;
  }

  const requestBody = {
    prompt: enhancedPrompt,
    num_steps: parseInt(options.steps) || 4,
    guidance_scale: parseFloat(options.guidance) || 7.5,
    width,
    height,
  };

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_AI_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!response.ok) {
    let cfErrors;
    try {
      const errorJson = await response.json();
      cfErrors = errorJson.errors;
    } catch {
      const errorText = await response.text();
      cfErrors = [{ message: errorText, code: response.status }];
    }
    const err = new Error(parseCfErrorMessage(cfErrors));
    err.statusCode = response.status;
    err.code = cfErrors?.[0]?.code || response.status;
    throw err;
  }

  const responseJson = await response.json();

  if (!responseJson.success || !responseJson.result || !responseJson.result.image) {
    const err = new Error(parseCfErrorMessage(responseJson.errors) || 'Unknown API error');
    err.statusCode = 502;
    throw err;
  }

  const imageBuffer = Buffer.from(responseJson.result.image, 'base64');

  return { imageBuffer, enhancedPrompt, width, height };
}

// Process image: format conversion, optimization, resize — returns buffer(s)
export async function processImage(imageBuffer, options = {}) {
  const format = (options.outputFormat || 'png').toLowerCase();
  const quality = parseInt(options.quality) || 85;

  let processor = sharp(imageBuffer);

  // Resize if requested
  if (options.resize) {
    const [w, h] = options.resize.split('x').map(Number);
    processor = processor.resize(w, h || w, { fit: 'cover', position: 'center' });
  }

  const originalSize = imageBuffer.length;

  // Apply format conversion (with extra optimization when optimize flag is set)
  const opt = options.optimize;
  switch (format) {
    case 'webp':
      processor = processor.webp(opt
        ? { quality, effort: 6, smartSubsample: true }
        : { quality });
      break;
    case 'jpg':
    case 'jpeg':
      processor = processor.jpeg(opt
        ? { quality, progressive: true, mozjpeg: true }
        : { quality, progressive: true });
      break;
    case 'png':
    default:
      processor = processor.png(opt ? { compressionLevel: 9, palette: true } : {});
      break;
  }

  const outputBuffer = await processor.toBuffer();
  const optimizedSize = outputBuffer.length;
  const savings = originalSize > 0
    ? ((1 - optimizedSize / originalSize) * 100).toFixed(1)
    : '0.0';

  const result = {
    buffer: outputBuffer,
    format,
    mimeType: getMimeType(format),
    originalSize,
    optimizedSize,
    savings: `${savings}%`,
  };

  // Generate responsive variants if requested
  if (options.responsive) {
    const sizes = options.responsiveSizes || [480, 768, 1024, 1920];
    result.variants = await generateResponsiveVariants(imageBuffer, sizes, format, quality);
  }

  return result;
}

// Generate responsive variants as buffer array
async function generateResponsiveVariants(imageBuffer, sizes, format, quality) {
  const variants = [];

  for (const size of sizes) {
    let processor = sharp(imageBuffer).resize(size, null, {
      fit: 'inside',
      withoutEnlargement: true,
    });

    switch (format) {
      case 'webp':
        processor = processor.webp({ quality });
        break;
      case 'jpg':
      case 'jpeg':
        processor = processor.jpeg({ quality, progressive: true });
        break;
      case 'png':
      default:
        processor = processor.png({});
        break;
    }

    const buffer = await processor.toBuffer();
    variants.push({ width: size, buffer });
  }

  return variants;
}

function parseCfErrorMessage(errors) {
  if (!errors || !errors.length) return 'Unknown Cloudflare error';
  const msg = errors[0].message || '';
  // Extract clean message from nested "AiError: AiError: ..." pattern
  const match = msg.match(/(?:AiError:\s*)*(.+?)(?:\s*\([0-9a-f-]+\))?$/);
  return match ? match[1].trim() : msg;
}

function getMimeType(format) {
  const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  return map[format] || 'image/png';
}

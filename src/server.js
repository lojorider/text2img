import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import express from 'express';
import cors from 'cors';
import generateRouter from './routes/generate.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env from project root
dotenv.config({ path: path.join(__dirname, '../.env.local') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3210;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'text2img' });
});

app.use('/api/generate', generateRouter);

// Error handling
app.use((err, _req, res, _next) => {
  console.error('[error]', err.message);
  const status = err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: err.message,
    ...(err.code && { code: err.code }),
  });
});

app.listen(PORT, () => {
  console.log(`text2img server running on http://localhost:${PORT}`);
});

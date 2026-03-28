import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { unlink } from 'fs/promises';
import {
  downloadVideo,
  getVideoTitle,
  analyzeVideoFile,
  cleanupTempFile,
  extractScreenshots,
  sweepOrphanedScreenshots,
  createReadStream,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3600');
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://video-mcp-production-2dc2.up.railway.app').replace(/\/$/, '');

// Registry: screenshot id -> { path, expires }
const screenshotRegistry = new Map<string, { path: string; expires: number }>();

const SCREENSHOT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function registerScreenshot(id: string, path: string): void {
  screenshotRegistry.set(id, { path, expires: Date.now() + SCREENSHOT_TTL_MS });
}

function purgeExpiredScreenshots(): void {
  const now = Date.now();
  for (const [id, entry] of screenshotRegistry) {
    if (now > entry.expires) {
      unlink(entry.path).catch(() => {});
      screenshotRegistry.delete(id);
    }
  }
}

sweepOrphanedScreenshots();

function createMcpServer(geminiApiKey: string): McpServer {
  const server = new McpServer({ name: 'video-mcp', version: '1.0.0' });

  server.tool(
    'analyze_video',
    'Download any public video (Loom, YouTube, Vimeo, etc.) and analyze it with Gemini AI. Returns a comprehensive report covering visual content, audio narration, sequence of actions, key technical details, and engineering action items, plus hosted screenshot URLs for key frames. Best for screen recordings, bug reports, and feature demos. Takes 1-3 minutes depending on video length.',
    {
      url: z.string().url().describe('Public video URL — Loom share link, YouTube, Vimeo, or any yt-dlp-supported URL'),
      prompt: z.string().optional().describe('Custom analysis prompt. Leave empty for the default comprehensive technical analysis.'),
      screenshots: z.boolean().optional().default(true).describe('Extract and return hosted screenshot URLs for evenly-spaced key frames (default: true). URLs are valid for 2 hours.'),
      screenshot_count: z.number().int().min(1).max(20).optional().default(8).describe('Number of screenshots to extract (default: 8, max: 20).'),
    },
    async ({ url, prompt, screenshots, screenshot_count }) => {
      purgeExpiredScreenshots();

      const title = await getVideoTitle(url).catch(() => url);
      const videoPath = await downloadVideo(url);

      let screenshotUrls: Array<{ timestamp_seconds: number; url: string }> = [];

      if (screenshots !== false) {
        const frames = await extractScreenshots(videoPath, screenshot_count ?? 8).catch(() => []);
        for (const frame of frames) {
          registerScreenshot(frame.id, frame.path);
          screenshotUrls.push({
            timestamp_seconds: frame.timestampSeconds,
            url: `${PUBLIC_URL}/screenshots/${frame.id}`,
          });
        }
      }

      const analysis = await analyzeVideoFile(geminiApiKey, videoPath, prompt).finally(() => {
        cleanupTempFile(videoPath);
      });

      const screenshotsSection = screenshotUrls.length > 0
        ? `\n\n## Screenshots\n\n${screenshotUrls.map(s => `- **${formatDuration(s.timestamp_seconds)}** — ${s.url}`).join('\n')}\n\n*Screenshots are hosted for 2 hours. Fetch with curl or pass URLs to a vision-capable LLM.*`
        : '';

      return {
        content: [
          {
            type: 'text',
            text: `# Video Analysis: ${title}\n\n**Source:** ${url}\n\n---\n\n${analysis}${screenshotsSection}`,
          },
        ],
      };
    }
  );

  server.tool(
    'get_video_info',
    'Get metadata about a video URL (title, duration, available formats) without downloading or analyzing it. Useful for a quick check before running analyze_video.',
    {
      url: z.string().url().describe('Public video URL to inspect'),
    },
    async ({ url }) => {
      const { stdout } = await (async () => {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const ytDlp = process.env.YT_DLP_PATH || 'yt-dlp';
        return promisify(exec)(
          `"${ytDlp}" --dump-json --no-download "${url}"`,
          { timeout: 30_000 }
        );
      })();

      const info = JSON.parse(stdout);
      const summary = {
        title: info.title,
        uploader: info.uploader,
        duration_seconds: info.duration,
        duration_human: formatDuration(info.duration),
        upload_date: info.upload_date,
        description: info.description?.slice(0, 500),
        webpage_url: info.webpage_url,
        extractor: info.extractor,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    }
  );

  return server;
}

function formatDuration(seconds: number): string {
  if (!seconds) return 'unknown';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

function authenticate(req: Request, res: Response, next: NextFunction) {
  if (!MCP_API_KEY) return next();
  const key = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : (req.headers['x-api-key'] as string | undefined);
  if (!key) { res.status(401).json({ error: 'Missing API key' }); return; }
  if (key !== MCP_API_KEY) { res.status(403).json({ error: 'Invalid API key' }); return; }
  next();
}

function resolveGeminiKey(req: Request): string | null {
  return (req.headers['x-gemini-api-key'] as string | undefined) ?? process.env.GEMINI_API_KEY ?? null;
}

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', server: 'video-mcp', version: '1.0.0' }));

app.get('/screenshots/:id', (req: Request, res: Response) => {
  purgeExpiredScreenshots();
  const entry = screenshotRegistry.get(req.params['id'] as string);
  if (!entry) {
    res.status(404).json({ error: 'Screenshot not found or expired' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=7200');
  createReadStream(entry.path).pipe(res);
});

app.post('/mcp', authenticate, async (req: Request, res: Response) => {
  const geminiApiKey = resolveGeminiKey(req);
  if (!geminiApiKey) {
    res.status(400).json({ error: 'No Gemini API key provided. Pass X-Gemini-Api-Key header or set GEMINI_API_KEY env var.' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  const server = createMcpServer(geminiApiKey);
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => console.log(`video-mcp running on http://0.0.0.0:${PORT}`));

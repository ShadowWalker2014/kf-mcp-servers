import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { unlink, readFile } from 'fs/promises';
import {
  downloadVideo,
  getVideoTitle,
  analyzeVideoFile,
  cleanupTempFile,
  extractFramesAtTimestamps,
  sweepOrphanedScreenshots,
  createReadStream,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3600');
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://video-mcp-production-2dc2.up.railway.app').replace(/\/$/, '');

// Video cache: url -> { path, expires } — keeps downloaded video on disk for 30 min
// so get_screenshots doesn't need to re-download after analyze_video
const videoCache = new Map<string, { path: string; expires: number }>();
const VIDEO_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function getOrDownloadVideo(url: string): Promise<string> {
  const cached = videoCache.get(url);
  if (cached && Date.now() < cached.expires) return cached.path;
  const path = await downloadVideo(url);
  videoCache.set(url, { path, expires: Date.now() + VIDEO_CACHE_TTL_MS });
  return path;
}

function purgeExpiredVideos(): void {
  const now = Date.now();
  for (const [url, entry] of videoCache) {
    if (now > entry.expires) {
      cleanupTempFile(entry.path);
      videoCache.delete(url);
    }
  }
}

// Screenshot registry: id -> { path, expires }
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

function createMcpServer(getGeminiKey: () => string | null): McpServer {
  const server = new McpServer({ name: 'video-mcp', version: '1.0.0' });

  server.tool(
    'analyze_video',
    'Download any public video (Loom, YouTube, Vimeo, etc.) and analyze it with Gemini AI. Returns a comprehensive text report with timestamps covering visual content, audio narration, sequence of actions, key technical details, and engineering action items. The video is cached for 30 minutes — call get_screenshots next with specific timestamps from this report to get hosted image URLs. Takes 1-3 minutes depending on video length.',
    {
      url: z.string().url().describe('Public video URL — Loom share link, YouTube, Vimeo, or any yt-dlp-supported URL'),
      prompt: z.string().optional().describe('Custom analysis prompt. Leave empty for the default comprehensive technical analysis.'),
    },
    async ({ url, prompt }) => {
      const geminiApiKey = getGeminiKey();
      if (!geminiApiKey) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'No Gemini API key provided. Pass X-Gemini-Api-Key header on the MCP request or set GEMINI_API_KEY env var on the server.' }],
        };
      }

      purgeExpiredVideos();
      purgeExpiredScreenshots();

      const title = await getVideoTitle(url).catch(() => url);
      const videoPath = await getOrDownloadVideo(url);

      const analysis = await analyzeVideoFile(geminiApiKey, videoPath, prompt);

      return {
        content: [
          {
            type: 'text',
            text: `# Video Analysis: ${title}\n\n**Source:** ${url}\n\n---\n\n${analysis}\n\n---\n\n*Video cached for 30 minutes. Call \`get_screenshots\` with this URL and specific timestamps to get hosted image URLs.*`,
          },
        ],
      };
    }
  );

  server.tool(
    'get_screenshots',
    'Extract screenshots from a video at specific timestamps and return hosted URLs valid for 2 hours. Call analyze_video first to get the text analysis with timestamps, then use this tool to grab images at the moments that matter. The video is cached for 30 minutes after analyze_video so this is fast.',
    {
      url: z.string().url().describe('Same video URL passed to analyze_video'),
      timestamps: z.array(z.number().min(0)).min(1).max(20).describe('Timestamps in seconds to capture (e.g. [10, 45, 90]). Max 20.'),
    },
    async ({ url, timestamps }) => {
      purgeExpiredVideos();
      purgeExpiredScreenshots();

      const videoPath = await getOrDownloadVideo(url);
      const frames = await extractFramesAtTimestamps(videoPath, timestamps);

      if (frames.length === 0) {
        return {
          content: [{ type: 'text', text: 'No screenshots could be extracted. Check that the timestamps are within the video duration.' }],
        };
      }

      // Build content: for each frame, emit a text label + the image inline as base64
      // so the calling LLM can see the frames directly without any extra curl/download step.
      type ContentItem =
        | { type: 'text'; text: string }
        | { type: 'image'; data: string; mimeType: string };

      const content: ContentItem[] = [
        { type: 'text', text: `## Screenshots (${frames.length} frames)\n` },
      ];

      for (const frame of frames) {
        registerScreenshot(frame.id, frame.path);
        const hostedUrl = `${PUBLIC_URL}/screenshots/${frame.id}`;
        const imageBytes = await readFile(frame.path);
        content.push({
          type: 'text',
          text: `**${formatDuration(frame.timestampSeconds)}** (${frame.timestampSeconds}s) — ${hostedUrl}`,
        });
        content.push({
          type: 'image',
          data: imageBytes.toString('base64'),
          mimeType: 'image/jpeg',
        });
      }

      content.push({
        type: 'text',
        text: '\n*Hosted URLs valid for 2 hours — pass to external vision APIs or download with curl.*',
      });

      return { content };
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
  // ChatGPT Apps and some other MCP clients only send `Accept: application/json`,
  // but the StreamableHTTP transport strictly requires both `application/json` AND
  // `text/event-stream` per spec. Normalize so we accept either client style.
  const accept = (req.headers.accept || '').toString();
  if (!accept.includes('text/event-stream')) {
    req.headers.accept = accept ? `${accept}, text/event-stream` : 'application/json, text/event-stream';
  }
  if (!req.headers.accept.includes('application/json')) {
    req.headers.accept = `application/json, ${req.headers.accept}`;
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  const server = createMcpServer(() => resolveGeminiKey(req));
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Use POST /mcp' }));
app.delete('/mcp', authenticate, (_req, res) => res.status(405).json({ error: 'Stateless mode' }));

app.listen(PORT, () => console.log(`video-mcp running on http://0.0.0.0:${PORT}`));

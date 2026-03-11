import express, { NextFunction, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import {
  downloadVideo,
  getVideoTitle,
  analyzeVideoFile,
  cleanupTempFile,
} from './api.js';

const MCP_API_KEY = process.env.MCP_API_KEY;
const PORT = parseInt(process.env.PORT || '3600');

function createMcpServer(geminiApiKey: string): McpServer {
  const server = new McpServer({ name: 'video-mcp', version: '1.0.0' });

  server.tool(
    'analyze_video',
    'Download any public video (Loom, YouTube, Vimeo, etc.) and analyze it with Gemini AI. Returns a comprehensive report covering visual content, audio narration, sequence of actions, key technical details, and engineering action items. Best for screen recordings, bug reports, and feature demos. Takes 1-3 minutes depending on video length.',
    {
      url: z.string().url().describe('Public video URL — Loom share link, YouTube, Vimeo, or any yt-dlp-supported URL'),
      prompt: z.string().optional().describe('Custom analysis prompt. Leave empty for the default comprehensive technical analysis.'),
    },
    async ({ url, prompt }) => {
      let videoPath: string | null = null;

      const title = await getVideoTitle(url).catch(() => url);
      videoPath = await downloadVideo(url);
      const analysis = await analyzeVideoFile(geminiApiKey, videoPath, prompt);
      await cleanupTempFile(videoPath);

      return {
        content: [
          {
            type: 'text',
            text: `# Video Analysis: ${title}\n\n**Source:** ${url}\n\n---\n\n${analysis}`,
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
        return promisify(exec)(
          `yt-dlp --dump-json --no-download "${url}"`,
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

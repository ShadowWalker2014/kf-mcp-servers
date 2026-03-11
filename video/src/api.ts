import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

const execAsync = promisify(exec);

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

// Domains where yt-dlp is unreliable from cloud IPs — use cobalt instead
const COBALT_DOMAINS = new Set([
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'twitter.com',
  'www.twitter.com',
  'x.com',
  'www.x.com',
]);

// Cobalt public instances ordered by score (checked 2026-03-11)
// Source: https://instances.cobalt.best/api — all confirmed instagram: true
const COBALT_INSTANCES = [
  'cobalt-api.meowing.de',       // score 88, independent
  'cobalt-backend.canine.tools', // score 84, independent
  'kityune.imput.net',           // score 76, official cobalt.tools backend
  'blossom.imput.net',           // score 76, official cobalt.tools backend
  'nachos.imput.net',            // score 72, official cobalt.tools backend
  'sunny.imput.net',             // score 72, official cobalt.tools backend
];

interface CobaltResponse {
  status: 'redirect' | 'tunnel' | 'picker' | 'error';
  url?: string;
  filename?: string;
  picker?: Array<{ type: string; url: string; thumb?: string }>;
  audio?: string;
  error?: { code: string };
}

async function downloadViaCobalt(url: string, outputPath: string): Promise<void> {
  let lastError = '';

  for (const instance of COBALT_INSTANCES) {
    let data: CobaltResponse;

    const res = await fetch(`https://${instance}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url, videoQuality: '720', downloadMode: 'auto' }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);

    if (!res?.ok) { lastError = `${instance}: HTTP ${res?.status ?? 'unreachable'}`; continue; }

    data = await res.json() as CobaltResponse;

    if (data.status === 'error') { lastError = `${instance}: ${data.error?.code}`; continue; }

    let videoUrl: string | null = null;

    if (data.status === 'redirect' || data.status === 'tunnel') {
      videoUrl = data.url ?? null;
    } else if (data.status === 'picker') {
      // Carousels — pick first video, fallback to first item
      const item = data.picker?.find((p) => p.type === 'video') ?? data.picker?.[0];
      videoUrl = item?.url ?? null;
    }

    if (!videoUrl) { lastError = `${instance}: no video URL in response`; continue; }

    // Download via curl — handles redirects, streaming, auth headers transparently
    const { stderr } = await execAsync(
      `curl -sL --max-time 120 -o "${outputPath}" "${videoUrl}"`,
      { timeout: 130_000 }
    ).catch((e: Error) => ({ stderr: e.message }));

    const fileExists = await access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) { lastError = `${instance}: curl failed — ${stderr}`; continue; }

    return; // success
  }

  throw new Error(`All cobalt instances failed. Last error: ${lastError}`);
}

const ANALYSIS_PROMPT = `You are a senior technical analyst reviewing a screen recording video. Produce an exhaustive analysis that an engineer can use to understand and act on the content WITHOUT watching the video themselves.

Structure your response as follows:

## Summary
One paragraph: what this video is about and the core issue/topic.

## Visual Content (Screen)
Describe exactly what is shown on screen at key moments:
- Application/page names, UI sections, navigation paths
- Exact text of error messages, status labels, data values, IDs
- Numbers, amounts, percentages, timestamps — verbatim
- Code snippets or terminal output visible on screen

## Audio / Narration
Summarize or transcribe what is said, capturing key phrases verbatim. Note who is speaking if mentioned.

## Sequence of Actions
Step-by-step: what the demonstrator does and what happens as a result.

## Key Technical Details
Bullet list of the most important concrete details:
- Exact values, IDs, or amounts that matter
- Error messages or unexpected behaviors
- Discrepancies or anomalies observed
- Any stack traces, logs, or console output visible

## Root Cause Hypothesis
Based on what you observed, what are the most likely causes of any issue shown?

## Engineering Action Items
What specific things should an engineer investigate, check in code, or query in the database?

Be exhaustive and precise. Engineers will rely entirely on this analysis.`;

export async function downloadVideo(url: string): Promise<string> {
  const id = randomUUID();
  const outputPath = join(tmpdir(), `video-${id}.mp4`);
  const hostname = new URL(url).hostname;

  if (COBALT_DOMAINS.has(hostname)) {
    await downloadViaCobalt(url, outputPath);
  } else {
    await execAsync(
      `"${YT_DLP}" -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`,
      { timeout: 180_000 }
    );
    await access(outputPath);
  }

  return outputPath;
}

export async function getVideoTitle(url: string): Promise<string> {
  const hostname = new URL(url).hostname;

  if (COBALT_DOMAINS.has(hostname)) {
    // Cobalt doesn't expose titles — derive from URL
    const match = url.match(/\/(p|reel|shorts)\/([^/?]+)/);
    return match ? `Instagram ${match[1]} ${match[2]}` : url;
  }

  const { stdout } = await execAsync(
    `"${YT_DLP}" --get-title "${url}"`,
    { timeout: 30_000 }
  );
  return stdout.trim();
}

export async function analyzeVideoFile(
  apiKey: string,
  videoPath: string,
  customPrompt?: string
): Promise<string> {
  const fileManager = new GoogleAIFileManager(apiKey);
  const genAI = new GoogleGenerativeAI(apiKey);

  const uploadResult = await fileManager.uploadFile(videoPath, {
    mimeType: 'video/mp4',
    displayName: `analysis-${Date.now()}`,
  });

  let file = await fileManager.getFile(uploadResult.file.name);
  while (file.state === FileState.PROCESSING) {
    await new Promise((r) => setTimeout(r, 3000));
    file = await fileManager.getFile(uploadResult.file.name);
  }

  if (file.state !== FileState.ACTIVE) {
    await fileManager.deleteFile(file.name).catch(() => {});
    throw new Error(`Gemini file processing failed with state: ${file.state}`);
  }

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent([
    { fileData: { mimeType: 'video/mp4', fileUri: file.uri } },
    customPrompt ?? ANALYSIS_PROMPT,
  ]);

  await fileManager.deleteFile(file.name).catch(() => {});

  return result.response.text();
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}

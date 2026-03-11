import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, access, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

const execAsync = promisify(exec);

// Support explicit path for environments where yt-dlp isn't on PATH (e.g. Railway)
const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

// Domains that require a cookies file to download
const COOKIE_DOMAINS: Record<string, string | undefined> = {
  'instagram.com': process.env.INSTAGRAM_COOKIES,
  'www.instagram.com': process.env.INSTAGRAM_COOKIES,
};

function getCookiesForUrl(url: string): string | undefined {
  const hostname = new URL(url).hostname;
  return COOKIE_DOMAINS[hostname];
}

async function writeTempCookies(cookiesB64: string): Promise<string> {
  const path = join(tmpdir(), `cookies-${randomUUID()}.txt`);
  const decoded = Buffer.from(cookiesB64, 'base64').toString('utf-8');
  await writeFile(path, decoded, 'utf-8');
  return path;
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

  const cookiesB64 = getCookiesForUrl(url);
  let cookiesPath: string | null = null;
  let cookiesFlag = '';

  if (cookiesB64) {
    cookiesPath = await writeTempCookies(cookiesB64);
    cookiesFlag = `--cookies "${cookiesPath}"`;
  }

  await execAsync(
    `"${YT_DLP}" -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best" --merge-output-format mp4 ${cookiesFlag} -o "${outputPath}" "${url}"`,
    { timeout: 180_000 }
  );

  if (cookiesPath) await unlink(cookiesPath).catch(() => {});

  await access(outputPath);
  return outputPath;
}

export async function getVideoTitle(url: string): Promise<string> {
  const cookiesB64 = getCookiesForUrl(url);
  let cookiesPath: string | null = null;
  let cookiesFlag = '';

  if (cookiesB64) {
    cookiesPath = await writeTempCookies(cookiesB64);
    cookiesFlag = `--cookies "${cookiesPath}"`;
  }

  const { stdout } = await execAsync(
    `"${YT_DLP}" --get-title ${cookiesFlag} "${url}"`,
    { timeout: 30_000 }
  );

  if (cookiesPath) await unlink(cookiesPath).catch(() => {});

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

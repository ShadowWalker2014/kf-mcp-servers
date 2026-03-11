import { exec } from 'child_process';
import { promisify } from 'util';
import { unlink, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { ApifyClient } from 'apify-client';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';

const execAsync = promisify(exec);

const YT_DLP = process.env.YT_DLP_PATH || 'yt-dlp';

const INSTAGRAM_DOMAINS = new Set(['instagram.com', 'www.instagram.com']);

let apifyClient: ApifyClient | null = null;
function getApifyClient(): ApifyClient {
  if (!apifyClient) {
    const token = process.env.APIFY_API_KEY;
    if (!token) throw new Error('APIFY_API_KEY env var not set');
    apifyClient = new ApifyClient({ token });
  }
  return apifyClient;
}

async function downloadViaApify(url: string, outputPath: string): Promise<void> {
  const client = getApifyClient();

  // Run apify/instagram-scraper for the specific post URL
  const run = await client.actor('apify/instagram-scraper').call({
    directUrls: [url],
    resultsType: 'posts',
    resultsLimit: 1,
    searchType: 'hashtag',
    searchLimit: 1,
    addParentData: false,
  });

  // Fetch dataset results
  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  if (!items.length) throw new Error('Apify Instagram scraper returned no results');

  const post = items[0] as Record<string, unknown>;

  // apify/instagram-scraper returns videoUrl for video posts
  const videoUrl = (post.videoUrl as string | undefined);
  if (!videoUrl) {
    throw new Error(
      `No videoUrl in Apify result. Post type: ${post.type}. ` +
      `Available keys: ${Object.keys(post).join(', ')}`
    );
  }

  await execAsync(`curl -sL --max-time 120 -o "${outputPath}" "${videoUrl}"`, { timeout: 130_000 });

  const fileExists = await access(outputPath).then(() => true).catch(() => false);
  if (!fileExists) throw new Error('Failed to download video from Instagram CDN via Apify');
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

  if (INSTAGRAM_DOMAINS.has(hostname)) {
    await downloadViaApify(url, outputPath);
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

  if (INSTAGRAM_DOMAINS.has(hostname)) {
    const match = url.match(/\/(p|reel|tv)\/([^/?]+)/);
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

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
const TIKTOK_DOMAINS = new Set(['tiktok.com', 'www.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']);

let apifyClient: ApifyClient | null = null;
function getApifyClient(): ApifyClient {
  if (!apifyClient) {
    const token = process.env.APIFY_API_KEY;
    if (!token) throw new Error('APIFY_API_KEY env var not set');
    apifyClient = new ApifyClient({ token });
  }
  return apifyClient;
}

async function downloadViaApify(
  url: string,
  outputPath: string,
  platform: 'instagram' | 'tiktok'
): Promise<void> {
  const client = getApifyClient();

  let run;

  if (platform === 'instagram') {
    // apify/instagram-scraper — accepts directUrls with specific post URL
    run = await client.actor('apify/instagram-scraper').call({
      directUrls: [url],
      resultsType: 'posts',
      resultsLimit: 1,
      searchType: 'hashtag',
      searchLimit: 1,
      addParentData: false,
    });
  } else {
    // clockworks/tiktok-profile-scraper — same actor used in creator-crm
    // Requires a username (profiles field), so extract from the URL
    // URL format: https://www.tiktok.com/@username/video/123456
    const tiktokMatch = url.match(/@([^/]+)\/video\/(\d+)/);
    if (!tiktokMatch) throw new Error(`Could not extract TikTok username/video ID from URL: ${url}`);
    const [, username, videoId] = tiktokMatch;

    run = await client.actor('clockworks/tiktok-profile-scraper').call({
      profiles: [username],
      profileScrapeSections: ['videos'],
      profileSorting: 'latest',
      resultsPerPage: 30,
      excludePinnedPosts: false,
      shouldDownloadVideos: true,  // Apify downloads to stable storage, avoids CDN URL expiry
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
      shouldDownloadAvatars: false,
    });

    const { items: allItems } = await client.dataset(run.defaultDatasetId).listItems();
    if (!allItems.length) throw new Error('Apify TikTok scraper returned no results');

    // Find the specific video by ID
    const allItemsTyped = allItems as Record<string, unknown>[];
    const matchedItem = allItemsTyped.find(
      (item) => String(item.id) === videoId || (item.webVideoUrl as string)?.includes(videoId)
    ) ?? allItemsTyped[0]; // fallback to most recent if not found

    // Field lookup across different versions of the TikTok scraper actor:
    // - videoPath / videoDownloadedPath: Apify key-value store URL (when shouldDownloadVideos=true)
    // - videoUrl: direct CDN mp4 URL
    // - mediaUrls: array of CDN URLs (most common in current actor version)
    const mediaUrls = matchedItem.mediaUrls as string[] | undefined;
    const cdnUrl = (matchedItem.videoPath as string | undefined)
      ?? (matchedItem.videoDownloadedPath as string | undefined)
      ?? (matchedItem.videoUrl as string | undefined)
      ?? (Array.isArray(mediaUrls) && mediaUrls.length > 0 ? mediaUrls[0] : undefined);

    if (!cdnUrl) {
      throw new Error(
        `No video URL in Apify TikTok result. Keys: ${Object.keys(matchedItem).join(', ')}`
      );
    }

    // TikTok CDN URLs need browser-like headers to avoid being served an HTML error page
    await execAsync(
      `curl -sL --fail --max-time 120 ` +
      `-H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" ` +
      `-H "Referer: https://www.tiktok.com/" ` +
      `-o "${outputPath}" "${cdnUrl}"`,
      { timeout: 130_000 }
    );

    const fileExists = await access(outputPath).then(() => true).catch(() => false);
    if (!fileExists) throw new Error('Failed to download TikTok video via Apify');
    return;
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  if (!items.length) throw new Error(`Apify ${platform} scraper returned no results`);

  const post = items[0] as Record<string, unknown>;

  // Instagram actor returns videoUrl for video content
  const videoUrl = (post.videoUrl as string | undefined)
    ?? (post.webVideoUrl as string | undefined);

  if (!videoUrl) {
    throw new Error(
      `No videoUrl in Apify ${platform} result. ` +
      `Available keys: ${Object.keys(post).join(', ')}`
    );
  }

  await execAsync(`curl -sL --max-time 120 -o "${outputPath}" "${videoUrl}"`, { timeout: 130_000 });

  const fileExists = await access(outputPath).then(() => true).catch(() => false);
  if (!fileExists) throw new Error(`Failed to download ${platform} video via Apify`);
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
    await downloadViaApify(url, outputPath, 'instagram');
  } else if (TIKTOK_DOMAINS.has(hostname)) {
    await downloadViaApify(url, outputPath, 'tiktok');
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

  if (TIKTOK_DOMAINS.has(hostname)) {
    const match = url.match(/\/video\/(\d+)/);
    return match ? `TikTok video ${match[1]}` : url;
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

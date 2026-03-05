/**
 * Text matching utilities for search/replace operations
 */

import { createTwoFilesPatch } from 'diff';

export function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

export function generateDiff(original: string, modified: string, path: string): string {
  return createTwoFilesPatch(path, path, original, modified, 'original', 'modified');
}

export interface FlexibleMatchResult {
  found: boolean;
  matchCount: number;
  startIndex: number;
  endIndex: number;
}

export function findFlexibleMatch(content: string, searchText: string): FlexibleMatchResult {
  const contentLines = content.split('\n');
  const searchLines = searchText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  
  if (searchLines.length === 0) {
    return { found: false, matchCount: 0, startIndex: -1, endIndex: -1 };
  }
  
  let matchCount = 0;
  let firstMatch: { startIndex: number; endIndex: number } | null = null;
  
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let matched = true;
    let endIndex = i;
    
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j]) {
        matched = false;
        break;
      }
      endIndex = i + j;
    }
    
    if (matched) {
      matchCount++;
      if (!firstMatch) {
        firstMatch = { startIndex: i, endIndex };
      }
    }
  }
  
  return {
    found: matchCount === 1,
    matchCount,
    startIndex: firstMatch?.startIndex ?? -1,
    endIndex: firstMatch?.endIndex ?? -1,
  };
}

export function applyFlexibleReplacement(
  normalizedContent: string,
  matchResult: FlexibleMatchResult,
  newText: string
): string {
  const contentLines = normalizedContent.split('\n');
  
  const originalIndent = contentLines[matchResult.startIndex].match(/^\s*/)?.[0] || '';
  const newLines = newText.split('\n');
  const newBaseIndent = newLines[0]?.match(/^\s*/)?.[0] || '';
  
  const usesOnlyTabs = originalIndent.length > 0 && originalIndent.replace(/\t/g, '') === '';
  const indentUnit = usesOnlyTabs ? '\t' : ' ';
  
  const indentedNewLines = newLines.map((line, j) => {
    if (j === 0) {
      return originalIndent + line.trimStart();
    }
    const newIndent = line.match(/^\s*/)?.[0] || '';
    const relativeCount = Math.max(0, newIndent.length - newBaseIndent.length);
    const extraIndent = relativeCount > 0 ? indentUnit.repeat(relativeCount) : '';
    return originalIndent + extraIndent + line.trimStart();
  });
  
  contentLines.splice(matchResult.startIndex, matchResult.endIndex - matchResult.startIndex + 1, ...indentedNewLines);
  return contentLines.join('\n');
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

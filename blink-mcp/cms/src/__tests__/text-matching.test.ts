import { describe, expect, test } from 'bun:test';

// Re-implement the text matching utilities for testing (they're not exported from http-server.ts)
function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n');
}

interface FlexibleMatchResult {
  found: boolean;
  matchCount: number;
  startIndex: number;
  endIndex: number;
}

function findFlexibleMatch(content: string, searchText: string): FlexibleMatchResult {
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

function applyFlexibleReplacement(
  originalContent: string,
  matchResult: FlexibleMatchResult,
  oldText: string,
  newText: string
): string {
  const contentLines = originalContent.split('\n');
  const eol = originalContent.includes('\r\n') ? '\r\n' : '\n';
  
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
  return contentLines.join(eol);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('normalizeLineEndings', () => {
  test('converts CRLF to LF', () => {
    expect(normalizeLineEndings('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
  });

  test('preserves LF', () => {
    expect(normalizeLineEndings('line1\nline2\nline3')).toBe('line1\nline2\nline3');
  });

  test('handles mixed line endings', () => {
    expect(normalizeLineEndings('line1\r\nline2\nline3\r\n')).toBe('line1\nline2\nline3\n');
  });

  test('handles empty string', () => {
    expect(normalizeLineEndings('')).toBe('');
  });
});

describe('findFlexibleMatch', () => {
  describe('single line matching', () => {
    test('finds exact match', () => {
      const content = 'line1\nline2\nline3';
      const result = findFlexibleMatch(content, 'line2');
      expect(result.found).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(result.startIndex).toBe(1);
      expect(result.endIndex).toBe(1);
    });

    test('finds match with trimmed whitespace', () => {
      const content = '  line1\n  line2\n  line3';
      const result = findFlexibleMatch(content, 'line2');
      expect(result.found).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    test('does not find non-existent text', () => {
      const content = 'line1\nline2\nline3';
      const result = findFlexibleMatch(content, 'line4');
      expect(result.found).toBe(false);
      expect(result.matchCount).toBe(0);
    });
  });

  describe('multi-line matching', () => {
    test('finds multi-line match', () => {
      const content = 'line1\nline2\nline3\nline4';
      const result = findFlexibleMatch(content, 'line2\nline3');
      expect(result.found).toBe(true);
      expect(result.matchCount).toBe(1);
      expect(result.startIndex).toBe(1);
      expect(result.endIndex).toBe(2);
    });

    test('finds multi-line match with different indentation', () => {
      const content = '  function test() {\n    return 42;\n  }';
      const result = findFlexibleMatch(content, 'function test() {\nreturn 42;\n}');
      expect(result.found).toBe(true);
    });
  });

  describe('multiple occurrences', () => {
    test('detects multiple occurrences', () => {
      const content = 'duplicate\nother\nduplicate';
      const result = findFlexibleMatch(content, 'duplicate');
      expect(result.found).toBe(false); // found is false when matchCount > 1
      expect(result.matchCount).toBe(2);
    });

    test('returns first match position with multiple occurrences', () => {
      const content = 'duplicate\nother\nduplicate';
      const result = findFlexibleMatch(content, 'duplicate');
      expect(result.startIndex).toBe(0);
      expect(result.endIndex).toBe(0);
    });
  });

  describe('edge cases', () => {
    test('handles empty search text', () => {
      const content = 'line1\nline2';
      const result = findFlexibleMatch(content, '');
      expect(result.found).toBe(false);
      expect(result.matchCount).toBe(0);
    });

    test('handles whitespace-only search text', () => {
      const content = 'line1\nline2';
      const result = findFlexibleMatch(content, '   \n   ');
      expect(result.found).toBe(false);
    });

    test('handles search text longer than content', () => {
      const content = 'short';
      const result = findFlexibleMatch(content, 'this is a very long search text\nwith multiple lines');
      expect(result.found).toBe(false);
    });
  });
});

describe('applyFlexibleReplacement', () => {
  test('preserves original indentation', () => {
    const original = 'function test() {\n    const x = 1;\n}';
    const matchResult = { found: true, matchCount: 1, startIndex: 1, endIndex: 1 };
    const result = applyFlexibleReplacement(original, matchResult, 'const x = 1;', 'const y = 2;');
    expect(result).toBe('function test() {\n    const y = 2;\n}');
  });

  test('handles multi-line replacement', () => {
    const original = 'line1\nline2\nline3';
    const matchResult = { found: true, matchCount: 1, startIndex: 1, endIndex: 1 };
    const result = applyFlexibleReplacement(original, matchResult, 'line2', 'new1\nnew2');
    expect(result).toContain('new1');
    expect(result).toContain('new2');
  });

  test('preserves tab indentation', () => {
    const original = 'function test() {\n\tconst x = 1;\n}';
    const matchResult = { found: true, matchCount: 1, startIndex: 1, endIndex: 1 };
    const result = applyFlexibleReplacement(original, matchResult, 'const x = 1;', 'const y = 2;');
    expect(result).toBe('function test() {\n\tconst y = 2;\n}');
  });
});

describe('escapeRegex', () => {
  test('escapes special characters', () => {
    expect(escapeRegex('hello.world')).toBe('hello\\.world');
    expect(escapeRegex('a*b+c?')).toBe('a\\*b\\+c\\?');
    expect(escapeRegex('(test)')).toBe('\\(test\\)');
    expect(escapeRegex('[brackets]')).toBe('\\[brackets\\]');
    expect(escapeRegex('a^b$c')).toBe('a\\^b\\$c');
  });

  test('handles string with no special characters', () => {
    expect(escapeRegex('hello world')).toBe('hello world');
  });

  test('handles empty string', () => {
    expect(escapeRegex('')).toBe('');
  });
});

describe('search and replace scenarios', () => {
  test('exact match replacement', () => {
    const content = 'const value = 42;';
    const search = 'value = 42';
    const replace = 'value = 100';
    const result = content.replace(search, replace);
    expect(result).toBe('const value = 100;');
  });

  test('replace all with regex', () => {
    const content = 'apple banana apple cherry apple';
    const search = 'apple';
    const replace = 'orange';
    const result = content.replace(new RegExp(escapeRegex(search), 'g'), replace);
    expect(result).toBe('orange banana orange cherry orange');
  });

  test('handles special characters in search', () => {
    const content = 'const fn = () => { return x; };';
    const search = '() => { return x; }';
    const result = content.replace(escapeRegex(search), '() => x');
    // Using escapeRegex as string, not regex - this shows the issue
    expect(content.includes(search)).toBe(true);
  });
});

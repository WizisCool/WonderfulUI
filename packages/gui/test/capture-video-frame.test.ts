import { describe, expect, test } from 'bun:test';
import {
  defaultScreenshotName,
  formatTimeForFilename,
  sanitizeFileStem,
  videoStemFromPath,
} from '../src/utils/capture-video-frame.ts';

describe('sanitizeFileStem', () => {
  test('strips Windows-illegal characters', () => {
    expect(sanitizeFileStem('a:b*c?.png')).toBe('abc.png');
    expect(sanitizeFileStem('foo/bar\\baz')).toBe('foobarbaz');
  });

  test('falls back when empty after clean', () => {
    expect(sanitizeFileStem('***')).toBe('精彩时刻');
    expect(sanitizeFileStem('   ')).toBe('精彩时刻');
  });
});

describe('formatTimeForFilename', () => {
  test('formats mm-ss without colon', () => {
    expect(formatTimeForFilename(0)).toBe('0-00');
    expect(formatTimeForFilename(65)).toBe('1-05');
    expect(formatTimeForFilename(3723)).toBe('62-03');
  });

  test('clamps non-finite and negative', () => {
    expect(formatTimeForFilename(NaN)).toBe('0-00');
    expect(formatTimeForFilename(-3)).toBe('0-00');
  });
});

describe('defaultScreenshotName', () => {
  test('uses path stem and time', () => {
    expect(defaultScreenshotName('D:\\videos\\击杀集锦.mp4', 65)).toBe('击杀集锦_1-05.png');
  });

  test('fallback stem when path missing', () => {
    expect(defaultScreenshotName(null, 12)).toBe('精彩时刻_0-12.png');
  });
});

describe('videoStemFromPath', () => {
  test('strips extension from basenames', () => {
    expect(videoStemFromPath('/a/b/c.mp4')).toBe('c');
    expect(videoStemFromPath('Z:\\x\\y.z.webm')).toBe('y.z');
  });
});

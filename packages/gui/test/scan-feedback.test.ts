import { describe, expect, test } from 'bun:test';
import {
  SCAN_FAILURE_MESSAGE,
  scanCompletionFeedback,
} from '../src/utils/scan-feedback.ts';

describe('library scan feedback', () => {
  test('distinguishes incremental and full success', () => {
    expect(scanCompletionFeedback('incremental', 0)).toEqual({
      message: '资料库已增量扫描',
      tone: 'ok',
    });
    expect(scanCompletionFeedback('full', 0)).toEqual({
      message: '资料库已全量扫描',
      tone: 'ok',
    });
  });

  test('never reports partial results as unconditional success', () => {
    expect(scanCompletionFeedback('incremental', 2)).toEqual({
      message: '扫描完成，但有 2 个账户或记录读取失败，请全量扫描重试',
      tone: 'error',
    });
    expect(scanCompletionFeedback('full', Number.NaN).tone).toBe('ok');
    expect(SCAN_FAILURE_MESSAGE).not.toContain('\\');
  });
});

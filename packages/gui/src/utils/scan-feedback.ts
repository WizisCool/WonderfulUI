export type ScanMode = 'incremental' | 'full';

export interface ScanFeedback {
  message: string;
  tone: 'ok' | 'error';
}

export const SCAN_FAILURE_MESSAGE = '扫描失败，请检查 ACLOS 数据目录后重试';

export function scanCompletionFeedback(mode: ScanMode, totalErrors: number): ScanFeedback {
  const count = Number.isFinite(totalErrors) ? Math.max(0, Math.trunc(totalErrors)) : 0;
  if (count > 0) {
    return {
      message: `扫描完成，但有 ${count} 个账户或记录读取失败，请全量扫描重试`,
      tone: 'error',
    };
  }
  return {
    message: mode === 'full' ? '资料库已全量扫描' : '资料库已增量扫描',
    tone: 'ok',
  };
}

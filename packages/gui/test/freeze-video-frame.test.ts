import { describe, expect, test } from 'bun:test';
import { paintVideoFrameToCanvas } from '../src/utils/freeze-video-frame.ts';

function fakeCanvas() {
  let w = 0;
  let h = 0;
  const drawCalls: Array<{ w: number; h: number }> = [];
  return {
    get width() {
      return w;
    },
    set width(v: number) {
      w = v;
    },
    get height() {
      return h;
    },
    set height(v: number) {
      h = v;
    },
    getContext(_id: string) {
      return {
        drawImage(_src: unknown, _x: number, _y: number, dw: number, dh: number) {
          drawCalls.push({ w: dw, h: dh });
        },
        clearRect() {},
      };
    },
    drawCalls,
  } as unknown as HTMLCanvasElement & { drawCalls: Array<{ w: number; h: number }> };
}

describe('paintVideoFrameToCanvas', () => {
  test('returns false when video has no frame size', () => {
    const canvas = fakeCanvas();
    const video = { videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    expect(paintVideoFrameToCanvas(video, canvas)).toBe(false);
  });

  test('returns false when getContext fails', () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => null,
    } as unknown as HTMLCanvasElement;
    const video = { videoWidth: 16, videoHeight: 9 } as unknown as HTMLVideoElement;
    expect(paintVideoFrameToCanvas(video, canvas)).toBe(false);
  });

  test('draws and returns true when video has dimensions', () => {
    const canvas = fakeCanvas();
    const video = { videoWidth: 16, videoHeight: 9 } as unknown as HTMLVideoElement;
    expect(paintVideoFrameToCanvas(video, canvas)).toBe(true);
    expect(canvas.width).toBe(16);
    expect(canvas.height).toBe(9);
    expect(canvas.drawCalls).toEqual([{ w: 16, h: 9 }]);
  });
});

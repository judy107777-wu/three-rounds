import { describe, it, expect, vi } from 'vitest';
import { createRecorder, RecorderError } from '../src/recorder.js';

// 假的 MediaRecorder：只做這個模組真正用到的部分
class FakeMediaRecorder {
  static isTypeSupported(type) {
    return type === 'audio/webm';
  }
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'audio/webm';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    if (this.ondataavailable) {
      this.ondataavailable({ data: new Blob(['fake-audio'], { type: this.mimeType }) });
    }
    if (this.onstop) this.onstop();
  }
}

function fakeStream() {
  const track = { stop: vi.fn(), kind: 'audio' };
  return { getTracks: () => [track], __track: track };
}

function makeOptions({ clock = { t: 0 }, stream = fakeStream(), fail = null } = {}) {
  return {
    clock,
    stream,
    options: {
      now: () => clock.t,
      getUserMedia: fail ? () => Promise.reject(fail) : () => Promise.resolve(stream),
      MediaRecorder: FakeMediaRecorder,
    },
  };
}

describe('T07 錄音模組', () => {
  it('呼叫開始後狀態變為錄音中', async () => {
    const { options } = makeOptions();
    const rec = createRecorder(options);
    expect(rec.state).toBe('idle');
    await rec.start();
    expect(rec.state).toBe('recording');
  });

  it('經過 5 秒後停止：回傳秒數 5 且產出音檔', async () => {
    const clock = { t: 1000 };
    const { options } = makeOptions({ clock });
    const rec = createRecorder(options);
    await rec.start();
    clock.t = 6000;
    const result = await rec.stop();
    expect(result.seconds).toBe(5);
    expect(result.audio).toBeInstanceOf(ArrayBuffer);
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(result.audioType).toBe('audio/webm');
    expect(rec.state).toBe('idle');
  });

  it('錄音中可以讀到正在往上數的秒數', async () => {
    const clock = { t: 0 };
    const { options } = makeOptions({ clock });
    const rec = createRecorder(options);
    expect(rec.elapsedSeconds()).toBe(0);
    await rec.start();
    clock.t = 3400;
    expect(rec.elapsedSeconds()).toBe(3);
    clock.t = 12000;
    expect(rec.elapsedSeconds()).toBe(12);
  });

  it('未授權麥克風：回傳明確錯誤，不當掉', async () => {
    const err = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
    const { options } = makeOptions({ fail: err });
    const rec = createRecorder(options);
    await expect(rec.start()).rejects.toBeInstanceOf(RecorderError);
    await rec.start().catch((e) => {
      expect(e.code).toBe('mic-denied');
      expect(e.message).toContain('麥克風');
    });
    expect(rec.state).toBe('idle');
  });

  it('找不到麥克風也是明確錯誤', async () => {
    const err = Object.assign(new Error('no device'), { name: 'NotFoundError' });
    const { options } = makeOptions({ fail: err });
    const rec = createRecorder(options);
    await rec.start().catch((e) => expect(e.code).toBe('mic-missing'));
  });

  it('瀏覽器不支援錄音：明確錯誤，不當掉', async () => {
    const rec = createRecorder({ getUserMedia: null, MediaRecorder: null, now: () => 0 });
    await rec.start().catch((e) => {
      expect(e.code).toBe('unsupported');
      expect(rec.state).toBe('idle');
    });
    await expect(rec.start()).rejects.toBeInstanceOf(RecorderError);
  });

  it('停止後會關掉麥克風，不會一直亮著', async () => {
    const stream = fakeStream();
    const { options } = makeOptions({ stream });
    const rec = createRecorder(options);
    await rec.start();
    await rec.stop();
    expect(stream.__track.stop).toHaveBeenCalled();
  });

  it('沒開始就停止：回傳零秒且沒有音檔，不報錯', async () => {
    const { options } = makeOptions();
    const rec = createRecorder(options);
    const result = await rec.stop();
    expect(result).toEqual({ seconds: 0, audio: null, audioType: null });
  });

  it('重複呼叫開始不會蓋掉正在進行的錄音', async () => {
    const clock = { t: 0 };
    const { options } = makeOptions({ clock });
    const rec = createRecorder(options);
    await rec.start();
    clock.t = 5000;
    await rec.start();
    clock.t = 8000;
    expect(rec.elapsedSeconds()).toBe(8);
  });
});

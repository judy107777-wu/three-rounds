import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 預設用 node 環境（啟動快）。需要 DOM 的測試檔在檔首加上：
    //   // @vitest-environment jsdom
    environment: 'node',
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    globals: false,
  },
});

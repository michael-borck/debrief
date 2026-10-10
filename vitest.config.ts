import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx,js}'],
    // Editing files on an exFAT/FAT external volume leaves behind `._name`
    // AppleDouble resource forks, which match the include glob above and fail
    // to parse. They're gitignored; exclude them here too so the suite is
    // green regardless of where the repo is checked out.
    exclude: ['**/node_modules/**', '**/dist/**', '**/._*'],
  },
});

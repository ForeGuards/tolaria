import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))
const mockVaultPath = process.env.VITE_INITIAL_MOCK_VAULT
  ?? path.join(repoRoot, 'demo-vault-v2')

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5365',
    headless: true,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `pnpm dev --port ${process.env.BASE_URL?.match(/:(\d+)/)?.[1] || '5365'}`,
    url: process.env.BASE_URL || 'http://localhost:5365',
    reuseExistingServer: true,
    env: { VITE_INITIAL_MOCK_VAULT: mockVaultPath },
  },
})

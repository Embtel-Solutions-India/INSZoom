import { seedFixtures, teardownFixtures } from './fixtures.js'

export default function globalSetup() {
  // Clear anything a previously-interrupted run left behind before seeding.
  teardownFixtures()
  const fixtures = seedFixtures()
  console.log(`[e2e] seeded fixture staff accounts (run ${fixtures.runId})`)
}

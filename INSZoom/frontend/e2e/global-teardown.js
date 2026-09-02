import { teardownFixtures } from './fixtures.js'

export default function globalTeardown() {
  const removed = teardownFixtures()
  console.log(`[e2e] removed fixture data: ${JSON.stringify(removed)}`)
}

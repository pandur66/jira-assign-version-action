import { test, expect, beforeAll } from 'vitest'
import { assignVersionToIssues, setSleep } from '../src/jira'

function makeRes(status: number, body: any, headers: Record<string, string> = {}) {
  return {
    message: { statusCode: status, headers },
    readBody: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as any
}

class FakeClient {
  private responses: any[]
  constructor(responses: any[]) {
    this.responses = responses
  }
  async request(method: string, url: string, data?: any, headers?: any) {
    // return next response
    const r = this.responses.shift()
    if (!r) throw new Error('No response configured')
    if (r instanceof Error) throw r
    return r
  }
}

test('dry-run returns updated issues list', async () => {
  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-1', 'ABC-2'],
    version: 'v1.0.0',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: true,
  }
  const res = await assignVersionToIssues(cfg as any)
  expect(res.updated).toEqual(['ABC-1', 'ABC-2'])
  expect(res.failed).toHaveLength(0)
})

beforeAll(() => {
  // make retry sleeps instant for tests
  setSleep(async () => Promise.resolve())
})

test('skips when version already present', async () => {
  const existingBody = {
    fields: { fixVersions: [{ id: '10', name: 'v1.2.3' }] },
  }
  // first response is GET -> returns existing version, no PUT will be attempted
  const client = new FakeClient([makeRes(200, existingBody)])

  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-3'],
    version: 'v1.2.3',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: false,
  }

  const res = await assignVersionToIssues(cfg as any, client as any)
  expect(res.skipped).toEqual(['ABC-3'])
  expect(res.updated).toHaveLength(0)
  expect(res.failed).toHaveLength(0)
})

test('retries on 429 then succeeds', async () => {
  // GET: issue has no versions
  const getBody = { fields: { fixVersions: [] } }
  // PUT responses: first 429 with Retry-After 0, then 204
  const client = new FakeClient([
    makeRes(200, getBody),
    makeRes(429, { error: 'rate' }, { 'retry-after': '0' }),
    makeRes(204, undefined),
  ])

  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-4'],
    version: 'v2.0.0',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: false,
    maxRetries: 3,
  }

  const res = await assignVersionToIssues(cfg as any, client as any)
  expect(res.updated).toEqual(['ABC-4'])
  expect(res.failed).toHaveLength(0)
})

test('fails after exhausting retries', async () => {
  // GET: no versions
  const getBody = { fields: { fixVersions: [] } }
  // PUT response: single 500 (we set maxRetries=1 to avoid long backoffs in test)
  const client = new FakeClient([makeRes(200, getBody), makeRes(500, { error: 'oops' })])

  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-5'],
    version: 'v9.9.9',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: false,
    maxRetries: 1,
  }

  const res = await assignVersionToIssues(cfg as any, client as any)
  expect(res.updated).toHaveLength(0)
  expect(res.failed).toHaveLength(1)
  expect(res.failed[0].issue).toBe('ABC-5')
})

test('client throws exception is reported as failed', async () => {
  // Fake client that throws on GET
  const client = new (class {
    async request() {
      throw new Error('network down')
    }
  })()

  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-6'],
    version: 'vx',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: false,
    maxRetries: 1,
  }

  const res = await assignVersionToIssues(cfg as any, client as any)
  expect(res.updated).toHaveLength(0)
  expect(res.failed).toHaveLength(1)
  expect(res.failed[0].issue).toBe('ABC-6')
})

test('concurrency: mixed responses across issues', async () => {
  // Simulate: ABC-7 GET empty -> PUT success; ABC-8 GET empty -> PUT 500; ABC-9 dry-run will just be updated
  // Use a client that returns responses based on issue key embedded in the URL
  const client = new (class {
    async request(method: string, url: string) {
      if (url.includes('ABC-7')) {
        // GET then PUT
        if (method === 'GET') return makeRes(200, { fields: { fixVersions: [] } })
        return makeRes(204, undefined)
      }
      if (url.includes('ABC-8')) {
        if (method === 'GET') return makeRes(200, { fields: { fixVersions: [] } })
        return makeRes(500, { error: 'x' })
      }
      if (url.includes('ABC-9')) {
        if (method === 'GET') return makeRes(200, { fields: { fixVersions: [] } })
        return makeRes(204, undefined)
      }
      return makeRes(404, { error: 'not found' })
    }
  })()
  const cfg = {
    baseUrl: 'https://example.atlassian.net',
    user: 'u',
    token: 't',
    issues: ['ABC-7', 'ABC-8', 'ABC-9'],
    version: 'vX',
    versionIsId: false,
    mode: 'fix' as const,
    dryRun: false,
    maxRetries: 1,
    concurrency: 3,
  }

  const res = await assignVersionToIssues(cfg as any, client as any)
  // ABC-7 and ABC-9 updated, ABC-8 failed
  expect(res.updated.sort()).toEqual(['ABC-7', 'ABC-9'].sort())
  expect(res.failed).toHaveLength(1)
  expect(res.failed[0].issue).toBe('ABC-8')
})

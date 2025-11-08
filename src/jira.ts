import * as core from '@actions/core'
import * as httpm from '@actions/http-client'
import pLimit from 'p-limit'

const USER_AGENT = 'jira-assign-version-action'

export interface JiraConfig {
  baseUrl: string
  user: string
  token: string
  issues: string[]
  version: string
  versionIsId: boolean
  mode: 'fix' | 'affected'
  dryRun: boolean
  concurrency?: number // optional limit of parallel requests
  maxRetries?: number // optional number of retry attempts
}

type Failure = { issue: string; error: string }

const sleep = (ms: number): Promise<void> => {
  return new Promise<void>((res) => setTimeout(res, ms))
}

const issueAlreadyHasVersion = (
  issueData: any,
  versionField: string,
  version: string,
  versionIsId: boolean,
): boolean => {
  const existing: any[] = issueData.fields && issueData.fields[versionField] ? issueData.fields[versionField] : []
  return existing.some((v: any) => (versionIsId ? v.id === version : v.name === version))
}

// allow tests to override sleep for fast retries
export let sleepFn: (ms: number) => Promise<void> = sleep
export const setSleep = (fn: (ms: number) => Promise<void>) => {
  sleepFn = fn
}

const requestWithRetry = async (
  client: httpm.HttpClient,
  method: string,
  url: string,
  body: any,
  headers: Record<string, string>,
  maxRetries = 4,
) => {
  let attempt = 0

  while (attempt <= maxRetries) {
    attempt++

    try {
      const res = await client.request(method, url, typeof body === 'string' ? body : JSON.stringify(body), headers)
      const status = res.message.statusCode || 0
      if (status >= 200 && status < 300) return res

      // For client errors other than 429, do not retry
      if (status >= 400 && status < 500 && status !== 429) return res

      // 429 or 5xx -> retry
      if (attempt >= maxRetries) return res

      const retryAfterHeader = (res.message.headers &&
        (res.message.headers['retry-after'] || res.message.headers['Retry-After'])) as string | undefined
      const waitSec = retryAfterHeader ? Number(retryAfterHeader) : Math.pow(2, attempt)
      core.info(`Request to ${url} got ${status}, retrying after ${waitSec}s (attempt ${attempt}/${maxRetries})`)

      await sleepFn(waitSec * 1000)
    } catch (err: any) {
      if (attempt >= maxRetries) throw err
      const backoff = Math.pow(2, attempt) * 1000
      core.info(`Request error: ${err.message}. Backing off ${backoff}ms (attempt ${attempt}/${maxRetries})`)
      await sleepFn(backoff)
    }
  }
}

export const assignVersionToIssues = async (
  config: JiraConfig,
  client?: httpm.HttpClient,
): Promise<{ updated: string[]; failed: Failure[]; skipped: string[] }> => {
  const { baseUrl, user, token, issues, version, versionIsId, mode, dryRun, concurrency = 4, maxRetries = 4 } = config

  client = client ?? new httpm.HttpClient(USER_AGENT)
  const updated: string[] = []
  const failed: Failure[] = []
  const skipped: string[] = []
  const field = mode === 'affected' ? 'affectedVersions' : 'fixVersions'

  const limit = pLimit(concurrency)

  const authHeader = `Basic ${Buffer.from(`${user}:${token}`).toString('base64')}`
  const commonHeaders = { 'Content-Type': 'application/json', Authorization: authHeader, Accept: 'application/json' }

  await Promise.all(
    issues.map((issue) =>
      limit(async () => {
        try {
          const issueUrl = `${baseUrl}/rest/api/3/issue/${issue}`

          if (dryRun) {
            core.info(
              `[DRY RUN] Would update ${issue} with ${field}: ${JSON.stringify(versionIsId ? { id: version } : { name: version })}`,
            )
            updated.push(issue)
            return
          }

          const getUrl = `${issueUrl}?fields=${field}`
          const getRes = await requestWithRetry(client!, 'GET', getUrl, undefined, commonHeaders, maxRetries)
          const getBody = await getRes!.readBody()
          let issueData: any = {}
          try {
            issueData = getBody ? JSON.parse(getBody) : {}
          } catch (e) {
            core.debug(`Failed to parse GET body for ${issue}: ${e}`)
          }

          if (issueAlreadyHasVersion(issueData, field, version, versionIsId)) {
            core.info(
              `Skipping ${issue}: already has ${field} ${versionIsId ? `(id:${version})` : `(name:${version})`}`,
            )
            skipped.push(issue)
            return
          }

          const versionField = versionIsId ? { id: version } : { name: version }
          const payload = { update: { [field]: [{ add: versionField }] } }

          const putRes = await requestWithRetry(client!, 'PUT', issueUrl, payload, commonHeaders, maxRetries)
          const status = putRes!.message.statusCode || 0
          if (status >= 200 && status < 300) {
            core.info(`Updated issue ${issue}`)
            updated.push(issue)
          } else {
            const body = await putRes!.readBody()
            core.warning(`Failed to update ${issue}: HTTP ${status}`)
            core.debug(body)
            failed.push({ issue, error: `HTTP ${status}: ${body}` })
          }
        } catch (err: any) {
          core.warning(`Error updating ${issue}: ${err.message}`)
          failed.push({ issue, error: err.message })
        }
      }),
    ),
  )

  return { updated, failed, skipped }
}

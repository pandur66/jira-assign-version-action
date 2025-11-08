import fs from 'fs'
import * as core from '@actions/core'
import { assignVersionToIssues } from './jira'

const readIssuesFromFile = (issuesFile: string): string[] => {
  let issues: string[] = []
  const content = fs.readFileSync(issuesFile, 'utf8')
  try {
    const parsed = JSON.parse(content)
    issues = parsed.map((i: any) => (typeof i === 'string' ? i : i.id))
  } catch {
    issues = content.split(/[\r\n,]+/).filter(Boolean)
  }
  return issues
}

const readIssuesFromInput = (issuesInput: string): string[] => {
  let issues: string[] = []
  try {
    const parsed = JSON.parse(issuesInput)
    issues = Array.isArray(parsed) ? parsed.map((i: any) => (typeof i === 'string' ? i : i.id)) : []
  } catch {
    issues = issuesInput.split(',').map((s) => s.trim())
  }
  return issues
}

const run = async () => {
  try {
    const baseUrl = core.getInput('jira-base-url', { required: true })
    const user = core.getInput('jira-user', { required: true })
    const token = core.getInput('jira-token', { required: true })
    const issuesInput = core.getInput('issues')
    const issuesFile = core.getInput('issues-file')
    const version = core.getInput('version', { required: true })
    const versionIsId = core.getBooleanInput('version-is-id')
    const mode = core.getInput('mode') === 'affected' ? 'affected' : 'fix'
    const dryRun = core.getBooleanInput('dry-run')
    const concurrency = parseInt(core.getInput('concurrency') || '4', 10)
    const maxRetries = parseInt(core.getInput('max-retries') || '4', 10)

    let issues: string[] = []

    if (issuesFile) {
      issues = readIssuesFromFile(issuesFile)
    } else if (issuesInput) {
      issues = readIssuesFromInput(issuesInput)
    } else {
      throw new Error("You must provide either 'issues' or 'issues-file'.")
    }

    core.info(`Mode: ${mode}`)
    core.info(`Issues: ${issues.join(', ')}`)
    core.info(`Version: ${version} (${versionIsId ? 'id' : 'name'})`)

    if (dryRun) core.info('Dry run enabled — no changes will be made.')

    core.setSecret(token)
    core.setSecret(user)

    const result = await assignVersionToIssues({
      baseUrl,
      user,
      token,
      issues,
      version,
      versionIsId,
      mode,
      dryRun,
      concurrency,
      maxRetries,
    })

    core.setOutput('updated-issues', result.updated.join(','))
    core.setOutput('failed-issues', JSON.stringify(result.failed))
    core.setOutput('skipped-issues', result.skipped.join(','))
    core.info(
      `Done. Updated ${result.updated.length} issues, skipped ${result.skipped.length}, failed ${result.failed.length}.`,
    )

    if (result.failed.length > 0) core.setFailed(`${result.failed.length} issues failed to update`)
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

run()

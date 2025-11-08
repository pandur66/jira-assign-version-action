# jira-assign-version-action

A GitHub Action that assigns a Jira version (by name or id) to one or more Jira issues using the Jira Cloud REST API. 

It is implemented in TypeScript and bundled to a single `dist/index.js` artifact for publishing.

## Installation

Use the action from GitHub Marketplace or directly from this repository:

```yaml
- uses: pandur66/jira-assign-version-action@v1
```

For more details and examples, see the [GitHub repository](https://github.com/pandur66/jira-assign-version-action).

## Features

- Assign a version to `fixVersions` or `affectedVersions` on one or many issues.
- Supports version by name or by id (`version-is-id`).
- Dry-run mode to preview changes.
- Idempotent updates: skips issues that already have the version.
- Retries with exponential backoff and respects `Retry-After` when provided by Jira.
- Concurrency control to avoid bursts that trigger rate limiting.

## Inputs

| Name           | Required | Description                                                                                                   |
| --------------- | -------: | ------------------------------------------------------------------------------------------------------------- |
| `jira-base-url` |      yes | Base URL of your Jira instance (e.g. `https://your-domain.atlassian.net`).                                    |
| `jira-user`     |      yes | Jira user/email for Basic Auth. Prefer to store in GitHub Secrets.                                            |
| `jira-token`    |      yes | Jira API token. Store in GitHub Secrets.                                                                      |
| `issues`        |       no | Comma-separated list or JSON array of issue keys (e.g. `PROJ-1,PROJ-2`) or a JSON array of objects with `id`. |
| `issues-file`   |       no | Path to a file containing issue keys or objects (JSON array, JSON-lines, plain list/CSV).                     |
| `version`       |      yes | Version name or ID to assign.                                                                                 |
| `version-is-id` |       no | If `true`, treats `version` input as an ID (default `false`).                                                 |
| `mode`          |       no | `fix` (default) to update `fixVersions` or `affected` to update `affectedVersions`.                           |
| `dry-run`       |       no | If `true`, simulates the assignment without making changes (default `false`).                                 |
| `concurrency`   |       no | Number of concurrent requests to Jira (default `4`). Tune to avoid rate limits.                               |
| `max-retries`   |       no | Max number of retry attempts for transient errors/429 (default `4`).                                          |

## Outputs

| Name           | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `updated-issues` | Comma-separated list of issue keys that were successfully updated.                         |
| `failed-issues`  | JSON array of objects `{ "issue": string, "error": string }` describing failures.          |
| `skipped-issues` | Comma-separated list of issues that already had the version and were skipped (idempotent). |

## Usage (GitHub Actions)

Assign a version to a small list of issues (dry run):

```yaml
name: Assign Jira Version

on: [workflow_dispatch]

jobs:
  assign-version:
    runs-on: ubuntu-latest
    steps:
      - name: Assign version to issues (dry run)
        uses: pandur66/jira-assign-version-action@v1
        with:
          jira-base-url: https://company.atlassian.net
          jira-user: ${{ secrets.JIRA_USER }}
          jira-token: ${{ secrets.JIRA_TOKEN }}
          issues: 'PROJ-1,PROJ-2'
          version: 'v1.2.0'
          dry-run: 'true'
```

Using an `issues-file` stored in the repository (JSON array, JSON-lines, or plain list):

```yaml
steps:
  - uses: actions/checkout@v4
  - name: Assign version from file
    uses: pandur66/jira-assign-version-action@v1
    with:
      jira-base-url: https://company.atlassian.net
      jira-user: ${{ secrets.JIRA_USER }}
      jira-token: ${{ secrets.JIRA_TOKEN }}
      issues-file: examples/issues.json
      version: 'v1.2.0'
```

## Local development

To run the action locally (TypeScript compiled or using the bundled file), set the corresponding `INPUT_` environment variables and run Node:

```bash
export INPUT_JIRA_BASE_URL="https://your-domain.atlassian.net"
export INPUT_JIRA_USER="you@example.com"
export INPUT_JIRA_TOKEN="your_api_token"
export INPUT_ISSUES='PROJ-1,PROJ-2'
export INPUT_VERSION='v1.2.0'
# run compiled action
node dist/index.js
```
Note: GitHub Actions converts dashed input names into uppercase env variables with `INPUT_` prefix (for example, `version` becomes `INPUT_VERSION`):

## Best practices

- Always store `jira-user` and `jira-token` in GitHub Secrets and avoid printing them.
- Lower `concurrency` or use higher `max-retries` if you hit Jira rate limits (HTTP 429).
- Use `dry-run` first to preview changes before applying them.

## Development & publishing

- The action targets Node 20 (see `action.yml`), compiles TypeScript into `dist/`, and bundles a single file using `@vercel/ncc` for publishing.
- Build: `npm run build`
- Bundle single file: `npm run bundle`
- Tests: `npm test` (uses `vitest`). Tests use a fast-path override for retry sleeps to run quickly.
- CI: a workflow runs lint/test/build on pushes and PRs (see `.github/workflows/ci.yml`).

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. To contribute:
1. Fork the repository at https://github.com/pandur66/jira-assign-version-action
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Note: CI will automatically run lint and build checks on your PR.


## License

MIT — Author: Bruno Ferreira

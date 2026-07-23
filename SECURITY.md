# Security policy

## Scope

SimClin AU is an educational prototype. Please do not include real patient
information, student identifiers, or production credentials in issues,
pull requests, fixtures, screenshots, or logs.

## Reporting a vulnerability

For a suspected credential leak or security issue, do not open a public issue.
Contact the repository maintainer privately, include the affected component,
reproduction steps, and whether any credential should be revoked immediately.

If a DeepSeek key is ever committed, revoke it first, then remove it from the
repository history and replace it with a new server-side secret.

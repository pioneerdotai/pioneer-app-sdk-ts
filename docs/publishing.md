# Public npm publication

Source and CI live at https://github.com/pioneerdotai/pioneer-app-sdk-ts.
The package is `@pioneercompany/app-sdk`, published publicly to
`https://registry.npmjs.org`. Installing it needs no authentication or custom
registry configuration. The previous local archive used `@pioneer/app-sdk`;
update imports when switching a consumer to the registry package. This setup
does not alter Terminal's already installed local archive.

## Workflow

`.github/workflows/package.yml` builds ESM/CJS on pull requests targeting main,
runs source tests and built-package acceptance tests, and saves the npm archive.
Pushes to main, including merged PRs, perform those checks and then publish the
tested archive. Publication uses npm Trusted Publishing through GitHub Actions
OIDC, not a stored npm token. Only the main-only publish job has id-token:write.
Pull requests and manual workflow runs do not publish. npm 11.21.0 is installed
in that job explicitly, and satisfies the OIDC minimum version. No NODE_AUTH_TOKEN,
NPM_TOKEN, personal GitHub token or GitHub Packages access is needed.

Every main push receives a unique version such as `0.1.0-main.42.1`: the base
version from package.json, workflow run number and attempt. The workflow does
not commit version changes or create tags. These are continuous main builds.
A successful build of the current main head updates npm's `latest` tag. Older
or superseded runs publish under the `main` tag without changing latest. A
retry gets a new attempt suffix. Both entry points are in the same archive.

## One-time maintainer setup

1. Own or create the `pioneercompany` scope on npmjs.com. The GitHub organization
   does not reserve the npm scope. Your npm account must have permission to
   create/publish packages in it, with interactive login and 2FA configured.
2. A package must exist before its Trusted Publisher settings can be configured.
   If `@pioneercompany/app-sdk` does not exist yet, perform the first publication
   once, locally, from a reviewed SDK checkout using an interactive npm session:

   ```sh
   bun install --frozen-lockfile
   bun run build
   bun x npm@11.21.0 login --registry=https://registry.npmjs.org
   bun x npm@11.21.0 publish --ignore-scripts --access public --registry=https://registry.npmjs.org
   ```

   Complete the browser/2FA prompts. This creates the initial source version,
   currently 0.1.0. Do not create a reusable publish token or store one in GitHub.
   If using an already packed archive, publish that reviewed archive explicitly;
   then rerun all CI jobs, not only the publish job, to generate a fresh version.
   Skip this step if you already manage this package on npm.
3. Put `.github/workflows/package.yml` and the SDK source in the GitHub repository.
   In npmjs.com → app-sdk → Settings → Trusted publishing, add GitHub Actions:

   | Field | Value |
   | --- | --- |
   | Organization or user | `pioneerdotai` |
   | Repository | `pioneer-app-sdk-ts` |
   | Workflow filename | `package.yml` (only the filename) |
   | Environment name | Leave empty; this workflow uses no GitHub environment |
   | Allowed actions | Enable direct `npm publish`, not only staging |

4. Merge a PR to main, or rerun all jobs of a failed main run, within two days
   after adding the trusted publisher. npm requires a first successful OIDC
   publication in this period to validate the repository identity; if it expires,
   delete and recreate the connection. Once validated, later main merges publish
   automatically. Changing the workflow filename requires a matching new npm
   trusted publisher configuration.
5. After successful OIDC publication, set the package's Publishing access to
   **Require two-factor authentication and disallow tokens**. Trusted publishing
   continues to work. Revoke an automation token or remove an NPM_TOKEN secret
   only if one was previously created for this SDK and is no longer used.

No repository secrets need to be added. GITHUB_TOKEN is supplied by GitHub and
only reads the current main commit to prevent older builds replacing latest.
The npm publish credential is short-lived and obtained through OIDC. For a public
package from this public repository, npm also generates provenance automatically.

## Install

```sh
bun add @pioneercompany/app-sdk
npm install @pioneercompany/app-sdk
pnpm add @pioneercompany/app-sdk
yarn add @pioneercompany/app-sdk
```

```ts
import { connectApp } from '@pioneercompany/app-sdk/client';
import { createAppServerContext } from '@pioneercompany/app-sdk/server';
```

No `.npmrc`, environment token or GitHub registry is needed by consumers.
For reproducible application builds, select an exact published version and
commit the consumer's dependency lockfile.

Official documentation:
- https://docs.npmjs.com/trusted-publishers/
- https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/

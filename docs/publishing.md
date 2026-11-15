# Public npm publication

Source and CI live at https://github.com/pioneerdotai/pioneer-app-sdk-ts.
The package is `@pioneercompany/app-sdk`, published publicly to
`https://registry.npmjs.org`. Installing it needs no authentication or custom
registry configuration. The previous local archive used `@pioneer/app-sdk`;
update imports when switching a consumer to the registry package. This setup
does not alter Terminal's already installed local archive.

## Workflow

`.github/workflows/package.yml` builds ESM/CJS on pull requests targeting main,
pushes/merges to main, and release tags. It runs source tests and built-package
acceptance tests and saves the npm archive. Only pushing a release tag such as
`v0.1.1` publishes that tested archive. Publication uses npm Trusted Publishing
through GitHub Actions OIDC, not a stored npm token. Only the tag-only publish
job has id-token:write. Branch pushes, PRs and manual workflow runs do not publish.
npm 11.21.0 is installed
in that job explicitly, and satisfies the OIDC minimum version. No NODE_AUTH_TOKEN,
NPM_TOKEN, personal GitHub token or GitHub Packages access is needed.

The version comes directly from package.json, and the tag must exactly match
`v` plus that version. Only stable `vX.Y.Z` tags are supported; malformed or
mismatched tags fail before compilation. There are no generated main versions,
automatic version commits or automatic Git tags. Both entry points are in the
same archive, published publicly under npm's `latest` tag. A published version
cannot be replaced; use a new version and tag for the next release.

## Release a version

1. Change package.json's version to the next release, for example `0.1.1`, in
   a PR and merge it to main. Other PRs may be merged before releasing.
2. Tag the desired main commit and push that tag:

   ```sh
   git fetch origin
   git tag v0.1.1 origin/main
   git push origin v0.1.1
   ```

3. Actions validates the version, builds, tests, packs and publishes `0.1.1`.
   Do not move an existing release tag. Rerunning a failed publish can reuse
   the tag if that version has not reached npm; an already published version
   cannot be published again.

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
   If using an already packed archive, publish that reviewed archive explicitly.
   The first automated release must use a new version and matching tag.
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

4. Push a new release tag, or rerun a failed tag publication, within two days
   after adding the trusted publisher. npm requires a first successful OIDC
   publication in this period to validate the repository identity; if it expires,
   delete and recreate the connection. Once validated, later release tags publish
   automatically; main merges only build/test. Changing the workflow filename requires a matching new npm
   trusted publisher configuration.
5. After successful OIDC publication, set the package's Publishing access to
   **Require two-factor authentication and disallow tokens**. Trusted publishing
   continues to work. Revoke an automation token or remove an NPM_TOKEN secret
   only if one was previously created for this SDK and is no longer used.

No repository secrets need to be added. The npm publish credential is short-lived
and obtained through OIDC. For a public
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

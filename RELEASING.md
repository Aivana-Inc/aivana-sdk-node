# Releasing

Publishing a GitHub Release publishes `@aivana/sdk` and `@aivana/cli` to npm.
No npm token is involved: npm trusts this repository's `publish.yml` directly
(trusted publishing), and every version gets a signed provenance record.

## 1. Bump the version, in a pull request

npm never accepts the same version twice, so every release starts with a bump.
The two packages are released together at the same version, and the CLI depends
on exactly that SDK version. From the repository root:

```bash
npm version patch      # or minor, major, or an exact version such as 0.7.0
```

This updates `package.json` and `package-lock.json`, then updates
`cli/package.json` to match: its own version and its `@aivana/sdk`
dependency. It doesn't commit or tag anything (see `.npmrc`). Commit those
files in a pull request and merge it once CI is green. CI fails if the four
version fields disagree.

## 2. Publish a GitHub Release

**Releases → Draft a new release**:

- **Tag:** `v` followed by the new version, for example `v0.6.5`, created on
  publish.
- **Target:** `main`.
- Optionally, **Generate release notes** to list the merged pull requests.

Then **Publish release**.

## 3. Watch the run

Actions → **Publish SDK and CLI**. The job:

1. runs the tests;
2. checks that the tag matches all four version fields, and stops before
   publishing anything if it doesn't;
3. publishes `@aivana/sdk`;
4. waits until npm serves that version, which can take several minutes;
5. publishes `@aivana/cli`.

If it fails partway, fix the cause and click **Re-run failed jobs**: a version
that is already on npm is skipped, not published twice. If the fix needs a code
change, merge it and release the next patch version instead.

## Keeping the two CLIs in step

`conformance/cli.json` is a byte-identical copy of the suite in
[aivana-sdk-python](https://github.com/Aivana-Inc/aivana-sdk-python). A change
to how the `aivana` command behaves updates the suite in both repositories, and
both SDKs are released so the two commands keep behaving the same.

## Deprecating a version

This needs a maintainer's npm login with two-factor authentication:

```bash
npm deprecate @aivana/sdk@<version> "<why, and what to use instead>"
npm deprecate @aivana/sdk@<version> ""   # an empty message removes the notice
```

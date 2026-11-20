# Agent Kit export fixture

`agent-kit-definition.json` is the output of Studio's actual
`exportDefinition('Help users', { ...defaultParams, system: 'Be clear', webSearch: false })`,
executed during this change on November 17, 2026. It also matches the existing
`definitionExport.test.ts` expected export. It contains no customer data.

Source: https://github.com/Aivana-Inc/aivana-ai-studio/blob/main/src/features/launchpad/mapping.ts
Contract: https://github.com/Aivana-Inc/aivana-intelligence-api/blob/main/docs/mmi-agent-blueprint-contract.md

This is a pinned compatibility fixture, not an automatic cross-repository drift check.
If the Studio export contract changes, regenerate this fixture with its exporter and
review the starter's supported subset before updating the tests.

# Contributing to gerdur-core

Contributions are welcome. Here's what you need to know.

## Prerequisites

- Node.js >= 12 (>= 18 recommended)
- npm or yarn
- A Deezer ARL token for any tests that hit the real API

## Getting Started

```bash
git clone https://github.com/soulwax/gerdur-core.git
cd gerdur-core
npm install
npm run build
```

## Development

```bash
npm run build     # Compile TypeScript → dist/
npm run lint      # ESLint check
npm test          # AVA test suite
```

## Making Changes

1. Fork the repo and create a branch off `main`.
2. Make your changes. If you're modifying API, converter, or metadata logic,
   add or update the relevant tests in `__tests__/`.
3. Run `npm run lint && npm test` — both must pass before opening a PR.
4. Open a pull request with a clear description of what changed and why.

## Project Layout

| Path | Purpose |
|------|---------|
| `src/index.ts` | Public API surface |
| `src/api/` | Deezer / Spotify / Tidal API clients |
| `src/lib/` | Shared utilities (crypto, HTTP helpers, etc.) |
| `src/converter/` | Format conversion helpers |
| `src/metadata-writer/` | Tag writing (ID3, FLAC, etc.) |
| `src/types/` | Shared TypeScript types (also published as `gerdur-core/types`) |
| `dist/` | Compiled output — do not edit directly |

This package is consumed by [`gerdur`](https://github.com/soulwax/gerdur)
and other services in the dabox/hexmusic ecosystem. Breaking changes to the
public API should be clearly noted in the PR and reflected in a semver bump.

## Commit Style

Prefer clear, imperative commit messages (`Fix token refresh for expired ARL`)
over vague ones (`fix stuff`). No strict convention enforced.

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

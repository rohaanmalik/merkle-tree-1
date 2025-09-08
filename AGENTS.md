# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Solidity contracts (e.g., `Merkle.sol`).
- `test/`: Forge tests (`*.t.sol`, e.g., `Merkle.t.sol`).
- `script/`: Forge deploy scripts (e.g., `Deploy.s.sol`).
- `scripts/`: TypeScript utilities for Merkle tree generation/verification.
- `generated/`, `out/`, `cache/`, `broadcast/`: Build and run artifacts (ignored by Git).
- Root files: `foundry.toml`, `tree.json` (generated), `.env` (secrets; ignored).

## Build, Test, and Development Commands
- Build contracts: `forge build`
- Run tests: `forge test -vvv` (use `--match-test <name>` to filter)
- Format Solidity: `forge fmt` (CI enforces `forge fmt --check`)
- Gas snapshot: `forge snapshot`
- Local node: `anvil`
- Deploy (example): `forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast` (requires `PRIVATE_KEY` and `MERKLE_ROOT` in `.env`)
- TypeScript scripts:
  - Compile: `npx tsc`
  - Generate tree: `node dist/generate.js`
  - Local verify: `node dist/verify.js`
  - On-chain verify: `node dist/contract-verify.js` (uses `RPC_URL`/`SEPOLIA_RPC_URL`)

## Coding Style & Naming Conventions
- Solidity: `pragma ^0.8.20`; use `forge fmt`; 4-space indentation; PascalCase files/contracts (`Merkle.sol`).
- Tests: file names `*.t.sol`; test functions prefixed with `test` (e.g., `test_Verify`).
- TypeScript: strict mode per `tsconfig.json`; keep `scripts/*.ts` kebab-case (e.g., `generate.ts`). Avoid committing `dist/`.

## Testing Guidelines
- Framework: Foundry (Forge). Keep tests deterministic and isolated.
- Run coverage (optional): `forge coverage --report lcov`
- Naming: one contract/system under test per file; helper logic in internal functions or separate contracts.
- Add representative proofs/roots to keep tests fast; avoid external RPC in unit tests.

## Commit & Pull Request Guidelines
- Commits: imperative mood (e.g., "Add Merkle verify test"). Optionally prefix scope (`feat:`, `fix:`, `chore:`).
- PRs: include a clear description, rationale, and test plan; link issues; attach relevant outputs (e.g., `forge test` logs, gas snapshot diffs, script output).
- CI must pass (format, build, tests). Do not commit secrets; `.env` stays local.

## Security & Configuration Tips
- `.env` keys commonly used: `PRIVATE_KEY`, `MERKLE_ROOT`, `RPC_URL`/`SEPOLIA_RPC_URL`.
- Verify remappings/solc in `foundry.toml` before upgrading dependencies.
- Prefer Anvil for local testing; avoid broadcasting transactions from unreviewed branches.

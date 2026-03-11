# Modernize CLI

A unified command-line tool that integrates [Flight Plans](https://github.com/microsoft/FlightPlans) governance into the GitHub Copilot modernization agent. Flight Plans are governance contracts that orchestrate AI-assisted modernization with quality gates, risk controls, and auditable artifacts.

This CLI wraps the existing `modernize.exe` agent and adds native `flightplan` subcommands, so teams can install, evaluate, and execute governed modernization scenarios from a single tool.

## Prerequisites

- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **modernize.exe** installed at `%LOCALAPPDATA%\Programs\modernize\modernize.exe` (or set `MODERNIZE_EXE_PATH`)
- **FlightPlans repository** cloned locally (or set `FLIGHTPLANS_REPO_PATH`)

## Installation

```bash
git clone https://github.com/rthorn17/modernize-cli.git
cd modernize-cli
npm install
npm run build
npm link
```

Once linked, the `modernize` command is available globally:

```bash
modernize --help
```

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `FLIGHTPLANS_REPO_PATH` | `~/Documents/GitHub Repos/FlightPlans` | Path to local FlightPlans repo clone |
| `MODERNIZE_EXE_PATH` | `%LOCALAPPDATA%\Programs\modernize\modernize.exe` | Path to the modernize agent binary |

## Commands

### Flight Plan Commands

#### `modernize flightplan list`

List all available scenarios from the Flight Plans catalog.

```bash
modernize flightplan list                  # Show all scenarios
modernize flightplan list --status active  # Only active scenarios
modernize flightplan list --status planned # Only planned scenarios
```

#### `modernize flightplan install <scenario>`

Install a Flight Plan into a project. Copies the full FlightPlanPackage (governance contract, skills, prompts, templates) and any shared assets into `.github/modernize/flightplans/<scenario>/`.

```bash
modernize flightplan install dotnet6-to-dotnet9
modernize flightplan install java8-to-java21 --source ./my-project
```

#### `modernize flightplan status`

Show the installed Flight Plan: scenario info, skills by phase, entry gate evaluation, required artifact status, and available orchestration steps.

```bash
modernize flightplan status
modernize flightplan status --source ./my-project
```

#### `modernize flightplan gates`

Evaluate all gate conditions (entry, output integrity, risk, exit) against the current project state. Returns a pass/fail table.

```bash
modernize flightplan gates                    # All gates
modernize flightplan gates --type entry       # Entry gates only
modernize flightplan gates --type exit        # Exit gates only
```

#### `modernize flightplan run <step>`

Display a Flight Plan orchestration prompt for a given step. Steps follow the 8-step governed workflow:

| Step | Purpose |
|---|---|
| `00-assess` | Assess the application |
| `01-vision` | Establish the migration vision |
| `02-roadmap` | Create the migration roadmap |
| `03-progress` | Create a progress tracker |
| `04-plan` | Queue work items |
| `05-spec` | Spec the next work item |
| `06-implement` | Implement the work item |
| `07-iterate` | Feedback and iterate |

```bash
modernize flightplan run 00-assess
modernize flightplan run 04-plan --source ./my-project
```

### Proxy Commands

These pass through directly to `modernize.exe`:

```bash
modernize assess --source ./my-project --verbose
modernize upgrade "Java 21" --source ./my-project
modernize plan create "Upgrade to .NET 9" --source ./my-project
modernize plan execute --source ./my-project
```

## Typical Workflow

```bash
# 1. Browse available flight plans
modernize flightplan list --status active

# 2. Install a flight plan into your project
modernize flightplan install dotnet6-to-dotnet9 --source ./my-app

# 3. Check entry gates and project readiness
modernize flightplan gates --type entry --source ./my-app

# 4. View the installed plan's status
modernize flightplan status --source ./my-app

# 5. Start the orchestration — run the assessment step
modernize flightplan run 00-assess --source ./my-app

# 6. Continue through the governed workflow
modernize flightplan run 01-vision --source ./my-app
modernize flightplan run 02-roadmap --source ./my-app
# ... steps 03-07

# 7. Use the modernize agent for upgrades
modernize upgrade ".NET 9" --source ./my-app

# 8. Verify exit gates pass
modernize flightplan gates --type exit --source ./my-app
```

## Project Structure

```
modernize-cli/
├── bin/run.js                          # CLI entry point
├── package.json                        # Dependencies and oclif config
├── tsconfig.json                       # TypeScript configuration
├── src/
│   ├── commands/
│   │   ├── flightplan/
│   │   │   ├── list.ts                 # List available scenarios
│   │   │   ├── install.ts              # Install a FlightPlanPackage
│   │   │   ├── status.ts              # Show installed plan status
│   │   │   ├── gates.ts               # Evaluate gate conditions
│   │   │   └── run.ts                 # Run an orchestration step
│   │   ├── plan/
│   │   │   ├── create.ts              # Proxy to modernize.exe
│   │   │   └── execute.ts             # Proxy to modernize.exe
│   │   ├── assess.ts                  # Proxy to modernize.exe
│   │   └── upgrade.ts                 # Proxy to modernize.exe
│   └── lib/
│       ├── types.ts                   # TypeScript interfaces
│       ├── catalog.ts                 # Parse scenario catalog from _index.md
│       ├── plan-parser.ts             # Parse flightplan.yaml files
│       ├── installer.ts               # Copy FlightPlanPackages into projects
│       ├── gate-evaluator.ts          # Evaluate gate conditions
│       └── proxy.ts                   # Spawn modernize.exe with passthrough args
└── dist/                               # Compiled output (generated by npm run build)
```

## How It Works

**Flight Plans as governance contracts:** Each scenario (e.g., `dotnet6-to-dotnet9`) is a FlightPlanPackage containing a `flightplan.yaml` governance contract, reusable skills (`SKILL.md` files), orchestration prompts (8-step workflow), and output templates. The governance contract defines:

- **Entry gates** — preconditions that must be true before work begins
- **Output integrity gates** — verify the AI produced required artifacts
- **Risk gates** — enforce thresholds (vulnerabilities, breaking changes)
- **Exit gates** — prove the migration is complete (build success, test pass rate, coverage)
- **Human controls** — mandatory pause points requiring human approval

**Install into a project:** `modernize flightplan install` copies the full package into `.github/modernize/flightplans/<scenario>/` within your project, resolving shared skills and templates from the FlightPlans repository.

**Evaluate gates:** `modernize flightplan gates` checks conditions like file existence (`artifact_exists`), project type detection (`.csproj`, `pom.xml`), and reports which gates pass or fail.

**Run orchestration:** `modernize flightplan run <step>` displays the prompt for each step in the 8-step workflow, which can be fed to an AI assistant to execute the governed modernization.

**Proxy to modernize.exe:** Commands like `assess`, `upgrade`, and `plan` pass through to the existing modernize agent binary, so all capabilities remain available from one CLI.

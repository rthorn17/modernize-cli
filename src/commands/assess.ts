import { Command } from '@oclif/core';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { proxyToModernize } from '../lib/proxy.js';
import { detectTechStack, matchScenarios } from '../lib/tech-detector.js';
import { installFlightPlan } from '../lib/installer.js';
import { getFlightPlansRepoPath } from '../lib/catalog.js';
import { generateModernizationPlan } from '../lib/plan-generator.js';
import type { ScenarioMatch } from '../lib/types.js';

export default class Assess extends Command {
  static override description =
    'Run assessment and generate summary report (proxied to modernize.exe). ' +
    'Use --with-flightplans to auto-discover and install matching Flight Plans.';

  static override strict = false;

  async run(): Promise<void> {
    const rawArgs = [...this.argv];

    // Extract our custom flags and strip them from the args forwarded to modernize.exe
    const withFlightPlans = this.consumeFlag(rawArgs, '--with-flightplans');
    const autoInstall = this.consumeFlag(rawArgs, '--auto-install');
    const registry = this.consumeFlagValue(rawArgs, '--registry') ?? this.consumeFlagValue(rawArgs, '-r');

    // Everything remaining goes to modernize.exe assess
    try {
      proxyToModernize(['assess', ...rawArgs]);
    } catch {
      // proxy sets process.exitCode on failure, continue with flight plan matching
    }

    // If --with-flightplans, run the enhanced workflow
    if (withFlightPlans) {
      const projectDir = this.findArgValue(rawArgs, '--source') ?? '.';
      const outputPath = this.findArgValue(rawArgs, '--output-path') ?? '.github/modernize/assessment';
      const repoPath = registry ?? getFlightPlansRepoPath();

      await this.runFlightPlanWorkflow(projectDir, outputPath, repoPath, autoInstall);
    }
  }

  // --- Flag parsing helpers (manual, to avoid oclif validation issues) ---

  /** Remove a boolean flag from args. Returns true if found. */
  private consumeFlag(args: string[], flag: string): boolean {
    const idx = args.indexOf(flag);
    if (idx !== -1) {
      args.splice(idx, 1);
      return true;
    }
    return false;
  }

  /** Remove a flag + its value from args. Returns the value or undefined. */
  private consumeFlagValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      const value = args[idx + 1];
      args.splice(idx, 2);
      return value;
    }
    if (idx !== -1) {
      args.splice(idx, 1);
    }
    return undefined;
  }

  /** Read a flag value from args WITHOUT removing it (for shared flags like --source). */
  private findArgValue(args: string[], flag: string): string | undefined {
    const idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
    }
    return undefined;
  }

  // --- Flight Plan Discovery Workflow ---

  private async runFlightPlanWorkflow(
    projectDir: string,
    assessmentOutputPath: string,
    repoPath: string,
    autoInstall: boolean,
  ): Promise<void> {
    // ── Step 1: Detect tech stack ──────────────────────────────────────
    this.log('');
    this.log(chalk.bold.cyan('=== Flight Plan Discovery ==='));
    this.log('');
    this.log(chalk.bold('Detecting project technology stack...'));

    const detections = detectTechStack(projectDir);

    if (detections.length === 0) {
      this.log(chalk.yellow('  No recognizable technology stack detected in ' + projectDir));
      return;
    }

    for (const d of detections) {
      this.log(
        `  ${chalk.green('detected')}  ${chalk.bold(d.repositoryType)}: ` +
        `${d.language}${d.framework ? ` ${d.framework}` : ''}` +
        `${d.frameworkVersion ? ` (v${d.frameworkVersion})` : ''}` +
        `${d.runtimeVersion ? ` runtime ${d.runtimeVersion}` : ''}`,
      );
      for (const e of d.evidence) {
        this.log(chalk.gray(`           ${e.file}: ${e.property} = ${e.value}`));
      }
    }

    // ── Step 2: Match against scenarios ────────────────────────────────
    this.log('');
    this.log(chalk.bold('Matching against Flight Plan scenarios...'));

    let matches: ScenarioMatch[];
    try {
      matches = matchScenarios(detections, repoPath);
    } catch (err) {
      this.log(chalk.red(`  Error matching scenarios: ${(err as Error).message}`));
      return;
    }

    if (matches.length === 0) {
      this.log(chalk.yellow('  No matching scenarios found in the Flight Plans catalog.'));
      return;
    }

    // ── Step 3: Display matches ────────────────────────────────────────
    this.log('');
    this.displayMatches(matches);

    // ── Step 4: User confirmation ──────────────────────────────────────
    let confirmed: ScenarioMatch[];
    if (autoInstall) {
      confirmed = matches;
      this.log(chalk.gray('  (--auto-install: selecting all matched scenarios)'));
    } else {
      confirmed = await this.confirmScenarios(matches);
    }

    if (confirmed.length === 0) {
      this.log(chalk.yellow('\n  No scenarios selected for installation.'));
      return;
    }

    // ── Step 5: Install flight plans ───────────────────────────────────
    this.log('');
    this.log(chalk.bold('Installing selected Flight Plans...'));

    const installed: Array<{
      scenarioName: string;
      plan: ReturnType<typeof installFlightPlan>['plan'];
      installedPath: string;
    }> = [];

    for (const match of confirmed) {
      try {
        const result = installFlightPlan(match.scenario.name, projectDir, repoPath);
        installed.push({
          scenarioName: match.scenario.name,
          plan: result.plan,
          installedPath: result.installedPath,
        });
        this.log(
          `  ${chalk.green('installed')}  ${match.scenario.name} v${result.plan.version}` +
          ` -> ${result.installedPath}`,
        );
      } catch (err) {
        this.log(
          `  ${chalk.red('FAILED')}     ${match.scenario.name}: ${(err as Error).message}`,
        );
      }
    }

    if (installed.length === 0) {
      this.log(chalk.red('\n  No flight plans were installed successfully.'));
      return;
    }

    // ── Step 6: Generate integrated plan ───────────────────────────────
    this.log('');
    this.log(chalk.bold('Generating integrated modernization plan...'));

    try {
      const planPath = generateModernizationPlan({
        projectDir,
        assessmentOutputPath,
        installedPlans: installed,
        detections,
        matches: confirmed,
      });
      this.log(`  ${chalk.green('Generated:')} ${planPath}`);
    } catch (err) {
      this.log(chalk.red(`  Error generating plan: ${(err as Error).message}`));
    }

    // ── Summary ────────────────────────────────────────────────────────
    this.log('');
    this.log(chalk.bold.green('Done!') + ` ${installed.length} flight plan(s) installed.`);
    this.log('');
    this.log(chalk.gray('Next steps:'));
    this.log(chalk.gray('  modernize flightplan status                # View installed plan status'));
    this.log(chalk.gray('  modernize flightplan gates --type entry    # Check entry gate readiness'));
    this.log(chalk.gray('  modernize flightplan run 00-assess         # Start orchestration'));
    this.log(chalk.gray('  cat .github/modernize/modernization-plan.md  # View full plan'));
  }

  private displayMatches(matches: ScenarioMatch[]): void {
    const highMatches = matches.filter(m => m.confidence === 'high');
    const medMatches = matches.filter(m => m.confidence === 'medium');
    const lowMatches = matches.filter(m => m.confidence === 'low');

    let idx = 1;

    if (highMatches.length > 0) {
      this.log(chalk.green.bold('  HIGH CONFIDENCE'));
      for (const m of highMatches) {
        this.log(`    ${chalk.bold(`[${idx}]`)} ${m.scenario.name} (v${m.plan.version})`);
        this.log(chalk.gray(`        ${m.scenario.description}`));
        this.log(chalk.gray(`        Matched: ${m.matchedProperties.join(', ')}`));
        idx++;
      }
    }

    if (medMatches.length > 0) {
      this.log(chalk.yellow.bold('  MEDIUM CONFIDENCE'));
      for (const m of medMatches) {
        this.log(`    ${chalk.bold(`[${idx}]`)} ${m.scenario.name} (v${m.plan.version})`);
        this.log(chalk.gray(`        ${m.scenario.description}`));
        this.log(chalk.gray(`        Matched: ${m.matchedProperties.join(', ')}`));
        idx++;
      }
    }

    if (lowMatches.length > 0) {
      this.log(chalk.gray.bold('  LOW CONFIDENCE'));
      for (const m of lowMatches) {
        this.log(`    ${chalk.bold(`[${idx}]`)} ${m.scenario.name} (v${m.plan.version})`);
        this.log(chalk.gray(`        ${m.scenario.description}`));
        this.log(chalk.gray(`        Matched: ${m.matchedProperties.join(', ')}`));
        idx++;
      }
    }
  }

  private async confirmScenarios(matches: ScenarioMatch[]): Promise<ScenarioMatch[]> {
    // If not a TTY, can't prompt — return empty
    if (!process.stdin.isTTY) {
      this.log(chalk.yellow('  Non-interactive terminal detected. Use --auto-install to install automatically.'));
      return [];
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<ScenarioMatch[]>((resolve) => {
      rl.question(
        chalk.bold('\nSelect scenarios to install (comma-separated numbers, "all", or "none"): '),
        (answer) => {
          rl.close();
          const trimmed = answer.trim().toLowerCase();

          if (trimmed === 'none' || trimmed === '' || trimmed === 'n') {
            resolve([]);
            return;
          }

          if (trimmed === 'all' || trimmed === 'a') {
            resolve(matches);
            return;
          }

          const indices = trimmed
            .split(',')
            .map(s => parseInt(s.trim(), 10) - 1)
            .filter(i => i >= 0 && i < matches.length);

          if (indices.length === 0) {
            this.log(chalk.yellow('  No valid selections. Skipping installation.'));
            resolve([]);
            return;
          }

          resolve(indices.map(i => matches[i]));
        },
      );
    });
  }
}

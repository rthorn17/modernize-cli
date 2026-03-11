import { Command } from '@oclif/core';
import * as readline from 'node:readline';
import chalk from 'chalk';
import { proxyToModernize } from '../lib/proxy.js';
import { detectTechStack, matchScenarios } from '../lib/tech-detector.js';
import { installFlightPlan } from '../lib/installer.js';
import { getFlightPlansRepoPath } from '../lib/catalog.js';
import { generateModernizationPlan } from '../lib/plan-generator.js';
import { scaffoldFlightPlan, suggestScenarioName, validateScenarioName } from '../lib/scaffolder.js';
import type { FlightPlan, ScenarioMatch, TechStackDetection } from '../lib/types.js';

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

    // ── Step 3: Display matches ────────────────────────────────────────
    this.log('');
    if (matches.length > 0) {
      this.displayMatches(matches);
    } else {
      this.log(chalk.yellow('  No matching scenarios found in the Flight Plans catalog.'));
    }

    // Always show the "Create New" option (even if no matches)
    this.log('');
    this.log(chalk.cyan.bold('  CREATE NEW'));
    this.log(`    ${chalk.bold('[C]')} Create a NEW flight plan tailored to your detected tech stack`);

    // ── Step 4: User confirmation ──────────────────────────────────────
    const installed: Array<{
      scenarioName: string;
      plan: FlightPlan;
      installedPath: string;
    }> = [];

    if (autoInstall) {
      // Auto-install selects all matches but does NOT scaffold
      if (matches.length > 0) {
        this.log(chalk.gray('  (--auto-install: selecting all matched scenarios)'));
      }
    } else {
      const result = await this.confirmScenariosWithCreate(matches);

      // Install selected catalog scenarios
      if (result.selected.length > 0) {
        this.log('');
        this.log(chalk.bold('Installing selected Flight Plans...'));

        for (const match of result.selected) {
          try {
            const installResult = installFlightPlan(match.scenario.name, projectDir, repoPath);
            installed.push({
              scenarioName: match.scenario.name,
              plan: installResult.plan,
              installedPath: installResult.installedPath,
            });
            this.log(
              `  ${chalk.green('installed')}  ${match.scenario.name} v${installResult.plan.version}` +
              ` -> ${installResult.installedPath}`,
            );
          } catch (err) {
            this.log(
              `  ${chalk.red('FAILED')}     ${match.scenario.name}: ${(err as Error).message}`,
            );
          }
        }
      }

      // Scaffold new flight plans if requested
      if (result.createNew) {
        const scaffolded = await this.runScaffoldWorkflow(detections, projectDir);
        installed.push(...scaffolded);
      }

      if (installed.length === 0) {
        this.log(chalk.yellow('\n  No flight plans installed or scaffolded.'));
        return;
      }
    }

    // For --auto-install path, install all matches
    if (autoInstall && matches.length > 0) {
      this.log('');
      this.log(chalk.bold('Installing selected Flight Plans...'));

      for (const match of matches) {
        try {
          const installResult = installFlightPlan(match.scenario.name, projectDir, repoPath);
          installed.push({
            scenarioName: match.scenario.name,
            plan: installResult.plan,
            installedPath: installResult.installedPath,
          });
          this.log(
            `  ${chalk.green('installed')}  ${match.scenario.name} v${installResult.plan.version}` +
            ` -> ${installResult.installedPath}`,
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
        matches: matches.filter(m =>
          installed.some(i => i.scenarioName === m.scenario.name),
        ),
      });
      this.log(`  ${chalk.green('Generated:')} ${planPath}`);
    } catch (err) {
      this.log(chalk.red(`  Error generating plan: ${(err as Error).message}`));
    }

    // ── Summary ────────────────────────────────────────────────────────
    const scaffoldedCount = installed.filter(i =>
      !matches.some(m => m.scenario.name === i.scenarioName),
    ).length;
    const catalogCount = installed.length - scaffoldedCount;

    this.log('');
    this.log(
      chalk.bold.green('Done!') +
      ` ${catalogCount} flight plan(s) installed` +
      (scaffoldedCount > 0 ? `, ${scaffoldedCount} custom plan(s) scaffolded.` : '.'),
    );
    this.log('');
    this.log(chalk.gray('Next steps:'));
    this.log(chalk.gray('  modernize flightplan status                # View installed plan status'));
    this.log(chalk.gray('  modernize flightplan gates --type entry    # Check entry gate readiness'));
    this.log(chalk.gray('  modernize flightplan run 00-assess         # Start orchestration'));
    this.log(chalk.gray('  cat .github/modernize/modernization-plan.md  # View full plan'));
  }

  // --- Display ---

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

  // --- Interactive confirmation with Create option ---

  private async confirmScenariosWithCreate(
    matches: ScenarioMatch[],
  ): Promise<{ selected: ScenarioMatch[]; createNew: boolean }> {
    if (!process.stdin.isTTY) {
      this.log(chalk.yellow('  Non-interactive terminal detected. Use --auto-install to install automatically.'));
      return { selected: [], createNew: false };
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<{ selected: ScenarioMatch[]; createNew: boolean }>((resolve) => {
      const prompt = matches.length > 0
        ? chalk.bold('\nSelect scenarios to install (comma-separated numbers, "all", "none", or "C" to create new): ')
        : chalk.bold('\nEnter "C" to create a new flight plan, or "none" to skip: ');

      rl.question(prompt, (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();

        if (trimmed === 'none' || trimmed === '' || trimmed === 'n') {
          resolve({ selected: [], createNew: false });
          return;
        }

        if (trimmed === 'c' || trimmed === 'create') {
          resolve({ selected: [], createNew: true });
          return;
        }

        if (trimmed === 'all' || trimmed === 'a') {
          resolve({ selected: matches, createNew: false });
          return;
        }

        // Parse comma-separated tokens: numbers map to scenarios, "c" triggers create
        const tokens = trimmed.split(',').map(s => s.trim());
        let createNew = false;
        const indices: number[] = [];

        for (const token of tokens) {
          if (token === 'c' || token === 'create') {
            createNew = true;
          } else {
            const num = parseInt(token, 10) - 1;
            if (num >= 0 && num < matches.length) {
              indices.push(num);
            }
          }
        }

        if (indices.length === 0 && !createNew) {
          this.log(chalk.yellow('  No valid selections. Skipping.'));
          resolve({ selected: [], createNew: false });
          return;
        }

        resolve({
          selected: indices.map(i => matches[i]),
          createNew,
        });
      });
    });
  }

  // --- Scaffold workflow ---

  private async runScaffoldWorkflow(
    detections: TechStackDetection[],
    projectDir: string,
  ): Promise<Array<{ scenarioName: string; plan: FlightPlan; installedPath: string }>> {
    const results: Array<{ scenarioName: string; plan: FlightPlan; installedPath: string }> = [];

    // Pick which detection to base the scaffold on
    let detection = detections[0];
    if (detections.length > 1) {
      this.log('');
      this.log(chalk.bold('Multiple tech stacks detected. Which should the new flight plan target?'));
      for (let i = 0; i < detections.length; i++) {
        const d = detections[i];
        this.log(`  [${i + 1}] ${d.repositoryType}: ${d.language}${d.framework ? ` ${d.framework}` : ''}`);
      }
      const choice = await this.promptForValue('  Select (default 1): ', '1');
      const idx = parseInt(choice, 10) - 1;
      if (idx >= 0 && idx < detections.length) {
        detection = detections[idx];
      }
    }

    let continueCreating = true;
    while (continueCreating) {
      this.log('');
      this.log(chalk.bold.cyan('Creating a new Flight Plan scaffold...'));
      this.log('');

      const techSummary =
        `${detection.repositoryType} / ${detection.language}` +
        (detection.framework ? ` / ${detection.framework}` : '') +
        (detection.frameworkVersion ? ` v${detection.frameworkVersion}` : '');
      this.log(`  Detected tech: ${chalk.cyan(techSummary)}`);
      this.log('');

      const suggestedName = suggestScenarioName(detection);
      const chosenName = await this.promptForValue(
        `  Suggested scenario name: ${chalk.bold(suggestedName)}\n  Enter scenario name (or press Enter to accept): `,
        suggestedName,
      );

      const validation = validateScenarioName(chosenName, projectDir);
      if (!validation.valid) {
        this.log(chalk.red(`  Invalid name: ${validation.reason}`));
        continue;
      }

      this.log('');
      this.log(`  Scaffolding flight plan: ${chalk.bold(chosenName)}`);

      try {
        const result = scaffoldFlightPlan({
          scenarioName: chosenName,
          projectDir,
          detection,
        });

        for (const file of result.createdFiles) {
          this.log(`    ${chalk.green('created')}  ${file}`);
        }

        results.push({
          scenarioName: chosenName,
          plan: result.plan,
          installedPath: result.installedPath,
        });

        this.log('');
        this.log(
          `  ${chalk.green('Scaffolded:')} ${chosenName} v${result.plan.version}` +
          ` -> ${result.installedPath}`,
        );
      } catch (err) {
        this.log(chalk.red(`  Failed to scaffold: ${(err as Error).message}`));
      }

      const another = await this.promptForValue(
        '\n  Create another flight plan? (y/N): ',
        'n',
      );
      continueCreating = another.toLowerCase() === 'y' || another.toLowerCase() === 'yes';
    }

    return results;
  }

  // --- Readline helper ---

  private async promptForValue(prompt: string, defaultValue: string): Promise<string> {
    if (!process.stdin.isTTY) return defaultValue;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise<string>((resolve) => {
      rl.question(prompt, (answer) => {
        rl.close();
        const trimmed = answer.trim();
        resolve(trimmed || defaultValue);
      });
    });
  }
}

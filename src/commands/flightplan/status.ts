import { Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { findInstalledPlan, parsePlan } from '../../lib/plan-parser.js';
import { evaluateGates } from '../../lib/gate-evaluator.js';
import type { InstalledPlan } from '../../lib/types.js';

export default class FlightplanStatus extends Command {
  static override description = 'Show the installed Flight Plan and gate status';

  static override flags = {
    source: Flags.string({
      description: 'Path to the target project',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FlightplanStatus);
    const projectDir = flags.source;

    const yamlPath = findInstalledPlan(projectDir);
    if (!yamlPath) {
      this.log('');
      this.log(chalk.yellow('  No Flight Plan installed in this project.'));
      this.log(chalk.gray('  Run "modernize flightplan install <scenario>" to install one.'));
      this.log('');
      return;
    }

    const plan = parsePlan(yamlPath);
    const planDir = path.dirname(yamlPath);

    // Read install metadata if available
    const metadataPath = path.join(planDir, '.install-metadata.json');
    let metadata: InstalledPlan | null = null;
    if (fs.existsSync(metadataPath)) {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    }

    this.log('');
    this.log(chalk.bold('Flight Plan Status'));
    this.log('');
    this.log(`  ${chalk.gray('Scenario:')}    ${chalk.white.bold(plan.scenario)}`);
    this.log(`  ${chalk.gray('Version:')}     ${plan.version}`);
    if (metadata) {
      this.log(`  ${chalk.gray('Installed:')}   ${metadata.installedAt}`);
    }
    this.log(`  ${chalk.gray('Location:')}    ${planDir}`);
    this.log('');

    // Intent
    this.log(chalk.bold('  Intent:'));
    this.log(`    ${chalk.gray(plan.intent.trim())}`);
    this.log('');

    // Skills by phase
    const phases = new Map<string, typeof plan.skills>();
    for (const skill of plan.skills) {
      const list = phases.get(skill.phase) ?? [];
      list.push(skill);
      phases.set(skill.phase, list);
    }
    this.log(chalk.bold('  Skills:'));
    for (const [phase, skills] of phases) {
      this.log(`    ${chalk.cyan(phase)} (${skills.length})`);
      for (const s of skills) {
        const loc = s.location === 'shared' ? chalk.gray(' [shared]') : '';
        this.log(`      - ${s.id} v${s.version}${loc}`);
      }
    }
    this.log('');

    // Quick gate check (entry gates only)
    this.log(chalk.bold('  Entry Gate Check:'));
    const entryResults = evaluateGates(plan, projectDir, ['entry']);
    for (const result of entryResults) {
      const icon = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
      this.log(`    ${icon}  ${result.name}`);
      if (result.reason) {
        this.log(`          ${chalk.gray(result.reason)}`);
      }
    }
    this.log('');

    // Required artifacts
    this.log(chalk.bold('  Required Artifacts:'));
    for (const artifact of plan.required_artifacts) {
      const exists = fs.existsSync(path.join(projectDir, artifact.name));
      const icon = exists ? chalk.green('found') : chalk.gray('missing');
      this.log(`    [${icon}] ${artifact.name}`);
    }
    this.log('');

    // Orchestration steps
    const promptsDir = path.join(planDir, 'Prompts');
    if (fs.existsSync(promptsDir)) {
      const prompts = fs.readdirSync(promptsDir)
        .filter(f => f.endsWith('.prompt.md'))
        .sort();
      this.log(chalk.bold('  Orchestration Steps:'));
      for (const p of prompts) {
        const step = p.replace('.prompt.md', '');
        this.log(`    - ${step}`);
      }
      this.log('');
      this.log(chalk.gray('  Run "modernize flightplan run <step>" to execute a step.'));
    }
    this.log('');
  }
}

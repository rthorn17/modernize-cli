import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { findInstalledPlan, parsePlan } from '../../lib/plan-parser.js';
import { evaluateGates } from '../../lib/gate-evaluator.js';

type GateCategory = 'entry' | 'output_integrity' | 'risk' | 'exit';

export default class FlightplanGates extends Command {
  static override description = 'Evaluate Flight Plan gate conditions against the project';

  static override flags = {
    type: Flags.string({
      char: 't',
      description: 'Gate category to evaluate',
      options: ['entry', 'output_integrity', 'risk', 'exit', 'all'],
      default: 'all',
    }),
    source: Flags.string({
      description: 'Path to the target project',
      default: '.',
    }),
  };

  static override examples = [
    'modernize flightplan gates',
    'modernize flightplan gates --type entry',
    'modernize flightplan gates --type exit --source ./my-project',
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(FlightplanGates);
    const projectDir = flags.source;

    const yamlPath = findInstalledPlan(projectDir);
    if (!yamlPath) {
      this.error('No Flight Plan installed. Run "modernize flightplan install <scenario>" first.');
    }

    const plan = parsePlan(yamlPath);
    const categories: GateCategory[] | undefined =
      flags.type === 'all'
        ? undefined
        : [flags.type as GateCategory];

    const results = evaluateGates(plan, projectDir, categories);

    this.log('');
    this.log(chalk.bold(`Gate Evaluation — ${plan.scenario} v${plan.version}`));
    this.log('');

    let currentCategory = '';
    let passCount = 0;
    let failCount = 0;

    for (const result of results) {
      if (result.category !== currentCategory) {
        currentCategory = result.category;
        const label = currentCategory.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
        this.log(chalk.cyan.bold(`  ${label} Gates`));
      }

      if (result.passed) {
        passCount++;
        this.log(`    ${chalk.green('PASS')}  ${result.name}`);
      } else {
        failCount++;
        this.log(`    ${chalk.red('FAIL')}  ${result.name}`);
      }
      this.log(`          ${chalk.gray(result.description)}`);
      if (result.reason) {
        this.log(`          ${chalk.dim(result.reason)}`);
      }
    }

    this.log('');
    this.log(chalk.bold('  Summary:'));
    this.log(`    ${chalk.green(`${passCount} passed`)}  ${chalk.red(`${failCount} failed`)}  ${chalk.gray(`${results.length} total`)}`);
    this.log('');
  }
}

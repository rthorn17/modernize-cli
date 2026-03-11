import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { installFlightPlan } from '../../lib/installer.js';
import { getFlightPlansRepoPath } from '../../lib/catalog.js';

export default class FlightplanInstall extends Command {
  static override description = 'Install a Flight Plan into the current project';

  static override args = {
    scenario: Args.string({
      description: 'Scenario name (e.g., dotnet6-to-dotnet9, java8-to-java21)',
      required: true,
    }),
  };

  static override flags = {
    source: Flags.string({
      description: 'Path to the target project',
      default: '.',
    }),
    registry: Flags.string({
      char: 'r',
      description: 'Path to FlightPlans repository',
    }),
  };

  static override examples = [
    'modernize flightplan install dotnet6-to-dotnet9',
    'modernize flightplan install java8-to-java21 --source ./my-project',
  ];

  async run(): Promise<void> {
    const { args, flags } = await this.parse(FlightplanInstall);
    const repoPath = flags.registry ?? getFlightPlansRepoPath();
    const projectDir = flags.source;

    this.log('');
    this.log(chalk.bold(`Installing Flight Plan: ${args.scenario}`));
    this.log('');

    try {
      const { installedPath, plan } = installFlightPlan(args.scenario, projectDir, repoPath);

      this.log(chalk.green('  Flight Plan installed successfully'));
      this.log('');
      this.log(`  ${chalk.gray('Scenario:')}    ${plan.scenario}`);
      this.log(`  ${chalk.gray('Version:')}     ${plan.version}`);
      this.log(`  ${chalk.gray('Installed to:')} ${installedPath}`);
      this.log('');

      // Show skills by phase
      const phases = new Map<string, string[]>();
      for (const skill of plan.skills) {
        const list = phases.get(skill.phase) ?? [];
        list.push(skill.id);
        phases.set(skill.phase, list);
      }

      this.log(chalk.bold('  Skills:'));
      for (const [phase, skills] of phases) {
        this.log(`    ${chalk.cyan(phase)}`);
        for (const s of skills) {
          this.log(`      - ${s}`);
        }
      }
      this.log('');

      // Show gate counts
      const gateCount =
        plan.gates.entry.length +
        plan.gates.output_integrity.length +
        plan.gates.risk.length +
        plan.gates.exit.length;
      this.log(chalk.bold('  Gates:'));
      this.log(`    Entry:            ${plan.gates.entry.length}`);
      this.log(`    Output Integrity: ${plan.gates.output_integrity.length}`);
      this.log(`    Risk:             ${plan.gates.risk.length}`);
      this.log(`    Exit:             ${plan.gates.exit.length}`);
      this.log(`    ${chalk.gray(`Total: ${gateCount} gates`)}`);
      this.log('');

      // Show human controls
      if (plan.human_controls.length > 0) {
        this.log(chalk.bold('  Human Controls:'));
        for (const hc of plan.human_controls) {
          this.log(`    - ${chalk.yellow(hc.trigger)}: ${hc.description}`);
        }
        this.log('');
      }

      this.log(chalk.gray('  Run "modernize flightplan status" to see gate evaluation.'));
      this.log(chalk.gray('  Run "modernize flightplan run 00-assess" to start the orchestration.'));
    } catch (err) {
      this.error((err as Error).message);
    }
  }
}

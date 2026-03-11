import { Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import { listScenarios, getFlightPlansRepoPath } from '../../lib/catalog.js';

export default class FlightplanList extends Command {
  static override description = 'List available Flight Plan scenarios from the catalog';

  static override flags = {
    status: Flags.string({
      char: 's',
      description: 'Filter by status',
      options: ['active', 'planned', 'all'],
      default: 'all',
    }),
    registry: Flags.string({
      char: 'r',
      description: 'Path to FlightPlans repository',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FlightplanList);
    const repoPath = flags.registry ?? getFlightPlansRepoPath();

    try {
      let scenarios = listScenarios(repoPath);

      if (flags.status !== 'all') {
        const filterStatus = flags.status === 'active' ? 'Active' : 'Planned';
        scenarios = scenarios.filter(s => s.status === filterStatus);
      }

      if (scenarios.length === 0) {
        this.log('No scenarios found.');
        return;
      }

      this.log('');
      this.log(chalk.bold('Available Flight Plan Scenarios'));
      this.log(chalk.gray(`Source: ${repoPath}`));
      this.log('');

      // Group by category
      const grouped = new Map<string, typeof scenarios>();
      for (const s of scenarios) {
        const list = grouped.get(s.category) ?? [];
        list.push(s);
        grouped.set(s.category, list);
      }

      for (const [category, items] of grouped) {
        this.log(chalk.cyan.bold(`  ${category}`));
        for (const item of items) {
          const statusBadge = item.status === 'Active'
            ? chalk.green('Active ')
            : chalk.yellow('Planned');
          this.log(`    ${statusBadge}  ${chalk.white.bold(item.name)}`);
          this.log(`             ${chalk.gray(item.description)}`);
        }
        this.log('');
      }

      const activeCount = scenarios.filter(s => s.status === 'Active').length;
      const plannedCount = scenarios.filter(s => s.status === 'Planned').length;
      this.log(chalk.gray(`  ${activeCount} active, ${plannedCount} planned scenarios`));
    } catch (err) {
      this.error((err as Error).message);
    }
  }
}

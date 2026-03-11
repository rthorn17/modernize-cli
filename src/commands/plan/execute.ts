import { Command } from '@oclif/core';
import { proxyToModernize } from '../../lib/proxy.js';

export default class PlanExecute extends Command {
  static override description = 'Execute a modernization plan (proxied to modernize.exe)';
  static override strict = false;

  async run(): Promise<void> {
    const rawArgs = this.argv;
    proxyToModernize(['plan', 'execute', ...rawArgs]);
  }
}

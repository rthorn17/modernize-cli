import { Command } from '@oclif/core';
import { proxyToModernize } from '../../lib/proxy.js';

export default class PlanCreate extends Command {
  static override description = 'Create a modernization plan (proxied to modernize.exe)';
  static override strict = false;

  async run(): Promise<void> {
    const rawArgs = this.argv;
    proxyToModernize(['plan', 'create', ...rawArgs]);
  }
}

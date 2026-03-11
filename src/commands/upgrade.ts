import { Command } from '@oclif/core';
import { proxyToModernize } from '../lib/proxy.js';

export default class Upgrade extends Command {
  static override description = 'Upgrade Java or .NET project(s) to target version (proxied to modernize.exe)';
  static override strict = false;

  async run(): Promise<void> {
    const rawArgs = this.argv;
    proxyToModernize(['upgrade', ...rawArgs]);
  }
}

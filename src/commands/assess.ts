import { Command } from '@oclif/core';
import { proxyToModernize } from '../lib/proxy.js';

export default class Assess extends Command {
  static override description = 'Run assessment and generate summary report (proxied to modernize.exe)';
  static override strict = false;

  async run(): Promise<void> {
    // Skip oclif parsing entirely — pass raw args to modernize.exe
    const rawArgs = this.argv;
    proxyToModernize(['assess', ...rawArgs]);
  }
}

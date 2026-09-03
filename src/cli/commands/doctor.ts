import type { Command } from 'commander';
import { mkdir } from 'node:fs/promises';
import { access } from 'node:fs/promises';
import { config } from '../../config/env.js';
import { checkFfmpeg, checkFfprobe } from '../../providers/audio/ffmpeg-provider.js';
import { checkYtDlp } from '../../providers/audio/yt-dlp-provider.js';
import { EssentiaRuntime } from '../../providers/music-analysis/essentia/essentia-loader.js';
import { PythonMirWorker } from '../../providers/music-analysis/python/python-worker.js';
import {
  llmCredentialsAvailable,
  resolveAgentModelConfig,
  resolveGoogleCloudLocation,
  resolveGoogleCloudProject,
  resolveModelProvider,
} from '../../providers/llm/config.js';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check environment: node, storage, ffmpeg, yt-dlp')
    .action(async () => {
      const checks: Check[] = [];

      checks.push({
        name: 'Node',
        ok: Number(process.versions.node.split('.')[0]) >= 20,
        detail: process.versions.node,
      });

      try {
        await mkdir(config.songsDir, { recursive: true });
        await access(config.dataDir);
        checks.push({ name: 'Storage', ok: true, detail: config.dataDir });
      } catch {
        checks.push({ name: 'Storage', ok: false, detail: config.dataDir });
      }

      try {
        checks.push({ name: 'ffmpeg', ok: true, detail: await checkFfmpeg() });
      } catch {
        checks.push({ name: 'ffmpeg', ok: false });
      }
      try {
        checks.push({ name: 'ffprobe', ok: true, detail: await checkFfprobe() });
      } catch {
        checks.push({ name: 'ffprobe', ok: false });
      }

      try {
        checks.push({ name: 'yt-dlp', ok: true, detail: await checkYtDlp() });
      } catch {
        checks.push({ name: 'yt-dlp', ok: false });
      }

      try {
        EssentiaRuntime.getInstance();
        checks.push({ name: 'Essentia', ok: true, detail: `music analyzer v${EssentiaRuntime.version()}` });
      } catch (err) {
        checks.push({
          name: 'Essentia',
          ok: false,
          detail: `music analyzer unavailable: ${(err as Error).message}`,
        });
      }

      try {
        const worker = new PythonMirWorker();
        const report = await worker.doctor();
        for (const component of report.components) {
          const label = `MIR ${component.name}`;
          checks.push({
            name: label,
            ok: component.ok,
            detail: component.ok ? `v${component.version}` : (component.error ?? 'unavailable'),
          });
        }
      } catch (err) {
        checks.push({
          name: 'Python MIR worker',
          ok: false,
          detail: `${(err as Error).message} (install: cd mir && uv sync)`,
        });
      }

      const project = resolveGoogleCloudProject();
      const location = resolveGoogleCloudLocation();
      const analysisConfig = resolveAgentModelConfig('analysis');
      const provider = analysisConfig !== null ? analysisConfig.provider : 'unset';

      checks.push({
        name: 'Google Cloud project',
        ok: project !== undefined,
        detail: project ?? 'set GOOGLE_CLOUD_PROJECT',
      });

      let adcDetail = 'unknown';
      let adcOk = false;
      if (provider === 'google-vertex') {
        try {
          const { GoogleAuth } = await import('google-auth-library');
          const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
          await auth.getAccessToken();
          adcOk = true;
          adcDetail = 'application default credentials';
        } catch (err) {
          adcDetail = `ADC unavailable: ${(err as Error).message}`;
        }
      } else {
        adcDetail = 'not required (non-Vertex model)';
        adcOk = true;
      }
      checks.push({ name: 'ADC', ok: adcOk, detail: adcDetail });

      const vertexConfigured =
        analysisConfig !== null &&
        analysisConfig.provider === 'google-vertex' &&
        project !== undefined &&
        llmCredentialsAvailable(analysisConfig);
      checks.push({
        name: 'Vertex AI',
        ok: vertexConfigured || provider !== 'google-vertex',
        detail:
          provider === 'google-vertex'
            ? vertexConfigured
              ? 'configured'
              : 'set GOOGLE_CLOUD_PROJECT + ADC'
            : `provider: ${provider}`,
      });

      if (analysisConfig !== null) {
        checks.push({
          name: 'Agent model',
          ok: true,
          detail: `${analysisConfig.model} (${resolveModelProvider(analysisConfig.model)})`,
        });
        if (provider === 'google-vertex') {
          checks.push({ name: 'Location', ok: true, detail: location });
        }
      } else {
        checks.push({
          name: 'Agent model',
          ok: false,
          detail: 'set LLM_DEFAULT_MODEL',
        });
      }

      for (const c of checks) {
        console.log(`${c.name.padEnd(10)} ${c.ok ? '✓' : '✗'}${c.detail ? `  ${c.detail}` : ''}`);
      }
      if (checks.some((c) => !c.ok)) process.exitCode = 1;
    });
}

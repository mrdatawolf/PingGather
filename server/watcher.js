import { readdir, readFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { importCsv } from './import.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INBOX = join(__dirname, 'inbox');
const COMPLETED = join(INBOX, 'completed');

const state = {
  active: false,
  totalFiles: 0,
  currentFile: 0,
  currentFileName: '',
  step: '',
  detail: '',
  percent: 0,
  inserted: 0,
  skipped: 0,
};

export function getWatcherStatus() {
  return { ...state };
}

export async function processInbox() {
  let files;
  try {
    files = (await readdir(INBOX)).filter(f => f.toLowerCase().endsWith('.csv'));
  } catch {
    return;
  }

  if (files.length === 0) return;

  state.active = true;
  state.totalFiles = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = join(INBOX, file);
    state.currentFile = i + 1;
    state.currentFileName = file;
    state.step = '';
    state.detail = '';
    state.percent = 0;
    state.inserted = 0;
    state.skipped = 0;

    try {
      const buffer = await readFile(filePath);
      console.log(`[watcher] Processing ${file} (${i + 1}/${files.length})...`);
      const result = await importCsv(buffer, file, (progress) => {
        state.step = progress.step || state.step;
        state.detail = progress.detail || state.detail;
        if (progress.percent != null) state.percent = progress.percent;
        if (progress.inserted != null) state.inserted = progress.inserted;
        if (progress.skipped != null) state.skipped = progress.skipped;
      });
      console.log(`[watcher] ${file}: ${result.inserted} inserted, ${result.skipped} skipped.`);
      await rename(filePath, join(COMPLETED, file));
    } catch (err) {
      console.error(`[watcher] Error processing ${file}:`, err.message);
    }
  }

  state.active = false;
}

export async function startWatcher(intervalMs = 5 * 60 * 1000) {
  await mkdir(COMPLETED, { recursive: true });
  console.log(`[watcher] Watching ${INBOX} every ${intervalMs / 1000}s`);
  processInbox();
  setInterval(processInbox, intervalMs);
}

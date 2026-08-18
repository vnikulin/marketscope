import { Worker } from 'node:worker_threads';

const MAX_INPUT_BYTES = 4_096;
const REGEX_TIMEOUT_MILLISECONDS = 50;

const WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');

try {
  const regex = new RegExp(workerData.pattern, workerData.flags);
  parentPort.postMessage({ matched: regex.test(workerData.input) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  parentPort.postMessage({ matched: false, error: 'invalid regex: ' + message });
}
`;

export interface RegexEvaluation {
  matched: boolean;
  timedOut: boolean;
  inputTruncated: boolean;
  error?: string;
}

interface WorkerMessage {
  matched: boolean;
  error?: string;
}

function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { matched?: unknown; error?: unknown };
  return (
    typeof candidate.matched === 'boolean' &&
    (candidate.error === undefined || typeof candidate.error === 'string')
  );
}

function capInput(input: string): { value: string; truncated: boolean } {
  const encoded = new TextEncoder().encode(input);
  if (encoded.byteLength <= MAX_INPUT_BYTES) {
    return { value: input, truncated: false };
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  let end = MAX_INPUT_BYTES;
  while (end > 0) {
    try {
      return {
        value: decoder.decode(encoded.subarray(0, end)),
        truncated: true,
      };
    } catch {
      end -= 1;
    }
  }

  return { value: '', truncated: true };
}

export function evaluateRegex(
  pattern: string,
  input: string,
  flags = 'iu',
): Promise<RegexEvaluation> {
  const cappedInput = capInput(input);

  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        pattern,
        flags,
        input: cappedInput.value,
      },
    });
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: RegexEvaluation): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      resolve(result);
    };

    worker.once('online', () => {
      timeout = setTimeout(() => {
        finish({
          matched: false,
          timedOut: true,
          inputTruncated: cappedInput.truncated,
          error: 'regex timeout',
        });
        void worker.terminate();
      }, REGEX_TIMEOUT_MILLISECONDS);
    });

    worker.once('message', (message: unknown) => {
      if (!isWorkerMessage(message)) {
        finish({
          matched: false,
          timedOut: false,
          inputTruncated: cappedInput.truncated,
          error: 'regex worker returned an invalid response',
        });
        return;
      }

      finish({
        matched: message.matched,
        timedOut: false,
        inputTruncated: cappedInput.truncated,
        ...(message.error === undefined ? {} : { error: message.error }),
      });
    });

    worker.once('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      finish({
        matched: false,
        timedOut: false,
        inputTruncated: cappedInput.truncated,
        error: `regex worker error: ${message}`,
      });
    });

    worker.once('exit', (code) => {
      if (code !== 0) {
        finish({
          matched: false,
          timedOut: false,
          inputTruncated: cappedInput.truncated,
          error: `regex worker exited with code ${code}`,
        });
      }
    });
  });
}

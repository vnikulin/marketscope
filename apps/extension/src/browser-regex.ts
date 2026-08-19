interface RegexEvaluation {
  matched: boolean;
  timedOut: boolean;
  inputTruncated: boolean;
  error?: string;
}

const MAX_INPUT_BYTES = 4_096;
const TIMEOUT_MS = 50;
const REGEX_WORKER_PATH = 'dist/assets/regex-worker.js';

interface WorkerReply {
  matched: boolean;
  error?: string;
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

export function evaluateBrowserRegex(
  pattern: string,
  input: string,
  flags: string,
): Promise<RegexEvaluation> {
  const capped = capInput(input);
  return new Promise((resolve) => {
    // Static manifest content scripts are classic scripts. Resolve the packaged
    // module worker through Chrome so the content bundle never contains import.meta.
    const worker = new Worker(chrome.runtime.getURL(REGEX_WORKER_PATH), {
      type: 'module',
    });
    let settled = false;
    const finish = (result: RegexEvaluation): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      resolve(result);
    };
    const timeout = setTimeout(() => {
      finish({
        matched: false,
        timedOut: true,
        inputTruncated: capped.truncated,
        error: 'regex timeout',
      });
    }, TIMEOUT_MS);
    worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
      finish({
        matched: event.data.matched,
        timedOut: false,
        inputTruncated: capped.truncated,
        ...(event.data.error === undefined ? {} : { error: event.data.error }),
      });
    });
    worker.addEventListener('error', (event) => {
      finish({
        matched: false,
        timedOut: false,
        inputTruncated: capped.truncated,
        error: `regex worker error: ${event.message}`,
      });
    });
    worker.postMessage({ pattern, flags, input: capped.value });
  });
}

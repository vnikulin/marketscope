interface RegexRequest {
  pattern: string;
  flags: string;
  input: string;
}

self.addEventListener('message', (event: MessageEvent<RegexRequest>) => {
  try {
    const regex = new RegExp(event.data.pattern, event.data.flags);
    self.postMessage({ matched: regex.test(event.data.input) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ matched: false, error: `invalid regex: ${message}` });
  }
});

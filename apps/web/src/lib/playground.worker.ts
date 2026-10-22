/// <reference lib="webworker" />
import { runClient, type ClientOutcome, type ClientRequest } from "@postseed/studio/shared/clientGen";

export interface WorkerRequest {
  id: number;
  request: ClientRequest;
}
export interface WorkerResponse {
  id: number;
  outcome: ClientOutcome;
}

/** The whole engine runs here, off the page's thread. Nothing is sent over the network. */
self.onmessage = (e: MessageEvent<WorkerRequest>): void => {
  const { id, request } = e.data;
  let outcome: ClientOutcome;
  try {
    outcome = runClient(request);
  } catch (err) {
    outcome = { ok: false, error: err instanceof Error ? err.message : String(err), warnings: [] };
  }
  (self as unknown as Worker).postMessage({ id, outcome } satisfies WorkerResponse);
};

export { runScanJob, processNextJob, claimNextJob, failStaleJobs } from "./scan-job.js";
export { defaultCloner, defaultTempDir } from "./defaults.js";
export type {
  PipelineDeps,
  GithubPort,
  Cloner,
  TempDir,
  ScanJob,
  JobOutcome,
} from "./types.js";

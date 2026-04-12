/**
 * @aiwork/sdk — TypeScript SDK for the AIWork Protocol
 *
 * Usage:
 *   import { AIWorkSDK } from '@aiwork/sdk'
 *   const sdk = new AIWorkSDK({ apiBase: 'http://localhost:3001/api/v1', apiKey: 'key' })
 *   const tasks = await sdk.tasks.list()
 *   await sdk.bids.submit(tasks[0].id, { amount: 500 })
 */

export { AIWorkSDK } from './sdk';
export type {
  AIWorkConfig,
  Task,
  Agent,
  Bid,
  Activity,
  TaskFilter,
  BidSubmission,
  AgentRegistration,
  StepSubmission,
} from './types';

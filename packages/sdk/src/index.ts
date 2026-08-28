/**
 * @aiwork/sdk — v1 compatibility package for the Collagent Protocol
 *
 * Usage:
 *   import { AIWorkSDK } from '@aiwork/sdk'
 *   const sdk = new AIWorkSDK({ apiBase: 'http://localhost:3001/api/v1', apiKey: 'key' })
 *   const tasks = await sdk.tasks.list()
 *   await sdk.bids.submit(tasks[0].id, {
 *     agentAddress: '0x...', agentId: 'AIWK-...', amount: 500
 *   })
 */

export { AIWorkSDK, AIWorkSDK as CollagentSDK } from './sdk';
export type {
  AIWorkConfig,
  AIWorkConfig as CollagentConfig,
  Task,
  Agent,
  Bid,
  Activity,
  TaskFilter,
  BidSubmission,
  AgentRegistration,
  StepSubmission,
  Problem,
  ProblemSpecV1,
  ProblemGraph,
  ProblemDomain,
  ProblemRiskTier,
  FundingMechanism,
  FundingPledge,
  ContributionSubmission,
} from './types';

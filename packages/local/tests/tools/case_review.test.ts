import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgent, setGlobalDispatcher } from 'undici';
import { caseReview } from '../../src/tools/case_review.js';
import { MulticaClient } from '@tcmcp/shared';
import { STANDARD_LABEL_MAP, interceptAnyLabelAdd } from '@tcmcp/shared/test-helpers';

const TRIVIAL = `### Judgment: x\n- short\n`;
const SUBSTANTIVE = `### Judgment: cache strategy
- **Context:** old cache key triggered storms during peak load
- **Options:** A) hash userID B) hash userID+region
- **Chose:** A — fewer collisions in our测试
- **In hindsight:** correct, p99 dropped 600ms→340ms
- **"Ancient impossible" check:** No, would have done same pre-AI
`;

describe('case_review', () => {
  let dir: string;
  let agent: MockAgent;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cr-'));
    agent = new MockAgent();
    agent.disableNetConnect();
    setGlobalDispatcher(agent);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await agent.close();
  });

  it('refuses if section 4 is trivially short', async () => {
    const casePath = join(dir, 'case.md');
    await writeFile(casePath, `# Case\n\n## 4. Key judgments\n${TRIVIAL}\n\n## 5. General rule candidates\n`);
    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });
    await expect(caseReview({
      casePath, multicaIssueId: 'i1', reviewerEmail: 'a@b',
    }, { client })).rejects.toThrow(/section 4.*too short/i);
  });

  it('signs section 4 and adds debrief-reviewed label', async () => {
    const pool = agent.get('http://m.test');
    interceptAnyLabelAdd(pool);
    pool.intercept({ path: '/api/issues/i1/labels', method: 'POST' }).reply(201, {});

    const casePath = join(dir, 'case.md');
    await writeFile(casePath, `# Case\n\n## 4. Key judgments\n${SUBSTANTIVE}\n\n## 5. General rule candidates\n`);
    const client = new MulticaClient({ serverUrl: 'http://m.test', token: 't', workspaceId: 'w', labelMap: STANDARD_LABEL_MAP });

    const r = await caseReview({
      casePath, multicaIssueId: 'i1', reviewerEmail: 'dri@aimiq',
    }, { client });

    expect(r.reviewed).toBe(true);
    const updated = await readFile(casePath, 'utf-8');
    expect(updated).toMatch(/Reviewed by:\s*dri@aimiq/);
    expect(updated).toMatch(/Reviewed at:/);
  });
});

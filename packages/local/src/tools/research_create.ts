import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { MulticaClient } from '@tcmcp/shared';

export const researchCreateInput = z.object({
  projectPath: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  question: z.string().min(20),
});

export async function researchCreate(
  raw: z.infer<typeof researchCreateInput>,
  deps: { client: MulticaClient }
): Promise<{ researchPath: string; multicaIssueId: string; alreadyExisted: boolean }> {
  const input = researchCreateInput.parse(raw);
  const date = new Date().toISOString().slice(0, 10);
  const researchPath = join(
    input.projectPath, 'docs', 'research',
    `research_${date}_${input.slug}.md`
  );

  let existed = false;
  try {
    await access(researchPath);
    existed = true;
  } catch {
    await mkdir(dirname(researchPath), { recursive: true });
    const body = `# 研究:${input.slug}

**日期**: ${date}
**研究者**: (你的名字 / 你的 claude-session-id)

## 问题
${input.question}

## 发现

### 现有代码
- TBD

### 先例
- TBD (行业论文 / 类似仓库 / 已知参考)

### 陷阱
- TBD (已知失败模式 / 坑)

### 约束
- TBD (团队 SOP / 安全 / 合规 / 时间)

## 待解问题
- TBD (研究没能回答的 — Plan session 前必须解决)

## 推荐方案 (选项,非决定)
1. TBD
2. TBD
3. TBD
`;
    await writeFile(researchPath, body, 'utf-8');
  }

  const issue = await deps.client.createIssue({
    title: `研究:${input.slug}`,
    body: `Research session for: ${input.question}\n\nFile: \`${researchPath}\``,
    labels: ['研究'],
  });

  return { researchPath, multicaIssueId: issue.id, alreadyExisted: existed };
}

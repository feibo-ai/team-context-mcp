import simpleGit, { SimpleGit } from 'simple-git';

export interface GitStatus {
  clean: boolean;
  uncommittedFiles: string[];
  branch: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  date: string;
}

export class GitOps {
  private g: SimpleGit;

  constructor(repoDir: string) {
    this.g = simpleGit(repoDir);
  }

  async status(): Promise<GitStatus> {
    const s = await this.g.status();
    const files = [
      ...s.not_added,
      ...s.created,
      ...s.modified,
      ...s.deleted,
      ...s.renamed.map((r) => r.to),
    ];
    return {
      clean: files.length === 0,
      uncommittedFiles: files,
      branch: s.current || 'unknown',
    };
  }

  async commitWip(summary: string): Promise<string> {
    const s = await this.status();
    if (s.clean) throw new Error('nothing to commit');
    await this.g.add('-A');
    const result = await this.g.commit(`wip: ${summary}`);
    return result.commit;
  }

  async stashWip(summary: string): Promise<void> {
    await this.g.stash(['push', '-m', `wip: ${summary}`]);
  }

  async lastCommit(): Promise<GitCommit> {
    const log = await this.g.log({ maxCount: 1 });
    const c = log.latest!;
    return { hash: c.hash, message: c.message, date: c.date };
  }
}

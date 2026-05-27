export type Layer = 'project' | 'task';
export type ReviewVerdict = 'pending' | 'approved' | 'changes-requested';

export interface Plan {
  filePath: string;
  layer: Layer;
  dri?: string;
  goal: string;
  completionCriteria: string[];
  appetite?: string;
  reviewVerdict: ReviewVerdict;
  reviewer?: string;
  reviewedAt?: string;
}

export interface CaseRulCandidate {
  text: string;
  promoted: boolean;
}

export interface Case {
  filePath: string;
  date: string;
  slug: string;
  goal: string;
  ruleCandidates: CaseRulCandidate[];
}

export interface MulticaIssue {
  id: string;
  title: string;
  status: string;
  labels: string[];
  assigneeId?: string;
  projectId?: string;
}

export interface SkillFile {
  path: string;
  name: string;
  description: string;
  body: string;
  bodyTokens: number;
  ownerEmail?: string;
  lastReviewedAt?: string;
}

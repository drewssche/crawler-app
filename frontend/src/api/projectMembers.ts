import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

export type ProjectMemberRole = "owner" | "editor" | "viewer";

export type ProjectMember = {
  id: number;
  project_id: number;
  user_id: number;
  email: string;
  user_role: string;
  role: ProjectMemberRole;
  created_at: string;
  is_current_user: boolean;
  is_approved: boolean;
  is_blocked: boolean;
};

export function listProjectMembers(projectId: number): Promise<ProjectMember[]> {
  return apiGet<ProjectMember[]>(`/projects/${projectId}/members`);
}

export function addProjectMember(
  projectId: number,
  input: { email: string; role: ProjectMemberRole },
): Promise<ProjectMember> {
  return apiPost<ProjectMember>(`/projects/${projectId}/members`, input);
}

export function updateProjectMemberRole(
  projectId: number,
  memberId: number,
  role: ProjectMemberRole,
): Promise<ProjectMember> {
  return apiPatch<ProjectMember>(`/projects/${projectId}/members/${memberId}`, { role });
}

export function deleteProjectMember(projectId: number, memberId: number): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/projects/${projectId}/members/${memberId}`);
}

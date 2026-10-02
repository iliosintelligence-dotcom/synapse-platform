/**
 * api/tasks — operational layer between pipeline and agent. CRUD plus
 * template-driven generation on stage entry.
 */
import { getDb } from '@synapse/database';
import {
  TaskStatus,
  type CreateTaskInput,
  type LeadStage,
  type Task,
  type TaskTemplate,
} from '@synapse/types';

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const db = getDb();
  const { data: auth } = await db.auth.getUser();
  const { data, error } = await db
    .from('tasks')
    .insert({
      agency_id: input.agency_id,
      lead_id: input.lead_id ?? null,
      assigned_to: input.assigned_to ?? null,
      created_by: auth.user?.id ?? null,
      title: input.title,
      description: input.description ?? null,
      task_type: input.task_type,
      priority: input.priority ?? 'medium',
      due_at: input.due_at ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as Task;
}

export async function listAgentTasks(agentId: string): Promise<Task[]> {
  const { data, error } = await getDb()
    .from('tasks')
    .select('*')
    .eq('assigned_to', agentId)
    .is('deleted_at', null)
    .order('due_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function listLeadTasks(leadId: string): Promise<Task[]> {
  const { data, error } = await getDb()
    .from('tasks')
    .select('*')
    .eq('lead_id', leadId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<Task> {
  const { data, error } = await getDb()
    .from('tasks')
    .update({
      status,
      completed_at: status === TaskStatus.COMPLETED ? new Date().toISOString() : null,
    })
    .eq('id', taskId)
    .select('*')
    .single();
  if (error) throw error;
  return data as Task;
}

/* ───────── templates ───────── */

export async function listTaskTemplates(agencyId: string): Promise<TaskTemplate[]> {
  const { data, error } = await getDb()
    .from('task_templates')
    .select('*')
    .eq('agency_id', agencyId)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (error) throw error;
  return (data ?? []) as TaskTemplate[];
}

/**
 * Generate tasks from any templates whose trigger_stage matches. Called when
 * a lead enters a stage. due_at = now + due_offset_hours.
 */
export async function generateTasksForStage(
  agencyId: string,
  leadId: string,
  stage: LeadStage,
  assignedTo: string | null,
): Promise<Task[]> {
  const db = getDb();
  const { data: templates, error } = await db
    .from('task_templates')
    .select('*')
    .eq('agency_id', agencyId)
    .eq('trigger_stage', stage)
    .eq('is_active', true);
  if (error) throw error;

  const rows = (templates ?? []).map((t) => ({
    agency_id: agencyId,
    lead_id: leadId,
    assigned_to: assignedTo,
    title: t.name as string,
    description: (t.description as string | null) ?? null,
    task_type: t.task_type,
    priority: t.default_priority,
    due_at: new Date(Date.now() + (t.due_offset_hours as number) * 3600_000).toISOString(),
  }));
  if (rows.length === 0) return [];

  const { data, error: insErr } = await db.from('tasks').insert(rows).select('*');
  if (insErr) throw insErr;
  return (data ?? []) as Task[];
}

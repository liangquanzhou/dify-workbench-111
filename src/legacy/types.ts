// Dify 1.11.1 adapter. Added to pinned dify-mcp cfaa2abafaf8807c0914eff1bb7b9909e6599293.
export type Obj = Record<string, any>;
export class LegacyError extends Error {
  code: string; details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message); this.name = 'LegacyError'; this.code = code; this.details = details;
  }
}
export function requireThat(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new LegacyError(code, message);
}
export type Mode = 'workflow' | 'advanced-chat';
export type RunResult = {status: 'succeeded'|'failed'|'stopped'|'unknown'; task_id?: string; workflow_run_id?: string; events: Obj[]; error?: unknown};
export type Target = {base_url:string; workspace_id:string; app_id:string; mode:Mode};
export type Config = {
  profile:'dify-1.11.1'; target:Target; dsl:string; state_file?:string;
  build?:{command:string; args?:string[]; cwd?:string; timeout_ms?:number};
  permissions?:{remote?:boolean; sync?:boolean; test?:boolean; publish?:boolean; build_command?:boolean};
  dataset_bindings?:Record<string,string>; timeout_ms?:number;
};

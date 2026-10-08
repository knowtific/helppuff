/**
 * Jobs (the site's pipeline), as the widget and the chat see them. Zod-free,
 * so the widget can import them (`@helppuff/protocol/jobs`).
 */

/** A quote flow's answers arrive as an action with this id prefix (then the flow's id). */
export const JOB_FLOW_PREFIX = 'jobflow_';
/** The form the assistant shows to complete a job it started: `job_<jobId>`. */
export const JOB_FORM_PREFIX = 'job_';
/**
 * The contact questions a quote flow ends with, by answer name, and the lead
 * field each one fills (so a site's lead form is not asked again).
 */
export const QUOTE_CONTACT_FIELDS = { contact_name: 'name', contact_email: 'email', contact_phone: 'phone' } as const;

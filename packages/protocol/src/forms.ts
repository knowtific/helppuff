/**
 * Which forms a chat may submit. The server answers only for forms it showed
 * (their message ids ride in the session token) and for the site's own
 * `widget.forms`, which the widget opens locally under an id built here, so
 * the server can tell which configured form it was.
 */

const LOCAL_FORM = /^wf_(.{1,55})~[a-z0-9]{1,8}$/;

/** The id of a configured form's message, opened in the widget: `wf_<formId>~<suffix>`. */
export function localFormId(formId: string, suffix: string): string {
  return `wf_${formId.slice(0, 55)}~${suffix.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || '0'}`;
}

/** The configured form a local form id names, if any of `formIds`. */
export function localFormOf(actionId: string, formIds: readonly string[]): string | null {
  const prefix = LOCAL_FORM.exec(actionId)?.[1];
  if (!prefix) return null;
  return formIds.find((id) => id.slice(0, 55) === prefix) ?? null;
}

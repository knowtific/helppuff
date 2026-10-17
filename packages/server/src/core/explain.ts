/**
 * What an error's `detail` means, said plainly for the person who can fix it,
 * with what to do. Visitors never see this: `app.onError` attaches it only to
 * the owner's own requests (an admin session or key, an API key, the owner's
 * test chat), and every failure is logged with its detail regardless.
 *
 * A detail with no entry here gives null: its error's own message says it
 * (`HelpPuffError.explanation` falls back to the detail for opaque codes).
 */

export type Explanation = { reason: string; hint?: string };

const LIMITS: Record<string, [setting: string, what: string]> = {
  messages_per_site_per_day: ['security.limits.messagesPerSitePerDay', "The site's daily message cap is reached; it resets at 00:00 UTC"],
  messages_per_session: ['security.limits.messagesPerSession', 'This chat reached its message limit'],
  messages_per_ip_per_minute: ['security.limits.messagesPerIpPerMinute', 'This visitor (IP address) sent too many messages this minute'],
  messages_per_ip_per_day: ['security.limits.messagesPerIpPerDay', 'This visitor (IP address) reached the daily message limit'],
  sessions_per_ip_per_hour: ['security.limits.sessionsPerIpPerHour', 'This visitor (IP address) started too many chats this hour'],
  sessions_per_ip_per_day: ['security.limits.sessionsPerIpPerDay', 'This visitor (IP address) started too many chats today'],
  files_per_conversation: ['files.perConversation', 'This chat reached its file limit'],
};

const RATE: Record<string, string> = {
  polls_per_ip: 'Too many polls for new messages from one address.',
  ends_per_ip: 'Too many chats closed from one address.',
  feedback_per_ip: 'Too many ratings from one address.',
  uploads_per_ip: 'Too many uploads from one address.',
  slot_lookups_per_ip: 'Too many looks at free times from one address.',
  bookings_per_ip: 'Too many bookings from one address.',
  api_key_rate: "This API key's requests per minute are used up.",
  admin_login: 'Too many sign-in attempts from this address.',
  admin_link: 'Too many sign-in links asked for from this address.',
  admin_login_account: 'Too many failed sign-ins for this account.',
  retell_kb_per_minute: 'Too many knowledge lookups from Retell this minute.',
};

const FIXED: Record<string, Explanation> = {
  helppuff_secret_missing: { reason: 'HELPPUFF_SECRET is not set on the Worker (or is shorter than 32 characters).', hint: 'helppuff deploy (it sets one)' },
  helppuff_secret_too_short: { reason: 'HELPPUFF_SECRET on the Worker is shorter than 32 characters.', hint: 'helppuff deploy (it sets one)' },
  workers_ai_binding_missing: { reason: 'This Worker has no Workers AI binding.', hint: 'helppuff deploy' },
  connector_state_too_large: { reason: "The backend's conversation state is too large to carry in the session token." },
  connector_threw: { reason: 'The backend failed in an unexpected way (a bug in it, not your setup).', hint: 'helppuff logs while repeating it; please report it' },
  origin_not_allowed: { reason: "The page's origin is not in this site's `origins`.", hint: 'Add it to origins in helppuff.json (exact scheme and host, with www. if used), then helppuff deploy' },
  ip_blocked: { reason: "This IP address is in the site's `security.blockIps`." },
  token_missing: { reason: 'The request has no session token.' },
  token_malformed: { reason: 'The session token is malformed.' },
  token_bad_signature: { reason: "The session token was not signed by this Worker's HELPPUFF_SECRET (it changed, or the token was altered)." },
  token_bad_payload: { reason: 'The session token is for another site, or unreadable.' },
  token_expired: { reason: 'The chat is older than `security.sessionTtlHours`.', hint: 'Start a new chat; raise security.sessionTtlHours to keep chats longer' },
  timeout: { reason: 'The AI provider did not answer in time.', hint: 'Try again; if it keeps happening, pick a faster model (helppuff model set …)' },
  stream_no_body: { reason: 'The backend answered a streamed request without a body.' },
  invalid_json: { reason: 'The backend answered with something that is not JSON.', hint: 'Check its address and that it speaks the protocol it is configured for' },
  ai_search_idle: { reason: 'The AI Search instance has nothing indexed yet, or is paused.', hint: 'helppuff knowledge sync' },
  gemini_status_failed: { reason: 'Gemini could not read the File Search store.', hint: 'helppuff knowledge sync' },
  openai_stream_truncated: { reason: "OpenAI's streamed answer stopped before it finished." },
  gemini_stream_truncated: { reason: "Gemini's streamed answer stopped before it finished." },
  http_stream_truncated: { reason: "Your API's streamed answer stopped before it finished." },
  retell_no_chat_id: { reason: 'Retell did not return a chat id.', hint: 'Check RETELL_API_KEY and the agent id' },
  admin_no_kv: { reason: 'This deployment has no KV namespace.', hint: 'helppuff deploy' },
  admin_no_db: { reason: 'This deployment has no database (the dashboard is off).', hint: 'helppuff config set dashboard.adminEmail you@example.com, then helppuff deploy' },
  admin_no_ai: { reason: 'This deployment has no Workers AI binding.', hint: 'helppuff deploy' },
  knowledge_no_workflow: { reason: 'This deployment has no background-job workflow.', hint: 'helppuff deploy' },
  knowledge_workflow_create_failed: { reason: 'Cloudflare refused to start the background job.', hint: 'Try again in a minute' },
  file_workflow_create_failed: { reason: 'Cloudflare refused to start the background job for the file.', hint: 'Try again in a minute' },
  admin_summary_unparsable: { reason: 'The model wrote a summary that could not be read.', hint: 'Try again' },
  files_no_storage: { reason: 'This deployment has no R2 bucket for photos and files.', hint: 'Turn on R2 in the Cloudflare dashboard, then helppuff deploy' },
  no_route: { reason: 'There is no such route on this Worker.', hint: 'Check the path; an older Worker may lack it: helppuff upgrade' },
  unknown_site: { reason: 'No site with this id on this Worker.', hint: 'Compare data-site in the embed with site in helppuff.json' },
  echo_forced_error: { reason: 'The echo backend was asked to fail (/error).' },
};

const PROVIDERS: [RegExp, string][] = [
  [/^openai_compatible/, 'The model API'],
  [/^openai/, 'OpenAI'],
  [/^gemini/, 'Gemini'],
  [/^anthropic/, 'Anthropic'],
  [/^retell/, 'Retell'],
  [/^ai_search/, 'AI Search'],
  [/^http_retrieval/, 'Your knowledge API'],
  [/^http/, 'Your API'],
  [/^workers_ai/, 'Workers AI'],
];

/** Which provider a detail like `openai_respond_401:…` is about. */
function providerOf(detail: string): string {
  return PROVIDERS.find(([pattern]) => pattern.test(detail))?.[1] ?? 'The AI provider';
}

/** A provider's HTTP status, and what it answered (cut), from `<provider>_<op>_<status>:<body>`. */
function providerStatus(detail: string): { status: number; body: string } | null {
  const match = /^[a-z_]+?_(\d{3})(?::([\s\S]*))?$/.exec(detail);
  if (!match) return null;
  return { status: Number(match[1]), body: (match[2] ?? '').trim().slice(0, 200) };
}

export function explainDetail(detail: string | undefined): Explanation | null {
  if (!detail || detail === 'none') return null;
  const fixed = FIXED[detail];
  if (fixed) return fixed;

  const limit = LIMITS[detail];
  if (limit) return { reason: `${limit[1]}.`, hint: `Raise ${limit[0]} (helppuff config set ${limit[0]} <n>, then helppuff deploy) if the traffic is real` };
  const rate = RATE[detail];
  if (rate) return { reason: rate, hint: 'Wait for Retry-After seconds' };

  const secret = /^(?:missing_secret|unresolved_secret)(?::[\w-]+)?:(\w+)$/.exec(detail)?.[1];
  if (secret) return { reason: `${secret} is not set on the Worker.`, hint: `helppuff secret set ${secret}, then helppuff deploy` };

  const custom = /^custom_(model|retriever)_missing:(.+)$/.exec(detail);
  if (custom) return { reason: `The custom ${custom[1] === 'model' ? 'model' : 'knowledge base'} "${custom[2]}" is not in the deployed Worker.`, hint: 'helppuff deploy' };

  const binding = /^ai_search_binding_missing:(.+)$/.exec(detail);
  if (binding) return { reason: `This Worker has no AI Search binding "${binding[1]}".`, hint: 'helppuff deploy' };

  const connector = /^unknown_connector:(.+)$/.exec(detail);
  if (connector) return { reason: `This Worker has no "${connector[1]}" backend.`, hint: 'Check backend.type, or helppuff upgrade' };
  const sink = /^unknown_sink:(.+)$/.exec(detail);
  if (sink) return { reason: `This Worker has no "${sink[1]}" lead destination.`, hint: 'Check the sinks in the config, or helppuff upgrade' };
  const options = /^connector_options_invalid:(.+)$/.exec(detail);
  if (options) return { reason: `The "${options[1]}" backend's settings are invalid.`, hint: 'helppuff validate, then helppuff deploy' };

  const turnstile = /^turnstile:(.+)$/.exec(detail);
  if (turnstile) {
    const code = turnstile[1]!;
    if (/invalid-input-secret|missing-input-secret/.test(code)) return { reason: `Turnstile rejected the secret key (${code}).`, hint: 'Check security.captcha.secret and its value: helppuff secret set …' };
    if (/timeout-or-duplicate/.test(code)) return { reason: 'The Turnstile token was used twice or expired (timeout-or-duplicate).', hint: 'The visitor tries again' };
    return { reason: `Turnstile could not verify the browser (${code}).`, hint: "Check that the page's hostname is on the Turnstile widget in Cloudflare" };
  }

  if (/^workers_ai_error:/.test(detail)) return { reason: `Workers AI failed: ${detail.slice('workers_ai_error:'.length, 220)}`, hint: 'Try again; set model.fallbackModel to try a second model' };
  if (/^retriever_error:/.test(detail)) return { reason: `The knowledge source failed: ${detail.slice('retriever_error:'.length, 220)}`, hint: 'helppuff rag test' };
  if (/_stream_error:/.test(detail)) return { reason: `${providerOf(detail)} sent an error mid-answer: ${detail.split('_stream_error:')[1]!.slice(0, 200)}` };

  const http = providerStatus(detail);
  if (http) {
    const who = providerOf(detail);
    const said = http.body ? ` It said: ${http.body}` : '';
    if (http.status === 401 || http.status === 403) return { reason: `${who} refused the key (HTTP ${http.status}).${said}`, hint: 'Store a working key: helppuff secret set <NAME>, then helppuff deploy; helppuff model test checks it' };
    if (http.status === 404) return { reason: `${who} does not know that model or address (HTTP 404).${said}`, hint: 'Check the model and base URL: helppuff model' };
    if (http.status === 429) return { reason: `${who} is rate limiting, or the account is out of credit (HTTP 429).${said}`, hint: "Check the provider account's limits and balance" };
    if (http.status >= 500) return { reason: `${who} is failing on its side (HTTP ${http.status}).${said}`, hint: 'Try again later; set model.fallbackModel to try a second model' };
    return { reason: `${who} answered HTTP ${http.status}.${said}` };
  }

  return null;
}

/**
 * Live chat's names, without Zod: the widget imports these
 * (`@helppuff/protocol/live`) and must not pull a schema library into its bundle.
 */

export const LIVE_SUBPROTOCOL = 'helppuff.v1';
/** The prefix of the subprotocol that carries the session token. */
export const LIVE_TOKEN_PROTOCOL = 't.';
/** The action a visitor sends to ask for a person ("Talk to a person"). */
export const HANDOVER_ACTION = 'handover';
/** Sent as plain text; answered with `pong` without waking the server. */
export const LIVE_PING = 'ping';

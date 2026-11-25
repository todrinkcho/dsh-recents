/**
 * Host half of `@todrink/dsh-recents`.
 *
 * The whole behaviour lives in the browser module (`./client.js`): it reads the
 * client Session list, Workspace list and Session status snapshots and paints a
 * three-row shortcut block between the New session button and the Workspaces
 * list. This entry only keeps the bundle a valid profile row.
 */
export const name = 'recent-sessions'

export function apply() {}

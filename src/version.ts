/** The editor's version as shown in the status bar and dialogs, e.g. `v1.0.0 (abc1234)`. */
export function versionLabel(): string {
  return `v${__LECTERN_VERSION__} (${__LECTERN_BUILD__})`;
}

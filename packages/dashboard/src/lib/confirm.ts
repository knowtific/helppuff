/**
 * Every delete asks first, and says plainly that it cannot be undone.
 * `question` is the first line ("Delete Ada?"), `consequence` what else goes.
 */
export function confirmDelete(question: string, consequence?: string): boolean {
  return window.confirm([question, consequence, 'This cannot be undone.'].filter(Boolean).join('\n\n'));
}

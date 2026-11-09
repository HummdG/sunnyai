/**
 * What Studio calls the installer's assistant: the name they gave it, or
 * "Sunny" until they do. "Sunny" as the product (Sunny Studio) never changes.
 */
export function assistantNameOf(name: string | null | undefined): string {
  return name?.trim() || 'Sunny';
}

/** "Ava's", "Jess's": always the name and "'s", kept simple. */
export function possessive(name: string): string {
  return `${name}'s`;
}

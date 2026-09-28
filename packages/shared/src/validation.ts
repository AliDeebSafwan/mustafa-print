/** One readable line from a zod error: "items.0.quantity: invalid decimal number; customer_id: Invalid UUID". */
export const formatIssues = (error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] }): string =>
  error.issues.map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ');

export const validateEnvironment = () => {
  const issues: string[] = [];

  if (!process.env.NODE_ENV) {
    issues.push('NODE_ENV');
  }

  return { ok: issues.length === 0, issues };
};

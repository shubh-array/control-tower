export function formatRepositoryPr(
  repository: string,
  prNumber: number,
): string {
  return `${repository}#${prNumber}`;
}

export function getReviewFallback(input: {
  jobId: string | null;
  jobState: string | null;
}): {
  action: "retry" | "analyze";
  label: string;
  message: string;
} {
  if (input.jobId !== null) {
    return {
      action: "retry",
      label: "Retry Analysis",
      message: "The draft is not available yet or is no longer current.",
    };
  }

  return {
    action: "analyze",
    label: "Analyze",
    message: "Analysis has not started for this pull request.",
  };
}

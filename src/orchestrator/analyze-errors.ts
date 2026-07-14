export class PrNotEligibleForReviewError extends Error {
  constructor(message = "PR is not eligible for review") {
    super(message);
    this.name = "PrNotEligibleForReviewError";
  }
}

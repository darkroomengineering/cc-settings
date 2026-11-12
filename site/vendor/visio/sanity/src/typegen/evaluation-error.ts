/** A query the evaluator cannot follow, reported for its file instead of thrown. */
export class EvaluationError extends Error {
  override name = "EvaluationError";
}

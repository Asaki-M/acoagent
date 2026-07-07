export type Vector = number[];

export function cosineSimilarity(left: Vector, right: Vector) {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function buildToolIndexText(input: {
  name: string;
  description: string;
  tags?: readonly string[];
  inputSchema?: Record<string, unknown>;
  source?: {
    type: string;
    label?: string;
  };
}) {
  return [
    input.name,
    input.description,
    input.tags?.join(" "),
    JSON.stringify(input.inputSchema ?? {}),
    input.source?.type,
    input.source?.label,
  ]
    .filter(Boolean)
    .join(" ");
}

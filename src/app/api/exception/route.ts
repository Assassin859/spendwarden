import { recordException } from "@/investigate/run";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; content?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const content = typeof body?.content === "string" ? body.content : "";
  if (!id) {
    return Response.json({ status: "error", message: "Missing payout" });
  }
  try {
    return Response.json(await recordException(id, content));
  } catch (error) {
    return Response.json({ status: "error", message: messageOf(error) });
  }
}

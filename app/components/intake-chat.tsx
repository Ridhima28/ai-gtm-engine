"use client";

import { useState, type FormEvent } from "react";
import { IntakeChatReplySchema, IntakeDraftSchema, type IntakePatch } from "@/app/lib/intake-chat-schema";
import type { ProductIntake } from "@/app/types/product";

export function IntakeChat({ product, disabled, onBusy, onUpdate }: {
  product: ProductIntake;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onUpdate: (patch: IntakePatch) => boolean;
}) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<{ message: string; reply: string }[]>([]);
  const [error, setError] = useState("");

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !message.trim()) return;
    setError("");
    onBusy(true);
    try {
      const draft = IntakeDraftSchema.strip().safeParse(product);
      if (!draft.success) throw new Error("Check the intake field lengths before sending a chat message.");
      const response = await fetch("/api/intake/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: draft.data, message, previousTurn: turns.at(-1) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const parsed = IntakeChatReplySchema.safeParse(result);
      if (!parsed.success) throw new Error("The intake service returned an invalid update. Try again.");
      const { patch, reply } = parsed.data;
      if (!onUpdate(patch)) return;
      setTurns((current) => [...current, { message: message.trim(), reply }]);
      setMessage("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Intake chat failed.");
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-[#e5eaf2] bg-white p-5">
      <h2 className="text-sm font-bold text-[#29364b]">Intake chat</h2>
      <div role="log" className="my-3 max-h-64 space-y-3 overflow-y-auto text-xs leading-5">
        <p>Tell me what you’re building, who uses it, and how you charge.</p>
        {turns.map((turn, index) => (
          <div key={index} className="space-y-2">
            <p className="whitespace-pre-wrap rounded-lg bg-[#edf2ff] p-3">{turn.message}</p>
            <p>{turn.reply}</p>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="space-y-2">
        <label htmlFor="intake-message" className="sr-only">Intake message</label>
        <textarea id="intake-message" rows={3} maxLength={4000} value={message} disabled={disabled}
          onChange={(event) => setMessage(event.target.value)} placeholder="Describe your product…"
          className="w-full rounded-lg border border-[#dce4f2] p-3 text-xs" />
        {error && <p role="alert" className="text-xs text-red-800">{error}</p>}
        <button disabled={disabled || !message.trim()} className="rounded-lg bg-[#31569e] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
          Send
        </button>
      </form>
    </section>
  );
}

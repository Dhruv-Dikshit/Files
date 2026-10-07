"use client";

import { useActionState } from "react";
import { createProfile } from "@/server/actions";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

export function WelcomeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(createProfile, null);
  return (
    <Card className="mx-auto mt-10 max-w-md space-y-5 p-6">
      <div className="text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-2xl font-bold text-white">=</span>
        <h1 className="mt-3 text-xl font-semibold">Welcome to Evenly</h1>
        <p className="mt-1 text-sm text-zinc-500">Split trips, rent and dinners with friends. What should people call you?</p>
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" required autoFocus maxLength={60} placeholder="e.g. Dhruv" />
        </div>
        {state && !state.ok && <p className="text-sm text-orange-600">{state.error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Setting up…" : "Get started"}
        </Button>
        <p className="text-center text-xs text-zinc-500">No password — this browser remembers you.</p>
      </form>
    </Card>
  );
}

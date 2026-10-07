"use client";

import { useActionState } from "react";
import { createProfile } from "@/server/actions";
import { Button, Card, Input, Label } from "@/components/ui/primitives";

export function WelcomeForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(createProfile, null);
  return (
    <Card className="mx-auto mt-10 max-w-md space-y-5 p-6">
      <div className="text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[16px] bg-hero text-[26px] font-bold text-action">=</span>
        <h1 className="mt-4 text-[20px] font-bold leading-8">Welcome to Evenly</h1>
        <p className="mt-1 text-[12px] leading-5 text-muted">Split trips, rent and dinners with friends. What should people call you?</p>
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <div>
          <Label htmlFor="name">Your name</Label>
          <Input id="name" name="name" required autoFocus maxLength={60} placeholder="e.g. Dhruv" />
        </div>
        {state && !state.ok && <p className="text-[12px] leading-5 text-danger">{state.error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Setting up…" : "Get started"}
        </Button>
        <p className="text-center text-[11px] leading-5 text-muted">No password — this browser remembers you.</p>
      </form>
    </Card>
  );
}

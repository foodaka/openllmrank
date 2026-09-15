"use client";

import { useActionState } from "react";
import type { BrandFormInput } from "@/lib/brand-writes";
import type { BrandFormState } from "../brands/actions";

// One form for add and edit. Plain text fields, one competitor or question
// per line: no chips, no drag handles. A customer pastes a list and moves on.

export function BrandForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: BrandFormState, formData: FormData) => Promise<BrandFormState>;
  initial: BrandFormInput;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as BrandFormState);
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="brand-form">
      {state.message && (
        <p className="err" role="alert">{state.message}</p>
      )}

      <div className="field">
        <label htmlFor="brand-name">Brand name</label>
        <input
          id="brand-name"
          name="name"
          type="text"
          defaultValue={initial.name}
          required
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={errors.name ? "brand-name-error" : undefined}
        />
        {errors.name && <span className="field-error" id="brand-name-error" role="alert">{errors.name}</span>}
      </div>

      <div className="field">
        <label htmlFor="brand-website">Website</label>
        <input
          id="brand-website"
          name="website"
          type="text"
          inputMode="url"
          defaultValue={initial.website}
          placeholder="acme.com"
          required
          aria-invalid={errors.website ? true : undefined}
          aria-describedby={errors.website ? "brand-website-error" : undefined}
        />
        {errors.website && <span className="field-error" id="brand-website-error" role="alert">{errors.website}</span>}
      </div>

      <div className="field">
        <label htmlFor="brand-category">What category do buyers put you in?</label>
        <input
          id="brand-category"
          name="category"
          type="text"
          defaultValue={initial.category}
          placeholder="B2B product analytics platforms"
          required
          aria-invalid={errors.category ? true : undefined}
          aria-describedby={errors.category ? "brand-category-error" : "brand-category-help"}
        />
        {errors.category ? (
          <span className="field-error" id="brand-category-error" role="alert">{errors.category}</span>
        ) : (
          <span className="field-help" id="brand-category-help">
            The phrase a customer would type, not a positioning statement.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="brand-aliases">Other names for your brand (optional)</label>
        <input
          id="brand-aliases"
          name="aliases"
          type="text"
          defaultValue={initial.aliases}
          placeholder="Acme Inc, acme.com"
          aria-describedby="brand-aliases-help"
        />
        <span className="field-help" id="brand-aliases-help">Comma-separated. Counted as citations of you.</span>
      </div>

      <div className="field">
        <label htmlFor="brand-competitors">Competitors, one per line</label>
        <textarea
          id="brand-competitors"
          name="competitors"
          rows={5}
          defaultValue={initial.competitors}
          placeholder={"Jira\nAsana | Asana.com\nMonday.com"}
          required
          aria-invalid={errors.competitors ? true : undefined}
          aria-describedby={errors.competitors ? "brand-competitors-error" : "brand-competitors-help"}
        />
        {errors.competitors ? (
          <span className="field-error" id="brand-competitors-error" role="alert">{errors.competitors}</span>
        ) : (
          <span className="field-help" id="brand-competitors-help">
            Add aliases after a vertical bar. Three to five close matches give the sharpest read.
          </span>
        )}
      </div>

      <div className="field">
        <label htmlFor="brand-prompts">Questions your buyers ask, one per line</label>
        <textarea
          id="brand-prompts"
          name="prompts"
          rows={8}
          defaultValue={initial.prompts}
          placeholder={"What is the best project management tool for software teams?\nBest Jira alternatives for engineering teams"}
          required
          aria-invalid={errors.prompts ? true : undefined}
          aria-describedby={errors.prompts ? "brand-prompts-error" : "brand-prompts-help"}
        />
        {errors.prompts ? (
          <span className="field-error" id="brand-prompts-error" role="alert">{errors.prompts}</span>
        ) : (
          <span className="field-help" id="brand-prompts-help">
            Up to ten. Keep them the same from run to run so the trend means something.
          </span>
        )}
      </div>

      <p className="form-actions">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </button>
      </p>
    </form>
  );
}

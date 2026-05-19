"use client";

import { useEffect, useRef, useState } from "react";

type SubmitState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function ContactLink({
  children = "Contact us",
  className,
  defaultSubject = "",
}: {
  children?: React.ReactNode;
  className?: string;
  defaultSubject?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [honeypot, setHoneypot] = useState("");
  const [state, setState] = useState<SubmitState>({ kind: "idle" });

  useEffect(() => {
    setSubject(defaultSubject);
  }, [defaultSubject]);

  function open() {
    setState({ kind: "idle" });
    dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !subject.trim() || !body.trim()) return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          subject: subject.trim(),
          body: body.trim(),
          hp: honeypot,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setState({
          kind: "error",
          message: data?.error ?? `Send failed (${res.status})`,
        });
        return;
      }
      setState({ kind: "sent" });
      setBody("");
    } catch (err) {
      setState({
        kind: "error",
        message: (err as Error).message || "Network error",
      });
    }
  }

  return (
    <>
      <button type="button" className={className ?? "contact-link"} onClick={open}>
        {children}
      </button>

      <dialog
        ref={dialogRef}
        className="contact-dialog"
        onClose={() => setState({ kind: "idle" })}
      >
        <form method="dialog" className="contact-form" onSubmit={handleSubmit}>
          <span className="kicker">Contact</span>
          <h2>Send us a note</h2>
          <p className="muted">
            We&rsquo;ll reply to the email you give us, usually within a day.
          </p>

          <div className="field">
            <label htmlFor="contact-email">Your email</label>
            <input
              id="contact-email"
              type="text"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="contact-subject">Subject</label>
            <input
              id="contact-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What&rsquo;s this about?"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="contact-body">Message</label>
            <textarea
              id="contact-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Tell us what&rsquo;s on your mind."
              required
            />
          </div>

          {/* Honeypot — real users never fill this; bots do. */}
          <div className="contact-hp" aria-hidden="true">
            <label htmlFor="contact-hp">Leave this empty</label>
            <input
              id="contact-hp"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          {state.kind === "error" && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
          {state.kind === "sent" && (
            <p className="contact-success" role="status">
              Sent. We&rsquo;ll be in touch.
            </p>
          )}

          <div className="contact-actions">
            <button
              type="button"
              className="btn-text"
              onClick={close}
              disabled={state.kind === "sending"}
            >
              Close
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={state.kind === "sending" || state.kind === "sent"}
            >
              {state.kind === "sending" ? "Sending…" : "Send"}
            </button>
          </div>
        </form>
      </dialog>

      <style>{`
        .contact-link {
          background: none;
          border: none;
          padding: 0;
          color: var(--accent);
          font: inherit;
          cursor: pointer;
          border-bottom: 1px solid transparent;
          transition: border-color 120ms ease;
        }
        .contact-link:hover { border-bottom-color: var(--accent); }
        .contact-link:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: 2px;
        }

        .contact-dialog {
          border: 1px solid var(--line);
          border-radius: var(--radius-md);
          background: var(--paper);
          color: var(--ink);
          padding: 0;
          max-width: 520px;
          width: calc(100% - 32px);
        }
        .contact-dialog::backdrop {
          background: rgba(36, 31, 25, 0.4);
        }
        .contact-form {
          padding: 28px;
          display: block;
        }
        .contact-form h2 {
          font-size: 26px;
          margin: 8px 0 12px;
        }
        .contact-form textarea {
          font-size: 16px;
          resize: vertical;
        }
        .contact-actions {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 24px;
        }
        .contact-success {
          color: var(--accent);
          font-size: 14px;
          margin: 12px 0 0;
        }
        .contact-hp {
          position: absolute;
          left: -9999px;
          width: 1px;
          height: 1px;
          overflow: hidden;
        }
      `}</style>
    </>
  );
}

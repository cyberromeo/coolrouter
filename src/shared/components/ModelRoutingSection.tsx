"use client";

import { useState, useEffect } from "react";
import { readApiError } from "@/shared/utils/apiErrorMessage";

export interface ModelMapping {
  id: string;
  pattern: string;
  comboId: string;
  comboName?: string;
  priority: number;
  enabled: boolean;
  description: string;
}

interface Combo {
  id: string;
  name: string;
}

export default function ModelRoutingSection({ combos = [] }: { combos?: Combo[] }) {
  const [mappings, setMappings] = useState<ModelMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state. Priority is kept as typed: converting on every keystroke turned "-" or an
  // emptied field into 0, so a negative or retyped number could not be entered.
  const [pattern, setPattern] = useState("");
  const [comboId, setComboId] = useState("");
  const [priority, setPriority] = useState("0");
  const [description, setDescription] = useState("");

  /** Returns null when the list could not be loaded (so the caller keeps what it has). */
  const loadMappings = async (): Promise<ModelMapping[] | null> => {
    try {
      const res = await fetch("/api/model-combo-mappings");
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data?.mappings) ? data.mappings : [];
      }
    } catch {}
    return null;
  };

  useEffect(() => {
    let cancelled = false;
    loadMappings().then((data) => {
      if (!cancelled) {
        setMappings(data || []);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refetchMappings = async () => {
    const data = await loadMappings();
    if (data) setMappings(data);
  };

  const resetForm = () => {
    setPattern("");
    setComboId("");
    setPriority("0");
    setDescription("");
    setAdding(false);
    setEditingId(null);
    setError(null);
  };

  const handleSave = async () => {
    if (!pattern.trim() || !comboId || saving) return;

    const priorityValue = priority.trim() === "" ? 0 : Number(priority);
    if (!Number.isInteger(priorityValue)) {
      setError("Priority must be a whole number.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify({
        pattern: pattern.trim(),
        comboId,
        priority: priorityValue,
        description,
      });
      const res = await fetch(
        editingId ? `/api/model-combo-mappings/${editingId}` : "/api/model-combo-mappings",
        {
          method: editingId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }
      );
      if (!res.ok) {
        // Keep the form open with what was typed. It used to close as if the rule had been
        // saved, while the server had rejected it.
        setError(await readApiError(res, "Failed to save the routing rule"));
        return;
      }
      await refetchMappings();
      resetForm();
    } catch {
      setError("Failed to save the routing rule");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (m: ModelMapping) => {
    setPattern(m.pattern);
    setComboId(m.comboId);
    setPriority(String(m.priority ?? 0));
    setDescription(m.description || "");
    setEditingId(m.id);
    setError(null);
    setAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this model routing rule?")) return;
    setError(null);
    try {
      const res = await fetch(`/api/model-combo-mappings/${id}`, { method: "DELETE" });
      // 404: already gone, which is what was asked for. Anything else: the rule still
      // exists on the server, so it must not vanish from the list.
      if (!res.ok && res.status !== 404) {
        setError(await readApiError(res, "Failed to delete the routing rule"));
        return;
      }
      setMappings((prev) => prev.filter((m) => m.id !== id));
      if (editingId === id) resetForm();
    } catch {
      setError("Failed to delete the routing rule");
    }
  };

  const handleToggle = async (m: ModelMapping) => {
    setError(null);
    try {
      const res = await fetch(`/api/model-combo-mappings/${m.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !m.enabled }),
      });
      if (res.ok) {
        setMappings((prev) => prev.map((x) => (x.id === m.id ? { ...x, enabled: !x.enabled } : x)));
      } else {
        setError(await readApiError(res, "Failed to update the routing rule"));
      }
    } catch {
      setError("Failed to update the routing rule");
    }
  };

  return (
    <div className="rounded-xl border border-black/10 dark:border-white/10 bg-white/50 dark:bg-white/[0.02] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">route</span>
          <div>
            <h3 className="text-sm font-semibold">Model Routing Rules</h3>
            <p className="text-[11px] text-text-muted">
              Automatically route models to specific combos using glob patterns
            </p>
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg
                       bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">add</span>
            Add Rule
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {/* Inline form */}
      {adding && (
        <div className="mt-3 p-3 rounded-lg border border-primary/20 bg-primary/[0.03] dark:bg-primary/[0.06]">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Pattern
              </label>
              <input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="claude-sonnet*"
                className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-black/10 dark:border-white/10
                           bg-white dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[9px] text-text-muted mt-0.5">
                Use * for any chars, ? for single char. Case-insensitive.
              </p>
            </div>
            <div>
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Route to Combo
              </label>
              <select
                value={comboId}
                onChange={(e) => setComboId(e.target.value)}
                className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-black/10 dark:border-white/10
                           bg-white dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select combo...</option>
                {combos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Priority
              </label>
              <input
                type="number"
                step={1}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-black/10 dark:border-white/10
                           bg-white dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="text-[9px] text-text-muted mt-0.5">
                Higher = checked first. Use 10+ for specific patterns.
              </p>
            </div>
            <div>
              <label className="text-[10px] font-medium text-text-muted uppercase tracking-wider">
                Description
              </label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Route Opus models to frontier combo"
                className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg border border-black/10 dark:border-white/10
                           bg-white dark:bg-black/20 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={handleSave}
              disabled={!pattern.trim() || !comboId || saving}
              className="px-3 py-1 text-xs font-medium rounded-lg bg-primary text-primary-foreground
                         hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              {editingId ? "Update" : "Save"}
            </button>
            <button
              onClick={resetForm}
              className="px-3 py-1 text-xs font-medium rounded-lg
                         bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Mappings list */}
      {loading ? (
        <div className="mt-3 text-xs text-text-muted">Loading...</div>
      ) : mappings.length === 0 ? (
        <div className="mt-3 text-center py-4">
          <p className="text-xs text-text-muted">
            No routing rules configured. Requests use the global combo by default.
          </p>
          <p className="text-[10px] text-text-muted mt-1">
            Add a rule like{" "}
            <code className="px-1 py-0.5 rounded bg-black/5 dark:bg-white/5">claude-opus*</code>
            {" → "} <span className="font-medium">frontier-combo</span> to automatically route
            requests.
          </p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {mappings.map((m) => (
            <div
              key={m.id}
              className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors
                ${
                  m.enabled
                    ? "border-black/10 dark:border-white/10 bg-white/70 dark:bg-white/[0.02]"
                    : "border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.01] opacity-50"
                }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <code className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 font-mono shrink-0">
                  {m.pattern}
                </code>
                <span className="text-text-muted text-[10px]">→</span>
                <span className="text-xs font-medium text-primary truncate">
                  {m.comboName || String(m.comboId || "").slice(0, 8)}
                </span>
                {m.description && (
                  <span className="text-[10px] text-text-muted truncate hidden sm:inline">
                    {m.description}
                  </span>
                )}
                <span className="text-[9px] px-1 py-0.5 rounded bg-black/5 dark:bg-white/5 text-text-muted shrink-0">
                  P{m.priority}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleToggle(m)}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title={m.enabled ? "Disable" : "Enable"}
                  aria-label={`${m.enabled ? "Disable" : "Enable"} rule ${m.pattern}`}
                  aria-pressed={m.enabled}
                >
                  <span
                    className={`material-symbols-outlined text-[14px] ${m.enabled ? "text-emerald-500" : "text-text-muted"}`}
                  >
                    {m.enabled ? "toggle_on" : "toggle_off"}
                  </span>
                </button>
                <button
                  onClick={() => handleEdit(m)}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                  title="Edit"
                  aria-label={`Edit rule ${m.pattern}`}
                >
                  <span className="material-symbols-outlined text-[14px] text-text-muted">
                    edit
                  </span>
                </button>
                <button
                  onClick={() => handleDelete(m.id)}
                  className="p-1 rounded hover:bg-red-500/10 transition-colors"
                  title="Delete"
                  aria-label={`Delete rule ${m.pattern}`}
                >
                  <span className="material-symbols-outlined text-[14px] text-red-500">delete</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

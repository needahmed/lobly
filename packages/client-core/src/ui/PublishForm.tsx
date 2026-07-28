import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ALL_ROLES,
  DIVISION_ORDER,
  TIER_ORDER,
  formatSlotRoles,
  type LobbyCapability,
  type Role,
} from "@lobly/shared-types";
import {
  applyRankPreset,
  capabilitySignature,
  clampSlotCount,
  reconcileDraftToCapability,
  resizeSlotRoles,
  type PublishDraft,
  type RankPreset,
} from "../state/publishDraft";
import { setPublishDraft } from "../state/listingMachine";
import { c, radius, ROLE_LABEL } from "./theme";
import { Button, RoleIcon, SectionTitle, Tag } from "./components";

const inputStyle: CSSProperties = {
  background: c.surfaceAlt,
  border: `1px solid ${c.border}`,
  borderRadius: radius.md,
  color: c.text,
  padding: "10px 12px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 750,
  letterSpacing: 0.85,
  textTransform: "uppercase",
  color: c.textFaint,
  marginBottom: 6,
  display: "block",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function RoleChip({
  role,
  active,
  onClick,
}: {
  role: Role | "ANY";
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "7px 10px",
        borderRadius: radius.pill,
        border: `1px solid ${active ? c.primary : c.border}`,
        background: active
          ? "linear-gradient(135deg, rgba(66,215,255,.15), rgba(155,123,255,.11))"
          : c.surfaceAlt,
        color: active ? c.text : c.textDim,
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {role !== "ANY" && <RoleIcon role={role} size={12} />}
      {role === "ANY" ? "Any" : ROLE_LABEL[role] ?? role}
    </button>
  );
}

function SlotRolePicker({
  index,
  roles,
  onChange,
}: {
  index: number;
  roles: Role[];
  onChange: (roles: Role[]) => void;
}) {
  const isAny = roles.length === 0;
  const primary = roles[0] ?? null;
  const secondary = roles[1] ?? null;

  return (
    <div
      style={{
        background: "rgba(16,25,39,.72)",
        border: `1px solid ${primary ? c.borderStrong : c.border}`,
        borderRadius: radius.lg,
        padding: 14,
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 700 }}>Slot {index + 1}</span>
        <Tag color={c.textDim}>{formatSlotRoles(roles)}</Tag>
      </div>
      <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 6 }}>
        Looking for (primary / secondary)
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        <RoleChip
          role="ANY"
          active={isAny}
          onClick={() => onChange([])}
        />
        {ALL_ROLES.map((r) => (
          <RoleChip
            key={r}
            role={r}
            active={primary === r}
            onClick={() => {
              if (primary === r) onChange(secondary ? [secondary] : []);
              else if (secondary === r) onChange([r]);
              else onChange(secondary ? [r, secondary] : [r]);
            }}
          />
        ))}
      </div>
      {!isAny && (
        <>
          <div style={{ fontSize: 11, color: c.textFaint, marginBottom: 6 }}>
            Also OK (secondary)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_ROLES.filter((r) => r !== primary).map((r) => (
              <RoleChip
                key={r}
                role={r}
                active={secondary === r}
                onClick={() => {
                  if (secondary === r) onChange(primary ? [primary] : []);
                  else onChange(primary ? [primary, r] : [r]);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function PublishForm({
  initialDraft,
  cap,
  live,
  creatorTier,
  creatorDivision,
  onPublish,
  onUnpublish,
  onSaveEdit,
  onQueueAgain,
  canPublishOk,
  publishReason,
  status,
  editing,
}: {
  initialDraft: PublishDraft;
  cap: LobbyCapability;
  live: boolean;
  creatorTier?: string | null;
  creatorDivision?: string | null;
  onPublish: (draft: PublishDraft) => void;
  onUnpublish: () => void;
  onSaveEdit?: (draft: PublishDraft) => void;
  onQueueAgain?: () => void;
  canPublishOk: boolean;
  publishReason: string | null;
  status: string;
  editing?: boolean;
}) {
  // The form owns the draft. Host windows (Electron renderer, Overwolf desktop)
  // run in a different JS realm than the process that owns appStore, so writing
  // every keystroke across the bridge and reading it back is both lossy and
  // racy against state pushes from the main process. We only hand the finished
  // draft over on Publish / Save.
  const [draft, setDraft] = useState<PublishDraft>(initialDraft);
  const seededFor = useRef(capabilitySignature(cap));

  useEffect(() => {
    const sig = capabilitySignature(cap);
    if (sig === seededFor.current) return;
    seededFor.current = sig;
    setDraft((cur) =>
      cur.queueId === cap.queueId
        ? reconcileDraftToCapability(cur, cap)
        : initialDraft
    );
  }, [cap, initialDraft]);

  // Mirror into the shared store so the machine can publish without the form.
  useEffect(() => {
    setPublishDraft(draft);
  }, [draft]);

  const maxSlots = Math.max(1, Math.min(4, Math.max(1, cap.freeSeats)));
  const patch = (p: Partial<PublishDraft>) =>
    setDraft((cur) => ({ ...cur, ...p }));

  const setSlotCount = (n: number) => {
    const count = clampSlotCount(cap, n);
    setDraft((cur) => ({
      ...cur,
      slotCount: count,
      slotRoles: resizeSlotRoles(cur.slotRoles, count),
    }));
  };

  const setPreset = (preset: RankPreset) => {
    setDraft((cur) => ({
      ...cur,
      rankPreset: preset,
      filters:
        preset === "custom"
          ? cur.filters
          : applyRankPreset(preset, creatorTier, creatorDivision, cap.duoRules),
    }));
  };

  return (
    <div>
      <SectionTitle
        right={
          <Tag color={c.accent}>
            {cap.freeSeats} free seat{cap.freeSeats === 1 ? "" : "s"}
          </Tag>
        }
      >
        {editing ? "Edit listing" : "What are you looking for?"}
      </SectionTitle>
      <div
        style={{
          margin: "-4px 0 18px",
          color: c.textDim,
          fontSize: 12,
          lineHeight: 1.55,
          maxWidth: 680,
        }}
      >
        LOBLY uses these signals to surface your squad to compatible, verified players.
        You stay in control of every seat.
      </div>

      <Field label="Title">
        <input
          style={inputStyle}
          value={draft.title}
          maxLength={80}
          onChange={(e) => patch({ title: e.target.value })}
          disabled={live && !editing}
        />
      </Field>

      <Field label="Note (optional)">
        <textarea
          style={{ ...inputStyle, minHeight: 56, resize: "vertical" }}
          value={draft.description}
          maxLength={280}
          onChange={(e) => patch({ description: e.target.value })}
          disabled={live && !editing}
          placeholder="e.g. chill vibes, mic preferred…"
        />
      </Field>

      <Field
        label={
          cap.positional
            ? `Players needed (1–${maxSlots})`
            : `Open slots (1–${maxSlots})`
        }
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button
            size="sm"
            disabled={(live && !editing) || draft.slotCount <= 1}
            onClick={() => setSlotCount(draft.slotCount - 1)}
          >
            −
          </Button>
          <span style={{ fontWeight: 700, minWidth: 24, textAlign: "center" }}>
            {draft.slotCount}
          </span>
          <Button
            size="sm"
            disabled={(live && !editing) || draft.slotCount >= maxSlots}
            onClick={() => setSlotCount(draft.slotCount + 1)}
          >
            +
          </Button>
          {!cap.positional && (
            <span style={{ fontSize: 12, color: c.textDim }}>
              Any role fills these seats
            </span>
          )}
        </div>
      </Field>

      {cap.positional && (
        <Field label="Roles per slot">
          {Array.from({ length: draft.slotCount }).map((_, i) => (
            <SlotRolePicker
              key={i}
              index={i}
              roles={draft.slotRoles[i] ?? []}
              onChange={(roles) => {
                const next = resizeSlotRoles(draft.slotRoles, draft.slotCount);
                next[i] = roles;
                patch({ slotRoles: next });
              }}
            />
          ))}
        </Field>
      )}

      <Field label="Rank range">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {(
            [
              ["any", "Any rank"],
              ["near", "My rank ±1"],
              ["above", "My rank+"],
              ["custom", "Custom"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={draft.rankPreset === key ? "primary" : "ghost"}
              disabled={live && !editing}
              onClick={() => setPreset(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        {cap.duoRules && (
          <div style={{ fontSize: 11, color: c.warn, marginBottom: 8 }}>
            Solo/Duo: Riot rank-spread rules still apply (Master+ can't duo).
          </div>
        )}
        {draft.rankPreset === "custom" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <select
              style={inputStyle}
              value={draft.filters.minTier ?? ""}
              disabled={live && !editing}
              onChange={(e) =>
                patch({
                  filters: {
                    ...draft.filters,
                    minTier: e.target.value || undefined,
                    minDivision: draft.filters.minDivision ?? "IV",
                    allowUnranked: false,
                  },
                })
              }
            >
              <option value="">Min tier</option>
              {TIER_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              style={inputStyle}
              value={draft.filters.minDivision ?? "IV"}
              disabled={live && !editing}
              onChange={(e) =>
                patch({
                  filters: { ...draft.filters, minDivision: e.target.value },
                })
              }
            >
              {DIVISION_ORDER.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              style={inputStyle}
              value={draft.filters.maxTier ?? ""}
              disabled={live && !editing}
              onChange={(e) =>
                patch({
                  filters: {
                    ...draft.filters,
                    maxTier: e.target.value || undefined,
                    maxDivision: draft.filters.maxDivision ?? "I",
                    allowUnranked: false,
                  },
                })
              }
            >
              <option value="">Max tier</option>
              {TIER_ORDER.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              style={inputStyle}
              value={draft.filters.maxDivision ?? "I"}
              disabled={live && !editing}
              onChange={(e) =>
                patch({
                  filters: { ...draft.filters, maxDivision: e.target.value },
                })
              }
            >
              {DIVISION_ORDER.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
      </Field>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <Field label="Duration">
          <select
            style={inputStyle}
            value={draft.durationMin}
            disabled={live && !editing}
            onChange={(e) =>
              patch({ durationMin: Number(e.target.value) as 15 | 30 | 60 })
            }
          >
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
            <option value={60}>60 min</option>
          </select>
        </Field>
        <Field label="Language">
          <input
            style={inputStyle}
            value={draft.languages.join(",")}
            disabled={live && !editing}
            onChange={(e) =>
              patch({
                languages: e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
            placeholder="en"
          />
        </Field>
        <Field label="Voice">
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: c.textDim,
              marginTop: 6,
            }}
          >
            <input
              type="checkbox"
              checked={draft.voiceRequired}
              disabled={live && !editing}
              onChange={(e) => patch({ voiceRequired: e.target.checked })}
            />
            Required
          </label>
        </Field>
      </div>

      {/* Preview */}
      <div
        style={{
          background:
            "radial-gradient(circle at 100% 0%, rgba(155,123,255,.12), transparent 40%), linear-gradient(135deg, rgba(66,215,255,.07), rgba(10,17,28,.8))",
          border: `1px solid ${c.borderStrong}`,
          borderRadius: radius.lg,
          padding: 15,
          marginBottom: 16,
          fontSize: 12,
          color: c.textDim,
        }}
      >
        <div style={{ fontSize: 9, fontWeight: 800, color: c.primary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 6 }}>
          Live board preview
        </div>
        <div style={{ fontWeight: 760, fontSize: 15, color: c.text, marginBottom: 5 }}>
          {draft.title || "Untitled lobby"}
        </div>
        Looking for {draft.slotCount} ·{" "}
        {cap.positional
          ? draft.slotRoles
              .slice(0, draft.slotCount)
              .map((r) => formatSlotRoles(r))
              .join(", ")
          : "any role"}
        {draft.filters.minTier || draft.filters.maxTier
          ? ` · ${draft.filters.minTier ?? "…"}–${draft.filters.maxTier ?? "…"}`
          : " · any rank"}
      </div>

      {publishReason && !canPublishOk && (
        <div
          style={{
            background: c.lossSoft,
            border: `1px solid ${c.loss}33`,
            color: c.loss,
            borderRadius: radius.md,
            padding: "9px 12px",
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {publishReason}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {!live && (
          <Button
            variant="primary"
            disabled={!canPublishOk}
            onClick={() => onPublish(draft)}
          >
            Publish lobby
          </Button>
        )}
        {live && editing && onSaveEdit && (
          <Button variant="primary" onClick={() => onSaveEdit(draft)}>
            Save changes
          </Button>
        )}
        <Button
          disabled={status === "DRAFT" || status === "DELISTED"}
          onClick={onUnpublish}
        >
          Unpublish
        </Button>
        {(status === "PAUSED" || status === "POST_SESSION") && onQueueAgain && (
          <Button onClick={onQueueAgain}>Queue again</Button>
        )}
      </div>
    </div>
  );
}

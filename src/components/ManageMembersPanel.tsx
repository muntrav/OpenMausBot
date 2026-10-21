// Edit an existing room's roster: the same picker "New Room" uses, opened
// from the member mauses in the room header and pre-ticked with who is
// already in. Membership is the only thing this touches — the transcript
// keeps every message a departing bot already sent.
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { track } from "@/lib/analytics";
import { useStore, type Group, type GroupCoordinationMode } from "@/state/store";
import { BotPickerList } from "./BotPickerList";
import { nextMemberIds } from "@/lib/room-members";

export function ManageMembersPanel({
  group,
  onClose,
  triggerRef,
}: {
  group: Group;
  onClose: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
}) {
  const { state, dispatch } = useStore();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(group.memberIds));
  const [saveError, setSaveError] = useState<string | null>(null);
  const openedMemberIds = useRef([...group.memberIds]);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Archived bots stay listed while they are still members — otherwise a
  // room could keep a member you have no way to remove.
  const bots = useMemo(
    () => state.bots.filter((b) => !b.hidden || group.memberIds.includes(b.id)),
    [state.bots, group.memberIds],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () =>
      [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
        (element) => !element.hasAttribute("hidden"),
      );
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return event.preventDefault();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", onKey);
    return () => {
      dialog.removeEventListener("keydown", onKey);
      triggerRef.current?.focus();
    };
  }, [onClose, triggerRef]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const memberIds = nextMemberIds(
    group.memberIds,
    picked,
    bots.map((b) => b.id),
  );
  const changed = memberIds.length !== group.memberIds.length || memberIds.some((id, i) => id !== group.memberIds[i]);
  const currentMode: GroupCoordinationMode = group.coordinationMode === "chief-supervised" ? "chief-supervised" : "section";
  const [coordinationMode, setCoordinationMode] = useState<GroupCoordinationMode>(currentMode);
  const chiefCandidates = bots.filter((bot) => bot.chiefOfStaff && !bot.hidden && memberIds.includes(bot.id));
  const [supervisorBotId, setSupervisorBotId] = useState(group.supervisorBotId ?? chiefCandidates[0]?.id ?? "");
  const specialistSections = [...new Set(memberIds
    .filter((id) => id !== supervisorBotId)
    .map((id) => state.bots.find((bot) => bot.id === id)?.section?.trim() ?? ""))];
  const specialistSection = specialistSections.length === 1 && specialistSections[0] ? specialistSections[0] : null;
  const coordinationChanged =
    coordinationMode !== currentMode ||
    (coordinationMode === "chief-supervised" ? supervisorBotId !== (group.supervisorBotId ?? chiefCandidates[0]?.id ?? "") : Boolean(group.supervisorBotId));

  const save = () => {
    if (!memberIds.length) return;
    const opened = openedMemberIds.current;
    const rosterChanged =
      opened.length !== group.memberIds.length || opened.some((id, index) => id !== group.memberIds[index]);
    if (rosterChanged) {
      setSaveError("This group's members changed while the panel was open. Close it and try again.");
      return;
    }
    if (coordinationMode === "chief-supervised") {
      if (!chiefCandidates.some((bot) => bot.id === supervisorBotId)) {
        setSaveError("Choose an active Chief of Staff who is a member of this room.");
        return;
      }
      if (!specialistSection) {
        setSaveError("Chief-supervised rooms need one non-empty specialist section besides the Chief.");
        return;
      }
      if (group.section?.trim() && group.section.trim() !== specialistSection) {
        setSaveError(`This room is filed under ${group.section}, but its specialist members are in ${specialistSection}.`);
        return;
      }
    }
    if (changed || coordinationChanged) {
      dispatch({ type: "patchGroup", groupId: group.id, patch: {
        memberIds,
        coordinationMode,
        supervisorBotId: coordinationMode === "chief-supervised" ? supervisorBotId : null,
      } });
      track("room_members_changed", {
        members: memberIds.length,
        added: memberIds.filter((id) => !group.memberIds.includes(id)).length,
        removed: group.memberIds.filter((id) => !memberIds.includes(id)).length,
        coordinationMode,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Manage members of ${group.name}`}
        className="w-[340px] rounded-2xl border border-hairline/50 bg-card p-4 shadow-2xl"
      >
        <div className="mb-1 text-[15px] font-semibold text-ink">Manage Members</div>
        <div className="mb-3 truncate text-[13px] text-ink-secondary">{group.name}</div>
        <div className="mb-3 rounded-xl border border-hairline/40 bg-panel p-3">
          <label htmlFor={`room-coordination-${group.id}`} className="block text-[12px] font-medium text-ink">Room access</label>
          <select
            id={`room-coordination-${group.id}`}
            value={coordinationMode}
            onChange={(event) => setCoordinationMode(event.target.value as GroupCoordinationMode)}
            className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-card px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent"
          >
            <option value="section">Section-only (recommended)</option>
            <option value="chief-supervised">Chief-supervised</option>
          </select>
          {coordinationMode === "chief-supervised" ? (
            <>
              <label htmlFor={`room-supervisor-${group.id}`} className="mt-2 block text-[12px] font-medium text-ink">Supervising Chief</label>
              <select
                id={`room-supervisor-${group.id}`}
                value={supervisorBotId}
                onChange={(event) => setSupervisorBotId(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-hairline/50 bg-card px-2.5 py-2 text-[12px] text-ink outline-none focus:border-accent"
                disabled={!chiefCandidates.length}
              >
                {!chiefCandidates.length && <option value="">No active Chief in this room</option>}
                {chiefCandidates.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
              </select>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">
                Allows this Chief to supervise the {specialistSection ?? "one specialist"} section. Other cross-section members remain blocked.
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-secondary">Only members in the same section can delegate or post here.</p>
          )}
        </div>
        <BotPickerList bots={bots} picked={picked} onToggle={toggle} emptyHint="Create a bot first — groups are made of bots." />
        {!memberIds.length && <div className="mt-2 text-[12px] text-ink-secondary">A group needs at least one bot.</div>}
        {saveError && (
          <div role="alert" className="mt-2 text-[12px] text-danger">
            {saveError}
          </div>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg bg-raised py-2 text-[14px] font-medium text-ink hover:brightness-110"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={!memberIds.length}
            className="flex-1 rounded-lg bg-accent py-2 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            Save{memberIds.length ? ` · ${memberIds.length} ${memberIds.length === 1 ? "bot" : "bots"}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}

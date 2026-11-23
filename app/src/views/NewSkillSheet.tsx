import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import { cx, validateSkillName } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { Sheet } from "../components/overlay";
import { Button, TextArea, TextField } from "../components/ui";

const MAX_DESC = 1024;

export function NewSkillSheet() {
  const { newSkillOpen, setNewSkillOpen } = useNav();
  return (
    <Sheet open={newSkillOpen} onClose={() => setNewSkillOpen(false)} width={460} label="New Skill">
      {newSkillOpen && <Form close={() => setNewSkillOpen(false)} />}
    </Sheet>
  );
}

function Form({ close }: { close: () => void }) {
  const { inventory, mySkills, settings } = useData();
  const { rescan, refreshMySkills } = useActions();
  const { go } = useNav();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [name, description]);

  const id = name.trim();
  const invalid = validateSkillName(id);
  const taken = !!id && !!inventory?.skills.some((s) => s.id === id);
  const nameProblem = invalid ?? (taken ? `A skill named “${id}” already exists.` : null);
  const tooLong = description.length > MAX_DESC;
  const ok = !!id && !nameProblem && !tooLong;
  const dir = mySkills?.displayDir ?? settings?.mySkillsDir ?? "~/Skills";

  const create = async () => {
    setTouched(true);
    if (!ok || busy) return;
    setBusy(true);
    try {
      await api.createSkill(id, description.trim());
      await Promise.all([rescan({ quiet: true }), refreshMySkills()]);
      close();
      go("mine", { selectedId: id });
      toast(`Created ${id}`, { description: `${dir}/${id}/SKILL.md` });
    } catch (e) {
      setError(errorMessage(e));
    }
    setBusy(false);
  };

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <div className="px-5 pt-5">
        <div className="text-[13px] font-semibold">New Skill</div>
        <p className="mt-0.5 text-[11.5px] leading-snug text-fg-2">
          Creates <span className="font-mono text-[11px]">{dir}/{id || "name"}/SKILL.md</span> and makes it available to your agents.
        </p>
      </div>
      <div className="mt-4 grid grid-cols-[86px_1fr] items-start gap-x-3 gap-y-3 px-5">
        <label htmlFor="ns-name" className="pt-[4px] text-right text-[13px]">
          Name:
        </label>
        <div>
          <TextField
            id="ns-name"
            data-autofocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setTouched(true);
            }}
            placeholder="pr-description"
            className={cx("w-full font-mono text-[12.5px]", touched && nameProblem && "border-red")}
            aria-invalid={!!(touched && nameProblem)}
            aria-describedby="ns-name-hint"
            maxLength={80}
          />
          <div id="ns-name-hint" className={cx("mt-1 text-[11px] leading-snug", touched && nameProblem ? "text-red" : "text-fg-3")}>
            {touched && nameProblem ? nameProblem : "Lowercase letters, digits and single hyphens. Up to 64 characters."}
          </div>
        </div>
        <label htmlFor="ns-desc" className="pt-[4px] text-right text-[13px]">
          Description:
        </label>
        <div>
          <TextArea
            id="ns-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What it does and when an agent should use it."
            rows={4}
            className={cx("w-full text-[12.5px]", tooLong && "border-red")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void create();
              }
            }}
          />
          <div className={cx("mt-1 flex justify-between text-[11px]", tooLong ? "text-red" : "text-fg-3")}>
            <span>Agents read this to decide when to load the skill.</span>
            <span className="tabular-nums">
              {description.length}/{MAX_DESC}
            </span>
          </div>
        </div>
      </div>
      {error && <div className="mx-5 mt-3 text-[12px] text-red">{error}</div>}
      <div className="mt-5 flex justify-end gap-2 px-5 pb-4">
        <Button size="lg" className="min-w-[76px]" onClick={close}>
          Cancel
        </Button>
        <Button size="lg" type="submit" variant="primary" className="min-w-[76px]" disabled={!ok} loading={busy}>
          Create
        </Button>
      </div>
    </form>
  );
}

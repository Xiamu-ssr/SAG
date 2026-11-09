import { useEffect, useId, useRef, useState } from "react";
import { Gauge } from "@phosphor-icons/react";
import { maxSpeed, minSpeed } from "../core/speed";

export default function SpeedControl({speed, onSpeed}: {
  speed: number;
  onSpeed: (value: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number>();
  const panelId = useId();
  const slider = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const changeSpeed = useRef(onSpeed);
  changeSpeed.current = onSpeed;
  const label = Number((draft ?? speed).toFixed(2)) + "×";

  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const commit = () => {
      void changeSpeed.current(input.valueAsNumber).finally(() => setDraft(undefined));
    };
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [open]);

  return (
    <div className="speed-control"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setDraft(undefined);
        }
      }}
      onKeyDown={event => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          setDraft(undefined);
          button.current?.focus();
        }
      }}>
      <button ref={button} className="outline-button speed-toggle" aria-expanded={open}
        aria-controls={panelId} aria-label={`速度 ${label}`} onClick={() => setOpen(!open)}>
        <Gauge size={17} />{label}
      </button>
      {open && <div className="speed-panel" id={panelId}>
        <label htmlFor={panelId + "-slider"}>速度 <output>{label}</output></label>
        <input ref={slider} id={panelId + "-slider"} aria-label="速度" aria-valuetext={label}
          type="range" min={minSpeed} max={maxSpeed} step="any" value={draft ?? speed}
          onChange={event => setDraft(event.currentTarget.valueAsNumber)} />
        <div className="speed-limits"><span>0.1×</span><span>10×</span></div>
      </div>}
    </div>
  );
}

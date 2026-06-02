import type { AnsStudy } from "@shared/ansStudy";
import { User } from "lucide-react";
import { ProvFieldRow } from "./ProvField";

interface Props {
  study: AnsStudy;
}

export function DemographicsCard({ study }: Props) {
  const p = study.patient;
  const m = study.fileMetadata;
  const a = study.anthropometrics;

  return (
    <section
      className="rounded-2xl bg-card/50 border border-border/30 p-4 md:p-5"
      data-testid="card-demographics"
    >
      <header className="flex items-center gap-2 mb-3">
        <User className="w-4 h-4" style={{ color: "var(--ps-brand-cyan, #4a9eff)" }} />
        <h3 className="text-[11px] tracking-[0.18em] uppercase text-muted-foreground font-medium">
          Patient demographics
        </h3>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <ProvFieldRow label="Last name" field={p.lastName} />
        <ProvFieldRow label="First name" field={p.firstName} />
        <ProvFieldRow label="DOB" field={p.dob} />
        <ProvFieldRow label="Age" field={p.ageAtStudy} unit="yr" />
        <ProvFieldRow label="Sex" field={p.sex} />
        <ProvFieldRow label="Physician" field={p.physician} />
        <ProvFieldRow label="MRN" field={p.mrn} />
        <ProvFieldRow label="Study date" field={m.studyDate} />
        <ProvFieldRow label="Procedure" field={m.procedureType} />
        <ProvFieldRow label="Height" field={a.heightInches} unit="in" />
        <ProvFieldRow label="Weight" field={a.weightLbs} unit="lb" />
        <ProvFieldRow label="BMI" field={a.bmi} />
      </div>
    </section>
  );
}

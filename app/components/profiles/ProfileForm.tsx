"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import {
  FIELD_LIMITS,
  profileDraftSchema,
  updateProfileSchema,
} from "../../../lib/db/students/students.schema";
import {
  studentsKeys,
  useCreateProfile,
  useMyContact,
  useUpdateContact,
  useUpdateProfile,
  useViewerProfile,
  useViewerSession,
} from "../../../lib/db/students/students.hooks";

import { BLOOD_GROUPS, SECTION_LABELS } from "../../../types/Student";
import { allSections, seriesFromRoll } from "../../../types/series";

import { Button, buttonClasses } from "../ui/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
  ToggleField,
} from "../ui/Field";
import { Alert } from "../ui/Icon";
import { Skeleton } from "../ui/StateBlock";
import { ImagePicker } from "./ImagePicker";
import { SignInPanel } from "./SignInPanel";

import type {
  ProfilePicture,
  Section,
  SectionFilter,
} from "../../../types/Student";

interface Values {
  fullName: string;
  nickname: string;
  roll: string;
  sec: Section;
  bloodGroup: string;
  bio: string;
  hobby: string;
  fbProfile: string;
  mobileNumber: string;
  published: boolean;
}

const EMPTY: Values = {
  fullName: "",
  nickname: "",
  roll: "",
  sec: "a",
  bloodGroup: "",
  bio: "",
  hobby: "",
  fbProfile: "",
  mobileNumber: "",
  published: true,
};

type FieldErrors = Partial<Record<keyof Values, string>>;

/** First message per field, from a Zod failure. */
function toFieldErrors(issues: { path: PropertyKey[]; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};

  for (const issue of issues) {
    const key = String(issue.path[0] ?? "") as keyof Values;
    if (key && !errors[key]) errors[key] = issue.message;
  }

  return errors;
}

export interface ProfileFormProps {
  mode: "create" | "update";
}

export function ProfileForm({ mode }: ProfileFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: session, isPending: sessionPending } = useViewerSession();
  const { data: viewer, isPending: viewerPending } = useViewerProfile();
  const { data: contact, isPending: contactPending } = useMyContact();

  const createProfile = useCreateProfile();
  const updateProfile = useUpdateProfile();
  const updateContact = useUpdateContact();

  const [values, setValues] = useState<Values>(EMPTY);
  const [picture, setPicture] = useState<ProfilePicture>({ publicId: "", url: "" });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Seed once, when the server data lands. Keyed on the profile id so a
  // re-fetch of the same profile does not stomp on in-progress edits.
  useEffect(() => {
    if (hydrated) return;

    if (mode === "update" && viewer) {
      setValues({
        fullName: viewer.fullName,
        nickname: viewer.nickname,
        roll: viewer.roll,
        sec: viewer.sec,
        bloodGroup: viewer.bloodGroup,
        bio: viewer.bio,
        hobby: viewer.hobby,
        fbProfile: viewer.fbProfile,
        mobileNumber: contact?.mobileNumber ?? "",
        published: viewer.published,
      });
      setPicture(viewer.profilePicture ?? { publicId: "", url: "" });
      setHydrated(true);
    }

    if (mode === "create" && contact) {
      setValues((prev) => ({ ...prev, mobileNumber: contact.mobileNumber ?? "" }));
      setHydrated(true);
    }
  }, [hydrated, mode, viewer, contact]);

  function set<K extends keyof Values>(key: K, value: Values[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
    // Clear a field error as soon as the user edits that field.
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  }

  // The section select follows the roll's series. Deriving `sec` while typing
  // is a convenience only — the select stays editable, because section
  // assignment has documented manual overrides.
  const availableSections =
    seriesFromRoll(values.roll)?.sections ?? allSections();

  function onRollChange(roll: string) {
    set("roll", roll);
    const derived = seriesFromRoll(roll)?.sectionFromRoll(roll);
    if (derived && derived !== values.sec) set("sec", derived);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const draft = {
      fullName: values.fullName,
      nickname: values.nickname,
      roll: values.roll,
      sec: values.sec,
      bloodGroup: values.bloodGroup,
      bio: values.bio,
      hobby: values.hobby,
      fbProfile: values.fbProfile,
      profilePicture: picture,
    };

    // Same schemas the server uses, so the user sees the real message instead of
    // a generic failure. The server revalidates regardless.
    const parsed =
      mode === "create"
        ? profileDraftSchema.safeParse(draft)
        : updateProfileSchema.safeParse({ ...draft, published: values.published });

    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error.issues));
      // Bring the first problem into view; otherwise an off-screen error looks
      // like a button that does nothing.
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setErrors({});

    if (mode === "create") {
      const result = await createProfile
        .mutateAsync({ draft: parsed.data, mobileNumber: values.mobileNumber })
        .catch(() => null);

      if (!result) {
        setFormError("Could not save your profile. Try again.");
        return;
      }

      if (!result.ok) {
        setFormError(result.error);
        return;
      }

      toast.success("Profile created");
      router.push(`/profiles/${result.profile.id}`);
      router.refresh();
      return;
    }

    const result = await updateProfile.mutateAsync(parsed.data).catch(() => null);

    if (!result) {
      setFormError("Could not save your changes. Try again.");
      return;
    }

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    // The mobile number is a separate private document with its own action.
    if (values.mobileNumber !== (contact?.mobileNumber ?? "")) {
      const saved = await updateContact.mutateAsync(values.mobileNumber).catch(() => null);

      if (!saved?.ok) {
        setFormError(
          saved?.error ?? "Profile saved, but your mobile number could not be updated.",
        );
        return;
      }
    }

    await queryClient.invalidateQueries({ queryKey: studentsKeys.all });
    setFormError(null);
    toast.success("Changes saved");
  }

  async function removeServerImage() {
    const response = await fetch("/api/profiles/delete-image", { method: "DELETE" });
    return response.ok;
  }

  if (sessionPending || viewerPending || contactPending) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  if (!session) {
    return (
      <SignInPanel
        context={
          mode === "create"
            ? "Sign in to create your directory profile."
            : "Sign in to edit your profile."
        }
      />
    );
  }

  if (mode === "update" && !viewer) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-fg">
            You don&apos;t have a profile yet
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            Signed in as <span className="font-semibold text-fg">{session.email}</span>. Create
            your profile to appear in the directory.
          </p>
          <Link href="/profiles/create" className={`${buttonClasses("primary", "sm")} mt-6`}>
            Create profile
          </Link>
        </div>
      </div>
    );
  }

  if (mode === "create" && viewer) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
        <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
          <h1 className="text-xl font-bold tracking-tight text-fg">
            You already have a profile
          </h1>
          <p className="mt-2 text-sm text-fg-muted">
            Signed in as{" "}
            <span className="font-semibold text-fg">{viewer.email}</span>. Only one
            profile is allowed per account.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link
              href={`/profiles/${viewer.id}`}
              className={buttonClasses("primary", "sm")}
            >
              View profile
            </Link>
            <Link href="/profiles/update" className={buttonClasses("secondary", "sm")}>
              Edit profile
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const creating = mode === "create";
  const saving = createProfile.isPending || updateProfile.isPending || updateContact.isPending;
  const busy = saving;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 lg:py-12">
      <h1 className="text-2xl font-bold tracking-tight text-fg">
        {creating ? "Create your profile" : "Edit profile"}
      </h1>
      <p className="mt-1.5 text-sm text-fg-muted">
        Signed in as <span className="font-semibold text-fg">{session.email}</span>.
        {creating
          ? " Only full name and roll are required — you can fill in the rest later."
          : " Your email address cannot be changed."}
      </p>

      <form
        onSubmit={onSubmit}
        noValidate
        className="mt-6 space-y-6 rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8"
      >
        <section aria-labelledby="section-photo" className="space-y-3">
          <h2
            id="section-photo"
            className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
          >
            Photo
          </h2>
          <ImagePicker
            name={values.fullName || "Profile"}
            picture={picture}
            onChange={setPicture}
            onServerRemove={creating ? undefined : removeServerImage}
            disabled={busy}
          />
        </section>

        <section aria-labelledby="section-about" className="space-y-4">
          <h2
            id="section-about"
            className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
          >
            About you
          </h2>

          <TextField
            label="Full name"
            required
            value={values.fullName}
            maxLength={FIELD_LIMITS.fullName}
            onChange={(event) => set("fullName", event.target.value)}
            error={errors.fullName}
            autoComplete="name"
          />

          <TextField
            label="Nickname"
            hint="Optional. Shown under your name."
            value={values.nickname}
            maxLength={FIELD_LIMITS.nickname}
            onChange={(event) => set("nickname", event.target.value)}
            error={errors.nickname}
          />

          <TextAreaField
            label="Bio"
            hint="A sentence or two about yourself."
            value={values.bio}
            maxLength={FIELD_LIMITS.bio}
            onChange={(event) => set("bio", event.target.value)}
            error={errors.bio}
          />

          <TextField
            label="Hobby"
            hint="Optional."
            value={values.hobby}
            maxLength={FIELD_LIMITS.hobby}
            onChange={(event) => set("hobby", event.target.value)}
            error={errors.hobby}
          />
        </section>

        <section aria-labelledby="section-batch" className="space-y-4">
          <h2
            id="section-batch"
            className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
          >
            Batch
          </h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Roll"
              required
              inputMode="numeric"
              placeholder="2403001"
              value={values.roll}
              onChange={(event) => onRollChange(event.target.value)}
              error={errors.roll}
            />

            <SelectField
              label="Section"
              required
              value={values.sec}
              onChange={(event) => set("sec", event.target.value as Section)}
              error={errors.sec}
            >
              {availableSections.map((value) => (
                <option key={value} value={value}>
                  {SECTION_LABELS[value as SectionFilter]}
                </option>
              ))}
            </SelectField>
          </div>

          <SelectField
            label="Blood group"
            value={values.bloodGroup}
            onChange={(event) => set("bloodGroup", event.target.value)}
            error={errors.bloodGroup}
          >
            <option value="">Prefer not to say</option>
            {BLOOD_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </SelectField>
        </section>

        <section aria-labelledby="section-links" className="space-y-4">
          <h2
            id="section-links"
            className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
          >
            Links
          </h2>

          <TextField
            label="Facebook profile"
            type="url"
            inputMode="url"
            placeholder="https://facebook.com/your.profile"
            hint="Optional."
            value={values.fbProfile}
            onChange={(event) => set("fbProfile", event.target.value)}
            error={errors.fbProfile}
          />
        </section>

        <section aria-labelledby="section-private" className="space-y-4">
          <h2
            id="section-private"
            className="text-xs font-bold uppercase tracking-[0.14em] text-fg-subtle"
          >
            Private
          </h2>

          <TextField
            label="Mobile number"
            type="tel"
            inputMode="tel"
            hint="Stored privately. Never shown in the directory."
            value={values.mobileNumber}
            onChange={(event) => set("mobileNumber", event.target.value)}
            error={errors.mobileNumber}
          />

          {creating ? null : (
          <div className="rounded-control border border-border bg-surface-sunken p-4">
            <ToggleField
              name="published"
              label="Show my profile in the directory"
              hint="When off, only you can see your profile."
              checked={values.published}
              onChange={(checked) => set("published", checked)}
            />
          </div>
          )}
        </section>

        {formError ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm font-medium text-danger"
          >
            <Alert className="mt-0.5 size-4 shrink-0" />
            {formError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-6">
          <Button
            type="submit"
            busy={saving}
            busyLabel={creating ? "Creating profile…" : "Saving…"}
          >
            {creating ? "Create profile" : "Save changes"}
          </Button>
          <Link
            href={viewer ? `/profiles/${viewer.id}` : "/"}
            className={buttonClasses("secondary", "md")}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

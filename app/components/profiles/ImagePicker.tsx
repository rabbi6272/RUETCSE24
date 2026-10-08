"use client";

import { useRef, useState } from "react";

import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Alert, Camera } from "../ui/Icon";
import { Spinner } from "../ui/Button";

import type { ProfilePicture } from "../../../types/Student";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp";

export interface ImagePickerProps {
  name: string;
  picture: ProfilePicture;
  onChange: (picture: ProfilePicture) => void;
  /** Server-side path that removes the caller's current photo. */
  onServerRemove?: () => Promise<boolean>;
  disabled?: boolean;
}

/**
 * Uploads through the authenticated route, which scopes the Cloudinary folder to
 * the caller's uid. The file is validated here for size and type as a fast
 * pre-check, but the route re-verifies the bytes with sharp, so a renamed
 * executable still cannot get through.
 */
export function ImagePicker({
  name,
  picture,
  onChange,
  onServerRemove,
  disabled,
}: ImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busyLoading, setBusyLoading] = useState(false);
  const [busyDeleting, setBusyDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }

    if (file.size > MAX_BYTES) {
      setError("That image is larger than 5 MB.");
      return;
    }

    setBusyLoading(true);

    try {
      const body = new FormData();
      body.append("profile", file);

      const response = await fetch("/api/profiles/upload-image", {
        method: "POST",
        body,
      });

      const data = (await response.json()) as {
        success?: boolean;
        url?: string;
        publicId?: string;
        error?: string;
      };

      if (!response.ok || !data.success || !data.url || !data.publicId) {
        setError(data.error ?? "Upload failed. Try again.");
        return;
      }

      onChange({ publicId: data.publicId, url: data.url });
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusyLoading(false);
      // Allow re-selecting the same file after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setError(null);
    setBusyDeleting(true);

    try {
      if (onServerRemove) {
        const ok = await onServerRemove();
        if (!ok) {
          setError("Could not remove the stored image. Try again.");
          return;
        }
      }

      onChange({ publicId: "", url: "" });
    } finally {
      setBusyDeleting(false);
      setBusyLoading(false);
    }
  }

  const hasImage = Boolean(picture.url);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4">
        <Avatar name={name} src={picture.url} size="xxl" />

        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={busyLoading}
            disabled={busyLoading || disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Camera className="size-4" />
            {hasImage ? "Change photo" : "Upload photo"}
          </Button>

          {hasImage && (
            <Button
              type="button"
              variant="danger"
              size="sm"
              busy={busyDeleting}
              disabled={busyDeleting || disabled}
              onClick={() => void remove()}
            >
              Remove
            </Button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only-focusable"
        disabled={disabled || busyLoading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <p className="flex items-center gap-1.5 text-xs text-fg-muted">
        JPEG, PNG, or WebP up to 5 MB. A square image works best.
      </p>

      {error ? (
        <p role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <Alert className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
}

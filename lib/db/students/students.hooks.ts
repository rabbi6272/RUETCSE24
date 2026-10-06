"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { getProfileDoc, listPublishedProfiles } from "./students.repo";
import {
  completePasswordRotationAction,
  createProfileAction,
  getMyContactAction,
  getMyProfileAction,
  getUnclaimedCountAction,
  signInAction,
  signOutAction,
  updateContactAction,
  updateProfileAction,
} from "./students.server";

import type { Profile } from "../../../types/Student";

/**
 * Client-side data access.
 *
 * Hooks never import Firestore directly — they go through a repo — and they
 * never import React-dependent code from the service layer. Server state lives
 * only here, so the Zustand mirror of profiles is no longer needed.
 */

export const studentsKeys = {
  all: ["profiles"] as const,
  list: (series: string) => [...studentsKeys.all, "list", series] as const,
  /** Prefix matching every series' directory cache. */
  get lists() {
    return [...studentsKeys.all, "list"] as const;
  },
  detail: (id: string) => [...studentsKeys.all, "detail", id] as const,
  unclaimedCount: () => [...studentsKeys.all, "unclaimed-count"] as const,
  viewer: () => [...studentsKeys.all, "viewer"] as const,
  contact: () => [...studentsKeys.all, "contact"] as const,
};

function byRoll(a: Profile, b: Profile): number {
  return a.roll.localeCompare(b.roll, undefined, { numeric: true });
}

export function useProfiles(series: string) {
  return useQuery({
    queryKey: studentsKeys.list(series),
    queryFn: () => listPublishedProfiles(series),
    select: (profiles) => [...profiles].sort(byRoll),
    staleTime: 60_000,
    enabled: Boolean(series),
  });
}

/**
 * Detail view. `initialData` is seeded from whichever series directory the
 * visitor has already loaded, so opening a card does not flash a skeleton, and
 * no separate request is made at all for a profile already in a list.
 */
export function useProfile(id: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: studentsKeys.detail(id),
    queryFn: () => getProfileDoc(id),
    initialData: () => {
      const lists = queryClient.getQueriesData<Profile[]>({
        queryKey: studentsKeys.lists,
      });

      for (const [, profiles] of lists) {
        const hit = profiles?.find((profile) => profile.id === id);
        if (hit) return hit;
      }
      return null;
    },
    staleTime: 60_000,
  });
}

/** Unclaimed legacy count. `enabled=false` skips the fetch for series without legacy data. */
export function useUnclaimedCount(enabled = true) {
  return useQuery({
    queryKey: studentsKeys.unclaimedCount(),
    queryFn: getUnclaimedCountAction,
    staleTime: 5 * 60_000,
    enabled,
  });
}

/**
 * The signed-in viewer's own profile, or `null` when signed out.
 *
 * Used to decide whether to offer edit affordances. Kept as a query rather than
 * a prop so the decision survives navigation without a server round trip per
 * page, and so signing out clears it along with everything else.
 */
export function useViewerProfile() {
  return useQuery({
    queryKey: studentsKeys.viewer(),
    queryFn: getMyProfileAction,
    staleTime: 60_000,
  });
}

/**
 * The caller's own private contact record. Kept out of the public profile
 * payload, so the edit form fetches it explicitly.
 */
export function useMyContact() {
  return useQuery({
    queryKey: studentsKeys.contact(),
    queryFn: getMyContactAction,
    staleTime: 60_000,
  });
}

function useInvalidateProfiles() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: studentsKeys.all });
  };
}

export function useSignIn() {
  const invalidate = useInvalidateProfiles();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      signInAction(email, password),
    onSuccess: (result) => {
      if (result.ok) invalidate();
    },
  });
}

/**
 * Rotation ends the session by design, so there is deliberately no cache
 * invalidation here: the caller routes back to sign-in with the new password.
 */
export function useCompletePasswordRotation() {
  return useMutation({
    mutationFn: (input: {
      currentPassword: string;
      newPassword: string;
      sec?: string;
    }) => completePasswordRotationAction(input),
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOutAction,
    onSuccess: () => {
      // Everything cached belongs to the previous user, so drop it rather than
      // showing a signed-out visitor the previous account's data.
      queryClient.clear();
    },
  });
}

export function useCreateProfile() {
  const invalidate = useInvalidateProfiles();

  return useMutation({
    mutationFn: ({ draft, mobileNumber }: { draft: unknown; mobileNumber: string }) =>
      createProfileAction(draft, mobileNumber),
    onSuccess: (result) => {
      if (result.ok) invalidate();
    },
  });
}

export function useUpdateProfile() {
  const invalidate = useInvalidateProfiles();

  return useMutation({
    mutationFn: (patch: unknown) => updateProfileAction(patch),
    onSuccess: (result) => {
      if (result.ok) invalidate();
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mobileNumber: string) => updateContactAction(mobileNumber),
    onSuccess: () => {
      // Contact changes are not public data, but the list caches are cheap to
      // refresh wholesale and this avoids knowing which series is on screen.
      queryClient.invalidateQueries({ queryKey: studentsKeys.all });
    },
  });
}

export const COLLECTIONS = {
  /** Public directory data. `profiles/{uid}`, uid === Firebase Auth user id. */
  profiles: "profiles",
  /** Pre-migration profiles awaiting a claim. Admin SDK only. */
  legacyProfiles: "legacyProfiles",
  /** OTP attempt counters and cooldowns. Admin SDK only. */
  rateLimits: "rateLimits",
  /** `roll -> uid`, so a roll can only ever be claimed once. Admin SDK only. */
  rollIndex: "rollIndex",
} as const;

/** Document under `profiles/{uid}/private/`. Denied to all clients by rules. */
export const PRIVATE_CONTACT_DOC = "contact";

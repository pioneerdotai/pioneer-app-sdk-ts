import { failure } from "../error.js";

export type ProfileIdentity = {
  readonly type: "human" | "agent";
  readonly id: string;
};

export interface AppProfile extends ProfileIdentity {
  readonly displayName: string;
  readonly nickname: string;
  readonly avatarRevision: string | null;
}

export interface ResolveProfilesOptions {
  includeSelf?: boolean;
  identities?: readonly ProfileIdentity[];
  signal?: AbortSignal;
}

export interface ResolvedProfiles {
  readonly self?: AppProfile;
  readonly profiles: readonly AppProfile[];
}

export interface AppProfiles {
  resolve(options: ResolveProfilesOptions): Promise<ResolvedProfiles>;
  avatarUrl(profile: AppProfile): string | null;
}

const profilePath = "_pioneer/profiles";
const validId = /^[A-Za-z0-9]{21}$/;
const validRevision = /^[0-9a-f]{64}$/;

function isIdentity(value: unknown): value is ProfileIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as Partial<ProfileIdentity>;
  return (identity.type === "human" || identity.type === "agent")
    && typeof identity.id === "string" && validId.test(identity.id);
}

function decodeProfile(value: unknown): AppProfile {
  if (!isIdentity(value)) throw failure("sdk.invalid_response");
  const wire = value as ProfileIdentity & {
    display_name?: unknown;
    nickname?: unknown;
    avatar_revision?: unknown;
  };
  const { type, id, display_name, nickname, avatar_revision } = wire;
  if (typeof display_name !== "string" || typeof nickname !== "string"
      || (avatar_revision !== null
        && (typeof avatar_revision !== "string" || !validRevision.test(avatar_revision)))) {
    throw failure("sdk.invalid_response");
  }
  return { type, id, displayName: display_name, nickname, avatarRevision: avatar_revision };
}

export function createProfiles(url: (path: string) => string, lifetime: AbortSignal): AppProfiles {
  return Object.freeze({
    async resolve({ includeSelf = false, identities = [], signal }: ResolveProfilesOptions) {
      if (!Array.isArray(identities) || identities.length > 64
          || identities.some(identity => !isIdentity(identity))) {
        throw failure("sdk.invalid_profile_request");
      }
      const endpoint = url(profilePath + "/resolve");
      const requestSignal = AbortSignal.any([
        lifetime, AbortSignal.timeout(15000), ...(signal ? [signal] : []),
      ]);
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "omit",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          include_self: includeSelf,
          identities: identities.map(({ type, id }) => ({ type, id })),
        }),
        signal: requestSignal,
      }).catch(() => {
        throw failure(requestSignal.aborted ? "sdk.cancelled" : "sdk.profiles_unavailable");
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw failure("sdk.profiles_unavailable");
      }
      const payload = await response.json().catch(() => { throw failure("sdk.invalid_response"); });
      if (!payload || !Array.isArray(payload.profiles) || payload.profiles.length > identities.length) {
        throw failure("sdk.invalid_response");
      }
      const pending = new Set(identities.map(({ type, id }) => `${type}:${id}`));
      const profiles = payload.profiles.map((entry: unknown) => {
        const profile = decodeProfile(entry);
        if (!pending.delete(`${profile.type}:${profile.id}`)) throw failure("sdk.invalid_response");
        return profile;
      });
      if (payload.self === undefined) return { profiles };
      const self = decodeProfile(payload.self);
      if (!includeSelf || self.type !== "human") throw failure("sdk.invalid_response");
      return { self, profiles };
    },
    avatarUrl(profile: AppProfile) {
      if (!isIdentity(profile)) throw failure("sdk.invalid_profile_request");
      const revision = profile.avatarRevision;
      if (revision === null) return null;
      if (typeof revision !== "string" || !validRevision.test(revision)) throw failure("sdk.invalid_profile_request");
      return url(`${profilePath}/${profile.type}/${profile.id}/avatar/${revision}`);
    },
  });
}

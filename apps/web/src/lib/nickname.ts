interface DisplayNameSource {
  displayName: string | null;
  oopsId: string;
}

/**
 * 昵称展示回退：未设置昵称（null/空串）时回退为裸 oops ID（不带 oops_ 前缀）。
 * /profile 页与头像菜单共用，保证默认昵称两处一致。
 */
export function resolveDisplayName(profile: DisplayNameSource): string {
  return profile.displayName || profile.oopsId;
}

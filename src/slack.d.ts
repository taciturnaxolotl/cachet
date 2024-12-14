/**
 * Response from Slack's users.info API endpoint
 */
export interface SlackUserInfoResponse {
  /** Whether the request was successful */
  ok: boolean;
  /** The user information if found */
  user?: SlackUser;
  /** Error message if request failed */
  error?: string;
}

/**
 * Response from Slack's emoji.list API endpoint
 */
export interface SlackEmojiListResponse {
  /** Whether the request was successful */
  ok: boolean;
  /** Map of emoji names to their image URLs */
  emoji?: Record<string, string>;
  /** Error message if request failed */
  error?: string;
}

/**
 * A Slack user's information
 */
export interface SlackUser {
  /** Unique identifier for the user */
  id: string;
  /** ID of the team the user belongs to */
  team_id: string;
  /** Username */
  name: string;
  /** Whether the user has been deactivated */
  deleted: boolean;
  /** User's color preference */
  color: string;
  /** User's full name */
  real_name: string;
  /** User's timezone identifier */
  tz: string;
  /** Display label for the timezone */
  tz_label: string;
  /** Timezone offset in seconds */
  tz_offset: number;
  /** Extended profile information */
  profile: SlackUserProfile;
  /** Whether user is a workspace admin */
  is_admin: boolean;
  /** Whether user is a workspace owner */
  is_owner: boolean;
  /** Whether user is the primary workspace owner */
  is_primary_owner: boolean;
  /** Whether user has restricted access */
  is_restricted: boolean;
  /** Whether user has ultra restricted access */
  is_ultra_restricted: boolean;
  /** Whether user is a bot */
  is_bot: boolean;
  /** Timestamp of last update to user info */
  updated: number;
  /** Whether user is an app user */
  is_app_user: boolean;
  /** Whether user has two-factor auth enabled */
  has_2fa: boolean;
}

/**
 * Extended profile information for a Slack user
 */
export interface SlackUserProfile {
  /** Hash of user's profile picture */
  avatar_hash: string;
  /** User's status text */
  status_text: string;
  /** Emoji shown in user's status */
  status_emoji: string;
  /** User's full name */
  real_name: string;
  /** User's display name */
  display_name: string;
  /** Normalized version of real name */
  real_name_normalized: string;
  /** Normalized version of display name */
  display_name_normalized: string;
  /** User's email address */
  email: string;
  /** Original size profile image URL */
  image_original: string;
  /** 24x24 profile image URL */
  image_24: string;
  /** 32x32 profile image URL */
  image_32: string;
  /** 48x48 profile image URL */
  image_48: string;
  /** 72x72 profile image URL */
  image_72: string;
  /** 192x192 profile image URL */
  image_192: string;
  /** 512x512 profile image URL */
  image_512: string;
  /** Team ID the profile belongs to */
  team: string;
}

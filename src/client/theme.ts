/** JSON theme snapshot: native field names are retained without aliases. */
export type ThemeMode = "light" | "dark";
export type ThemeValue = null | boolean | number | string | readonly ThemeValue[] | ThemeObject;
export interface ThemeObject { readonly [key: string]: ThemeValue | undefined }

/** Resolved native colors, including roles absent from a user's theme file. */
export const THEME_COLOR_KEYS = [
  "accent",
  "accent_foreground",
  "accordion",
  "background",
  "border",
  "button",
  "button_active",
  "button_foreground",
  "button_hover",
  "button_danger",
  "button_danger_active",
  "button_danger_foreground",
  "button_danger_hover",
  "button_info",
  "button_info_active",
  "button_info_foreground",
  "button_info_hover",
  "button_primary",
  "button_primary_active",
  "button_primary_foreground",
  "button_primary_hover",
  "button_secondary",
  "button_secondary_active",
  "button_secondary_foreground",
  "button_secondary_hover",
  "button_success",
  "button_success_active",
  "button_success_foreground",
  "button_success_hover",
  "button_warning",
  "button_warning_active",
  "button_warning_foreground",
  "button_warning_hover",
  "group_box",
  "group_box_foreground",
  "caret",
  "chart_1",
  "chart_2",
  "chart_3",
  "chart_4",
  "chart_5",
  "chart_bullish",
  "chart_bearish",
  "chart_grid",
  "danger",
  "danger_active",
  "danger_foreground",
  "danger_hover",
  "description_list_label",
  "description_list_label_foreground",
  "drag_border",
  "drop_target",
  "foreground",
  "info",
  "info_active",
  "info_foreground",
  "info_hover",
  "input",
  "link",
  "link_active",
  "link_hover",
  "list",
  "list_active",
  "list_active_border",
  "list_even",
  "list_head",
  "list_hover",
  "muted",
  "muted_foreground",
  "popover",
  "popover_foreground",
  "primary",
  "primary_active",
  "primary_foreground",
  "primary_hover",
  "progress_bar",
  "ring",
  "scrollbar",
  "scrollbar_thumb",
  "scrollbar_thumb_hover",
  "secondary",
  "secondary_active",
  "secondary_foreground",
  "secondary_hover",
  "selection",
  "sidebar",
  "sidebar_accent",
  "sidebar_accent_foreground",
  "sidebar_border",
  "sidebar_foreground",
  "sidebar_primary",
  "sidebar_primary_foreground",
  "skeleton",
  "slider_bar",
  "slider_thumb",
  "success",
  "success_foreground",
  "success_hover",
  "success_active",
  "switch",
  "switch_thumb",
  "tab",
  "tab_active",
  "tab_active_foreground",
  "tab_bar",
  "tab_bar_segmented",
  "tab_foreground",
  "table",
  "table_active",
  "table_active_border",
  "table_even",
  "table_head",
  "table_head_foreground",
  "table_foot",
  "table_foot_foreground",
  "table_hover",
  "table_row_border",
  "title_bar",
  "title_bar_border",
  "status_bar",
  "status_bar_border",
  "warning",
  "warning_active",
  "warning_hover",
  "warning_foreground",
  "overlay",
  "window_border",
  "red",
  "red_light",
  "green",
  "green_light",
  "blue",
  "blue_light",
  "yellow",
  "yellow_light",
  "magenta",
  "magenta_light",
  "cyan",
  "cyan_light",
] as const;
export type ThemeColorName = typeof THEME_COLOR_KEYS[number];
export type ThemeColors = Readonly<Record<ThemeColorName, string> & Record<string, string>>;

/** Theme-file keys from the complete GPUI ThemeConfigColors schema. */
export const THEME_CONFIG_COLOR_KEYS = [
  "accent.background",
  "accent.foreground",
  "accordion.background",
  "background",
  "border",
  "button.background",
  "button.active.background",
  "button.foreground",
  "button.hover.background",
  "button.danger.background",
  "button.danger.active.background",
  "button.danger.foreground",
  "button.danger.hover.background",
  "button.info.background",
  "button.info.active.background",
  "button.info.foreground",
  "button.info.hover.background",
  "button.primary.background",
  "button.primary.active.background",
  "button.primary.foreground",
  "button.primary.hover.background",
  "button.secondary.background",
  "button.secondary.active.background",
  "button.secondary.foreground",
  "button.secondary.hover.background",
  "button.success.background",
  "button.success.active.background",
  "button.success.foreground",
  "button.success.hover.background",
  "button.warning.background",
  "button.warning.active.background",
  "button.warning.foreground",
  "button.warning.hover.background",
  "group_box.background",
  "group_box.foreground",
  "group_box.title.foreground",
  "caret",
  "chart.1",
  "chart.2",
  "chart.3",
  "chart.4",
  "chart.5",
  "chart.bullish",
  "chart.bearish",
  "chart.grid",
  "danger.background",
  "danger.active.background",
  "danger.foreground",
  "danger.hover.background",
  "description_list.label.background",
  "description_list.label.foreground",
  "drag.border",
  "drop_target.background",
  "foreground",
  "info.background",
  "info.active.background",
  "info.foreground",
  "info.hover.background",
  "input.border",
  "link",
  "link.active",
  "link.hover",
  "list.background",
  "list.active.background",
  "list.active.border",
  "list.even.background",
  "list.head.background",
  "list.hover.background",
  "muted.background",
  "muted.foreground",
  "popover.background",
  "popover.foreground",
  "primary.background",
  "primary.active.background",
  "primary.foreground",
  "primary.hover.background",
  "progress.bar.background",
  "ring",
  "scrollbar.background",
  "scrollbar.thumb.background",
  "scrollbar.thumb.hover.background",
  "secondary.background",
  "secondary.active.background",
  "secondary.foreground",
  "secondary.hover.background",
  "selection.background",
  "sidebar.background",
  "sidebar.accent.background",
  "sidebar.accent.foreground",
  "sidebar.border",
  "sidebar.foreground",
  "sidebar.primary.background",
  "sidebar.primary.foreground",
  "skeleton.background",
  "slider.background",
  "slider.thumb.background",
  "success.background",
  "success.foreground",
  "success.hover.background",
  "success.active.background",
  "switch.background",
  "switch.thumb.background",
  "tab.background",
  "tab.active.background",
  "tab.active.foreground",
  "tab_bar.background",
  "tab_bar.segmented.background",
  "tab.foreground",
  "table.background",
  "table.active.background",
  "table.active.border",
  "table.even.background",
  "table.head.background",
  "table.head.foreground",
  "table.foot.background",
  "table.foot.foreground",
  "table.hover.background",
  "table.row.border",
  "title_bar.background",
  "title_bar.border",
  "status_bar.background",
  "status_bar.border",
  "warning.background",
  "warning.active.background",
  "warning.hover.background",
  "warning.foreground",
  "overlay",
  "window.border",
  "base.blue",
  "base.blue.light",
  "base.cyan",
  "base.cyan.light",
  "base.green",
  "base.green.light",
  "base.magenta",
  "base.magenta.light",
  "base.red",
  "base.red.light",
  "base.yellow",
  "base.yellow.light",
] as const;
export type ThemeConfigColorName = typeof THEME_CONFIG_COLOR_KEYS[number];
export type ThemeConfigColors = Readonly<Partial<Record<ThemeConfigColorName, string | null>> & ThemeObject>;

export interface ThemeConfig extends ThemeObject {
  readonly name: string;
  readonly mode: ThemeMode;
  readonly is_default?: boolean;
  readonly "font.size"?: number | null;
  readonly "font.family"?: string | null;
  readonly "mono_font.size"?: number | null;
  readonly "mono_font.family"?: string | null;
  readonly radius?: number | null;
  readonly "radius.lg"?: number | null;
  readonly "window.radius"?: number | null;
  readonly shadow?: boolean | null;
  readonly colors: ThemeConfigColors;
  readonly highlight?: ThemeObject | null;
}
export interface ThemeToken extends ThemeObject {
  readonly color: string;
  readonly background: ThemeValue;
}
/** All serializable native Theme fields, plus its full semantic projection. */
export interface Theme extends ThemeObject {
  readonly mode: ThemeMode;
  readonly colors: ThemeColors;
  readonly light_theme: ThemeConfig;
  readonly dark_theme: ThemeConfig;
  readonly tokens: Readonly<Record<string, ThemeToken>>;
  readonly semantic_tokens: ThemeObject;
  readonly highlight_theme: ThemeObject;
  readonly font_family: string;
  readonly font_size: number;
  readonly mono_font_family: string;
  readonly mono_font_size: number;
  readonly radius: number;
  readonly radius_lg: number;
  readonly window_radius: number;
  readonly shadow: boolean;
  readonly focus_ring: boolean;
  readonly transparent: string;
  readonly scrollbar_mode: string;
  readonly list: ThemeObject;
  readonly sheet: ThemeObject;
}

function object(value: ThemeValue | undefined): value is ThemeObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const mode = (value: unknown): value is ThemeMode => value === "light" || value === "dark";
const color = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 128 && CSS.supports("color", value);

/** Clone/freeze the complete JSON tree; never project it onto a field whitelist. */
export function decodeTheme(value: unknown): Readonly<Theme> | null {
  let nodes = 0;
  let characters = 0;
  const ancestors = new Set<object>();
  const clone = (value: unknown, depth: number): ThemeValue => {
    if (++nodes > 50000 || depth > 32) throw new Error("Theme exceeds limits");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      characters += value.length;
      if (value.length > 65536 || characters > 1024 * 1024) throw new Error("Theme exceeds limits");
      return value;
    }
    if (typeof value !== "object" || ancestors.has(value)) throw new Error("Invalid theme JSON");
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
      throw new Error("Invalid theme object");
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        if (value.length > 50000 - nodes) throw new Error("Theme exceeds limits");
        return Object.freeze(Array.from(value, item => clone(item, depth + 1)));
      }
      const source = Object.entries(value);
      if (source.length > 50000 - nodes) throw new Error("Theme exceeds limits");
      const entries = source.map(([key, item]) => {
        characters += key.length;
        if (key.length > 256 || characters > 1024 * 1024) throw new Error("Theme exceeds limits");
        return [key, clone(item, depth + 1)] as const;
      });
      return Object.freeze(Object.fromEntries(entries));
    } finally { ancestors.delete(value); }
  };
  try {
    const theme = clone(value, 0);
    if (!object(theme) || !mode(theme.mode)) return null;
    const colors = theme.colors;
    if (!object(colors) || !THEME_COLOR_KEYS.every(key => color(colors[key]))) return null;
    if (!Object.values(colors).every(color)) return null;
    for (const [key, expected] of [["light_theme", "light"], ["dark_theme", "dark"]] as const) {
      const config = theme[key];
      if (!object(config) || config.mode !== expected || typeof config.name !== "string" || !object(config.colors)) return null;
      if (!Object.values(config.colors).every(value => value === null || typeof value === "string")) return null;
      for (const key of ["font.size", "mono_font.size", "radius", "radius.lg", "window.radius"]) {
        const value = config[key];
        if (value !== undefined && value !== null && (typeof value !== "number" || value < 0)) return null;
      }
      for (const key of ["font.family", "mono_font.family"]) {
        if (config[key] !== undefined && config[key] !== null && typeof config[key] !== "string") return null;
      }
      if (config.is_default !== undefined && typeof config.is_default !== "boolean") return null;
      if (config.shadow !== undefined && config.shadow !== null && typeof config.shadow !== "boolean") return null;
      if (config.highlight !== undefined && config.highlight !== null && !object(config.highlight)) return null;
    }
    for (const key of ["font_family", "mono_font_family", "scrollbar_mode"]) {
      if (typeof theme[key] !== "string") return null;
    }
    for (const key of ["font_size", "mono_font_size", "radius", "radius_lg", "window_radius"]) {
      const value = theme[key];
      if (typeof value !== "number" || value < 0) return null;
    }
    if (typeof theme.shadow !== "boolean" || typeof theme.focus_ring !== "boolean" || !color(theme.transparent)) return null;
    for (const key of ["tokens", "semantic_tokens", "highlight_theme", "list", "sheet"]) {
      if (!object(theme[key])) return null;
    }
    for (const token of Object.values(theme.tokens as ThemeObject)) {
      if (!object(token) || !color(token.color) || !("background" in token)) return null;
    }
    return theme as Theme;
  } catch { return null; }
}

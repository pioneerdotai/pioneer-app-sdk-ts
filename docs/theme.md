# Complete application theme (SDK 0.2)

```ts
const app = await connectApp();
app.theme.subscribe(theme => {
  theme.mode;                              // "light" | "dark"
  theme.colors.success;                    // resolved current CSS color
  theme.colors.tab_bar;
  theme.colors.scrollbar_thumb;
  theme.light_theme.colors["base.blue.light"];
  theme.dark_theme.colors["success.background"];
  theme.dark_theme["font.size"];
  theme.dark_theme.highlight;
  theme.tokens.background;                 // solid color + native background data
  theme.semantic_tokens;                   // complete colors/radius/spacing/etc.
  theme.highlight_theme;
  theme.font_family;
  theme.mono_font_family;
  theme.radius;
});
```

The message is `{ type: "pioneer.theme", theme: { ... } }`. `theme.current` is that
complete snapshot, not a selected color palette. It is recursively immutable and
retains every serializable field, including future fields unknown to this SDK.
Both Light and Dark configs are included regardless of which mode is active.
Config color keys use the original dotted spelling from the theme-file schema;
resolved current colors use native ThemeColor names. Config values can be null
when inherited. Use resolved `theme.colors` to render the current appearance.

The exported `Theme`, `ThemeColors`, `ThemeConfig` and `ThemeConfigColors` types
cover the complete known schema. `THEME_COLOR_KEYS` lists all 139 resolved color
roles, and `THEME_CONFIG_COLOR_KEYS` lists all 140 theme-file roles from the pinned
GPUI schema, including every color in Pioneer's theme template. Open JSON index
signatures preserve access to future keys without requiring another transport
change. Native delivery serializes the theme directly; those SDK lists validate
and describe known fields, and never filter unknown fields out of a snapshot.

Font sizes and radii are numeric pixels. Colors serialized by native GPUI use
`#RRGGBBAA`; other CSS color strings are accepted for resolved colors. Native
background/gradient and highlighting objects are retained as JSON data. SDK
performs no CSS injection or implicit conversion of native drawing structures.

## Migrating from 0.1

| Previous | 0.2 |
| --- | --- |
| `theme.appearance` | `theme.mode` |
| `theme.background` / `foreground` / `border` | `theme.colors.background` / `foreground` / `border` |
| `theme.muted` | `theme.colors.muted_foreground` |
| `theme.accent` / `theme["accent-foreground"]` | `theme.colors.primary` / `primary_foreground` |
| `theme.success`, `warning`, `danger`, `info` | `theme.colors.success`, `warning`, `danger`, `info` |

No flat aliases or old-palette adapter are provided. Use the updated Desktop
bridge and SDK 0.2 together. Outside Pioneer, `theme.current` remains null until a
complete valid snapshot arrives; applications own any standalone defaults.

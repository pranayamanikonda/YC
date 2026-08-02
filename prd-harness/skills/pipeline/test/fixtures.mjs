/** Shared test fixtures (not a test file, so importing it runs no tests). */

/** A valid DTCG tokens.json that passes validateTokens with zero errors. */
export const VALID_TOKENS_JSON = JSON.stringify({
  $themes: ["light", "dark"],
  primitive: {
    color: { $type: "color", blue: { 600: { $value: "#1d4ed8" } }, slate: { 900: { $value: "#0b0b0c" }, 50: { $value: "#ffffff" } } },
  },
  semantic: {
    color: {
      $type: "color",
      background: { default: { $value: { light: "{primitive.color.slate.50}", dark: "{primitive.color.slate.900}" } } },
      text: { default: { $value: { light: "{primitive.color.blue.600}", dark: "#e6e6e6" }, $extensions: { qm: { contrastAgainst: "{semantic.color.background.default}", min: 4.5 } } } },
      action: { primary: { $value: "{primitive.color.blue.600}" } },
    },
  },
  component: { button: { $type: "color", background: { default: { $value: "{semantic.color.action.primary}" } } } },
});

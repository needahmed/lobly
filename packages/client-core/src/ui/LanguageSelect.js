import { jsx as _jsx } from "react/jsx-runtime";
import { c, radius } from "./theme";
export const MATCH_LANGUAGES = [
    { code: "en", label: "English" },
    { code: "de", label: "German" },
    { code: "fr", label: "French" },
    { code: "es", label: "Spanish" },
    { code: "pt", label: "Portuguese" },
    { code: "it", label: "Italian" },
    { code: "pl", label: "Polish" },
    { code: "tr", label: "Turkish" },
    { code: "ru", label: "Russian" },
    { code: "ar", label: "Arabic" },
    { code: "ko", label: "Korean" },
    { code: "ja", label: "Japanese" },
    { code: "zh", label: "Chinese" },
];
export function LanguageMultiSelect({ value, onChange, disabled, }) {
    const selected = new Set(value.map((v) => v.toLowerCase()));
    return (_jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: MATCH_LANGUAGES.map((lang) => {
            const on = selected.has(lang.code);
            return (_jsx("button", { type: "button", disabled: disabled, title: lang.label, onClick: () => {
                    const next = on
                        ? value.filter((v) => v.toLowerCase() !== lang.code)
                        : [...value.filter((v) => v.toLowerCase() !== lang.code), lang.code];
                    onChange(next);
                }, style: {
                    border: `1px solid ${on ? c.borderStrong : c.border}`,
                    background: on ? c.primarySoft : "transparent",
                    color: on ? c.primary : c.textDim,
                    borderRadius: radius.pill,
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    cursor: disabled ? "default" : "pointer",
                    opacity: disabled ? 0.55 : 1,
                }, children: lang.code.toUpperCase() }, lang.code));
        }) }));
}
